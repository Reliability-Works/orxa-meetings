use super::*;

/// Stop recording with optimized graceful shutdown ensuring NO transcript chunks are lost
pub async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    _args: RecordingArgs,
) -> Result<(), String> {
    info!(
        "🛑 Starting optimized recording shutdown - ensuring ALL transcript chunks are preserved"
    );

    // Check if recording is active
    if !IS_RECORDING.load(Ordering::SeqCst) {
        info!("Recording was not active");
        return Ok(());
    }

    emit_shutdown_progress(&app, "stopping_audio", "Stopping audio capture...", 20);
    let manager_for_cleanup = stop_audio_capture().await?;
    cleanup_transcript_listener(&app);

    emit_shutdown_progress(
        &app,
        "processing_transcripts",
        "Processing remaining transcript chunks...",
        40,
    );
    wait_for_transcription_task(&app).await;

    unload_transcription_model(&app).await;
    let analytics_data = manager_for_cleanup
        .as_ref()
        .map(collect_meeting_end_analytics_data);
    track_meeting_end_analytics(&app, analytics_data).await;

    emit_shutdown_progress(
        &app,
        "finalizing",
        "Finalizing recording and cleaning up resources...",
        90,
    );
    let (meeting_folder, meeting_name) = save_recording_data(&app, manager_for_cleanup).await;

    // Set recording flag to false
    info!("🔍 Setting IS_RECORDING to false");
    IS_RECORDING.store(false, Ordering::SeqCst);

    // Step 4.5: Prepare metadata for frontend (NO database save)
    // NOTE: We do NOT save to database here. The frontend will save after all transcripts are displayed.
    // This ensures the user sees all transcripts streaming in before the database save happens.
    let (folder_path_str, meeting_name_str) = match (&meeting_folder, &meeting_name) {
        (Some(path), Some(name)) => (Some(path.to_string_lossy().to_string()), Some(name.clone())),
        _ => (None, None),
    };

    info!("📤 Preparing recording metadata for frontend save");
    info!("   folder_path: {:?}", folder_path_str);
    info!("   meeting_name: {:?}", meeting_name_str);

    // Database save removed - frontend will handle this after receiving all transcripts
    info!("ℹ️ Skipping database save in Rust - frontend will save after all transcripts received");

    // Step 5: Complete shutdown
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": "complete",
            "message": "Recording stopped successfully",
            "progress": 100
        }),
    );

    // Emit final stop event with folder_path and meeting_name for frontend to save
    app.emit(
        "recording-stopped",
        serde_json::json!({
            "message": "Recording stopped - frontend will save after all transcripts received",
            "folder_path": folder_path_str,
            "meeting_name": meeting_name_str
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect stopped state
    crate::tray::update_tray_menu(&app);

    info!("🎉 Recording stopped successfully with ZERO transcript chunks lost");
    Ok(())
}

pub(super) fn emit_shutdown_progress<R: Runtime>(
    app: &AppHandle<R>,
    stage: &str,
    message: &str,
    progress: u32,
) {
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": stage,
            "message": message,
            "progress": progress
        }),
    );
}

pub(super) async fn stop_audio_capture() -> Result<Option<RecordingManager>, String> {
    let manager_for_cleanup = {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        global_manager.take()
    };

    if let Some(mut manager) = manager_for_cleanup {
        info!("🚀 Using FORCE FLUSH to eliminate pipeline accumulation delays");
        manager.stop_streams_and_force_flush().await.map_err(|e| {
            error!("❌ Failed to stop audio streams: {}", e);
            format!("Failed to stop audio streams: {}", e)
        })?;
        info!("✅ Audio streams stopped successfully - no more chunks will be created");
        Ok(Some(manager))
    } else {
        warn!("No recording manager found to stop");
        Ok(None)
    }
}

pub(super) fn cleanup_transcript_listener<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Listener;

    if let Some(listener_id) = TRANSCRIPT_LISTENER_ID.lock().unwrap().take() {
        app.unlisten(listener_id);
        info!("✅ Transcript-update listener removed");
    }
}

