// Model manager for built-in AI models - handles downloads and lifecycle
// Follows the same pattern as whisper_engine/whisper_engine.rs for consistency

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::RwLock;

use super::models::{get_available_models, get_model_by_name};

mod download;

// ============================================================================
// Model Status Types
// ============================================================================

/// Detailed download progress info (MB-based with speed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Bytes downloaded so far
    pub downloaded_bytes: u64,
    /// Total file size in bytes
    pub total_bytes: u64,
    /// Downloaded in MB (for display)
    pub downloaded_mb: f64,
    /// Total size in MB (for display)
    pub total_mb: f64,
    /// Download speed in MB/s
    pub speed_mbps: f64,
    /// Percentage complete (0-100)
    pub percent: u8,
}

impl DownloadProgress {
    pub fn new(downloaded: u64, total: u64, speed_mbps: f64) -> Self {
        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        Self {
            downloaded_bytes: downloaded,
            total_bytes: total,
            downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
            total_mb: total as f64 / (1024.0 * 1024.0),
            speed_mbps,
            percent,
        }
    }
}

/// Model status in the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModelStatus {
    /// Model is not yet downloaded
    NotDownloaded,

    /// Model is currently being downloaded (progress 0-100)
    Downloading { progress: u8 },

    /// Model is downloaded and ready to use
    Available,

    /// Model file is corrupted and needs redownload
    Corrupted {
        file_size: u64,
        expected_min_size: u64,
    },

    /// Error occurred with the model
    Error(String),
}

/// Model information for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Model name (e.g., "gemma3:1b")
    pub name: String,

    /// Display name for UI
    pub display_name: String,

    /// Current status
    pub status: ModelStatus,

    /// File path (if available)
    pub path: PathBuf,

    /// Size in MB
    pub size_mb: u64,

    /// Context window size in tokens
    pub context_size: u32,

    /// Description
    pub description: String,

    /// GGUF filename on disk
    pub gguf_file: String,
}

// ============================================================================
// Model Manager
// ============================================================================

pub struct ModelManager {
    /// Directory where models are stored
    models_dir: PathBuf,

    /// Currently available models with their status
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,

    /// Active downloads (model names)
    active_downloads: Arc<RwLock<HashSet<String>>>,

    /// Cancellation flag for current download
    cancel_download_flag: Arc<RwLock<Option<String>>>,
}

