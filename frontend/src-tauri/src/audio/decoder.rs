// Audio file decoder for retranscription feature
// Uses Symphonia to decode MP4/AAC audio files, with ffmpeg fallback for
// formats Symphonia can't handle (MKV, WebM, WMA)

use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use rayon::prelude::*;
use std::borrow::Cow;
use std::path::Path;
use std::process::{Command, Stdio};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::audio_processing::{audio_to_mono, resample, resample_audio};
use super::ffmpeg::find_ffmpeg_path;

/// Extensions requiring ffmpeg pre-conversion (Symphonia lacks these demuxers/codecs)
const FFMPEG_ONLY_EXTENSIONS: &[&str] = &["mkv", "webm", "wma"];

/// Progress callback for long-running operations
/// Returns current progress (0-100) and a message
pub type ProgressCallback = Box<dyn Fn(u32, &str) + Send>;

/// Decoded audio data from a file
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    /// Raw audio samples (interleaved if stereo)
    pub samples: Vec<f32>,
    /// Sample rate of the decoded audio
    pub sample_rate: u32,
    /// Number of channels (1 = mono, 2 = stereo)
    pub channels: u16,
    /// Duration in seconds
    pub duration_seconds: f64,
}

impl DecodedAudio {
    /// Convert decoded audio to Whisper-compatible 16kHz mono f32 format.
    ///
    /// Performs mono conversion, normalization, and resampling. Large files
    /// (>5 min at 48kHz) use chunked sinc resampling to keep memory bounded
    /// while preserving audio quality for downstream VAD and transcription.
    pub fn to_whisper_format(&self) -> Vec<f32> {
        self.to_whisper_format_with_progress(None)
    }

    /// Convert decoded audio to Whisper format with optional progress callback
    pub fn to_whisper_format_with_progress(
        &self,
        progress_callback: Option<ProgressCallback>,
    ) -> Vec<f32> {
        // Step 1: Convert to mono if needed
        let mono_samples = if self.channels > 1 {
            info!(
                "Converting {} channels to mono ({} samples)",
                self.channels,
                self.samples.len()
            );
            audio_to_mono(&self.samples, self.channels)
        } else {
            self.samples.clone()
        };

        // Step 1.5: Normalize samples to valid range (-1.0 to 1.0)
        // Some audio files may have samples slightly outside this range
        let mono_samples = normalize_audio_samples(mono_samples);

        // Step 2: Resample to 16kHz if needed
        const WHISPER_SAMPLE_RATE: u32 = 16000;
        if self.sample_rate != WHISPER_SAMPLE_RATE {
            // Large files are processed in chunks through the sinc resampler
            // to keep memory bounded while preserving audio quality.
            // Linear interpolation (fast_resample) was removed because it lacks
            // an anti-aliasing filter, causing aliasing artifacts that make VAD
            // miss ~99% of speech in long recordings.
            const LARGE_FILE_THRESHOLD: usize = 14_400_000;

            let mut resampled = if mono_samples.len() > LARGE_FILE_THRESHOLD {
                info!(
                    "Chunked sinc resampling {} samples from {}Hz to {}Hz (large file mode)",
                    mono_samples.len(),
                    self.sample_rate,
                    WHISPER_SAMPLE_RATE
                );
                chunked_resample_with_progress(
                    &mono_samples,
                    self.sample_rate,
                    WHISPER_SAMPLE_RATE,
                    progress_callback,
                )
            } else {
                info!(
                    "Resampling {} samples from {}Hz to {}Hz",
                    mono_samples.len(),
                    self.sample_rate,
                    WHISPER_SAMPLE_RATE
                );
                resample_audio(&mono_samples, self.sample_rate, WHISPER_SAMPLE_RATE)
            };

            // Clamp after resampling: the sinc resampler can overshoot
            // slightly beyond [-1.0, 1.0] (Gibbs phenomenon), which causes
            // VAD to reject samples with "Float sample must be in the range -1.0 to 1.0"
            for s in &mut resampled {
                *s = s.clamp(-1.0, 1.0);
            }
            resampled
        } else {
            mono_samples
        }
    }
}