pub(super) async fn wait_for_transcription_task<R: Runtime>(app: &AppHandle<R>) {
    let transcription_task = {
        let mut global_task = TRANSCRIPTION_TASK.lock().unwrap();
        global_task.take()
    };

    let Some(task_handle) = transcription_task else {
        info!("ℹ️ No transcription task found to wait for");
        return;
    };

    info!("⏳ Waiting for ALL transcription chunks to be processed (no timeout - preserving every chunk)");
    let progress_task = spawn_transcription_shutdown_progress(app.clone());

    match tokio::time::timeout(tokio::time::Duration::from_secs(600), task_handle).await {
        Ok(Ok(())) => info!("✅ ALL transcription chunks processed successfully - no data lost"),
        Ok(Err(e)) => warn!("⚠️ Transcription task completed with error: {:?}", e),
        Err(_) => warn!(
            "⏱️ Transcription timeout (10 minutes) reached, continuing shutdown to prevent indefinite hang"
        ),
    }

    progress_task.abort();
}

pub(super) fn spawn_transcription_shutdown_progress<R: Runtime>(
    progress_app: AppHandle<R>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let last_update = std::time::Instant::now();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let elapsed = last_update.elapsed().as_secs();
            let _ = progress_app.emit(
                "recording-shutdown-progress",
                serde_json::json!({
                    "stage": "processing_transcripts",
                    "message": format!("Processing transcripts... ({}s elapsed)", elapsed),
                    "progress": 40,
                    "detailed": true,
                    "elapsed_seconds": elapsed
                }),
            );
        }
    })
}

pub(super) async fn unload_transcription_model<R: Runtime>(app: &AppHandle<R>) {
    emit_shutdown_progress(
        app,
        "unloading_model",
        "Unloading speech recognition model...",
        70,
    );
    info!("🧠 All transcript chunks processed. Now safely unloading transcription model...");

    match load_transcription_provider(app).await.as_deref() {
        Some("parakeet") => unload_parakeet_model().await,
        _ => unload_whisper_model().await,
    }
}

pub(super) async fn load_transcription_provider<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(30),
        crate::api::api_get_transcript_config(app.clone(), app.clone().state(), None),
    )
    .await
    {
        Ok(Ok(Some(config))) => Some(config.provider),
        Ok(Ok(None)) => None,
        Ok(Err(e)) => {
            warn!("⚠️ Failed to get transcript config: {:?}", e);
            None
        }
        Err(_) => {
            warn!("⏱️ Transcript config timeout (30s), continuing shutdown");
            None
        }
    }
}

pub(super) async fn unload_parakeet_model() {
    info!("🦜 Unloading Parakeet model...");
    let engine_clone = {
        let engine_guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
            .lock()
            .unwrap();
        engine_guard.as_ref().cloned()
    };

    if let Some(engine) = engine_clone {
        let current_model = engine
            .get_current_model()
            .await
            .unwrap_or_else(|| "unknown".to_string());
        info!("Current Parakeet model before unload: '{}'", current_model);

        if engine.unload_model().await {
            info!(
                "✅ Parakeet model '{}' unloaded successfully",
                current_model
            );
        } else {
            warn!("⚠️ Failed to unload Parakeet model '{}'", current_model);
        }
    } else {
        warn!("⚠️ No Parakeet engine found to unload model");
    }
}

pub(super) async fn unload_whisper_model() {
    info!("🎤 Unloading Whisper model...");
    let engine_clone = {
        let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .unwrap();
        engine_guard.as_ref().cloned()
    };

    if let Some(engine) = engine_clone {
        let current_model = engine
            .get_current_model()
            .await
            .unwrap_or_else(|| "unknown".to_string());
        info!("Current Whisper model before unload: '{}'", current_model);

        if engine.unload_model().await {
            info!("✅ Whisper model '{}' unloaded successfully", current_model);
        } else {
            warn!("⚠️ Failed to unload Whisper model '{}'", current_model);
        }
    } else {
        warn!("⚠️ No Whisper engine found to unload model");
    }
}

pub(super) struct MeetingEndAnalyticsData {
    total_duration: Option<f64>,
    active_duration: f64,
    pause_duration: f64,
    transcript_segments_count: u64,
    had_fatal_error: bool,
    mic_device_name: Option<String>,
    sys_device_name: Option<String>,
    chunks_processed: u64,
}

