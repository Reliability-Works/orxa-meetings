use super::*;

pub(super) async fn process_worker_chunk<R: Runtime>(
    worker_id: usize,
    engine: &TranscriptionEngine,
    app: &AppHandle<R>,
    counters: &WorkerCounters,
    chunk: AudioChunk,
) {
    let should_log_this_chunk = chunk.chunk_id % 10 == 0;
    log_chunk_start(worker_id, &chunk, should_log_this_chunk);

    if !engine.is_model_loaded().await {
        warn!(
            "⚠️ Worker {}: Model unloaded, but continuing to preserve chunk {}",
            worker_id, chunk.chunk_id
        );
        counters.mark_completed();
        return;
    }

    let timing = ChunkTiming {
        timestamp: chunk.timestamp,
        duration: chunk.data.len() as f64 / chunk.sample_rate as f64,
        speaker: chunk.speaker.clone(),
    };

    match super::provider::transcribe_chunk_with_provider(engine, chunk, app).await {
        Ok((transcript, confidence, is_partial)) => {
            let success = TranscriptionSuccess {
                transcript,
                confidence,
                is_partial,
            };
            handle_transcription_success(
                worker_id,
                engine,
                app,
                timing,
                success,
                should_log_this_chunk,
            );
        }
        Err(e) if completes_chunk_early(worker_id, &e, counters) => return,
        Err(e) => {
            warn!("Worker {}: Transcription failed: {}", worker_id, e);
            let _ = app.emit("transcription-warning", e.to_string());
        }
    }

    emit_worker_progress(worker_id, app, counters, should_log_this_chunk);
}

pub(super) fn log_chunk_start(worker_id: usize, chunk: &AudioChunk, should_log_this_chunk: bool) {
    if should_log_this_chunk {
        info!(
            "👷 Worker {} processing chunk {} with {} samples",
            worker_id,
            chunk.chunk_id,
            chunk.data.len()
        );
    }
}

pub(super) fn handle_transcription_success<R: Runtime>(
    worker_id: usize,
    engine: &TranscriptionEngine,
    app: &AppHandle<R>,
    timing: ChunkTiming,
    success: TranscriptionSuccess,
    should_log_this_chunk: bool,
) {
    let confidence_threshold = confidence_threshold_for(engine);
    let confidence_str = success
        .confidence
        .map(|confidence| format!("{:.2}", confidence))
        .unwrap_or_else(|| "N/A".to_string());

    info!(
        "🔍 Worker {} transcription result: text='{}', confidence={}, partial={}, threshold={:.2}",
        worker_id, success.transcript, confidence_str, success.is_partial, confidence_threshold
    );

    let meets_threshold = success
        .confidence
        .map_or(true, |confidence| confidence >= confidence_threshold);
    if !success.transcript.trim().is_empty() && meets_threshold {
        info!(
            "✅ Worker {} transcribed: {} (confidence: {}, partial: {})",
            worker_id, success.transcript, confidence_str, success.is_partial
        );
        emit_speech_detected_once(app);
        emit_transcript_update(
            worker_id,
            app,
            timing,
            success.transcript,
            success.confidence,
            success.is_partial,
        );
    } else if !success.transcript.trim().is_empty() && should_log_this_chunk {
        if let Some(confidence) = success.confidence {
            info!(
                "Worker {} low-confidence transcription (confidence: {:.2}), skipping",
                worker_id, confidence
            );
        }
    }
}

pub(super) fn confidence_threshold_for(engine: &TranscriptionEngine) -> f32 {
    match engine {
        TranscriptionEngine::Whisper(_) | TranscriptionEngine::Provider(_) => 0.3,
        TranscriptionEngine::Parakeet(_) => 0.0,
    }
}

