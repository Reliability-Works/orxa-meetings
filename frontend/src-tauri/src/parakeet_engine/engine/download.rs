use super::{DownloadProgress, ModelStatus, ParakeetEngine};
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use std::path::Path;
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::time::timeout;

mod support;
use support::*;
mod state;

impl ParakeetEngine {
    /// Delete a corrupted model.
    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete Parakeet model: {}", model_name);
        let model_info = self
            .model_info(model_name)
            .await
            .ok_or_else(|| anyhow!("Parakeet model '{}' not found", model_name))?;

        log::info!(
            "Parakeet model '{}' has status: {:?}",
            model_name,
            model_info.status
        );

        match &model_info.status {
            ModelStatus::Corrupted { .. } | ModelStatus::Available => {
                self.delete_model_directory(&model_info).await?;
                self.set_model_status(model_name, ModelStatus::Missing).await;
                Ok(format!("Successfully deleted Parakeet model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available Parakeet models. Model '{}' has status: {:?}",
                model_name,
                model_info.status
            )),
        }
    }

    /// Download a Parakeet model from HuggingFace (backward-compatible wrapper).
    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        let detailed_callback: Option<Box<dyn Fn(DownloadProgress) + Send>> = progress_callback
            .map(|cb| {
                Box::new(move |p: DownloadProgress| cb(p.percent))
                    as Box<dyn Fn(DownloadProgress) + Send>
            });
        self.download_model_detailed(model_name, detailed_callback)
            .await
    }

    /// Download a Parakeet model with detailed progress (MB/speed/resume support).
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for Parakeet model: {}", model_name);
        self.ensure_download_can_start(model_name).await?;
        self.start_download_state(model_name).await;

        let plan = match self.build_download_plan(model_name).await {
            Ok(plan) => plan,
            Err(e) => {
                self.remove_active_download(model_name).await;
                return Err(e);
            }
        };

        self.set_model_status(model_name, ModelStatus::Downloading { progress: 0 })
            .await;
        self.prepare_model_directory(model_name, &plan.model_info.path)
            .await?;

        let client = download_client()?;
        let mut tracker = ProgressTracker::new(
            plan.total_size_bytes,
            plan.already_downloaded,
            plan.files.len(),
            progress_callback,
        );

        log::info!(
            "Starting weighted download for {} files, total size: {:.2} MB (already downloaded: {:.2} MB)",
            plan.files.len(),
            plan.total_size_bytes as f64 / 1_048_576.0,
            plan.already_downloaded as f64 / 1_048_576.0
        );

        for (index, filename) in plan.files.iter().enumerate() {
            let request = ParakeetFileRequest {
                model_name,
                base_url: plan.base_url,
                model_dir: &plan.model_info.path,
                filename,
                index,
                expected_size: plan.file_sizes.get(filename).copied().unwrap_or(0),
            };
            self.download_plan_file(&client, request, &mut tracker)
                .await?;
        }

        self.finish_download(model_name, &plan.model_info.path, &mut tracker)
            .await;
        log::info!("Download completed for Parakeet model: {}", model_name);
        Ok(())
    }

    /// Cancel an ongoing model download.
    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for Parakeet model: {}", model_name);
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = Some(model_name.to_string());
        }

        self.remove_active_download(model_name).await;
        self.set_model_status(model_name, ModelStatus::Missing)
            .await;

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        let model_path = self.models_dir.join(model_name);
        if model_path.exists() {
            if let Err(e) = fs::remove_dir_all(&model_path).await {
                log::warn!("Failed to clean up cancelled download directory: {}", e);
            } else {
                log::info!(
                    "Cleaned up cancelled download directory: {}",
                    model_path.display()
                );
            }
        }

        Ok(())
    }

    async fn download_plan_file(
        &self,
        client: &reqwest::Client,
        request: ParakeetFileRequest<'_>,
        tracker: &mut ProgressTracker,
    ) -> Result<()> {
        let file_path = request.model_dir.join(request.filename);
        let existing_size = existing_file_size(&file_path).await;

        if file_is_complete(existing_size, request.expected_size) {
            log::info!(
                "Skipping complete file: {} ({:.2} MB, expected: {:.2} MB)",
                request.filename,
                existing_size as f64 / 1_048_576.0,
                request.expected_size as f64 / 1_048_576.0
            );
            return Ok(());
        }

        log::info!(
            "Downloading file {}/{}: {} (resuming from {} bytes)",
            request.index + 1,
            tracker.total_files,
            request.filename,
            existing_size
        );

        let Some(started) = self
            .start_file_download(client, &request, &file_path, existing_size)
            .await?
        else {
            return Ok(());
        };
        let mut writer = open_download_file(&file_path, request.filename, started.resuming).await?;
        let context = ParakeetStreamContext {
            model_name: request.model_name,
            index: request.index,
            file_total_size: started.file_total_size,
            existing_size,
        };
        let file_downloaded = self
            .stream_file(started.response, &mut writer, context, tracker)
            .await?;

        if let Err(e) = writer.flush().await {
            self.mark_download_missing(request.model_name).await;
            return Err(anyhow!("Failed to flush file {}: {}", request.filename, e));
        }

        log::info!(
            "Completed download: {} ({:.2} MB, overall progress: {:.1}%)",
            request.filename,
            file_downloaded as f64 / 1_048_576.0,
            (tracker.total_downloaded as f64 / tracker.total_size_bytes as f64) * 100.0
        );
        Ok(())
    }

    async fn stream_file(
        &self,
        response: reqwest::Response,
        writer: &mut BufWriter<fs::File>,
        context: ParakeetStreamContext<'_>,
        tracker: &mut ProgressTracker,
    ) -> Result<u64> {
        let mut stream = response.bytes_stream();
        let mut file_downloaded = context.existing_size;

        loop {
            if self.download_is_cancelled(context.model_name).await {
                return self
                    .handle_cancelled_stream(context.model_name, writer)
                    .await;
            }

            let chunk = match timeout(Duration::from_secs(30), stream.next()).await {
                Err(_) => return self.handle_stream_timeout(context.model_name, writer).await,
                Ok(None) => break,
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(e))) => {
                    return self
                        .handle_stream_error(context.model_name, writer, e)
                        .await;
                }
            };

            if let Err(e) = writer.write_all(&chunk).await {
                self.mark_download_missing(context.model_name).await;
                return Err(anyhow!("Failed to write chunk to file: {}", e));
            }

            let chunk_len = chunk.len() as u64;
            file_downloaded += chunk_len;
            tracker.record_chunk(chunk_len);
            self.report_progress(&context, file_downloaded, tracker)
                .await;
        }

        Ok(file_downloaded)
    }

    async fn report_progress(
        &self,
        context: &ParakeetStreamContext<'_>,
        file_downloaded: u64,
        tracker: &mut ProgressTracker,
    ) {
        let progress =
            tracker.overall_progress(file_downloaded, context.file_total_size, context.index);
        let is_complete = file_downloaded >= context.file_total_size;
        if !tracker.should_report(progress, is_complete) {
            return;
        }

        let speed_mbps = tracker.current_speed_mbps();
        tracker.mark_reported(progress);
        tracker.emit_progress(speed_mbps);
        self.set_model_status(context.model_name, ModelStatus::Downloading { progress })
            .await;
    }

    async fn start_file_download(
        &self,
        client: &reqwest::Client,
        request: &ParakeetFileRequest<'_>,
        file_path: &Path,
        existing_size: u64,
    ) -> Result<Option<StartedFileDownload>> {
        let file_url = format!("{}/{}", request.base_url, request.filename);
        let mut response =
            send_download_request(client, &file_url, existing_size, request.filename).await?;

        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let remaining = response.content_length().unwrap_or(0);
            log::info!("Server supports resume, remaining: {} bytes", remaining);
            return Ok(Some(StartedFileDownload {
                response,
                file_total_size: existing_size + remaining,
                resuming: true,
            }));
        }

        if response.status().is_success() {
            if existing_size > 0 {
                log::warn!(
                    "Server doesn't support resume for {}, starting fresh download",
                    request.filename
                );
            }
            return Ok(Some(StartedFileDownload {
                file_total_size: response.content_length().unwrap_or(0),
                response,
                resuming: false,
            }));
        }

        if response.status() != reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            self.remove_active_download(request.model_name).await;
            return Err(anyhow!(
                "Download failed for {} with status: {}",
                request.filename,
                response.status()
            ));
        }

        log::warn!(
            "Server returned 416 Range Not Satisfiable for {}",
            request.filename
        );
        if file_is_complete(existing_size, request.expected_size) {
            log::info!(
                "File {} complete ({} bytes). Skipping.",
                request.filename,
                existing_size
            );
            return Ok(None);
        }

        self.delete_incomplete_file(request.model_name, request.filename, file_path)
            .await?;
        log::info!("Retrying {} without resume", request.filename);
        response = client
            .get(&file_url)
            .send()
            .await
            .map_err(|e| anyhow!("Retry failed for {}: {}", request.filename, e))?;

        if !response.status().is_success() {
            self.remove_active_download(request.model_name).await;
            return Err(anyhow!(
                "Retry failed for {} with status: {}",
                request.filename,
                response.status()
            ));
        }

        Ok(Some(StartedFileDownload {
            file_total_size: response.content_length().unwrap_or(0),
            response,
            resuming: false,
        }))
    }

    async fn build_download_plan(&self, model_name: &str) -> Result<ParakeetDownloadPlan> {
        let model_info = self
            .model_info(model_name)
            .await
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;
        let files = files_for_quantization(&model_info.quantization);
        let file_sizes = file_sizes_for_model(model_name, &model_info.quantization);
        let total_size_bytes = files
            .iter()
            .filter_map(|file| file_sizes.get(file))
            .copied()
            .sum();
        let already_downloaded =
            existing_downloaded_bytes(&model_info.path, &files, &file_sizes).await;
        let base_url = if model_name.contains("-v2-") {
            "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/main"
        } else {
            "https://orxa.towardsgeneralintelligence.com/models/parakeet-tdt-0.6b-v3-onnx"
        };

        Ok(ParakeetDownloadPlan {
            model_info,
            base_url,
            files,
            file_sizes,
            total_size_bytes,
            already_downloaded,
        })
    }

    async fn prepare_model_directory(&self, model_name: &str, model_dir: &Path) -> Result<()> {
        if !model_dir.exists() {
            if let Err(e) = fs::create_dir_all(model_dir).await {
                self.remove_active_download(model_name).await;
                return Err(anyhow!("Failed to create model directory: {}", e));
            }
        }

        log::info!("Checking for incomplete model files to clean up...");
        if let Err(e) = self.clean_incomplete_model_directory(model_dir).await {
            log::warn!("Failed to clean incomplete model directory: {}", e);
        }
        Ok(())
    }

    async fn clean_incomplete_model_directory(&self, model_dir: &Path) -> Result<()> {
        if !model_dir.exists() {
            return Ok(());
        }

        if self.validate_model_directory(model_dir).await.is_ok() {
            log::info!("Model directory is valid, no cleanup needed");
            return Ok(());
        }

        self.remove_model_dir_files(model_dir).await
    }

    async fn remove_model_dir_files(&self, model_dir: &Path) -> Result<()> {
        let mut entries = fs::read_dir(model_dir)
            .await
            .map_err(|e| anyhow!("Failed to read model directory: {}", e))?;
        let mut removed_count = 0;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| anyhow!("Failed to read directory entry: {}", e))?
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            match fs::remove_file(&path).await {
                Ok(_) => {
                    log::info!("Removed incomplete file: {:?}", path.file_name());
                    removed_count += 1;
                }
                Err(e) => log::warn!("Failed to remove file {:?}: {}", path, e),
            }
        }

        log::info!(
            "Cleaned {} incomplete files from model directory",
            removed_count
        );
        Ok(())
    }
}
