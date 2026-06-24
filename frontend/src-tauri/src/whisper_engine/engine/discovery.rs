use anyhow::{anyhow, Result};
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::config::WHISPER_MODEL_CATALOG;

use super::{ModelInfo, ModelStatus, WhisperEngine};

impl WhisperEngine {
    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let mut models = Vec::new();

        for &(name, filename, size_mb, accuracy, speed, description) in WHISPER_MODEL_CATALOG {
            let model_path = self.models_dir.join(filename);
            let status = self
                .discover_model_status(name, filename, size_mb, &model_path)
                .await;

            models.push(ModelInfo {
                name: name.to_string(),
                path: model_path,
                size_mb,
                accuracy: accuracy.to_string(),
                speed: speed.to_string(),
                status,
                description: description.to_string(),
            });
        }

        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    async fn discover_model_status(
        &self,
        name: &str,
        filename: &str,
        size_mb: u32,
        model_path: &std::path::Path,
    ) -> ModelStatus {
        if !model_path.exists() {
            return ModelStatus::Missing;
        }

        match std::fs::metadata(model_path) {
            Ok(metadata) => {
                self.model_status_from_metadata(name, filename, size_mb, model_path, metadata.len())
                    .await
            }
            Err(_) => ModelStatus::Missing,
        }
    }

    async fn model_status_from_metadata(
        &self,
        name: &str,
        filename: &str,
        size_mb: u32,
        model_path: &std::path::Path,
        file_size_bytes: u64,
    ) -> ModelStatus {
        let file_size_mb = file_size_bytes / (1024 * 1024);
        let expected_min_size_mb = (size_mb as f64 * 0.9) as u64;

        if file_size_mb >= expected_min_size_mb && file_size_mb > 1 {
            return match self.validate_model_file(model_path).await {
                Ok(_) => ModelStatus::Available,
                Err(_) => {
                    log::warn!(
                        "Model file {} has correct size but appears corrupted (failed validation)",
                        filename
                    );
                    ModelStatus::Corrupted {
                        file_size: file_size_bytes,
                        expected_min_size: expected_min_size_mb * 1024 * 1024,
                    }
                }
            };
        }

        if file_size_mb > 0 {
            return self
                .small_existing_model_status(name, filename, size_mb, file_size_bytes)
                .await;
        }

        ModelStatus::Missing
    }

    async fn small_existing_model_status(
        &self,
        name: &str,
        filename: &str,
        size_mb: u32,
        file_size_bytes: u64,
    ) -> ModelStatus {
        let file_size_mb = file_size_bytes / (1024 * 1024);
        let expected_min_size_mb = (size_mb as f64 * 0.9) as u64;
        let models_guard = self.available_models.read().await;

        if let Some(existing_model) = models_guard.get(name) {
            if let ModelStatus::Downloading { progress } = &existing_model.status {
                log::debug!(
                    "Model {} appears to be downloading ({} MB so far, {}% complete)",
                    filename,
                    file_size_mb,
                    progress
                );
                return ModelStatus::Downloading {
                    progress: *progress,
                };
            }
        }

        log::warn!(
            "Model file {} exists but is corrupted ({} MB, expected ~{} MB)",
            filename,
            file_size_mb,
            size_mb
        );
        ModelStatus::Corrupted {
            file_size: file_size_bytes,
            expected_min_size: expected_min_size_mb * 1024 * 1024,
        }
    }

    async fn validate_model_file(&self, model_path: &std::path::Path) -> Result<()> {
        let mut file = fs::File::open(model_path)
            .await
            .map_err(|e| anyhow!("Failed to open model file: {}", e))?;

        let mut buffer = [0u8; 8];
        file.read_exact(&mut buffer)
            .await
            .map_err(|e| anyhow!("Failed to read model file header: {}", e))?;

        if buffer.starts_with(b"ggml")
            || buffer.starts_with(b"GGUF")
            || buffer.starts_with(b"ggmf")
            || buffer.starts_with(b"lmgg")
            || buffer.starts_with(b"FUGU")
            || buffer.starts_with(b"fmgg")
        {
            Ok(())
        } else {
            Err(anyhow!(
                "Invalid model file: missing GGML/GGUF magic number. Found: {:?}",
                String::from_utf8_lossy(&buffer[..4])
            ))
        }
    }
}
