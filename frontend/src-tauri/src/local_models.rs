use chrono::Utc;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use url::Url;

static ACTIVE_DOWNLOADS: Lazy<Arc<RwLock<HashSet<String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashSet::new())));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalModelDownloadStatus {
    pub model_id: String,
    pub state: String,
    pub path: String,
    pub source_url: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub file_count: usize,
    pub updated_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalModelManifest {
    model_id: String,
    name: String,
    source_url: String,
    downloaded_at: String,
    files: Vec<LocalModelFile>,
    total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalModelFile {
    path: String,
    bytes: u64,
}

#[derive(Debug, Deserialize)]
struct HfModelResponse {
    siblings: Vec<HfSibling>,
    #[serde(rename = "usedStorage")]
    used_storage: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
}

#[derive(Debug, Deserialize)]
struct GithubRepoResponse {
    default_branch: String,
}

#[tauri::command]
pub async fn local_model_get_statuses<R: Runtime>(
    app: AppHandle<R>,
    model_ids: Vec<String>,
) -> Result<Vec<LocalModelDownloadStatus>, String> {
    let root = local_model_root(&app)?;
    let active = ACTIVE_DOWNLOADS.read().await;

    model_ids
        .iter()
        .map(|model_id| {
            let mut status = read_status(&root, model_id)?;
            if active.contains(model_id) {
                status.state = "downloading".to_string();
            }
            Ok(status)
        })
        .collect()
}

#[tauri::command]
pub async fn local_model_download_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
    name: String,
    source_url: String,
) -> Result<LocalModelDownloadStatus, String> {
    {
        let mut active = ACTIVE_DOWNLOADS.write().await;
        if active.contains(&model_id) {
            return Err(format!("{} is already downloading", name));
        }
        active.insert(model_id.clone());
    }

    let result = download_model_inner(&app, &model_id, &name, &source_url).await;

    {
        let mut active = ACTIVE_DOWNLOADS.write().await;
        active.remove(&model_id);
    }

    match result {
        Ok(status) => Ok(status),
        Err(error) => {
            emit_progress(
                &app,
                &model_id,
                &name,
                0.0,
                0,
                0,
                0.0,
                "error",
                Some(&error),
                None,
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn local_model_open_folder<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let root = local_model_root(&app)?;
    let folder = model_dir(&root, &model_id);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Failed to create model folder: {}", e))?;
    open_folder(&folder)
}

async fn download_model_inner<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    name: &str,
    source_url: &str,
) -> Result<LocalModelDownloadStatus, String> {
    let root = local_model_root(app)?;
    let folder = model_dir(&root, model_id);
    if folder.exists() {
        tokio::fs::remove_dir_all(&folder)
            .await
            .map_err(|e| format!("Failed to replace existing model folder: {}", e))?;
    }
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|e| format!("Failed to create model folder: {}", e))?;

    emit_progress(
        app,
        model_id,
        name,
        0.0,
        0,
        0,
        0.0,
        "downloading",
        None,
        Some(&folder),
    );

    let client = Client::builder()
        .user_agent("Meetily model downloader")
        .build()
        .map_err(|e| format!("Failed to build download client: {}", e))?;

    let manifest = if let Some(repo_id) = parse_huggingface_repo(source_url) {
        download_huggingface_snapshot(app, &client, model_id, name, source_url, &repo_id, &folder)
            .await?
    } else if let Some((owner, repo)) = parse_github_repo(source_url) {
        download_github_archive(
            app, &client, model_id, name, source_url, &owner, &repo, &folder,
        )
        .await?
    } else {
        return Err(
            "Unsupported model source URL. Use a Hugging Face model URL or GitHub repository URL."
                .to_string(),
        );
    };

    let manifest_path = folder.join("meetily-model-manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to write model manifest: {}", e))?;
    tokio::fs::write(&manifest_path, manifest_json)
        .await
        .map_err(|e| format!("Failed to write model manifest: {}", e))?;

    emit_progress(
        app,
        model_id,
        name,
        100.0,
        manifest.total_bytes,
        manifest.total_bytes,
        0.0,
        "completed",
        None,
        Some(&folder),
    );

    Ok(status_from_manifest(model_id, &folder, &manifest))
}

async fn download_huggingface_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    model_id: &str,
    name: &str,
    source_url: &str,
    repo_id: &str,
    folder: &Path,
) -> Result<LocalModelManifest, String> {
    let api_url = format!("https://huggingface.co/api/models/{}", repo_id);
    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to query Hugging Face model API: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Hugging Face model API returned an error: {}", e))?
        .json::<HfModelResponse>()
        .await
        .map_err(|e| format!("Failed to parse Hugging Face model metadata: {}", e))?;

    let mut files = response
        .siblings
        .into_iter()
        .map(|sibling| sibling.rfilename)
        .filter(|file| should_download_hf_file(file))
        .collect::<Vec<_>>();

    if files.is_empty() {
        return Err("Hugging Face model has no downloadable model files.".to_string());
    }
    files.sort();

    let planned_total = response.used_storage.unwrap_or(0);
    let mut downloaded_total = 0_u64;
    let mut downloaded_files = Vec::new();
    let started = Instant::now();

    for rfilename in files {
        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            repo_id,
            escape_hf_path(&rfilename)
        );
        let destination = folder.join(&rfilename);
        let bytes = download_file(
            app,
            client,
            model_id,
            name,
            &url,
            &destination,
            downloaded_total,
            planned_total,
            started,
        )
        .await?;
        downloaded_total = downloaded_total.saturating_add(bytes);
        downloaded_files.push(LocalModelFile {
            path: rfilename,
            bytes,
        });
    }

    Ok(LocalModelManifest {
        model_id: model_id.to_string(),
        name: name.to_string(),
        source_url: source_url.to_string(),
        downloaded_at: Utc::now().to_rfc3339(),
        total_bytes: downloaded_total,
        files: downloaded_files,
    })
}

