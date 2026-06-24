use super::*;

/// Internal function to run import
pub(super) async fn run_import<R: Runtime>(
    app: AppHandle<R>,
    source_path: String,
    title: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
) -> Result<ImportResult> {
    let source = PathBuf::from(&source_path);

    // Validate source file
    if !source.exists() {
        return Err(anyhow!("Source file not found: {}", source.display()));
    }

    info!(
        "Starting import for '{}' from {} with language {:?}, model {:?}, provider {:?}",
        title, source_path, language, model, provider
    );

    // Determine which provider to use (default to whisper)
    let use_parakeet = provider.as_deref() == Some("parakeet");

    super::progress::emit_progress(&app, "copying", 5, "Creating meeting folder...");
    ensure_import_not_cancelled(None)?;

    let copied_audio = copy_audio_to_import_folder(&app, &source, &title).await?;
    ensure_import_not_cancelled(Some(&copied_audio.meeting_folder))?;

    super::progress::emit_progress(&app, "decoding", 15, "Decoding audio file...");
    let decoded = decode_import_audio(&app, &copied_audio.dest_path).await?;
    let duration_seconds = decoded.duration_seconds;

    super::progress::emit_progress(&app, "resampling", 20, "Converting audio format...");
    ensure_import_not_cancelled(Some(&copied_audio.meeting_folder))?;
    let audio_samples = resample_import_audio(&app, decoded).await?;

    super::progress::emit_progress(&app, "vad", 25, "Detecting speech segments...");
    ensure_import_not_cancelled(Some(&copied_audio.meeting_folder))?;
    let speech_segments = detect_import_speech_segments(&app, audio_samples).await?;

    let total_segments = speech_segments.len();
    info!(
        "VAD detected {} speech segments (redemption_time={}ms)",
        total_segments, VAD_REDEMPTION_TIME_MS
    );

    log_vad_segment_stats(&speech_segments, duration_seconds);

    warn_if_import_has_no_speech(&app, total_segments);
    ensure_import_not_cancelled(Some(&copied_audio.meeting_folder))?;

    super::progress::emit_progress(&app, "transcribing", 30, "Loading transcription engine...");
    let engines = super::transcription::load_import_transcription_engines(
        &app,
        use_parakeet,
        total_segments,
        &model,
    )
    .await?;
    let batch = super::transcription::transcribe_import_segments(
        &app,
        &copied_audio.meeting_folder,
        &speech_segments,
        &engines,
        language,
    )
    .await?;
    ensure_import_not_cancelled(Some(&copied_audio.meeting_folder))?;

    super::progress::emit_progress(&app, "saving", 85, "Creating meeting...");

    // Create transcript segments
    let segments = create_transcript_segments(&batch.transcripts);

    // Save to database
    let app_state = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow!("App state not available"))?;

    let meeting_id = super::persistence::create_meeting_with_transcripts(
        app_state.db_manager.pool(),
        &title,
        &segments,
        copied_audio.meeting_folder.to_string_lossy().to_string(),
    )
    .await?;

    // Write transcripts.json and metadata.json to the meeting folder
    super::progress::emit_progress(&app, "saving", 90, "Writing transcript files...");

    if let Err(e) = write_transcripts_json(&copied_audio.meeting_folder, &segments) {
        warn!("Failed to write transcripts.json: {}", e);
    }

    if let Err(e) = super::persistence::write_import_metadata(
        &copied_audio.meeting_folder,
        &meeting_id,
        &title,
        duration_seconds,
        &copied_audio.dest_filename,
        "import",
    ) {
        warn!("Failed to write metadata.json: {}", e);
    }

    super::progress::emit_progress(&app, "complete", 100, "Import complete");

    Ok(ImportResult {
        meeting_id,
        title,
        segments_count: segments.len(),
        duration_seconds,
    })
}

pub(super) struct CopiedImportAudio {
    meeting_folder: PathBuf,
    dest_filename: String,
    dest_path: PathBuf,
}

pub(super) fn ensure_import_not_cancelled(meeting_folder: Option<&Path>) -> Result<()> {
    if IMPORT_CANCELLED.load(Ordering::SeqCst) {
        if let Some(folder) = meeting_folder {
            let _ = std::fs::remove_dir_all(folder);
        }
        return Err(anyhow!("Import cancelled"));
    }

    Ok(())
}

