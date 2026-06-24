use super::*;

// ============================================================================
// RECORDING COMMANDS
// ============================================================================

/// Start recording with default devices
pub async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start_recording_with_meeting_name(app, None).await
}

/// Start recording with default devices and optional meeting name
pub async fn start_recording_with_meeting_name<R: Runtime>(
    app: AppHandle<R>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with default devices, meeting: {:?}",
        meeting_name
    );

    let engine_lifecycle_guard = crate::audio::common::acquire_engine_lifecycle_lock().await;

    validate_recording_start(&app).await?;

    // Async-first approach - no more blocking operations!
    info!("🚀 Starting async recording initialization");

    // Create new recording manager
    let mut manager = RecordingManager::new();

    // Load recording preferences to get auto_save AND device preferences
    let preferences = load_recording_start_preferences(&app).await;
    let microphone_device = resolve_preferred_microphone(preferences.preferred_mic_name)?;
    let system_device = resolve_preferred_system_audio(preferences.preferred_system_name);

    // Always ensure a meeting name is set so incremental saver initializes
    let effective_meeting_name = meeting_name.clone().unwrap_or_else(|| {
        // Example: Meeting 2025-10-03_08-25-23
        let now = chrono::Local::now();
        format!("Meeting {}", now.format("%Y-%m-%d_%H-%M-%S"))
    });
    manager.set_meeting_name(Some(effective_meeting_name));

    // Set up error callback
    let app_for_error = app.clone();
    manager.set_error_callback(move |error| {
        let _ = app_for_error.emit("recording-error", error.user_message());
    });

    // Start recording with resolved devices (replaces start_recording_with_defaults_and_auto_save call)
    let transcription_receiver = manager
        .start_recording(microphone_device, system_device, preferences.auto_save)
        .await
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    finish_recording_start(
        app,
        manager,
        transcription_receiver,
        engine_lifecycle_guard,
        serde_json::json!({
            "message": "Recording started successfully with parallel processing",
            "devices": ["Default Microphone", "Default System Audio"],
            "workers": 3
        }),
        "✅ Recording started successfully with async-first approach",
    )
}

pub(super) async fn validate_recording_start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let current_recording_state = IS_RECORDING.load(Ordering::SeqCst);
    info!("🔍 IS_RECORDING state check: {}", current_recording_state);
    if current_recording_state {
        return Err("Recording already in progress".to_string());
    }

    info!("🔍 Validating transcription model availability before starting recording...");
    if let Err(validation_error) = transcription::validate_transcription_model_ready(app).await {
        error!("Model validation failed: {}", validation_error);
        let _ = app.emit("transcription-error", serde_json::json!({
            "error": validation_error,
            "userMessage": "Recording cannot start: Transcription model is still downloading. Please wait for the download to complete.",
            "actionable": false
        }));
        return Err(validation_error);
    }

    info!("✅ Transcription model validation passed");
    Ok(())
}

pub(super) async fn load_recording_start_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> RecordingStartPreferences {
    match crate::audio::recording_preferences::load_recording_preferences(app).await {
        Ok(prefs) => {
            info!("📋 Loaded recording preferences: auto_save={}, preferred_mic={:?}, preferred_system={:?}",
                  prefs.auto_save, prefs.preferred_mic_device, prefs.preferred_system_device);
            RecordingStartPreferences {
                auto_save: prefs.auto_save,
                preferred_mic_name: prefs.preferred_mic_device,
                preferred_system_name: prefs.preferred_system_device,
            }
        }
        Err(e) => {
            warn!(
                "Failed to load recording preferences, using defaults: {}",
                e
            );
            RecordingStartPreferences {
                auto_save: true,
                preferred_mic_name: None,
                preferred_system_name: None,
            }
        }
    }
}

pub(super) fn resolve_preferred_microphone(
    preferred_name: Option<String>,
) -> Result<Option<Arc<AudioDevice>>, String> {
    match preferred_name {
        Some(pref_name) => resolve_named_microphone(pref_name),
        None => resolve_default_microphone(),
    }
}

pub(super) fn resolve_named_microphone(
    pref_name: String,
) -> Result<Option<Arc<AudioDevice>>, String> {
    info!("🎤 Attempting to use preferred microphone: '{}'", pref_name);
    match parse_audio_device(&pref_name) {
        Ok(device) => {
            info!("✅ Using preferred microphone: '{}'", device.name);
            Ok(Some(Arc::new(device)))
        }
        Err(e) => {
            warn!(
                "⚠️ Preferred microphone '{}' not available: {}",
                pref_name, e
            );
            warn!("   Falling back to system default microphone...");
            default_input_device()
                .map(|device| {
                    info!("✅ Using default microphone: '{}'", device.name);
                    Some(Arc::new(device))
                })
                .map_err(|default_err| {
                    error!("❌ No microphone available (preferred and default both failed)");
                    format!(
                        "No microphone device available. Preferred device '{}' not found, and default microphone unavailable: {}",
                        pref_name, default_err
                    )
                })
        }
    }
}

pub(super) fn resolve_default_microphone() -> Result<Option<Arc<AudioDevice>>, String> {
    info!("🎤 No microphone preference set, using system default");
    default_input_device()
        .map(|device| {
            info!("✅ Using default microphone: '{}'", device.name);
            Some(Arc::new(device))
        })
        .map_err(|e| {
            error!("❌ No default microphone available");
            format!("No microphone device available: {}", e)
        })
}