async fn download_github_archive<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    model_id: &str,
    name: &str,
    source_url: &str,
    owner: &str,
    repo: &str,
    folder: &Path,
) -> Result<LocalModelManifest, String> {
    let repo_api = format!("https://api.github.com/repos/{}/{}", owner, repo);
    let repo_info = client
        .get(&repo_api)
        .send()
        .await
        .map_err(|e| format!("Failed to query GitHub repository API: {}", e))?
        .error_for_status()
        .map_err(|e| format!("GitHub repository API returned an error: {}", e))?
        .json::<GithubRepoResponse>()
        .await
        .map_err(|e| format!("Failed to parse GitHub repository metadata: {}", e))?;

    let archive_url = format!(
        "https://api.github.com/repos/{}/{}/zipball/{}",
        owner, repo, repo_info.default_branch
    );
    let archive_name = format!("{}-{}.zip", owner, repo);
    let destination = folder.join(&archive_name);
    let bytes = download_file(
        app,
        client,
        model_id,
        name,
        &archive_url,
        &destination,
        0,
        0,
        Instant::now(),
    )
    .await?;

    Ok(LocalModelManifest {
        model_id: model_id.to_string(),
        name: name.to_string(),
        source_url: source_url.to_string(),
        downloaded_at: Utc::now().to_rfc3339(),
        total_bytes: bytes,
        files: vec![LocalModelFile {
            path: archive_name,
            bytes,
        }],
    })
}

async fn download_file<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    model_id: &str,
    name: &str,
    url: &str,
    destination: &Path,
    already_downloaded: u64,
    planned_total: u64,
    started: Instant,
) -> Result<u64, String> {
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create download directory: {}", e))?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Download returned an error: {}", e))?;

    let content_length = response.content_length().unwrap_or(0);
    let effective_total = if planned_total > 0 {
        planned_total
    } else {
        already_downloaded.saturating_add(content_length)
    };
    let part_path = destination.with_extension("part");
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("Failed to create model file: {}", e))?;
    let mut stream = response.bytes_stream();
    let mut file_bytes = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream failed: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write model file: {}", e))?;
        file_bytes = file_bytes.saturating_add(chunk.len() as u64);

        let downloaded = already_downloaded.saturating_add(file_bytes);
        let progress = if effective_total > 0 {
            ((downloaded as f64 / effective_total as f64) * 100.0).min(99.0)
        } else {
            0.0
        };
        let elapsed = started.elapsed().as_secs_f64().max(0.1);
        let speed = downloaded as f64 / elapsed;
        emit_progress(
            app,
            model_id,
            name,
            progress,
            downloaded,
            effective_total,
            speed,
            "downloading",
            None,
            destination.parent(),
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {}", e))?;
    drop(file);
    tokio::fs::rename(&part_path, destination)
        .await
        .map_err(|e| format!("Failed to finalize model file: {}", e))?;

    Ok(file_bytes)
}