pub(super) fn emit_speech_detected_once<R: Runtime>(app: &AppHandle<R>) {
    let current_flag = SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst);
    info!(
        "🔍 Checking speech-detected flag: current={}, will_emit={}",
        current_flag, !current_flag
    );

    if current_flag {
        info!("🔍 Speech already detected in this session, not re-emitting");
        return;
    }

    SPEECH_DETECTED_EMITTED.store(true, Ordering::SeqCst);
    match app.emit(
        "speech-detected",
        serde_json::json!({ "message": "Speech activity detected" }),
    ) {
        Ok(_) => info!("🎤 ✅ First speech detected - successfully emitted speech-detected event"),
        Err(e) => error!("🎤 ❌ Failed to emit speech-detected event: {}", e),
    }
}

pub(super) fn emit_transcript_update<R: Runtime>(
    worker_id: usize,
    app: &AppHandle<R>,
    timing: ChunkTiming,
    transcript: String,
    confidence_opt: Option<f32>,
    is_partial: bool,
) {
    let sequence_id = SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst);
    let update = TranscriptUpdate {
        text: transcript,
        timestamp: format_current_timestamp(),
        source: "Audio".to_string(),
        speaker: timing.speaker,
        sequence_id,
        chunk_start_time: timing.timestamp,
        is_partial,
        confidence: confidence_opt.unwrap_or(0.85),
        audio_start_time: timing.timestamp,
        audio_end_time: timing.timestamp + timing.duration,
        duration: timing.duration,
    };

    if let Err(e) = app.emit("transcript-update", &update) {
        error!(
            "Worker {}: Failed to emit transcript update: {}",
            worker_id, e
        );
    }
}

pub(super) fn completes_chunk_early(
    worker_id: usize,
    error: &TranscriptionError,
    counters: &WorkerCounters,
) -> bool {
    match error {
        TranscriptionError::AudioTooShort { .. } => {
            info!("Worker {}: {}", worker_id, error);
            counters.mark_completed();
            true
        }
        TranscriptionError::ModelNotLoaded => {
            warn!("Worker {}: Model unloaded during transcription", worker_id);
            counters.mark_completed();
            true
        }
        _ => false,
    }
}

pub(super) fn emit_worker_progress<R: Runtime>(
    worker_id: usize,
    app: &AppHandle<R>,
    counters: &WorkerCounters,
    should_log_this_chunk: bool,
) {
    let completed = counters.mark_completed();
    let queued = counters.queued();

    if completed % 5 == 0 || should_log_this_chunk {
        info!(
            "Worker {}: Progress {}/{} chunks ({:.1}%)",
            worker_id,
            completed,
            queued,
            (completed as f64 / queued.max(1) as f64 * 100.0)
        );
    }

    let progress_percentage = if queued > 0 {
        (completed as f64 / queued as f64 * 100.0) as u32
    } else {
        100
    };

    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({
            "worker_id": worker_id,
            "chunks_completed": completed,
            "chunks_queued": queued,
            "progress_percentage": progress_percentage,
            "message": format!("Worker {} processing... ({}/{})", worker_id, completed, queued)
        }),
    );
}

pub(super) async fn should_finish_worker(worker_id: usize, counters: &WorkerCounters) -> bool {
    if counters.input_finished.load(Ordering::SeqCst) {
        let final_queued = counters.queued();
        let final_completed = counters.completed();

        if final_completed >= final_queued {
            info!(
                "👷 Worker {} finishing - all {}/{} chunks processed",
                worker_id, final_completed, final_queued
            );
            return true;
        }

        warn!(
            "👷 Worker {} detected potential chunk loss: {}/{} completed, waiting...",
            worker_id, final_completed, final_queued
        );
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    } else {
        tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
    }

    false
}

/// Format current timestamp (wall-clock time)
pub(super) fn format_current_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    let hours = (now.as_secs() / 3600) % 24;
    let minutes = (now.as_secs() / 60) % 60;
    let seconds = now.as_secs() % 60;

    format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
}

/// Format recording-relative time as [MM:SS]
#[allow(dead_code)]
pub(super) fn format_recording_time(seconds: f64) -> String {
    let total_seconds = seconds.floor() as u64;
    let minutes = total_seconds / 60;
    let secs = total_seconds % 60;

    format!("[{:02}:{:02}]", minutes, secs)
}
