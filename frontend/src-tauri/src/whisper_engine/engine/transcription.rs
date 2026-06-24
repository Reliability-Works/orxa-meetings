use anyhow::{anyhow, Result};
use whisper_rs::{FullParams, SamplingStrategy, WhisperState};

use super::WhisperEngine;

struct TranscriptionLogging {
    duration_seconds: f64,
    should_log_transcription: bool,
    should_log_short_warning: bool,
}

impl WhisperEngine {
    /// Transcribe audio with streaming support for partial results and adaptive quality.
    pub async fn transcribe_audio_with_confidence(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<(String, f32, bool)> {
        let ctx_lock = self.current_context.read().await;
        let ctx = ctx_lock
            .as_ref()
            .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?;

        let hardware_profile = crate::audio::HardwareProfile::detect();
        let adaptive_config = hardware_profile.get_whisper_config();
        let params = build_transcription_params(
            language.as_deref(),
            adaptive_config.beam_size,
            adaptive_config.temperature,
        );
        let duration_seconds = audio_data.len() as f64 / 16000.0;

        let (num_segments, state) = {
            let mut state = ctx.create_state()?;
            state.full(params, &audio_data)?;
            let num_segments = state.full_n_segments()?;
            (num_segments, state)
        };

        let (final_result, avg_confidence) = collect_confidence_segments(&state, num_segments);
        let cleaned_result = Self::clean_repetitive_text(&final_result);

        Ok((cleaned_result, avg_confidence, duration_seconds < 15.0))
    }

    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<String> {
        let ctx_lock = self.current_context.read().await;
        let ctx = ctx_lock
            .as_ref()
            .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?;

        let hardware_profile = crate::audio::HardwareProfile::detect();
        let adaptive_config = hardware_profile.get_whisper_config();
        let params =
            build_transcription_params(language.as_deref(), adaptive_config.beam_size, 0.3);
        let logging = self.prepare_transcription_logging(audio_data.len()).await;
        let transcription_count = self.next_transcription_count().await;

        log_short_audio_warning(&logging);
        log_transcription_start(
            transcription_count,
            audio_data.len(),
            logging.duration_seconds,
            logging.should_log_transcription,
        );

        let mut state = ctx.create_state()?;
        state.full(params, &audio_data)?;
        let num_segments = state.full_n_segments()?;

        log_transcription_completion(
            transcription_count,
            num_segments,
            logging.duration_seconds,
            logging.should_log_transcription,
        );

        let final_result =
            collect_transcription_segments(&state, num_segments, logging.duration_seconds);
        let cleaned_result = Self::clean_repetitive_text(&final_result);
        log_transcription_result(
            transcription_count,
            logging.duration_seconds,
            logging.should_log_transcription,
            &final_result,
            &cleaned_result,
        );

        Ok(cleaned_result)
    }

    async fn prepare_transcription_logging(&self, sample_count: usize) -> TranscriptionLogging {
        let duration_seconds = sample_count as f64 / 16000.0;
        let is_short_audio = duration_seconds < 1.0;
        let mut should_log_transcription = true;
        let mut should_log_short_warning = false;

        if is_short_audio {
            let last_was_short = *self.last_transcription_was_short.read().await;
            let warning_logged = *self.short_audio_warning_logged.read().await;

            if !warning_logged {
                should_log_short_warning = true;
                *self.short_audio_warning_logged.write().await = true;
            }

            should_log_transcription = !last_was_short;
            *self.last_transcription_was_short.write().await = true;
        } else {
            let last_was_short = *self.last_transcription_was_short.read().await;

            if last_was_short {
                log::info!("Audio duration normalized, resuming transcription");
                *self.short_audio_warning_logged.write().await = false;
            }

            *self.last_transcription_was_short.write().await = false;
        }

        TranscriptionLogging {
            duration_seconds,
            should_log_transcription,
            should_log_short_warning,
        }
    }

    async fn next_transcription_count(&self) -> u64 {
        let mut count = self.transcription_count.write().await;
        *count += 1;
        *count
    }
}

fn build_transcription_params<'a>(
    language: Option<&'a str>,
    beam_size: usize,
    temperature: f32,
) -> FullParams<'a, 'static> {
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: beam_size as i32,
        patience: 1.0,
    });

    apply_language(&mut params, language);
    apply_common_transcription_params(&mut params, temperature);
    params
}

fn apply_language<'a, 'b>(params: &mut FullParams<'a, 'b>, language: Option<&'a str>) {
    let (language_code, should_translate) = match language {
        Some("auto") | None => (None, false),
        Some("auto-translate") => (None, true),
        Some(lang) => (Some(lang), false),
    };
    params.set_language(language_code);
    params.set_translate(should_translate);
}

