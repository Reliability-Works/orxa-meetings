use super::PARAKEET_ENGINE;
use crate::parakeet_engine::{DownloadProgress, ModelStatus};
use tauri::{AppHandle, Emitter, Runtime};

pub(super) async fn parakeet_download_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = PARAKEET_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        // Create progress callback that emits detailed events
        let app_handle_clone = app_handle.clone();
        let model_name_clone = model_name.clone();

        let progress_callback = Box::new(move |progress: DownloadProgress| {
            log::info!(
                "Parakeet download progress for {}: {:.1} MB / {:.1} MB ({:.1} MB/s) - {}%",
                model_name_clone,
                progress.downloaded_mb,
                progress.total_mb,
                progress.speed_mbps,
                progress.percent
            );

            // Emit download progress event with detailed info
            if let Err(e) = app_handle_clone.emit(
                "parakeet-model-download-progress",
                serde_json::json!({
                    "modelName": model_name_clone,
                    "progress": progress.percent,
                    "downloaded_bytes": progress.downloaded_bytes,
                    "total_bytes": progress.total_bytes,
                    "downloaded_mb": progress.downloaded_mb,
                    "total_mb": progress.total_mb,
                    "speed_mbps": progress.speed_mbps,
                    "status": if progress.percent == 100 { "completed" } else { "downloading" }
                }),
            ) {
                log::error!("Failed to emit parakeet download progress event: {}", e);
            }
        });

        // Ensure models are discovered before downloading
        // This populates available_models so we don't get "Model not found" error
        if let Err(e) = engine.discover_models().await {
            log::warn!("Failed to discover models before download: {}", e);
            // Continue anyway, maybe it will work if the model is already known
        }

        let result = engine
            .download_model_detailed(&model_name, Some(progress_callback))
            .await;

        match result {
            Ok(()) => {
                // Emit completion event
                if let Err(e) = app_handle.emit(
                    "parakeet-model-download-complete",
                    serde_json::json!({
                        "modelName": model_name
                    }),
                ) {
                    log::error!("Failed to emit parakeet download complete event: {}", e);
                }

                // Update tray menu to reflect model is now available
                log::info!("Parakeet model download complete - updating tray menu");
                crate::tray::update_tray_menu(&app_handle);

                Ok(())
            }
            Err(e) => {
                // Emit error event
                if let Err(emit_e) = app_handle.emit(
                    "parakeet-model-download-error",
                    serde_json::json!({
                        "modelName": model_name,
                        "error": e.to_string()
                    }),
                ) {
                    log::error!("Failed to emit parakeet download error event: {}", emit_e);
                }
                Err(format!("Failed to download Parakeet model: {}", e))
            }
        }
    } else {
        Err("Parakeet engine not initialized".to_string())
    }
}

pub(super) async fn parakeet_cancel_download<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = PARAKEET_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .cancel_download(&model_name)
            .await
            .map_err(|e| format!("Failed to cancel Parakeet download: {}", e))?;

        // Emit cancellation event to update UI (global toast and component state)
        let _ = app_handle.emit(
            "parakeet-model-download-progress",
            serde_json::json!({
                "modelName": model_name,
                "progress": 0,
                "status": "cancelled"
            }),
        );

        log::info!("Parakeet download cancelled: {}", model_name);
        Ok(())
    } else {
        Err("Parakeet engine not initialized".to_string())
    }
}

pub(super) async fn parakeet_retry_download<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    log::info!("Retrying download for: {}", model_name);

    let engine = {
        let guard = PARAKEET_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        // DEFENSIVE: Ensure clean state before retry
        // This handles any edge cases where error handler didn't complete
        {
            let mut active = engine.active_downloads.write().await;
            if active.contains(&model_name) {
                log::warn!(
                    "Retry: Model {} was still in active downloads, removing",
                    model_name
                );
                active.remove(&model_name);
            }
        }

        // DEFENSIVE: Force model status to Missing to allow fresh download
        {
            let mut models = engine.available_models.write().await;
            if let Some(model) = models.get_mut(&model_name) {
                log::info!(
                    "Retry: Resetting model {} status from {:?} to Missing",
                    model_name,
                    model.status
                );
                model.status = ModelStatus::Missing;
            }
        }

        // Rediscover models to refresh state based on disk files
        let _ = engine.discover_models().await;

        // Call regular download (emits events)
        parakeet_download_model(app_handle, model_name).await
    } else {
        Err("Parakeet engine not initialized".to_string())
    }
}