/// Resample large audio files in fixed-size chunks through the sinc resampler.
///
/// Processes `input` in 60-second chunks using the high-quality sinc resampler
/// from [`resample_audio`], concatenating the results. This avoids the memory
/// spike of resampling the entire file at once while preserving anti-aliasing
/// quality that is critical for downstream VAD accuracy.
///
/// Chunked resampling with optional progress callback.
///
/// Resamples `input` in parallel 60-second chunks via [`rayon`], then merges
/// the results sequentially with a 100ms cross-fade to eliminate discontinuities
/// at chunk boundaries. Each chunk's [`resample`] call is independent and
/// CPU-bound, making this ideal for data parallelism.
///
/// Falls back to [`resample_audio`] (single-pass sinc) if any chunk fails.
fn chunked_resample_with_progress(
    input: &[f32],
    from_rate: u32,
    to_rate: u32,
    progress_callback: Option<ProgressCallback>,
) -> Vec<f32> {
    if input.is_empty() || from_rate == to_rate {
        return input.to_vec();
    }

    // 60 seconds of audio at the source sample rate per chunk
    let chunk_samples = from_rate as usize * 60;
    // 100ms overlap in the input domain to cross-fade between chunks
    let overlap_input = from_rate as usize / 10;
    let ratio = to_rate as f64 / from_rate as f64;
    let overlap_output = (overlap_input as f64 * ratio) as usize;
    let estimated_output = (input.len() as f64 * ratio) as usize + 1024;

    // Build overlapping chunk boundaries
    let mut chunk_ranges: Vec<(usize, usize)> = Vec::new();
    let mut start = 0usize;
    while start < input.len() {
        let end = (start + chunk_samples + overlap_input).min(input.len());
        chunk_ranges.push((start, end));
        start += chunk_samples;
    }

    let total_chunks = chunk_ranges.len();
    info!(
        "Parallel chunked sinc resampling: {} chunks of ~60s each with 100ms cross-fade ({} total samples)",
        total_chunks,
        input.len()
    );

    // Resample all chunks in parallel — each is independent and CPU-bound
    let resampled_chunks: Vec<Result<Vec<f32>>> = chunk_ranges
        .par_iter()
        .map(|&(chunk_start, chunk_end)| {
            let chunk = &input[chunk_start..chunk_end];
            resample(chunk, from_rate, to_rate)
        })
        .collect();

    // Merge sequentially with cross-fade (order-dependent, must be serial)
    let mut output = Vec::with_capacity(estimated_output);
    for (chunk_idx, result) in resampled_chunks.into_iter().enumerate() {
        match result {
            Ok(resampled) => {
                if chunk_idx == 0 {
                    output.extend_from_slice(&resampled);
                } else {
                    // Cross-fade the overlap region with the tail of the previous output
                    let fade_len = overlap_output.min(resampled.len()).min(output.len());
                    if fade_len > 0 {
                        let out_start = output.len() - fade_len;
                        for i in 0..fade_len {
                            let t = i as f32 / fade_len as f32;
                            output[out_start + i] =
                                output[out_start + i] * (1.0 - t) + resampled[i] * t;
                        }
                        if fade_len < resampled.len() {
                            output.extend_from_slice(&resampled[fade_len..]);
                        }
                    } else {
                        output.extend_from_slice(&resampled);
                    }
                }
            }
            Err(e) => {
                warn!(
                    "Resampling failed on chunk {}/{}: {}, falling back to single-pass sinc resampler",
                    chunk_idx + 1,
                    total_chunks,
                    e
                );
                return resample_audio(input, from_rate, to_rate);
            }
        }

        if let Some(callback) = &progress_callback {
            let progress_pct = ((chunk_idx + 1) as f64 / total_chunks as f64) * 100.0;
            if (chunk_idx + 1) % 10 == 0 || chunk_idx + 1 == total_chunks {
                info!(
                    "Resampling progress: {}/{} chunks ({:.0}%)",
                    chunk_idx + 1,
                    total_chunks,
                    progress_pct
                );
            }
            callback(
                progress_pct as u32,
                &format!("Resampling audio: {:.0}%", progress_pct),
            );
        }
    }

    info!(
        "Parallel chunked sinc resampling complete: {} -> {} samples",
        input.len(),
        output.len()
    );
    output
}

/// Normalize audio samples to the valid range (-1.0 to 1.0)
/// This handles audio files that may have samples slightly outside the expected range
fn normalize_audio_samples(mut samples: Vec<f32>) -> Vec<f32> {
    // First, find the maximum absolute value
    let max_abs = samples
        .iter()
        .filter(|s| s.is_finite())
        .map(|s| s.abs())
        .fold(0.0f32, |a, b| a.max(b));

    if max_abs > 1.0 {
        // Audio exceeds valid range - normalize by scaling
        info!(
            "Audio samples exceed valid range (max: {:.3}), normalizing...",
            max_abs
        );
        let scale = 1.0 / max_abs;
        for sample in &mut samples {
            *sample *= scale;
        }
    }

    // Also clamp any remaining edge cases (NaN, infinity, etc.)
    for sample in &mut samples {
        if !sample.is_finite() {
            *sample = 0.0;
        } else {
            *sample = sample.clamp(-1.0, 1.0);
        }
    }

    samples
}

/// Check if a file extension requires ffmpeg pre-conversion
mod runtime;

pub use self::runtime::{decode_audio_file, decode_audio_file_with_progress};

#[cfg(test)]
mod tests;
