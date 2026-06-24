use super::*;

pub(super) struct RetranscriptionEngines {
    use_parakeet: bool,
    whisper: Option<Arc<WhisperEngine>>,
    parakeet: Option<Arc<ParakeetEngine>>,
}

pub(super) async fn load_retranscription_engines<R: Runtime>(
    app: &AppHandle<R>,
    use_parakeet: bool,
    model: &Option<String>,
) -> Result<RetranscriptionEngines> {
    let whisper = if !use_parakeet {
        Some(super::engines::get_or_init_whisper(app, model.as_deref()).await?)
    } else {
        None
    };
    let parakeet = if use_parakeet {
        Some(super::engines::get_or_init_parakeet(app, model.as_deref()).await?)
    } else {
        None
    };

    Ok(RetranscriptionEngines {
        use_parakeet,
        whisper,
        parakeet,
    })
}

pub(super) fn split_processable_segments(
    speech_segments: &[crate::audio::vad::SpeechSegment],
) -> Vec<crate::audio::vad::SpeechSegment> {
    const MAX_SEGMENT_SAMPLES: usize = 25 * 16000;
    let mut processable_segments = Vec::new();

    for segment in speech_segments {
        if segment.samples.len() > MAX_SEGMENT_SAMPLES {
            debug!(
                "Splitting large segment ({:.0}ms, {} samples) at silence boundaries",
                segment.end_timestamp_ms - segment.start_timestamp_ms,
                segment.samples.len()
            );
            let sub_segments = split_segment_at_silence(segment, MAX_SEGMENT_SAMPLES);
            debug!("Split into {} sub-segments", sub_segments.len());
            processable_segments.extend(sub_segments);
        } else {
            processable_segments.push(segment.clone());
        }
    }

    processable_segments
}

pub(super) async fn transcribe_retranscription_segments<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    speech_segments: &[crate::audio::vad::SpeechSegment],
    engines: &RetranscriptionEngines,
    language: Option<String>,
) -> Result<Vec<(String, f64, f64)>> {
    let processable_segments = split_processable_segments(speech_segments);
    let processable_count = processable_segments.len();
    info!(
        "Processing {} segments (after splitting)",
        processable_count
    );

    let mut transcripts = Vec::new();
    let mut total_confidence = 0.0f32;

    for (index, segment) in processable_segments.iter().enumerate() {
        super::workflow::ensure_retranscription_not_cancelled()?;
        let Some((text, confidence)) = transcribe_retranscription_segment(
            app,
            meeting_id,
            index,
            processable_count,
            segment,
            engines,
            &language,
        )
        .await?
        else {
            continue;
        };
        transcripts.push((text, segment.start_timestamp_ms, segment.end_timestamp_ms));
        total_confidence += confidence;
    }

    log_retranscription_summary(transcripts.len(), processable_count, total_confidence);
    Ok(transcripts)
}

pub(super) async fn transcribe_retranscription_segment<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    index: usize,
    processable_count: usize,
    segment: &crate::audio::vad::SpeechSegment,
    engines: &RetranscriptionEngines,
    language: &Option<String>,
) -> Result<Option<(String, f32)>> {
    let segment_duration_sec = (segment.end_timestamp_ms - segment.start_timestamp_ms) / 1000.0;
    self::emit_retranscription_progress(
        app,
        meeting_id,
        index,
        processable_count,
        segment_duration_sec,
    );

    if segment.samples.len() < 1600 {
        debug!(
            "Skipping short segment {} with {} samples",
            index,
            segment.samples.len()
        );
        return Ok(None);
    }

    let (text, confidence) =
        transcribe_retranscription_audio_segment(index, segment, engines, language).await?;
    if text.trim().is_empty() {
        debug!(
            "Segment {}/{}: {:.1}s — empty transcription",
            index + 1,
            processable_count,
            segment_duration_sec
        );
        return Ok(None);
    }

    log_retranscription_segment(
        index,
        processable_count,
        segment_duration_sec,
        confidence,
        &text,
    );
    Ok(Some((text, confidence)))
}

pub(super) fn emit_retranscription_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    index: usize,
    processable_count: usize,
    segment_duration_sec: f64,
) {
    let progress = 25 + ((index as f32 / processable_count as f32) * 55.0) as u32;
    super::persistence::emit_progress(
        app,
        meeting_id,
        "transcribing",
        progress,
        &format!(
            "Transcribing segment {} of {} ({:.1}s)...",
            index + 1,
            processable_count,
            segment_duration_sec
        ),
    );
}

pub(super) async fn transcribe_retranscription_audio_segment(
    index: usize,
    segment: &crate::audio::vad::SpeechSegment,
    engines: &RetranscriptionEngines,
    language: &Option<String>,
) -> Result<(String, f32)> {
    if engines.use_parakeet {
        let engine = engines.parakeet.as_ref().unwrap();
        let text = engine
            .transcribe_audio(segment.samples.clone())
            .await
            .map_err(|e| anyhow!("Parakeet transcription failed on segment {}: {}", index, e))?;
        Ok((text, 0.9f32))
    } else {
        let engine = engines.whisper.as_ref().unwrap();
        let (text, confidence, _) = engine
            .transcribe_audio_with_confidence(segment.samples.clone(), language.clone())
            .await
            .map_err(|e| anyhow!("Whisper transcription failed on segment {}: {}", index, e))?;
        Ok((text, confidence))
    }
}

pub(super) fn log_retranscription_segment(
    index: usize,
    processable_count: usize,
    segment_duration_sec: f64,
    confidence: f32,
    text: &str,
) {
    let trimmed = text.trim();
    debug!(
        "Segment {}/{}: {:.1}s, conf={:.2}, text='{}'",
        index + 1,
        processable_count,
        segment_duration_sec,
        confidence,
        preview_transcript_text(trimmed)
    );
}

pub(super) fn preview_transcript_text(trimmed: &str) -> &str {
    if trimmed.len() <= 80 {
        return trimmed;
    }

    let mut end = 80;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    &trimmed[..end]
}

pub(super) fn log_retranscription_summary(
    transcribed_count: usize,
    processable_count: usize,
    total_confidence: f32,
) {
    let avg_confidence = if transcribed_count > 0 {
        total_confidence / transcribed_count as f32
    } else {
        0.0
    };
    info!(
        "Transcription complete: {} segments transcribed out of {}, avg confidence: {:.2}",
        transcribed_count, processable_count, avg_confidence
    );
}
