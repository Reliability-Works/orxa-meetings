use super::batch_processor::AudioMetricsBatcher;
use crate::batch_audio_metric;
use anyhow::Result;
use log::{debug, error, info, warn};
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::audio_processing::{
    audio_to_mono, HighPassFilter, LoudnessNormalizer, NoiseSuppressionProcessor,
};
use super::devices::AudioDevice;
use super::recording_state::{AudioChunk, AudioError, DeviceType, RecordingState};
use super::vad::ContinuousVadProcessor;

mod capture;
mod capture_processing;
mod manager;
mod mixer;
mod runner;

pub use self::capture::AudioCapture;
pub use self::manager::AudioPipelineManager;
pub use self::runner::AudioPipeline;