impl ModelManager {
    /// Create a new model manager with default models directory
    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new model manager with custom models directory
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir
        } else {
            // Fallback: Use current directory in development
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            if cfg!(debug_assertions) {
                // Development mode
                current_dir.join("models").join("summary")
            } else {
                // Production mode fallback (caller should provide path)
                log::warn!("ModelManager: No models directory provided, using fallback path");
                dirs::data_dir()
                    .or_else(dirs::home_dir)
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Orxa")
                    .join("models")
                    .join("summary")
            }
        };

        log::info!(
            "Built-in AI ModelManager using directory: {}",
            models_dir.display()
        );

        Ok(Self {
            models_dir,
            available_models: Arc::new(RwLock::new(HashMap::new())),
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
            cancel_download_flag: Arc::new(RwLock::new(None)),
        })
    }

    /// Initialize and scan for existing models
    pub async fn init(&self) -> Result<()> {
        // Create models directory if it doesn't exist
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await?;
            log::info!("Created models directory: {}", self.models_dir.display());
        }

        // Scan for existing models
        self.scan_models().await?;

        Ok(())
    }

    /// Scan models directory and update status
    pub async fn scan_models(&self) -> Result<()> {
        let start = std::time::Instant::now();

        log::info!(
            "Starting model scan in directory: {}",
            self.models_dir.display()
        );

        let model_defs = get_available_models();
        let mut models_map = HashMap::new();

        for model_def in model_defs {
            let model_path = self.models_dir.join(&model_def.gguf_file);
            log::debug!(
                "Checking model '{}' at path: {}",
                model_def.name,
                model_path.display()
            );

            let is_actively_downloading = {
                let active = self.active_downloads.read().await;
                active.contains(&model_def.name)
            };

            // If actively downloading, preserve existing status from memory
            if is_actively_downloading {
                let existing_info = {
                    let models = self.available_models.read().await;
                    models.get(&model_def.name).cloned()
                };

                if let Some(info) = existing_info {
                    // Preserve existing status (should be Downloading)
                    models_map.insert(model_def.name.clone(), info);
                    log::debug!(
                        "Model '{}': Preserving Downloading status during scan",
                        model_def.name
                    );
                    continue;
                }
            }

            let status = if model_path.exists() {
                // Check if file size matches expected size (basic validation)
                match fs::metadata(&model_path).await {
                    Ok(metadata) => {
                        let file_size_mb = metadata.len() / (1024 * 1024);

                        // Allow 10% variance for file size check
                        let expected_min = (model_def.size_mb as f64 * 0.9) as u64;
                        let expected_max = (model_def.size_mb as f64 * 1.1) as u64;

                        log::info!(
                            "Model '{}': found {} MB (expected {}-{} MB)",
                            model_def.name,
                            file_size_mb,
                            expected_min,
                            expected_max
                        );

                        if file_size_mb >= expected_min && file_size_mb <= expected_max {
                            log::info!("Model '{}': AVAILABLE", model_def.name);
                            ModelStatus::Available
                        } else {
                            log::warn!(
                                "Model '{}': CORRUPTED (size mismatch: {} MB, expected {} MB)",
                                model_def.name,
                                file_size_mb,
                                model_def.size_mb
                            );
                            ModelStatus::Corrupted {
                                file_size: file_size_mb,
                                expected_min_size: expected_min,
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("Model '{}': Failed to read metadata: {}", model_def.name, e);
                        ModelStatus::Error(format!("Failed to read metadata: {}", e))
                    }
                }
            } else {
                log::debug!("Model '{}': NOT FOUND", model_def.name);
                ModelStatus::NotDownloaded
            };

            let model_info = ModelInfo {
                name: model_def.name.clone(),
                display_name: model_def.display_name.clone(),
                status,
                path: model_path,
                size_mb: model_def.size_mb,
                context_size: model_def.context_size,
                description: model_def.description.clone(),
                gguf_file: model_def.gguf_file.clone(),
            };

            models_map.insert(model_def.name.clone(), model_info);
        }

        let model_count = models_map.len();

        let mut models = self.available_models.write().await;
        *models = models_map;

        let elapsed = start.elapsed();
        log::info!(
            "Model scan complete: {} models checked in {:?}",
            model_count,
            elapsed
        );
        Ok(())
    }

    /// Get list of all models with their status
    pub async fn list_models(&self) -> Vec<ModelInfo> {
        self.available_models
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    /// Get info for a specific model
    pub async fn get_model_info(&self, model_name: &str) -> Option<ModelInfo> {
        self.available_models.read().await.get(model_name).cloned()
    }

    /// Check if a model is ready to use
    /// If refresh=true, scans filesystem before checking (slower but accurate)
    pub async fn is_model_ready(&self, model_name: &str, refresh: bool) -> bool {
        if refresh {
            if let Err(e) = self.scan_models().await {
                log::error!("Failed to scan models: {}", e);
                return false;
            }
        }

        if let Some(info) = self.get_model_info(model_name).await {
            info.status == ModelStatus::Available
        } else {
            false
        }
    }

    /// Download a model with simple percentage callback (backward compatible)
    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send>>,
    ) -> Result<()> {
        // Wrap the simple callback to use detailed progress internally
        let detailed_callback: Option<Box<dyn Fn(DownloadProgress) + Send>> = progress_callback
            .map(|cb| {
                Box::new(move |p: DownloadProgress| cb(p.percent))
                    as Box<dyn Fn(DownloadProgress) + Send>
            });
        self.download_model_detailed(model_name, detailed_callback)
            .await
    }

    /// Cancel an ongoing download
    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for model: {}", model_name);

        // Set cancellation flag - download loop will detect this and handle cleanup
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = Some(model_name.to_string());
        }

        // Note: active_downloads cleanup is handled by the download loop when it detects
        // the cancellation flag. This avoids double-removal race condition.

        // Update status immediately for UI responsiveness
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::NotDownloaded;
            }
        }

        // Brief delay to let download loop detect cancellation
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        Ok(())
    }

    /// Delete a corrupted or available model file
    pub async fn delete_model(&self, model_name: &str) -> Result<()> {
        log::info!("Deleting model: {}", model_name);

        let model_def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

        let file_path = self.models_dir.join(&model_def.gguf_file);

        if file_path.exists() {
            fs::remove_file(&file_path).await?;
            log::info!("Deleted model file: {}", file_path.display());
        }

        // Update status
        {
            let mut models = self.available_models.write().await;
            if let Some(model_info) = models.get_mut(model_name) {
                model_info.status = ModelStatus::NotDownloaded;
            }
        }

        Ok(())
    }

    /// Get models directory path
    pub fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }
}
