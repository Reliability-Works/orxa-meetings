use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use std::path::Path;
use std::time::Instant;
use tauri::{AppHandle, Runtime};
use tokio::io::AsyncWriteExt;
use url::Url;

use super::{emit_progress, LocalModelFile, LocalModelManifest};

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

pub(super) async fn download_huggingface_snapshot<R: Runtime>(
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

#[expect(
    clippy::too_many_arguments,
    reason = "Download helper keeps GitHub archive identity and destination explicit"
)]
pub(super) async fn download_github_archive<R: Runtime>(
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

#[expect(
    clippy::too_many_arguments,
    reason = "Download helper tracks progress inputs without storing mutable shared state"
)]
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

pub(super) fn parse_huggingface_repo(source_url: &str) -> Option<String> {
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

pub(super) fn parse_github_repo(source_url: &str) -> Option<(String, String)> {
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
