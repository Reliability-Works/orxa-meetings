use anyhow::{anyhow, Result};
use reqwest::Client;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::{ModelStatus, WhisperEngine};

impl WhisperEngine {
    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);
        self.start_model_download(model_name).await?;

        let model_url = whisper_model_url(model_name)?;
        log::info!("Model URL for {}: {}", model_name, model_url);

        let filename = format!("ggml-{}.bin", model_name);
        let file_path = self.models_dir.join(&filename);

        log::info!("Downloading to file path: {}", file_path.display());
        self.prepare_whisper_download(model_name).await?;

        let response = self
            .open_whisper_download_response(model_name, model_url)
            .await?;
        let total_size = log_whisper_response_size(&response);
        self.stream_whisper_download(
            model_name,
            &file_path,
            response,
            total_size,
            progress_callback,
        )
        .await?;
        self.finish_whisper_download(model_name, file_path).await?;

        Ok(())
    }

    async fn start_model_download(&self, model_name: &str) -> Result<()> {
        let active = self.active_downloads.read().await;
        if active.contains(model_name) {
            log::warn!("Download already in progress for model: {}", model_name);
            return Err(anyhow!(
                "Download already in progress for model: {}",
                model_name
            ));
        }
        drop(active);

        self.active_downloads
            .write()
            .await
            .insert(model_name.to_string());
        *self.cancel_download_flag.write().await = None;
        Ok(())
    }

    async fn prepare_whisper_download(&self, model_name: &str) -> Result<()> {
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir)
                .await
                .map_err(|e| anyhow!("Failed to create models directory: {}", e))?;
        }
        self.set_model_status(model_name, ModelStatus::Downloading { progress: 0 })
            .await;
        Ok(())
    }

    async fn open_whisper_download_response(
        &self,
        model_name: &str,
        model_url: &str,
    ) -> Result<reqwest::Response> {
        log::info!("Creating HTTP client and starting request...");
        let client = Client::new();
        log::info!("Sending GET request to: {}", model_url);
        let response = client
            .get(model_url)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to start download: {}", e))?;

        log::info!("Received response with status: {}", response.status());
        if !response.status().is_success() {
            self.remove_active_download(model_name).await;
            return Err(anyhow!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        Ok(response)
    }

    async fn stream_whisper_download(
        &self,
        model_name: &str,
        file_path: &std::path::Path,
        response: reqwest::Response,
        total_size: u64,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        let mut file = fs::File::create(file_path)
            .await
            .map_err(|e| anyhow!("Failed to create file: {}", e))?;

        log::info!("File created successfully at: {}", file_path.display());
        log::info!("Starting streaming download...");
        log::info!(
            "Expected size: {:.1} MB",
            total_size as f64 / (1024.0 * 1024.0)
        );

        let mut progress_reporter = WhisperProgressReporter::new(progress_callback);
        progress_reporter.emit_initial();

        let downloaded = self
            .write_whisper_download_stream(
                model_name,
                response,
                total_size,
                &mut file,
                &mut progress_reporter,
            )
            .await?;
        log::info!("Streaming download completed: {} bytes", downloaded);
        self.report_whisper_download_complete(model_name, &mut progress_reporter)
            .await;
        file.flush()
            .await
            .map_err(|e| anyhow!("Failed to flush file: {}", e))?;
        log::info!("Download completed for model: {}", model_name);
        Ok(())
    }

    async fn write_whisper_download_stream(
        &self,
        model_name: &str,
        response: reqwest::Response,
        total_size: u64,
        file: &mut fs::File,
        progress_reporter: &mut WhisperProgressReporter,
    ) -> Result<u64> {
        use futures_util::StreamExt;

        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;

        while let Some(chunk_result) = stream.next().await {
            self.check_whisper_download_cancelled(model_name).await?;
            let chunk = chunk_result.map_err(|e| anyhow!("Failed to read chunk: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| anyhow!("Failed to write chunk to file: {}", e))?;
            downloaded += chunk.len() as u64;

            let progress = whisper_download_progress(downloaded, total_size);
            if progress_reporter.should_report(progress) {
                self.report_whisper_download_progress(
                    model_name,
                    progress,
                    downloaded,
                    total_size,
                    progress_reporter,
                )
                .await;
            }
        }

        Ok(downloaded)
    }

    async fn check_whisper_download_cancelled(&self, model_name: &str) -> Result<()> {
        let cancel_flag = self.cancel_download_flag.read().await;
        if cancel_flag.as_ref() == Some(&model_name.to_string()) {
            log::info!("Download cancelled for {}", model_name);
            drop(cancel_flag);
            self.remove_active_download(model_name).await;
            return Err(anyhow!("Download cancelled by user"));
        }
        Ok(())
    }

    async fn report_whisper_download_progress(
        &self,
        model_name: &str,
        progress: u8,
        downloaded: u64,
        total_size: u64,
        progress_reporter: &mut WhisperProgressReporter,
    ) {
        log::info!(
            "Download progress: {}% ({:.1} MB / {:.1} MB)",
            progress,
            downloaded as f64 / (1024.0 * 1024.0),
            total_size as f64 / (1024.0 * 1024.0)
        );
        self.set_model_status(model_name, ModelStatus::Downloading { progress })
            .await;
        progress_reporter.report(progress);
    }

    async fn report_whisper_download_complete(
        &self,
        model_name: &str,
        progress_reporter: &mut WhisperProgressReporter,
    ) {
        self.set_model_status(model_name, ModelStatus::Downloading { progress: 100 })
            .await;
        progress_reporter.report(100);
    }

    async fn finish_whisper_download(
        &self,
        model_name: &str,
        file_path: std::path::PathBuf,
    ) -> Result<()> {
        self.set_model_status_with_path(model_name, ModelStatus::Available, file_path)
            .await;
        self.remove_active_download(model_name).await;
        Ok(())
    }

    async fn set_model_status(&self, model_name: &str, status: ModelStatus) {
        let mut models = self.available_models.write().await;
        if let Some(model_info) = models.get_mut(model_name) {
            model_info.status = status;
        }
    }

    async fn set_model_status_with_path(
        &self,
        model_name: &str,
        status: ModelStatus,
        path: std::path::PathBuf,
    ) {
        let mut models = self.available_models.write().await;
        if let Some(model_info) = models.get_mut(model_name) {
            model_info.status = status;
            model_info.path = path;
        }
    }

    async fn remove_active_download(&self, model_name: &str) {
        self.active_downloads.write().await.remove(model_name);
    }

    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for model: {}", model_name);

        *self.cancel_download_flag.write().await = Some(model_name.to_string());
        self.active_downloads.write().await.remove(model_name);
        self.set_model_status(model_name, ModelStatus::Missing)
            .await;

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let filename = format!("ggml-{}.bin", model_name);
        let file_path = self.models_dir.join(&filename);
        if file_path.exists() {
            if let Err(e) = fs::remove_file(&file_path).await {
                log::warn!("Failed to clean up cancelled download file: {}", e);
            } else {
                log::info!(
                    "Cleaned up cancelled download file: {}",
                    file_path.display()
                );
            }
        }

        Ok(())
    }
}

fn whisper_model_url(model_name: &str) -> Result<&'static str> {
    match model_name {
        "tiny" => Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"),
        "base" => Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"),
        "small" => Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"),
        "medium" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin")
        }
        "large-v3-turbo" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin")
        }
        "large-v3" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin")
        }
        "tiny-q5_1" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin")
        }
        "base-q5_1" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin")
        }
        "small-q5_1" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin")
        }
        "medium-q5_0" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin")
        }
        "large-v3-turbo-q5_0" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin")
        }
        "large-v3-q5_0" => {
            Ok("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin")
        }
        _ => Err(anyhow!("Unsupported model: {}", model_name)),
    }
}

