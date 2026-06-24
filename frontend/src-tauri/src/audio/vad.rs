use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use silero_rs::{VadConfig, VadSession, VadTransition};
use std::collections::VecDeque;
use std::time::Duration;

/// Represents a complete speech segment detected by VAD
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
}

/// Processes audio in 30ms chunks but returns complete speech segments
pub struct ContinuousVadProcessor {
    session: VadSession,
    chunk_size: usize,
    sample_rate: u32,
    buffer: Vec<f32>,
    speech_segments: VecDeque<SpeechSegment>,
    current_speech: Vec<f32>,
    in_speech: bool,
    processed_samples: usize,
    speech_start_sample: usize,
    // State tracking for smart logging
    last_logged_state: bool,
}

mod chunks;
mod processor;

pub use self::chunks::{extract_speech_16k, get_speech_chunks, get_speech_chunks_with_progress};

#[cfg(test)]
mod tests;
