use super::*;

pub(super) async fn initialize_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<TranscriptionEngine> {
    match crate::audio::transcription::engine::get_or_init_transcription_engine(app).await {
        Ok(engine) => Some(engine),
        Err(e) => {
            error!("Failed to initialize transcription engine: {}", e);
            let _ = app.emit("transcription-error", serde_json::json!({
                "error": e,
                "userMessage": "Recording failed: Unable to initialize speech recognition. Please check your model settings.",
                "actionable": true
            }));
            None
        }
    }
}

pub(super) fn spawn_transcription_workers<R: Runtime>(
    app: &AppHandle<R>,
    transcription_engine: &TranscriptionEngine,
    work_receiver: WorkReceiver,
    counters: &WorkerCounters,
) -> Vec<tokio::task::JoinHandle<()>> {
    (0..NUM_WORKERS)
        .map(|worker_id| {
            let engine_clone = clone_transcription_engine(transcription_engine);
            let app_clone = app.clone();
            let work_receiver_clone = work_receiver.clone();
            let counters_clone = counters.clone();

            tokio::spawn(async move {
                run_transcription_worker(
                    worker_id,
                    engine_clone,
                    app_clone,
                    work_receiver_clone,
                    counters_clone,
                )
                .await;
            })
        })
        .collect()
}

pub(super) fn clone_transcription_engine(engine: &TranscriptionEngine) -> TranscriptionEngine {
    match engine {
        TranscriptionEngine::Whisper(e) => TranscriptionEngine::Whisper(e.clone()),
        TranscriptionEngine::Parakeet(e) => TranscriptionEngine::Parakeet(e.clone()),
        TranscriptionEngine::Provider(p) => TranscriptionEngine::Provider(p.clone()),
    }
}

pub(super) async fn run_transcription_worker<R: Runtime>(
    worker_id: usize,
    engine: TranscriptionEngine,
    app: AppHandle<R>,
    work_receiver: WorkReceiver,
    counters: WorkerCounters,
) {
    info!("👷 Worker {} started", worker_id);
    log_worker_model_state(worker_id, &engine).await;

    loop {
        let chunk = receive_worker_chunk(&work_receiver).await;
        match chunk {
            Some(chunk) => {
                super::processing::process_worker_chunk(worker_id, &engine, &app, &counters, chunk)
                    .await
            }
            None if super::processing::should_finish_worker(worker_id, &counters).await => break,
            None => {}
        }
    }

    info!("👷 Worker {} completed", worker_id);
}

pub(super) async fn log_worker_model_state(worker_id: usize, engine: &TranscriptionEngine) {
    let initial_model_loaded = engine.is_model_loaded().await;
    let current_model = engine
        .get_current_model()
        .await
        .unwrap_or_else(|| "unknown".to_string());
    let engine_name = engine.provider_name();

    if initial_model_loaded {
        info!(
            "✅ Worker {} pre-validation: {} model '{}' is loaded and ready",
            worker_id, engine_name, current_model
        );
    } else {
        warn!(
            "⚠️ Worker {} pre-validation: {} model not loaded - chunks may be skipped",
            worker_id, engine_name
        );
    }
}

pub(super) async fn receive_worker_chunk(work_receiver: &WorkReceiver) -> Option<AudioChunk> {
    let mut receiver = work_receiver.lock().await;
    receiver.recv().await
}

pub(super) async fn dispatch_chunks<R: Runtime>(
    app: &AppHandle<R>,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<AudioChunk>,
    work_sender: tokio::sync::mpsc::UnboundedSender<AudioChunk>,
    counters: &WorkerCounters,
) {
    while let Some(chunk) = receiver.recv().await {
        let queued = counters.queue_chunk();
        info!(
            "📥 Dispatching chunk {} to workers (total queued: {})",
            chunk.chunk_id, queued
        );

        if work_sender.send(chunk).is_err() {
            error!("❌ Failed to send chunk to workers - this should not happen!");
            break;
        }
    }

    counters.input_finished.store(true, Ordering::SeqCst);
    drop(work_sender);
    emit_queue_complete(app, counters.queued());
}

pub(super) fn emit_queue_complete<R: Runtime>(app: &AppHandle<R>, total_chunks_queued: u64) {
    info!(
        "📭 Input finished with {} total chunks queued. Waiting for all {} workers to complete...",
        total_chunks_queued, NUM_WORKERS
    );

    let _ = app.emit("transcription-queue-complete", serde_json::json!({
        "total_chunks": total_chunks_queued,
        "message": format!("{} chunks queued for processing - waiting for completion", total_chunks_queued)
    }));
}

pub(super) async fn wait_for_workers(worker_handles: Vec<tokio::task::JoinHandle<()>>) {
    for (worker_id, handle) in worker_handles.into_iter().enumerate() {
        if let Err(e) = handle.await {
            error!("❌ Worker {} panicked: {:?}", worker_id, e);
        } else {
            info!("✅ Worker {} completed successfully", worker_id);
        }
    }
}

pub(super) async fn verify_chunk_completion<R: Runtime>(
    app: &AppHandle<R>,
    counters: &WorkerCounters,
) {
    let mut verification_attempts = 0;

    loop {
        let final_queued = counters.queued();
        let final_completed = counters.completed();

        if final_queued == final_completed {
            info!(
                "🎉 ALL {} chunks processed successfully - ZERO chunks lost!",
                final_completed
            );
            break;
        }

        if verification_attempts >= MAX_VERIFICATION_ATTEMPTS {
            emit_chunk_loss_detected(app, final_queued, final_completed);
            break;
        }

        verification_attempts += 1;
        warn!("⚠️ Chunk count mismatch (attempt {}): {} queued, {} completed - waiting for stragglers...",
             verification_attempts, final_queued, final_completed);
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

pub(super) fn emit_chunk_loss_detected<R: Runtime>(
    app: &AppHandle<R>,
    final_queued: u64,
    final_completed: u64,
) {
    error!(
        "❌ CRITICAL: After {} attempts, chunk loss detected: {} queued, {} completed",
        MAX_VERIFICATION_ATTEMPTS, final_queued, final_completed
    );

    let _ = app.emit(
        "transcript-chunk-loss-detected",
        serde_json::json!({
            "chunks_queued": final_queued,
            "chunks_completed": final_completed,
            "chunks_lost": final_queued - final_completed,
            "message": "Some transcript chunks may have been lost during shutdown"
        }),
    );
}
