use super::{DownloadProgress, ModelManager, ModelStatus};
use crate::summary::summary_engine::models::{get_model_by_name, ModelDef};
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use std::path::Path;
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::time::timeout;

mod support;
use support::*;

impl ModelManager {
    /// Download a model with detailed progress (MB, speed, etc.).
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);
        self.ensure_download_can_start(model_name).await?;

        let model_def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;
        self.start_download_state(model_name).await;
        self.set_model_status(model_name, ModelStatus::Downloading { progress: 0 })
            .await;

        let file_path = self.models_dir.join(&model_def.gguf_file);
        if let Some(total) = self
            .valid_existing_model_size(model_name, &model_def, &file_path)
            .await?
        {
            self.set_model_status(model_name, ModelStatus::Available)
                .await;
            self.remove_active_download(model_name).await;
            if let Some(callback) = &progress_callback {
                callback(DownloadProgress::new(total, total, 0.0));
            }
            return Ok(());
        }

        log::info!("Downloading from: {}", model_def.download_url);
        log::info!("Saving to: {}", file_path.display());
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await?;
        }

        let existing_size = existing_file_size(&file_path).await;
        let client = download_client()?;
        let started = self
            .start_download_response(model_name, &model_def.download_url, existing_size, &client)
            .await?;
        log::info!("Total size: {} MB", started.total_size / (1024 * 1024));

        let mut writer = open_model_file(&file_path, started.resuming).await?;
        let mut progress = DownloadProgressState::new(
            if started.resuming { existing_size } else { 0 },
            started.total_size,
            progress_callback,
        );
        progress.emit_initial_progress();

        self.stream_download(model_name, started.response, &mut writer, &mut progress)
            .await?;
        writer.flush().await?;
        drop(writer);

        self.complete_download(model_name, &file_path, &mut progress)
            .await
    }

    async fn valid_existing_model_size(
        &self,
        model_name: &str,
        model_def: &ModelDef,
        file_path: &Path,
    ) -> Result<Option<u64>> {
        if !file_path.exists() {
            return Ok(None);
        }

        let Ok(metadata) = fs::metadata(file_path).await else {
            return Ok(None);
        };
        let file_size_mb = metadata.len() / (1024 * 1024);
        let expected_min = (model_def.size_mb as f64 * 0.9) as u64;
        let expected_max = (model_def.size_mb as f64 * 1.1) as u64;

        if file_size_mb >= expected_min && file_size_mb <= expected_max {
            log::info!(
                "Model '{}' already exists and is valid ({} MB), skipping download",
                model_name,
                file_size_mb
            );
            return Ok(Some(metadata.len()));
        }

        if file_size_mb > expected_max {
            log::warn!(
                "Model '{}' exists but is too large ({} MB, expected max {} MB), deleting and re-downloading",
                model_name,
                file_size_mb,
                expected_max
            );
            if let Err(e) = fs::remove_file(file_path).await {
                log::warn!("Failed to delete oversized model file: {}", e);
            }
        } else {
            log::info!(
                "Model '{}' exists but is incomplete ({} MB, expected min {} MB), will resume download",
                model_name,
                file_size_mb,
                expected_min
            );
        }

        Ok(None)
    }

    async fn start_download_response(
        &self,
        model_name: &str,
        download_url: &str,
        existing_size: u64,
        client: &reqwest::Client,
    ) -> Result<StartedDownload> {
        let mut request = client.get(download_url);
        if existing_size > 0 {
            log::info!(
                "Resuming download from byte {} ({:.1} MB)",
                existing_size,
                existing_size as f64 / (1024.0 * 1024.0)
            );
            request = request.header("Range", format!("bytes={}-", existing_size));
        }

        let response = request
            .send()
            .await
            .map_err(|e| anyhow!("Failed to start download: {}", e))?;

        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let remaining = response.content_length().unwrap_or(0);
            log::info!(
                "Server supports resume, {} MB remaining",
                remaining / (1024 * 1024)
            );
            return Ok(StartedDownload {
                response,
                total_size: existing_size + remaining,
                resuming: true,
            });
        }

        if response.status().is_success() {
            if existing_size > 0 {
                log::warn!("Server doesn't support resume, starting fresh download");
            }
            return Ok(StartedDownload {
                total_size: response.content_length().unwrap_or(0),
                response,
                resuming: false,
            });
        }

        self.remove_active_download(model_name).await;
        Err(anyhow!(
            "Download failed with status: {}",
            response.status()
        ))
    }

    async fn stream_download(
        &self,
        model_name: &str,
        response: reqwest::Response,
        writer: &mut BufWriter<fs::File>,
        progress: &mut DownloadProgressState,
    ) -> Result<()> {
        log::info!(
            "Starting at {:.1} MB / {:.1} MB",
            progress.downloaded as f64 / (1024.0 * 1024.0),
            progress.total_size as f64 / (1024.0 * 1024.0)
        );

        let mut stream = response.bytes_stream();
        loop {
            if self.download_is_cancelled(model_name).await {
                return self.handle_cancelled_download(model_name, writer).await;
            }

            let chunk = match timeout(Duration::from_secs(30), stream.next()).await {
                Err(_) => return self.handle_download_timeout(model_name, writer).await,
                Ok(None) => break,
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(e))) => return self.handle_stream_error(model_name, writer, e).await,
            };

            writer
                .write_all(&chunk)
                .await
                .map_err(|e| anyhow!("Error writing to file: {}", e))?;
            progress.record_chunk(chunk.len() as u64);
            if progress.should_report() {
                self.report_download_progress(model_name, progress).await;
            }
        }

        Ok(())
    }

    async fn report_download_progress(
        &self,
        model_name: &str,
        progress: &mut DownloadProgressState,
    ) {
        let speed_mbps = progress.speed_mbps();
        let percent = progress_percent(progress.downloaded, progress.total_size);
        let status_percent = if progress.downloaded >= progress.total_size {
            100
        } else {
            percent
        };

        log::info!(
            "Download: {:.1} MB / {:.1} MB ({:.1} MB/s)",
            progress.downloaded as f64 / (1024.0 * 1024.0),
            progress.total_size as f64 / (1024.0 * 1024.0),
            speed_mbps
        );
        self.set_model_status(
            model_name,
            ModelStatus::Downloading {
                progress: status_percent,
            },
        )
        .await;
        progress.emit_progress(speed_mbps);
        progress.mark_reported();
    }

    async fn complete_download(
        &self,
        model_name: &str,
        file_path: &Path,
        progress: &mut DownloadProgressState,
    ) -> Result<()> {
        log::info!("Download completed for model: {}", model_name);
        self.set_model_status(model_name, ModelStatus::Downloading { progress: 100 })
            .await;
        progress.emit_final_progress();

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if let Err(e) = validate_gguf_file(file_path).await {
            self.handle_validation_error(model_name, file_path, e)
                .await?;
        }

        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::Available;
                model_info.path = file_path.to_path_buf();
            }
        }
        self.remove_active_download(model_name).await;
        Ok(())
    }

    async fn handle_validation_error(
        &self,
        model_name: &str,
        file_path: &Path,
        error: anyhow::Error,
    ) -> Result<()> {
        log::error!("Downloaded file failed validation: {}", error);
        let _ = fs::remove_file(file_path).await;
        self.set_model_status(
            model_name,
            ModelStatus::Error(format!("Validation failed: {}", error)),
        )
        .await;
        self.remove_active_download(model_name).await;
        Err(anyhow!("File validation failed: {}", error))
    }

    async fn handle_cancelled_download(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
    ) -> Result<()> {
        log::info!("Download cancelled for model: {}", model_name);
        let _ = writer.flush().await;
        self.remove_active_download(model_name).await;
        self.set_model_status(model_name, ModelStatus::NotDownloaded)
            .await;
        Err(anyhow!("CANCELLED: Download cancelled by user"))
    }

    async fn handle_download_timeout(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
    ) -> Result<()> {
        log::warn!(
            "Download timeout for {}: no data received for 30 seconds",
            model_name
        );
        let _ = writer.flush().await;
        self.remove_active_download(model_name).await;
        self.set_model_status(
            model_name,
            ModelStatus::Error("Download timeout - No data received for 30 seconds".to_string()),
        )
        .await;
        Err(anyhow!(
            "Download timeout - No data received for 30 seconds"
        ))
    }

    async fn handle_stream_error(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
        error: reqwest::Error,
    ) -> Result<()> {
        log::error!("Download error for {}: {:?}", model_name, error);
        let _ = writer.flush().await;
        self.remove_active_download(model_name).await;

        let error_msg = download_error_label(&error);
        self.set_model_status(model_name, ModelStatus::Error(error_msg.to_string()))
            .await;
        Err(anyhow!("{}: {}", error_msg, error))
    }

    async fn ensure_download_can_start(&self, model_name: &str) -> Result<()> {
        let active = self.active_downloads.read().await;
        if active.contains(model_name) {
            log::warn!("Download already in progress for model: {}", model_name);
            return Err(anyhow!("Download already in progress"));
        }
        Ok(())
    }

    async fn start_download_state(&self, model_name: &str) {
        {
            let mut active = self.active_downloads.write().await;
            active.insert(model_name.to_string());
        }
        let mut cancel_flag = self.cancel_download_flag.write().await;
        *cancel_flag = None;
    }

    async fn set_model_status(&self, model_name: &str, status: ModelStatus) {
        let mut models = self.available_models.write().await;
        if let Some(model_info) = models.get_mut(model_name) {
            model_info.status = status;
        }
    }

    async fn remove_active_download(&self, model_name: &str) {
        let mut active = self.active_downloads.write().await;
        active.remove(model_name);
    }

    async fn download_is_cancelled(&self, model_name: &str) -> bool {
        self.cancel_download_flag.read().await.as_deref() == Some(model_name)
    }
}
