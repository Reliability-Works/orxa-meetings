use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::RwLock;

mod download;

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
        .user_agent("Orxa model downloader")
        .build()
        .map_err(|e| format!("Failed to build download client: {}", e))?;

    let manifest = if let Some(repo_id) = download::parse_huggingface_repo(source_url) {
        download::download_huggingface_snapshot(
            app, &client, model_id, name, source_url, &repo_id, &folder,
        )
        .await?
    } else if let Some((owner, repo)) = download::parse_github_repo(source_url) {
        download::download_github_archive(
            app, &client, model_id, name, source_url, &owner, &repo, &folder,
        )
        .await?
    } else {
        return Err(
            "Unsupported model source URL. Use a Hugging Face model URL or GitHub repository URL."
                .to_string(),
        );
    };

    let manifest_path = folder.join("orxa-model-manifest.json");
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
    model_dir(root, model_id).join("orxa-model-manifest.json")
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

#[expect(
    clippy::too_many_arguments,
    reason = "Progress event fields map directly to the frontend download event contract"
)]
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
