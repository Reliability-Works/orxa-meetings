use anyhow::Result;
use log::{debug, error, info, warn};
use std::sync::Arc;
use tokio::sync::mpsc;

use super::devices::{list_audio_devices, AudioDevice};

#[cfg(target_os = "macos")]
use super::devices::get_safe_recording_devices_macos;

use super::device_monitor::{AudioDeviceMonitor, DeviceEvent, DeviceMonitorType};
#[cfg(not(target_os = "macos"))]
use super::devices::{default_input_device, default_output_device};
use super::pipeline::AudioPipelineManager;
use super::recording_saver::RecordingSaver;
use super::recording_state::{AudioChunk, DeviceType as RecordingDeviceType, RecordingState};
use super::stream::AudioStreamManager;

/// Stream manager type enumeration
pub enum StreamManagerType {
    Standard(AudioStreamManager),
}

/// Simplified recording manager that coordinates all audio components
pub struct RecordingManager {
    state: Arc<RecordingState>,
    stream_manager: AudioStreamManager,
    pipeline_manager: AudioPipelineManager,
    recording_saver: RecordingSaver,
    device_monitor: Option<AudioDeviceMonitor>,
    device_event_receiver: Option<mpsc::UnboundedReceiver<DeviceEvent>>,
}

// SAFETY: RecordingManager contains types that we've marked as Send
unsafe impl Send for RecordingManager {}

mod accessors;
mod lifecycle;
mod reconnect;

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for RecordingManager {
    fn drop(&mut self) {
        // Note: Can't call async cleanup in Drop, but streams have their own Drop implementations
        self.state.cleanup();
    }
}