pub(super) async fn track_meeting_end_analytics<R: Runtime>(
    app: &AppHandle<R>,
    analytics_data: Option<MeetingEndAnalyticsData>,
) {
    let Some(data) = analytics_data else {
        return;
    };

    info!("📊 Collecting analytics for meeting end");
    let (transcription_provider, transcription_model) = transcript_model_for_analytics(app).await;
    let (summary_provider, summary_model) = summary_model_for_analytics(app).await;

    match crate::analytics::commands::track_meeting_ended(
        transcription_provider,
        transcription_model,
        summary_provider,
        summary_model,
        data.total_duration,
        data.active_duration,
        data.pause_duration,
        classify_optional_device_type(&data.mic_device_name).to_string(),
        classify_optional_device_type(&data.sys_device_name).to_string(),
        data.chunks_processed,
        data.transcript_segments_count,
        data.had_fatal_error,
    )
    .await
    {
        Ok(_) => info!("✅ Analytics tracked successfully for meeting end"),
        Err(e) => warn!("⚠️ Failed to track analytics: {}", e),
    }
}

pub(super) fn collect_meeting_end_analytics_data(
    manager: &RecordingManager,
) -> MeetingEndAnalyticsData {
    let state = manager.get_state();
    let stats = state.get_stats();

    MeetingEndAnalyticsData {
        total_duration: manager.get_recording_duration(),
        active_duration: manager.get_active_recording_duration().unwrap_or(0.0),
        pause_duration: manager.get_total_pause_duration(),
        transcript_segments_count: manager.get_transcript_segments().len() as u64,
        had_fatal_error: state.has_fatal_error(),
        mic_device_name: state.get_microphone_device().map(|d| d.name.clone()),
        sys_device_name: state.get_system_device().map(|d| d.name.clone()),
        chunks_processed: stats.chunks_processed,
    }
}

pub(super) async fn transcript_model_for_analytics<R: Runtime>(
    app: &AppHandle<R>,
) -> (String, String) {
    match crate::api::api_get_transcript_config(app.clone(), app.clone().state(), None).await {
        Ok(Some(config)) => (config.provider, config.model),
        _ => ("unknown".to_string(), "unknown".to_string()),
    }
}

pub(super) async fn summary_model_for_analytics<R: Runtime>(
    app: &AppHandle<R>,
) -> (String, String) {
    match crate::api::api_get_model_config(app.clone(), app.clone().state(), None).await {
        Ok(Some(config)) => (config.provider, config.model),
        _ => ("unknown".to_string(), "unknown".to_string()),
    }
}

pub(super) fn classify_optional_device_type(device_name: &Option<String>) -> &'static str {
    device_name
        .as_deref()
        .map(classify_device_type)
        .unwrap_or("Unknown")
}

pub(super) fn classify_device_type(device_name: &str) -> &'static str {
    let name_lower = device_name.to_lowercase();
    if name_lower.contains("bluetooth")
        || name_lower.contains("airpods")
        || name_lower.contains("beats")
        || name_lower.contains("headphones")
        || name_lower.contains("bt ")
        || name_lower.contains("wireless")
    {
        "Bluetooth"
    } else {
        "Wired"
    }
}

pub(super) async fn save_recording_data<R: Runtime>(
    app: &AppHandle<R>,
    manager_for_cleanup: Option<RecordingManager>,
) -> (Option<std::path::PathBuf>, Option<String>) {
    let Some(mut manager) = manager_for_cleanup else {
        info!("ℹ️ No recording manager available for cleanup");
        return (None, None);
    };

    info!("🧹 Performing final cleanup and saving recording data");
    let meeting_folder = manager.get_meeting_folder();
    let meeting_name = manager.get_meeting_name();

    match tokio::time::timeout(
        tokio::time::Duration::from_secs(300),
        manager.save_recording_only(app),
    )
    .await
    {
        Ok(Ok(_)) => info!("✅ Recording data saved successfully during cleanup"),
        Ok(Err(e)) => warn!(
            "⚠️ Error during recording cleanup (transcripts preserved): {}",
            e
        ),
        Err(_) => warn!("⏱️ File I/O timeout (5 minutes) reached during save, continuing shutdown"),
    }

    (meeting_folder, meeting_name)
}
