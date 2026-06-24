// audio/transcription/worker.rs
//
// Parallel transcription worker pool and chunk processing logic.

use super::engine::TranscriptionEngine;
use super::provider::TranscriptionError;
use crate::audio::AudioChunk;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

type WorkReceiver = Arc<tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<AudioChunk>>>;

// Sequence counter for transcript updates
static SEQUENCE_COUNTER: AtomicU64 = AtomicU64::new(0);

// Speech detection flag - reset per recording session
static SPEECH_DETECTED_EMITTED: AtomicBool = AtomicBool::new(false);

const NUM_WORKERS: usize = 1; // Serial processing ensures transcripts emit in chronological order
const MAX_VERIFICATION_ATTEMPTS: u32 = 10;

#[derive(Clone)]
struct WorkerCounters {
    queued: Arc<AtomicU64>,
    completed: Arc<AtomicU64>,
    input_finished: Arc<AtomicBool>,
}

impl WorkerCounters {
    fn new() -> Self {
        Self {
            queued: Arc::new(AtomicU64::new(0)),
            completed: Arc::new(AtomicU64::new(0)),
            input_finished: Arc::new(AtomicBool::new(false)),
        }
    }

    fn queue_chunk(&self) -> u64 {
        self.queued.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn mark_completed(&self) -> u64 {
        self.completed.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn queued(&self) -> u64 {
        self.queued.load(Ordering::SeqCst)
    }

    fn completed(&self) -> u64 {
        self.completed.load(Ordering::SeqCst)
    }
}

struct ChunkTiming {
    timestamp: f64,
    duration: f64,
    speaker: Option<String>,
}

struct TranscriptionSuccess {
    transcript: String,
    confidence: Option<f32>,
    is_partial: bool,
}

/// Reset the speech detected flag for a new recording session
pub fn reset_speech_detected_flag() {
    SPEECH_DETECTED_EMITTED.store(false, Ordering::SeqCst);
    info!(
        "🔍 SPEECH_DETECTED_EMITTED reset to: {}",
        SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst)
    );
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptUpdate {
    pub text: String,
    pub timestamp: String, // Wall-clock time for reference (e.g., "14:30:05")
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    pub sequence_id: u64,
    pub chunk_start_time: f64, // Legacy field, kept for compatibility
    pub is_partial: bool,
    pub confidence: f32,
    // NEW: Recording-relative timestamps for playback sync
    pub audio_start_time: f64, // Seconds from recording start (e.g., 125.3)
    pub audio_end_time: f64,   // Seconds from recording start (e.g., 128.6)
    pub duration: f64,         // Segment duration in seconds (e.g., 3.3)
}

// NOTE: get_transcript_history and get_recording_meeting_name functions
// have been moved to recording_commands.rs where they have access to RECORDING_MANAGER

/// Optimized parallel transcription task ensuring ZERO chunk loss
pub fn start_transcription_task<R: Runtime>(
    app: AppHandle<R>,
    transcription_receiver: tokio::sync::mpsc::UnboundedReceiver<AudioChunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        info!("🚀 Starting optimized parallel transcription task - guaranteeing zero chunk loss");

        let Some(transcription_engine) = initialize_transcription_engine(&app).await else {
            return;
        };
        let (work_sender, work_receiver) = tokio::sync::mpsc::unbounded_channel::<AudioChunk>();
        let work_receiver = Arc::new(tokio::sync::Mutex::new(work_receiver));
        let counters = WorkerCounters::new();

        info!(
            "📊 Starting {} transcription worker{} (serial mode for ordered emission)",
            NUM_WORKERS,
            if NUM_WORKERS == 1 { "" } else { "s" }
        );

        let worker_handles =
            spawn_transcription_workers(&app, &transcription_engine, work_receiver, &counters);
        dispatch_chunks(&app, transcription_receiver, work_sender, &counters).await;
        wait_for_workers(worker_handles).await;
        verify_chunk_completion(&app, &counters).await;

        info!("✅ Parallel transcription task completed - all workers finished, ready for model unload");
    })
}

mod lifecycle;
mod processing;
mod provider;

use self::lifecycle::{
    dispatch_chunks, initialize_transcription_engine, spawn_transcription_workers,
    verify_chunk_completion, wait_for_workers,
};
