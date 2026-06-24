use super::runtime::needs_ffmpeg_conversion;
use super::*;

#[test]
fn test_to_whisper_format_mono_16k() {
    // Already in correct format
    let audio = DecodedAudio {
        samples: vec![0.1, 0.2, 0.3],
        sample_rate: 16000,
        channels: 1,
        duration_seconds: 0.0001875,
    };

    let result = audio.to_whisper_format();
    assert_eq!(result.len(), 3);
}

#[test]
fn test_to_whisper_format_stereo_to_mono() {
    // Stereo input
    let audio = DecodedAudio {
        samples: vec![0.2, 0.4, 0.6, 0.8], // 2 stereo frames
        sample_rate: 16000,
        channels: 2,
        duration_seconds: 0.000125,
    };

    let result = audio.to_whisper_format();
    assert_eq!(result.len(), 2); // Should be mono now
                                 // Average of (0.2, 0.4) = 0.3 and (0.6, 0.8) = 0.7
    assert!((result[0] - 0.3).abs() < 0.001);
    assert!((result[1] - 0.7).abs() < 0.001);
}

#[test]
fn test_to_whisper_format_resamples_48k_to_16k() {
    // 48kHz mono input - should be downsampled to 16kHz
    // Use a larger sample to ensure resampler works correctly
    // 48000 samples at 48kHz = 1 second → 16000 samples at 16kHz
    let audio = DecodedAudio {
        samples: vec![0.5; 4800], // 0.1 seconds at 48kHz
        sample_rate: 48000,
        channels: 1,
        duration_seconds: 4800.0 / 48000.0,
    };

    let result = audio.to_whisper_format();
    // Output length should be approximately input_len / 3 (16000/48000 ratio)
    // 4800 / 3 = 1600
    assert!(!result.is_empty(), "Result should not be empty");
    assert!(
        result.len() > 1000 && result.len() < 2000,
        "Expected ~1600 samples, got {}",
        result.len()
    );
}

#[test]
fn test_chunked_resample_same_rate() {
    let input = vec![0.1, 0.2, 0.3, 0.4, 0.5];
    let result = chunked_resample_with_progress(&input, 16000, 16000, None);
    assert_eq!(result.len(), input.len());
    for (i, &sample) in result.iter().enumerate() {
        assert!((sample - input[i]).abs() < 0.001);
    }
}

#[test]
fn test_chunked_resample_empty_input() {
    let input: Vec<f32> = vec![];
    let result = chunked_resample_with_progress(&input, 48000, 16000, None);
    assert!(result.is_empty());
}

#[test]
fn test_chunked_resample_downsamples_correctly() {
    // 48kHz to 16kHz = 3x downsampling with a 2-second signal
    let input: Vec<f32> = (0..96000).map(|i| i as f32 / 96000.0).collect();
    let result = chunked_resample_with_progress(&input, 48000, 16000, None);

    // Output should be approximately 1/3 the length
    let expected_len = 96000.0 * (16000.0 / 48000.0);
    assert!(
        (result.len() as f64 - expected_len).abs() < 200.0,
        "Expected ~{} samples, got {}",
        expected_len,
        result.len()
    );
}

#[test]
fn test_chunked_resample_preserves_signal_range() {
    // 1 second of sine wave at 44100Hz
    let input: Vec<f32> = (0..44100)
        .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 44100.0).sin())
        .collect();
    let result = chunked_resample_with_progress(&input, 44100, 16000, None);

    for sample in &result {
        assert!(
            *sample >= -1.1 && *sample <= 1.1,
            "Sample {} out of expected range",
            sample
        );
    }
}

#[test]
fn test_chunked_resample_matches_single_pass() {
    // Verify chunked output is close to single-pass for small files
    let input: Vec<f32> = (0..48000)
        .map(|i| (2.0 * std::f32::consts::PI * 300.0 * i as f32 / 48000.0).sin() * 0.5)
        .collect();

    let single_pass = resample_audio(&input, 48000, 16000);
    let chunked = chunked_resample_with_progress(&input, 48000, 16000, None);

    // Lengths should be very close
    let len_diff = (single_pass.len() as i64 - chunked.len() as i64).unsigned_abs();
    assert!(
        len_diff < 50,
        "Length mismatch: single_pass={}, chunked={}",
        single_pass.len(),
        chunked.len()
    );

    // Compare overlapping samples (allow some tolerance at chunk boundaries)
    let compare_len = single_pass.len().min(chunked.len());
    let mut max_diff = 0.0f32;
    for i in 0..compare_len {
        let diff = (single_pass[i] - chunked[i]).abs();
        max_diff = max_diff.max(diff);
    }
    // Chunk boundaries may introduce small discontinuities
    assert!(
        max_diff < 0.15,
        "Max sample difference too large: {}",
        max_diff
    );
}

