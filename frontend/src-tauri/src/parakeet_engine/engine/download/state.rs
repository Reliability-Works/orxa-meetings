use super::super::{ModelInfo, ModelStatus, ParakeetEngine};
use super::support::{download_error_label, ProgressTracker};
use anyhow::{anyhow, Result};
use std::path::Path;
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};

impl ParakeetEngine {
    pub(super) async fn finish_download(
        &self,
        model_name: &str,
        model_dir: &Path,
        tracker: &mut ProgressTracker,
    ) {
        tracker.emit_final_progress();

        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Available;
                model.path = model_dir.to_path_buf();
            }
        }

        self.remove_active_download(model_name).await;
        let mut cancel_flag = self.cancel_download_flag.write().await;
        if cancel_flag.as_ref() == Some(&model_name.to_string()) {
            *cancel_flag = None;
        }
    }

    pub(super) async fn delete_model_directory(&self, model_info: &ModelInfo) -> Result<()> {
        if model_info.path.exists() {
            fs::remove_dir_all(&model_info.path).await.map_err(|e| {
                anyhow!(
                    "Failed to delete directory '{}': {}",
                    model_info.path.display(),
                    e
                )
            })?;
            log::info!(
                "Successfully deleted Parakeet model directory: {}",
                model_info.path.display()
            );
        } else {
            log::warn!(
                "Directory '{}' does not exist, nothing to delete",
                model_info.path.display()
            );
        }
        Ok(())
    }

    pub(super) async fn delete_incomplete_file(
        &self,
        model_name: &str,
        filename: &str,
        file_path: &Path,
    ) -> Result<()> {
        if let Err(e) = fs::remove_file(file_path).await {
            self.remove_active_download(model_name).await;
            return Err(anyhow!(
                "Failed to delete incomplete file {}: {}",
                filename,
                e
            ));
        }
        Ok(())
    }

    pub(super) async fn handle_cancelled_stream(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
    ) -> Result<u64> {
        log::info!("Download cancelled for {}", model_name);
        let _ = writer.flush().await;
        self.remove_active_download(model_name).await;
        Err(anyhow!("Download cancelled by user"))
    }

    pub(super) async fn handle_stream_timeout(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
    ) -> Result<u64> {
        log::warn!(
            "Download timeout for {}: no data received for 30 seconds",
            model_name
        );
        let _ = writer.flush().await;
        self.mark_download_missing(model_name).await;
        Err(anyhow!(
            "Download timeout - No data received for 30 seconds"
        ))
    }

    pub(super) async fn handle_stream_error(
        &self,
        model_name: &str,
        writer: &mut BufWriter<fs::File>,
        error: reqwest::Error,
    ) -> Result<u64> {
        log::error!("Download error for {}: {:?}", model_name, error);
        let _ = writer.flush().await;
        self.mark_download_missing(model_name).await;
        Err(anyhow!("{}: {}", download_error_label(&error), error))
    }

    pub(super) async fn ensure_download_can_start(&self, model_name: &str) -> Result<()> {
        let active = self.active_downloads.read().await;
        if active.contains(model_name) {
            log::warn!(
                "Download already in progress for Parakeet model: {}",
                model_name
            );
            return Err(anyhow!(
                "Download already in progress for model: {}",
                model_name
            ));
        }
        Ok(())
    }

    pub(super) async fn start_download_state(&self, model_name: &str) {
        {
            let mut active = self.active_downloads.write().await;
            active.insert(model_name.to_string());
        }
        let mut cancel_flag = self.cancel_download_flag.write().await;
        *cancel_flag = None;
    }

    pub(super) async fn mark_download_missing(&self, model_name: &str) {
        self.remove_active_download(model_name).await;
        self.set_model_status(model_name, ModelStatus::Missing)
            .await;
    }

    pub(super) async fn model_info(&self, model_name: &str) -> Option<ModelInfo> {
        self.available_models.read().await.get(model_name).cloned()
    }

    pub(super) async fn set_model_status(&self, model_name: &str, status: ModelStatus) {
        let mut models = self.available_models.write().await;
        if let Some(model) = models.get_mut(model_name) {
            model.status = status;
        }
    }

    pub(super) async fn remove_active_download(&self, model_name: &str) {
        let mut active = self.active_downloads.write().await;
        active.remove(model_name);
    }

    pub(super) async fn download_is_cancelled(&self, model_name: &str) -> bool {
        self.cancel_download_flag.read().await.as_deref() == Some(model_name)
    }
}