pub(super) async fn copy_audio_to_import_folder<R: Runtime>(
    app: &AppHandle<R>,
    source: &Path,
    title: &str,
) -> Result<CopiedImportAudio> {
    let base_folder = get_default_recordings_folder();
    let meeting_folder = create_meeting_folder(&base_folder, title, false)?;

    super::progress::emit_progress(app, "copying", 10, "Copying audio file...");
    let dest_filename = format!(
        "audio.{}",
        source.extension().and_then(|e| e.to_str()).unwrap_or("mp4")
    );
    let dest_path = meeting_folder.join(&dest_filename);

    let src = source.to_path_buf();
    let dst = dest_path.clone();
    tokio::task::spawn_blocking(move || std::fs::copy(&src, &dst))
        .await
        .map_err(|e| anyhow!("Copy task join error: {}", e))?
        .map_err(|e| anyhow!("Failed to copy audio file: {}", e))?;

    info!("Copied audio to: {}", dest_path.display());
    Ok(CopiedImportAudio {
        meeting_folder,
        dest_filename,
        dest_path,
    })
}

pub(super) async fn decode_import_audio<R: Runtime>(
    app: &AppHandle<R>,
    dest_path: &Path,
) -> Result<crate::audio::decoder::DecodedAudio> {
    let app_for_decode = app.clone();
    let decode_progress = Box::new(move |progress: u32, msg: &str| {
        let overall_progress = 15 + ((progress as f32 * 0.05) as u32);
        super::progress::emit_progress(&app_for_decode, "decoding", overall_progress, msg);
    });

    let path_for_decode = dest_path.to_path_buf();
    let decoded = tokio::task::spawn_blocking(move || {
        decode_audio_file_with_progress(&path_for_decode, Some(decode_progress))
    })
    .await
    .map_err(|e| anyhow!("Decode task join error: {}", e))??;

    info!(
        "Decoded audio: {:.2}s, {}Hz, {} channels",
        decoded.duration_seconds, decoded.sample_rate, decoded.channels
    );
    Ok(decoded)
}

pub(super) async fn resample_import_audio<R: Runtime>(
    app: &AppHandle<R>,
    decoded: crate::audio::decoder::DecodedAudio,
) -> Result<Vec<f32>> {
    let app_for_resample = app.clone();
    let resample_progress = Box::new(move |progress: u32, msg: &str| {
        let overall_progress = 20 + ((progress as f32 * 0.05) as u32);
        super::progress::emit_progress(&app_for_resample, "resampling", overall_progress, msg);
    });

    let audio_samples = tokio::task::spawn_blocking(move || {
        decoded.to_whisper_format_with_progress(Some(resample_progress))
    })
    .await
    .map_err(|e| anyhow!("Resample task join error: {}", e))?;
    info!(
        "Converted to 16kHz mono format: {} samples",
        audio_samples.len()
    );
    Ok(audio_samples)
}

pub(super) async fn detect_import_speech_segments<R: Runtime>(
    app: &AppHandle<R>,
    audio_samples: Vec<f32>,
) -> Result<Vec<crate::audio::vad::SpeechSegment>> {
    let app_for_vad = app.clone();

    tokio::task::spawn_blocking(move || {
        get_speech_chunks_with_progress(
            &audio_samples,
            VAD_REDEMPTION_TIME_MS,
            |vad_progress, segments_found| {
                let overall_progress = 25 + (vad_progress as f32 * 0.05) as u32;
                super::progress::emit_progress(
                    &app_for_vad,
                    "vad",
                    overall_progress,
                    &format!(
                        "Detecting speech segments... {}% ({} found)",
                        vad_progress, segments_found
                    ),
                );
                !IMPORT_CANCELLED.load(Ordering::SeqCst)
            },
        )
    })
    .await
    .map_err(|e| anyhow!("VAD task panicked: {}", e))?
    .map_err(|e| anyhow!("VAD processing failed: {}", e))
}

pub(super) fn warn_if_import_has_no_speech<R: Runtime>(app: &AppHandle<R>, total_segments: usize) {
    if total_segments > 0 {
        return;
    }

    warn!("No speech detected in audio");
    let _ = app.emit(
        "import-warning",
        ImportWarning {
            warning: "No speech detected in audio file".to_string(),
            details: Some(
                "The file was imported successfully, but VAD did not detect any speech. \
                 The meeting was created but contains no transcripts."
                    .to_string(),
            ),
        },
    );
}
