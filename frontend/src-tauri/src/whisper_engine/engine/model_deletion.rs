use anyhow::{anyhow, Result};
use tokio::fs;

use super::{ModelStatus, WhisperEngine};

impl WhisperEngine {
    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete model: {}", model_name);

        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model '{}' not found", model_name))?;

        log::info!("Model '{}' has status: {:?}", model_name, model_info.status);
        match &model_info.status {
            ModelStatus::Corrupted {
                file_size,
                expected_min_size,
            } => {
                log::info!(
                    "Deleting corrupted model '{}' (file size: {} bytes, expected min: {} bytes)",
                    model_name,
                    file_size,
                    expected_min_size
                );
                delete_model_file_if_present(
                    &model_info.path,
                    "Successfully deleted corrupted file",
                )
                .await?;
                self.mark_model_missing(model_name).await;
                Ok(format!(
                    "Successfully deleted corrupted model '{}'",
                    model_name
                ))
            }
            ModelStatus::Available => {
                log::info!("Deleting available model '{}' (for cleanup)", model_name);
                delete_model_file_if_present(
                    &model_info.path,
                    "Successfully deleted available model file",
                )
                .await?;
                self.mark_model_missing(model_name).await;
                Ok(format!("Successfully deleted model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available models. Model '{}' has status: {:?}",
                model_name,
                model_info.status
            )),
        }
    }

    async fn mark_model_missing(&self, model_name: &str) {
        let mut models = self.available_models.write().await;
        if let Some(model) = models.get_mut(model_name) {
            model.status = ModelStatus::Missing;
        }
    }
}

async fn delete_model_file_if_present(path: &std::path::Path, success_prefix: &str) -> Result<()> {
    if path.exists() {
        fs::remove_file(path)
            .await
            .map_err(|e| anyhow!("Failed to delete file '{}': {}", path.display(), e))?;
        log::info!("{}: {}", success_prefix, path.display());
    } else {
        log::warn!(
            "File '{}' does not exist, nothing to delete",
            path.display()
        );
    }

    Ok(())
}
