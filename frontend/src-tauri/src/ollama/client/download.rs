use super::*;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Runtime};

pub(super) async fn pull_ollama_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
    endpoint: Option<String>,
) -> Result<(), String> {
    // Check if model is already being downloaded
    {
        let downloading = DOWNLOADING_MODELS.read().await;
        if downloading.contains(&model_name) {
            log::warn!(
                "Model {} is already being downloaded, ignoring duplicate request",
                model_name
            );
            return Err(format!("Model {} is already being downloaded", model_name));
        }
    }

    // Mark model as downloading
    {
        let mut downloading = DOWNLOADING_MODELS.write().await;
        downloading.insert(model_name.clone());
        log::info!("Started download tracking for model: {}", model_name);
    }

    let client = Client::new();
    let base_url = endpoint.as_deref().unwrap_or("http://localhost:11434");
    let url = format!("{}/api/pull", base_url);

    let payload = serde_json::json!({
        "name": model_name,
        "stream": true
    });

    let response = client
        .post(&url)
        .json(&payload)
        .timeout(Duration::from_secs(600)) // 10 minutes timeout for pulling
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("Download timed out. The model may be large, please try using the Ollama CLI: ollama pull {}", model_name)
            } else if e.is_connect() {
                format!("Cannot connect to {}. Please check if the Ollama server is running.", base_url)
            } else {
                format!("Failed to download model: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());

        // Remove from downloading set on error
        {
            let mut downloading = DOWNLOADING_MODELS.write().await;
            downloading.remove(&model_name);
        }

        // Emit error event
        let _ = app_handle.emit(
            "ollama-model-download-error",
            serde_json::json!({
                "modelName": model_name,
                "error": format!("HTTP {}: {}", status, error_text)
            }),
        );

        return Err(format!(
            "Failed to pull model (HTTP {}): {}",
            status, error_text
        ));
    }

    // Process streaming response (NDJSON format)
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut last_progress = 0u8;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let error_msg = format!("Failed to read stream: {}", e);

            // Remove from downloading set on stream error
            let model_name_clone = model_name.clone();
            tokio::spawn(async move {
                let mut downloading = DOWNLOADING_MODELS.write().await;
                downloading.remove(&model_name_clone);
            });

            let _ = app_handle.emit(
                "ollama-model-download-error",
                serde_json::json!({
                    "modelName": model_name,
                    "error": error_msg
                }),
            );
            error_msg
        })?;

        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            // Parse JSON line
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                // Extract progress if available
                if let (Some(completed), Some(total)) = (
                    json.get("completed").and_then(|v| v.as_u64()),
                    json.get("total").and_then(|v| v.as_u64()),
                ) {
                    if total > 0 {
                        let progress = ((completed as f64 / total as f64) * 100.0) as u8;

                        // Only emit if progress changed significantly (reduces event spam)
                        if progress != last_progress
                            && (progress - last_progress >= 1 || progress == 100)
                        {
                            log::info!(
                                "Ollama download progress for {}: {}%",
                                model_name,
                                progress
                            );

                            let _ = app_handle.emit(
                                "ollama-model-download-progress",
                                serde_json::json!({
                                    "modelName": model_name,
                                    "progress": progress
                                }),
                            );

                            last_progress = progress;
                        }
                    }
                }

                // Check for error status
                if let Some(error) = json.get("error").and_then(|v| v.as_str()) {
                    let error_msg = format!("Ollama error: {}", error);

                    // Remove from downloading set on Ollama error
                    {
                        let mut downloading = DOWNLOADING_MODELS.write().await;
                        downloading.remove(&model_name);
                    }

                    let _ = app_handle.emit(
                        "ollama-model-download-error",
                        serde_json::json!({
                            "modelName": model_name,
                            "error": error_msg
                        }),
                    );
                    return Err(error_msg);
                }
            }
        }
    }

    // Remove from downloading set before emitting completion
    {
        let mut downloading = DOWNLOADING_MODELS.write().await;
        downloading.remove(&model_name);
        log::info!("Removed {} from downloading set", model_name);
    }

    // Emit completion event
    let _ = app_handle.emit(
        "ollama-model-download-complete",
        serde_json::json!({
            "modelName": model_name
        }),
    );

    log::info!("Ollama model {} downloaded successfully", model_name);

    Ok(())
}