pub(super) fn resolve_preferred_system_audio(
    preferred_name: Option<String>,
) -> Option<Arc<AudioDevice>> {
    match preferred_name {
        Some(pref_name) => resolve_named_system_audio(pref_name),
        None => resolve_default_system_audio(),
    }
}

pub(super) fn resolve_named_system_audio(pref_name: String) -> Option<Arc<AudioDevice>> {
    info!(
        "🔊 Attempting to use preferred system audio: '{}'",
        pref_name
    );
    match parse_audio_device(&pref_name) {
        Ok(device) => {
            info!("✅ Using preferred system audio: '{}'", device.name);
            Some(Arc::new(device))
        }
        Err(e) => {
            warn!(
                "⚠️ Preferred system audio '{}' not available: {}",
                pref_name, e
            );
            warn!("   Falling back to system default...");
            resolve_default_system_audio_after_preference_failure()
        }
    }
}

pub(super) fn resolve_default_system_audio_after_preference_failure() -> Option<Arc<AudioDevice>> {
    match default_output_device() {
        Ok(device) => {
            info!("✅ Using default system audio: '{}'", device.name);
            Some(Arc::new(device))
        }
        Err(default_err) => {
            warn!(
                "⚠️ No system audio available (preferred and default both failed): {}",
                default_err
            );
            warn!("   Recording will continue with microphone only");
            None
        }
    }
}

pub(super) fn resolve_default_system_audio() -> Option<Arc<AudioDevice>> {
    info!("🔊 No system audio preference set, using system default");
    match default_output_device() {
        Ok(device) => {
            info!("✅ Using default system audio: '{}'", device.name);
            Some(Arc::new(device))
        }
        Err(e) => {
            warn!("⚠️ No default system audio available: {}", e);
            warn!("   Recording will continue with microphone only");
            None
        }
    }
}

/// Start recording with specific devices
pub async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

/// Start recording with specific devices and optional meeting name
pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with specific devices: mic={:?}, system={:?}, meeting={:?}",
        mic_device_name, system_device_name, meeting_name
    );

    let engine_lifecycle_guard = crate::audio::common::acquire_engine_lifecycle_lock().await;

    // Check if already recording
    let current_recording_state = IS_RECORDING.load(Ordering::SeqCst);
    info!("🔍 IS_RECORDING state check: {}", current_recording_state);
    if current_recording_state {
        return Err("Recording already in progress".to_string());
    }

    // Validate that transcription models are available before starting recording
    info!("🔍 Validating transcription model availability before starting recording...");
    if let Err(validation_error) = transcription::validate_transcription_model_ready(&app).await {
        error!("Model validation failed: {}", validation_error);

        // Emit error event for frontend - actionable: false to show toast instead of modal
        // (download progress is already shown in top-right toast)
        let _ = app.emit("transcription-error", serde_json::json!({
            "error": validation_error,
            "userMessage": "Recording cannot start: Transcription model is still downloading. Please wait for the download to complete.",
            "actionable": false
        }));

        return Err(validation_error);
    }
    info!("✅ Transcription model validation passed");

    // Parse devices
    let mic_device = if let Some(ref name) = mic_device_name {
        Some(Arc::new(parse_audio_device(name).map_err(|e| {
            format!("Invalid microphone device '{}': {}", name, e)
        })?))
    } else {
        None
    };

    let system_device = if let Some(ref name) = system_device_name {
        Some(Arc::new(parse_audio_device(name).map_err(|e| {
            format!("Invalid system device '{}': {}", name, e)
        })?))
    } else {
        None
    };

    // Async-first approach for custom devices - no more blocking operations!
    info!("🚀 Starting async recording initialization with custom devices");

    // Create new recording manager
    let mut manager = RecordingManager::new();

    // Load recording preferences to check auto_save setting
    let auto_save =
        match crate::audio::recording_preferences::load_recording_preferences(&app).await {
            Ok(prefs) => {
                info!(
                    "📋 Loaded recording preferences: auto_save={}",
                    prefs.auto_save
                );
                prefs.auto_save
            }
            Err(e) => {
                warn!(
                    "Failed to load recording preferences, defaulting to auto_save=true: {}",
                    e
                );
                true // Default to saving if preferences can't be loaded
            }
        };

    // Always ensure a meeting name is set so incremental saver initializes
    let effective_meeting_name = meeting_name.clone().unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!("Meeting {}", now.format("%Y-%m-%d_%H-%M-%S"))
    });
    manager.set_meeting_name(Some(effective_meeting_name));

    // Set up error callback
    let app_for_error = app.clone();
    manager.set_error_callback(move |error| {
        let _ = app_for_error.emit("recording-error", error.user_message());
    });

    // Start recording with specified devices and auto_save setting
    let transcription_receiver = manager
        .start_recording(mic_device, system_device, auto_save)
        .await
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    finish_recording_start(
        app,
        manager,
        transcription_receiver,
        engine_lifecycle_guard,
        serde_json::json!({
            "message": "Recording started with custom devices and parallel processing",
            "devices": [
                mic_device_name.unwrap_or_else(|| "Default Microphone".to_string()),
                system_device_name.unwrap_or_else(|| "Default System Audio".to_string())
            ],
            "workers": 3
        }),
        "✅ Recording started with custom devices using async-first approach",
    )
}