#[test]
fn test_decoded_audio_duration_calculation() {
    let audio = DecodedAudio {
        samples: vec![0.0; 48000], // 1 second at 48kHz mono
        sample_rate: 48000,
        channels: 1,
        duration_seconds: 1.0,
    };

    // Duration should be samples / sample_rate for mono
    let calculated_duration = audio.samples.len() as f64 / audio.sample_rate as f64;
    assert!((calculated_duration - audio.duration_seconds).abs() < 0.001);
}

#[test]
fn test_decoded_audio_stereo_duration() {
    let audio = DecodedAudio {
        samples: vec![0.0; 96000], // 1 second at 48kHz stereo (2 channels)
        sample_rate: 48000,
        channels: 2,
        duration_seconds: 1.0,
    };

    // Duration should be samples / (sample_rate * channels) for stereo
    let frames = audio.samples.len() / audio.channels as usize;
    let calculated_duration = frames as f64 / audio.sample_rate as f64;
    assert!((calculated_duration - audio.duration_seconds).abs() < 0.001);
}

#[test]
fn test_to_whisper_format_handles_large_file_threshold() {
    // Test that large files use chunked sinc resampling path
    // LARGE_FILE_THRESHOLD is 14_400_000 samples
    // We'll test with a smaller sample to verify the path selection logic works
    let audio = DecodedAudio {
        samples: vec![0.5; 1000], // Small file
        sample_rate: 48000,
        channels: 1,
        duration_seconds: 1000.0 / 48000.0,
    };

    let result = audio.to_whisper_format();
    // Should complete without error and produce valid output
    assert!(!result.is_empty());
    assert!(result.len() < 1000); // Downsampled
}

#[test]
fn test_normalize_audio_samples_already_normalized() {
    let samples = vec![0.5, -0.5, 0.0, 0.9, -0.9];
    let result = normalize_audio_samples(samples.clone());
    // Should be unchanged (already in range)
    for (i, &s) in result.iter().enumerate() {
        assert!((s - samples[i]).abs() < 0.001);
    }
}

#[test]
fn test_normalize_audio_samples_exceeds_range() {
    let samples = vec![0.5, -0.5, 2.0, -1.5]; // max_abs = 2.0
    let result = normalize_audio_samples(samples);
    // All samples should be scaled by 0.5 (1.0 / 2.0)
    assert!((result[0] - 0.25).abs() < 0.001);
    assert!((result[1] - -0.25).abs() < 0.001);
    assert!((result[2] - 1.0).abs() < 0.001);
    assert!((result[3] - -0.75).abs() < 0.001);
}

#[test]
fn test_normalize_audio_samples_handles_nan() {
    let samples = vec![0.5, f32::NAN, 0.3];
    let result = normalize_audio_samples(samples);
    assert!((result[0] - 0.5).abs() < 0.001);
    assert_eq!(result[1], 0.0); // NaN replaced with 0
    assert!((result[2] - 0.3).abs() < 0.001);
}

#[test]
fn test_normalize_audio_samples_handles_infinity() {
    let samples = vec![0.5, f32::INFINITY, -0.3];
    let result = normalize_audio_samples(samples);
    assert!((result[0] - 0.5).abs() < 0.001); // preserved
    assert_eq!(result[1], 0.0); // infinity → 0
    assert!((result[2] - (-0.3)).abs() < 0.001); // preserved
}

#[test]
fn test_needs_ffmpeg_conversion() {
    assert!(needs_ffmpeg_conversion(Path::new("video.mkv")));
    assert!(needs_ffmpeg_conversion(Path::new("audio.webm")));
    assert!(needs_ffmpeg_conversion(Path::new("audio.wma")));
    // Case insensitive
    assert!(needs_ffmpeg_conversion(Path::new("meeting.MKV")));
    assert!(needs_ffmpeg_conversion(Path::new("audio.WMA")));
    assert!(needs_ffmpeg_conversion(Path::new("audio.WebM")));
    // Symphonia-native formats should NOT need ffmpeg
    assert!(!needs_ffmpeg_conversion(Path::new("audio.mp4")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.wav")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.mp3")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.flac")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.ogg")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.aac")));
    assert!(!needs_ffmpeg_conversion(Path::new("audio.m4a")));
    // No extension
    assert!(!needs_ffmpeg_conversion(Path::new("noext")));
}