struct WhisperProgressReporter {
    callback: Option<Box<dyn Fn(u8) + Send>>,
    last_progress: u8,
    last_report_time: std::time::Instant,
}

impl WhisperProgressReporter {
    fn new(callback: Option<Box<dyn Fn(u8) + Send>>) -> Self {
        Self {
            callback,
            last_progress: 0,
            last_report_time: std::time::Instant::now(),
        }
    }

    fn emit_initial(&mut self) {
        self.report(0);
    }

    fn should_report(&self, progress: u8) -> bool {
        progress > self.last_progress
            || progress == 100
            || self.last_report_time.elapsed().as_secs() >= 2
    }

    fn report(&mut self, progress: u8) {
        if let Some(ref callback) = self.callback {
            callback(progress);
        }
        self.last_progress = progress;
        self.last_report_time = std::time::Instant::now();
    }
}

fn log_whisper_response_size(response: &reqwest::Response) -> u64 {
    let total_size = response.content_length().unwrap_or(0);
    log::info!(
        "Response successful, content length: {} bytes ({:.1} MB)",
        total_size,
        total_size as f64 / (1024.0 * 1024.0)
    );

    if total_size == 0 {
        log::warn!("Content length is 0 or unknown - download may not show accurate progress");
    }

    total_size
}

fn whisper_download_progress(downloaded: u64, total_size: u64) -> u8 {
    if total_size > 0 {
        ((downloaded as f64 / total_size as f64) * 100.0) as u8
    } else {
        0
    }
}
