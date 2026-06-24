use crate::config::WHISPER_MODEL_CATALOG;
use crate::whisper_engine::{ModelInfo, ModelStatus};

use super::get_models_directory;

/// Discover Whisper models by scanning the models directory directly.
/// Used when the Whisper engine isn't initialized, e.g. while Parakeet handles live transcription.
pub(super) fn discover_models_standalone() -> Result<Vec<ModelInfo>, String> {
    let models_dir =
        get_models_directory().ok_or_else(|| "Models directory not initialized".to_string())?;
    let whisper_dir = models_dir.clone();

    log::info!("Scanning for Whisper models in: {}", whisper_dir.display());

    let mut models = Vec::new();
    for &(name, filename, size_mb, accuracy, speed, description) in WHISPER_MODEL_CATALOG {
        let model_path = whisper_dir.join(filename);
        let status = standalone_model_status(&model_path);

        models.push(ModelInfo {
            name: name.to_string(),
            path: model_path,
            size_mb,
            status,
            accuracy: accuracy.to_string(),
            speed: speed.to_string(),
            description: description.to_string(),
        });
    }

    let downloaded_count = models
        .iter()
        .filter(|m| matches!(m.status, ModelStatus::Available))
        .count();
    log::info!("Found {} downloaded Whisper models", downloaded_count);

    Ok(models)
}

fn standalone_model_status(model_path: &std::path::Path) -> ModelStatus {
    if !model_path.exists() {
        return ModelStatus::Missing;
    }

    match std::fs::metadata(model_path) {
        Ok(metadata) if metadata.len() / (1024 * 1024) >= 1 => ModelStatus::Available,
        _ => ModelStatus::Missing,
    }
}
