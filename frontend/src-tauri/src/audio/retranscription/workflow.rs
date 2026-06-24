use super::*;

/// Find audio file in meeting folder
/// Tries common names first, then scans for any file with an audio extension
pub(super) fn find_audio_file(folder: &Path) -> Result<PathBuf> {
    let candidates = [
        "audio.mp4",
        "audio.m4a",
        "audio.wav",
        "audio.mp3",
        "audio.flac",
        "audio.ogg",
        "recording.mp4",
        "audio.mkv",
        "audio.webm",
        "audio.wma",
    ];

    for name in candidates {
        let path = folder.join(name);
        if path.exists() {
            return Ok(path);
        }
    }

    // Fallback: scan folder for any file with an audio extension
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
                    return Ok(path);
                }
            }
        }
    }

    Err(anyhow!("No audio file found in: {}", folder.display()))
}

/// Internal function to run retranscription
pub(super) async fn run_retranscription<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    meeting_folder_path: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
) -> Result<RetranscriptionResult> {
    let folder_path = PathBuf::from(&meeting_folder_path);
    let audio_path = find_audio_file(&folder_path)?;

    // Determine which provider to use (default to whisper)
    let use_parakeet = provider.as_deref() == Some("parakeet");

    info!(
        "Starting retranscription for meeting {} with language {:?}, model {:?}, provider {:?}",
        meeting_id, language, model, provider
    );

    // Emit progress: decoding
    super::persistence::emit_progress(&app, &meeting_id, "decoding", 5, "Decoding audio file...");
    ensure_retranscription_not_cancelled()?;
    let decoded = decode_retranscription_audio(&audio_path).await?;
    let duration_seconds = decoded.duration_seconds;

    super::persistence::emit_progress(
        &app,
        &meeting_id,
        "decoding",
        15,
        "Converting audio format...",
    );
    ensure_retranscription_not_cancelled()?;
    let audio_samples = resample_retranscription_audio(decoded).await?;

    super::persistence::emit_progress(&app, &meeting_id, "vad", 20, "Detecting speech segments...");
    ensure_retranscription_not_cancelled()?;
    let speech_segments =
        detect_retranscription_speech_segments(&app, &meeting_id, audio_samples).await?;

    let total_segments = speech_segments.len();
    info!(
        "VAD detected {} speech segments (redemption_time={}ms)",
        total_segments, VAD_REDEMPTION_TIME_MS
    );

    log_vad_segment_stats(&speech_segments, duration_seconds);

    if total_segments == 0 {
        warn!("No speech detected in audio");
        return Err(anyhow!("No speech detected in audio file"));
    }

    super::persistence::emit_progress(
        &app,
        &meeting_id,
        "transcribing",
        25,
        "Loading transcription engine...",
    );

    let engines =
        super::transcription::load_retranscription_engines(&app, use_parakeet, &model).await?;
    let all_transcripts = super::transcription::transcribe_retranscription_segments(
        &app,
        &meeting_id,
        &speech_segments,
        &engines,
        language.clone(),
    )
    .await?;
    ensure_retranscription_not_cancelled()?;

    super::persistence::emit_progress(&app, &meeting_id, "saving", 80, "Saving transcripts...");

    // Create transcript segments with proper timestamps from VAD
    let segments = create_transcript_segments(&all_transcripts);

    super::persistence::save_retranscription_segments(&app, &meeting_id, &segments).await?;

    // Write updated transcripts.json and metadata.json to the meeting folder
    super::persistence::emit_progress(
        &app,
        &meeting_id,
        "saving",
        90,
        "Writing transcript files...",
    );

    super::persistence::write_retranscription_outputs(
        &folder_path,
        &meeting_id,
        duration_seconds,
        &audio_path,
        &segments,
    );

    super::persistence::emit_progress(
        &app,
        &meeting_id,
        "complete",
        100,
        "Retranscription complete",
    );

    Ok(RetranscriptionResult {
        meeting_id,
        segments_count: segments.len(),
        duration_seconds,
        language,
    })
}

pub(super) fn ensure_retranscription_not_cancelled() -> Result<()> {
    if RETRANSCRIPTION_CANCELLED.load(Ordering::SeqCst) {
        return Err(anyhow!("Retranscription cancelled"));
    }

    Ok(())
}

pub(super) async fn decode_retranscription_audio(
    audio_path: &Path,
) -> Result<crate::audio::decoder::DecodedAudio> {
    let path_for_decode = audio_path.to_path_buf();
    let decoded = tokio::task::spawn_blocking(move || decode_audio_file(&path_for_decode))
        .await
        .map_err(|e| anyhow!("Decode task panicked: {}", e))??;

    info!(
        "Decoded audio: {:.2}s, {}Hz, {} channels",
        decoded.duration_seconds, decoded.sample_rate, decoded.channels
    );
    Ok(decoded)
}

pub(super) async fn resample_retranscription_audio(
    decoded: crate::audio::decoder::DecodedAudio,
) -> Result<Vec<f32>> {
    let audio_samples = tokio::task::spawn_blocking(move || decoded.to_whisper_format())
        .await
        .map_err(|e| anyhow!("Resample task panicked: {}", e))?;
    info!(
        "Converted to 16kHz mono format: {} samples",
        audio_samples.len()
    );
    Ok(audio_samples)
}

pub(super) async fn detect_retranscription_speech_segments<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    audio_samples: Vec<f32>,
) -> Result<Vec<crate::audio::vad::SpeechSegment>> {
    let app_for_vad = app.clone();
    let meeting_id_for_vad = meeting_id.to_string();

    tokio::task::spawn_blocking(move || {
        get_speech_chunks_with_progress(
            &audio_samples,
            VAD_REDEMPTION_TIME_MS,
            |vad_progress, segments_found| {
                let overall_progress = 20 + (vad_progress as f32 * 0.05) as u32;
                super::persistence::emit_progress(
                    &app_for_vad,
                    &meeting_id_for_vad,
                    "vad",
                    overall_progress,
                    &format!(
                        "Detecting speech segments... {}% ({} found)",
                        vad_progress, segments_found
                    ),
                );
                !RETRANSCRIPTION_CANCELLED.load(Ordering::SeqCst)
            },
        )
    })
    .await
    .map_err(|e| anyhow!("VAD task panicked: {}", e))?
    .map_err(|e| anyhow!("VAD processing failed: {}", e))
}