fn apply_common_transcription_params(params: &mut FullParams<'_, '_>, temperature: f32) {
    params.set_no_timestamps(true);
    params.set_token_timestamps(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_suppress_non_speech_tokens(true);
    params.set_temperature(temperature);
    params.set_max_initial_ts(1.0);
    params.set_entropy_thold(2.4);
    params.set_logprob_thold(-1.0);
    params.set_no_speech_thold(0.55);
    params.set_max_len(200);
    params.set_single_segment(false);
}

fn collect_confidence_segments(state: &WhisperState, num_segments: i32) -> (String, f32) {
    let mut result = String::new();
    let mut total_confidence = 0.0;
    let mut segment_count = 0;

    for i in 0..num_segments {
        let segment_text = match state.full_get_segment_text_lossy(i) {
            Ok(text) => text,
            Err(_) => continue,
        };

        let segment_length = segment_text.len() as f32;
        total_confidence += if segment_length > 0.0 {
            (segment_length / 100.0).min(0.9) + 0.1
        } else {
            0.1
        };
        segment_count += 1;
        append_clean_segment(&mut result, &segment_text);
    }

    let avg_confidence = if segment_count > 0 {
        total_confidence / segment_count as f32
    } else {
        0.0
    };
    (result.trim().to_string(), avg_confidence)
}

fn collect_transcription_segments(
    state: &WhisperState,
    num_segments: i32,
    duration_seconds: f64,
) -> String {
    let mut result = String::new();

    for i in 0..num_segments {
        let segment_text = match state.full_get_segment_text_lossy(i) {
            Ok(text) => text,
            Err(_) => continue,
        };

        let start_time = state.full_get_segment_t0(i).unwrap_or(0);
        let end_time = state.full_get_segment_t1(i).unwrap_or(0);
        if duration_seconds > 30.0 {
            perf_trace!(
                "Segment {} ({:.2}s-{:.2}s): '{}'",
                i,
                start_time as f64 / 100.0,
                end_time as f64 / 100.0,
                segment_text
            );
        }

        append_clean_segment(&mut result, &segment_text);
    }

    result.trim().to_string()
}

fn append_clean_segment(result: &mut String, segment_text: &str) {
    let cleaned_text = segment_text.trim();
    if cleaned_text.is_empty() {
        return;
    }

    if !result.is_empty() {
        result.push(' ');
    }
    result.push_str(cleaned_text);
}

fn log_short_audio_warning(logging: &TranscriptionLogging) {
    if logging.should_log_short_warning {
        log::warn!("Audio duration is short ({:.1}s < 1.0s). Consider padding the input audio with silence. Further short audio warnings will be suppressed.", logging.duration_seconds);
    }
}

fn log_transcription_start(
    transcription_count: u64,
    sample_count: usize,
    duration_seconds: f64,
    should_log_transcription: bool,
) {
    if should_log_transcription && (transcription_count % 10 == 0 || duration_seconds > 10.0) {
        log::info!(
            "Starting transcription #{} of {} samples ({:.1}s duration)",
            transcription_count,
            sample_count,
            duration_seconds
        );
    }
}

fn log_transcription_completion(
    transcription_count: u64,
    num_segments: i32,
    duration_seconds: f64,
    should_log_transcription: bool,
) {
    if (should_log_transcription || num_segments > 0)
        && (num_segments > 3 || duration_seconds > 5.0)
    {
        perf_debug!(
            "Transcription #{} completed with {} segments ({:.1}s)",
            transcription_count,
            num_segments,
            duration_seconds
        );
    }
}

fn log_transcription_result(
    transcription_count: u64,
    duration_seconds: f64,
    should_log_transcription: bool,
    final_result: &str,
    cleaned_result: &str,
) {
    if cleaned_result.is_empty() {
        if should_log_transcription && transcription_count % 20 == 0 {
            perf_debug!(
                "Transcription #{} result is empty - no speech detected",
                transcription_count
            );
        }
        return;
    }

    if cleaned_result != final_result {
        log::info!(
            "Cleaned repetitive transcription #{}: '{}' -> '{}'",
            transcription_count,
            final_result,
            cleaned_result
        );
    }

    if transcription_count % 5 == 0 || cleaned_result.len() > 50 || duration_seconds > 10.0 {
        log::info!(
            "Transcription #{} result: '{}'",
            transcription_count,
            cleaned_result
        );
    } else {
        perf_debug!(
            "Transcription #{} result: '{}'",
            transcription_count,
            cleaned_result
        );
    }
}
