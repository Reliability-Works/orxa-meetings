use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{AudioChunk, ProcessingError, TranscriptionResult};

pub(super) struct ChunkQueue {
    pub(super) pending: Vec<AudioChunk>,
    pub(super) processing: HashMap<u32, AudioChunk>,
    pub(super) completed: HashMap<u32, TranscriptionResult>,
    pub(super) failed: HashMap<u32, ProcessingError>,
    pub(super) retry_queue: Vec<(AudioChunk, u32)>,
}

impl ChunkQueue {
    pub(super) fn new() -> Self {
        Self {
            pending: Vec::new(),
            processing: HashMap::new(),
            completed: HashMap::new(),
            failed: HashMap::new(),
            retry_queue: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingStatus {
    pub total_chunks: usize,
    pub pending_chunks: usize,
    pub processing_chunks: usize,
    pub completed_chunks: usize,
    pub failed_chunks: usize,
    pub retry_queue_size: usize,
    pub is_paused: bool,
    pub is_stopped: bool,
}