fn local_model_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(app_data_dir.join("models").join("catalog"))
}

fn model_dir(root: &Path, model_id: &str) -> PathBuf {
    root.join(sanitize_model_id(model_id))
}

fn manifest_path(root: &Path, model_id: &str) -> PathBuf {
    model_dir(root, model_id).join("meetily-model-manifest.json")
}

fn read_status(root: &Path, model_id: &str) -> Result<LocalModelDownloadStatus, String> {
    let folder = model_dir(root, model_id);
    let manifest_path = manifest_path(root, model_id);
    if !manifest_path.exists() {
        return Ok(LocalModelDownloadStatus {
            model_id: model_id.to_string(),
            state: "missing".to_string(),
            path: folder.to_string_lossy().to_string(),
            source_url: None,
            downloaded_bytes: 0,
            total_bytes: 0,
            file_count: 0,
            updated_at: None,
            error: None,
        });
    }

    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read model manifest: {}", e))?;
    let manifest = serde_json::from_str::<LocalModelManifest>(&raw)
        .map_err(|e| format!("Failed to parse model manifest: {}", e))?;
    Ok(status_from_manifest(model_id, &folder, &manifest))
}

fn status_from_manifest(
    model_id: &str,
    folder: &Path,
    manifest: &LocalModelManifest,
) -> LocalModelDownloadStatus {
    LocalModelDownloadStatus {
        model_id: model_id.to_string(),
        state: "downloaded".to_string(),
        path: folder.to_string_lossy().to_string(),
        source_url: Some(manifest.source_url.clone()),
        downloaded_bytes: manifest.total_bytes,
        total_bytes: manifest.total_bytes,
        file_count: manifest.files.len(),
        updated_at: Some(manifest.downloaded_at.clone()),
        error: None,
    }
}

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    model_name: &str,
    progress: f64,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_second: f64,
    status: &str,
    error: Option<&str>,
    destination: Option<&Path>,
) {
    let _ = app.emit(
        "local-model-download-progress",
        serde_json::json!({
            "modelId": model_id,
            "modelName": model_name,
            "progress": progress,
            "downloaded_mb": downloaded_bytes as f64 / 1_048_576.0,
            "total_mb": total_bytes as f64 / 1_048_576.0,
            "speed_mbps": speed_bytes_per_second / 1_048_576.0,
            "status": status,
            "error": error,
            "path": destination.map(|path| path.to_string_lossy().to_string())
        }),
    );
}

fn parse_huggingface_repo(source_url: &str) -> Option<String> {
    let url = Url::parse(source_url).ok()?;
    if url.host_str()? != "huggingface.co" {
        return None;
    }
    let mut segments = url.path_segments()?;
    let owner = segments.next()?;
    let repo = segments.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{}/{}", owner, repo))
}

fn parse_github_repo(source_url: &str) -> Option<(String, String)> {
    let url = Url::parse(source_url).ok()?;
    if url.host_str()? != "github.com" {
        return None;
    }
    let mut segments = url.path_segments()?;
    let owner = segments.next()?.to_string();
    let repo = segments.next()?.trim_end_matches(".git").to_string();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner, repo))
}

fn should_download_hf_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    if lower == ".gitattributes" || lower == "readme.md" || lower.ends_with("/readme.md") {
        return false;
    }
    let ignored_extensions = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".md", ".pdf",
    ];
    !ignored_extensions
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn escape_hf_path(path: &str) -> String {
    path.split('/')
        .map(|segment| url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>())
        .collect::<Vec<_>>()
        .join("/")
}

fn sanitize_model_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    command
        .status()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}
