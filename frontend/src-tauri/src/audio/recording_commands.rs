// audio/recording_commands.rs
//
// Slim Tauri command layer for recording functionality.
// Delegates to transcription and recording modules for actual implementation.

use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::{sync::mpsc, task::JoinHandle};

use super::{
    default_input_device,  // Get default microphone
    default_output_device, // Get default system audio
    parse_audio_device,
    AudioChunk,
    AudioDevice,
    DeviceEvent,
    DeviceMonitorType,
    RecordingManager,
};

// Import transcription modules
use super::transcription::{self, reset_speech_detected_flag};

// Re-export TranscriptUpdate for backward compatibility
pub use super::transcription::TranscriptUpdate;

// ============================================================================
// GLOBAL STATE
// ============================================================================

// Simple recording state tracking
static IS_RECORDING: AtomicBool = AtomicBool::new(false);

// Global recording manager and transcription task to keep them alive during recording
static RECORDING_MANAGER: Mutex<Option<RecordingManager>> = Mutex::new(None);
static TRANSCRIPTION_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

// Listener ID for proper cleanup - prevents microphone from staying active after recording stops
static TRANSCRIPT_LISTENER_ID: Mutex<Option<tauri::EventId>> = Mutex::new(None);

fn finish_recording_start<R: Runtime, G>(
    app: AppHandle<R>,
    manager: RecordingManager,
    transcription_receiver: mpsc::UnboundedReceiver<AudioChunk>,
    engine_lifecycle_guard: G,
    started_payload: serde_json::Value,
    success_log: &str,
) -> Result<(), String> {
    {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        *global_manager = Some(manager);
    }

    info!("🔍 Setting IS_RECORDING to true and resetting SPEECH_DETECTED_EMITTED");
    IS_RECORDING.store(true, Ordering::SeqCst);
    drop(engine_lifecycle_guard);
    reset_speech_detected_flag();

    let task_handle = transcription::start_transcription_task(app.clone(), transcription_receiver);
    {
        let mut global_task = TRANSCRIPTION_TASK.lock().unwrap();
        *global_task = Some(task_handle);
    }

    register_transcript_history_listener(&app);

    app.emit("recording-started", started_payload)
        .map_err(|e| e.to_string())?;

    crate::tray::update_tray_menu(&app);
    info!("{}", success_log);

    Ok(())
}

fn register_transcript_history_listener<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Listener;

    let listener_id = app.listen("transcript-update", move |event: tauri::Event| {
        if let Ok(update) = serde_json::from_str::<TranscriptUpdate>(event.payload()) {
            let segment = crate::audio::recording_saver::TranscriptSegment {
                id: format!("seg_{}", update.sequence_id),
                text: update.text.clone(),
                speaker: update.speaker.clone(),
                audio_start_time: update.audio_start_time,
                audio_end_time: update.audio_end_time,
                duration: update.duration,
                display_time: update.timestamp.clone(),
                confidence: update.confidence,
                sequence_id: update.sequence_id,
            };

            if let Ok(manager_guard) = RECORDING_MANAGER.lock() {
                if let Some(manager) = manager_guard.as_ref() {
                    manager.add_transcript_segment(segment);
                }
            }
        }
    });

    let mut global_listener = TRANSCRIPT_LISTENER_ID.lock().unwrap();
    *global_listener = Some(listener_id);
    info!("✅ Transcript-update event listener registered for history persistence");
}

// ============================================================================
// PUBLIC TYPES
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RecordingArgs {
    pub save_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptionStatus {
    pub chunks_in_queue: usize,
    pub is_processing: bool,
    pub last_activity_ms: u64,
}

struct RecordingStartPreferences {
    auto_save: bool,
    preferred_mic_name: Option<String>,
    preferred_system_name: Option<String>,
}

mod devices;
mod start;
mod state;
mod stop;

pub use self::devices::{DeviceEventResponse, DisconnectedDeviceInfo, ReconnectionStatus};

pub async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start::start_recording(app).await
}

pub async fn start_recording_with_meeting_name<R: Runtime>(
    app: AppHandle<R>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    start::start_recording_with_meeting_name(app, meeting_name).await
}

pub async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start::start_recording_with_devices(app, mic_device_name, system_device_name).await
}

pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    start::start_recording_with_devices_and_meeting(
        app,
        mic_device_name,
        system_device_name,
        meeting_name,
    )
    .await
}

pub async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    args: RecordingArgs,
) -> Result<(), String> {
    stop::stop_recording(app, args).await
}

pub async fn is_recording() -> bool {
    state::is_recording().await
}

pub async fn get_transcription_status() -> TranscriptionStatus {
    state::get_transcription_status().await
}

#[tauri::command]
pub async fn pause_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    state::pause_recording(app).await
}

#[tauri::command]
pub async fn resume_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    state::resume_recording(app).await
}

#[tauri::command]
pub async fn is_recording_paused() -> bool {
    state::is_recording_paused().await
}

#[tauri::command]
pub async fn get_recording_state() -> serde_json::Value {
    state::get_recording_state().await
}

#[tauri::command]
pub async fn get_meeting_folder_path() -> Result<Option<String>, String> {
    state::get_meeting_folder_path().await
}

#[tauri::command]
pub async fn get_transcript_history(
) -> Result<Vec<crate::audio::recording_saver::TranscriptSegment>, String> {
    state::get_transcript_history().await
}

#[tauri::command]
pub async fn get_recording_meeting_name() -> Result<Option<String>, String> {
    state::get_recording_meeting_name().await
}

#[tauri::command]
pub async fn poll_audio_device_events() -> Result<Option<DeviceEventResponse>, String> {
    devices::poll_audio_device_events().await
}

#[tauri::command]
pub async fn get_reconnection_status() -> Result<ReconnectionStatus, String> {
    devices::get_reconnection_status().await
}

#[tauri::command]
pub async fn get_active_audio_output() -> Result<super::playback_monitor::AudioOutputInfo, String> {
    devices::get_active_audio_output().await
}

#[tauri::command]
pub async fn attempt_device_reconnect(
    device_name: String,
    device_type: String,
) -> Result<bool, String> {
    devices::attempt_device_reconnect(device_name, device_type).await
}
