// Commit name to recover the serial whisper engine processing for smaller meetings [Slower processing but dooes not fail] - "before parallel processing implementation"

mod discovery;
mod download;
mod model_deletion;
mod text_cleanup;
mod transcription;

use super::acceleration::{whisper_context_acceleration_for, WhisperCompiledBackend};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use whisper_rs::{WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading {
        progress: u8,
    },
    Error(String),
    Corrupted {
        file_size: u64,
        expected_min_size: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub accuracy: String,
    pub speed: String,
    pub status: ModelStatus,
    pub description: String,
}

pub struct WhisperEngine {
    models_dir: PathBuf,
    current_context: Arc<RwLock<Option<WhisperContext>>>,
    current_model: Arc<RwLock<Option<String>>>,
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    last_transcription_was_short: Arc<RwLock<bool>>,
    short_audio_warning_logged: Arc<RwLock<bool>>,
    transcription_count: Arc<RwLock<u64>>,
    cancel_download_flag: Arc<RwLock<Option<String>>>,
    active_downloads: Arc<RwLock<HashSet<String>>>,
}

impl WhisperEngine {
    /// Detect available GPU acceleration capabilities.
    fn detect_gpu_acceleration() -> bool {
        match WhisperCompiledBackend::current() {
            WhisperCompiledBackend::Metal => {
                log::info!("macOS detected - attempting to enable Metal GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cuda => {
                log::info!("CUDA feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Vulkan => {
                log::info!("Vulkan feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::HipBlas => {
                log::info!("HIP BLAS feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cpu => {
                log::info!("No GPU acceleration features detected - using CPU processing");
                false
            }
        }
    }

    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new WhisperEngine with optional custom models directory.
    /// If models_dir is None, uses default location (app data dir for production, local for dev).
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        std::env::set_var("GGML_METAL_LOG_LEVEL", "1");
        std::env::set_var("WHISPER_LOG_LEVEL", "1");

        let models_dir = match models_dir {
            Some(dir) => dir,
            None => default_models_dir()?,
        };

        log::info!(
            "WhisperEngine using models directory: {}",
            models_dir.display()
        );
        log::info!("Debug mode: {}", cfg!(debug_assertions));

        let gpu_support = Self::detect_gpu_acceleration();
        log::info!(
            "Hardware acceleration support: {}",
            if gpu_support { "enabled" } else { "disabled" }
        );

        log_compiled_acceleration_features();

        Ok(Self {
            models_dir,
            current_context: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            last_transcription_was_short: Arc::new(RwLock::new(false)),
            short_audio_warning_logged: Arc::new(RwLock::new(false)),
            transcription_count: Arc::new(RwLock::new(0)),
            cancel_download_flag: Arc::new(RwLock::new(None)),
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models
            .get(model_name)
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;

        match &model_info.status {
            ModelStatus::Available => {
                if let Some(current_model) = self.current_model.read().await.as_ref() {
                    if current_model == model_name {
                        log::info!("Model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }

                    log::info!(
                        "Unloading current model '{}' before loading '{}'",
                        current_model,
                        model_name
                    );
                    self.unload_model().await;
                }

                log::info!("Loading model: {}", model_name);

                let hardware_profile = crate::audio::HardwareProfile::detect();
                let adaptive_config = hardware_profile.get_whisper_config();
                let acceleration = whisper_context_acceleration_for(
                    WhisperCompiledBackend::current(),
                    hardware_profile.gpu_type,
                    hardware_profile.performance_tier,
                );

                let context_param = WhisperContextParameters {
                    use_gpu: acceleration.use_gpu,
                    gpu_device: acceleration.gpu_device,
                    flash_attn: acceleration.flash_attn,
                    ..Default::default()
                };

                log::info!(
                    "Whisper acceleration decision: compiled_backend={} runtime_detected_gpu={:?} use_gpu={} flash_attn={} gpu_device={}",
                    acceleration.compiled_backend.as_str(),
                    acceleration.runtime_detected_gpu,
                    acceleration.use_gpu,
                    acceleration.flash_attn,
                    acceleration.gpu_device,
                );

                let ctx = WhisperContext::new_with_params(
                    &model_info.path.to_string_lossy(),
                    context_param,
                )
                .map_err(|e| anyhow!("Failed to load model {}: {}", model_name, e))?;

                *self.current_context.write().await = Some(ctx);
                *self.current_model.write().await = Some(model_name.to_string());

                log::info!("Successfully loaded model: {} with {} (Performance Tier: {:?}, Beam Size: {}, Threads: {:?})",
                          model_name, acceleration.status_label(), hardware_profile.performance_tier,
                          adaptive_config.beam_size, adaptive_config.max_threads);
                Ok(())
            }
            ModelStatus::Missing => Err(anyhow!("Model {} is not downloaded", model_name)),
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Model {} is currently downloading", model_name))
            }
            ModelStatus::Error(err) => Err(anyhow!("Model {} has error: {}", model_name, err)),
            ModelStatus::Corrupted { .. } => Err(anyhow!(
                "Model {} is corrupted and cannot be loaded",
                model_name
            )),
        }
    }

    pub async fn unload_model(&self) -> bool {
        let mut ctx_guard = self.current_context.write().await;
        let unloaded = ctx_guard.take().is_some();
        if unloaded {
            log::info!("📉Whisper model unloaded");
        }

        let mut model_name_guard = self.current_model.write().await;
        model_name_guard.take();

        unloaded
    }

    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model.read().await.clone()
    }

    pub async fn is_model_loaded(&self) -> bool {
        self.current_context.read().await.is_some()
    }

    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }
}

fn default_models_dir() -> Result<PathBuf> {
    let current_dir =
        std::env::current_dir().map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

    if cfg!(debug_assertions) {
        Ok(development_models_dir(current_dir))
    } else {
        log::warn!("WhisperEngine: No models directory provided, using fallback path");
        Ok(dirs::data_dir()
            .or_else(dirs::home_dir)
            .ok_or_else(|| anyhow!("Could not find system data directory"))?
            .join("Orxa")
            .join("models"))
    }
}

fn development_models_dir(current_dir: PathBuf) -> PathBuf {
    for relative_path in [
        "models",
        "../models",
        "backend/whisper-server-package/models",
        "../backend/whisper-server-package/models",
    ] {
        let candidate = current_dir.join(relative_path);
        if candidate.exists() {
            return candidate;
        }
    }

    current_dir.join("models")
}

fn log_compiled_acceleration_features() {
    #[cfg(feature = "metal")]
    log::info!("Apple Metal GPU support: enabled");

    #[cfg(feature = "openblas")]
    log::info!("OpenBLAS CPU optimization: enabled");

    #[cfg(feature = "coreml")]
    log::info!("Apple CoreML support: enabled");

    #[cfg(feature = "cuda")]
    log::info!("NVIDIA CUDA support: enabled");

    #[cfg(feature = "vulkan")]
    log::info!("Vulkan GPU support: enabled");

    #[cfg(feature = "openmp")]
    log::info!("OpenMP parallel processing: enabled");
}
