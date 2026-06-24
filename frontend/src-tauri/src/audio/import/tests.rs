use super::persistence::write_import_metadata;
use super::validation::extract_duration_from_metadata;
use super::*;

#[test]
fn test_audio_extensions() {
    assert!(AUDIO_EXTENSIONS.contains(&"mp4"));
    assert!(AUDIO_EXTENSIONS.contains(&"wav"));
    assert!(AUDIO_EXTENSIONS.contains(&"mp3"));
    assert!(!AUDIO_EXTENSIONS.contains(&"txt"));
}

#[test]
fn test_create_transcript_segments_empty() {
    let transcripts: Vec<(String, f64, f64)> = vec![];
    let segments = create_transcript_segments(&transcripts);
    assert!(segments.is_empty());
}

#[test]
fn test_create_transcript_segments_single() {
    let transcripts = vec![("Hello world".to_string(), 0.0, 1500.0)];
    let segments = create_transcript_segments(&transcripts);

    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].text, "Hello world");
    assert_eq!(segments[0].audio_start_time, Some(0.0));
    assert_eq!(segments[0].audio_end_time, Some(1.5));
}

#[test]
fn test_cancellation_flag() {
    IMPORT_CANCELLED.store(false, Ordering::SeqCst);
    IMPORT_IN_PROGRESS.store(false, Ordering::SeqCst);

    assert!(!is_import_in_progress());

    cancel_import();
    assert!(IMPORT_CANCELLED.load(Ordering::SeqCst));

    // Reset
    IMPORT_CANCELLED.store(false, Ordering::SeqCst);
}

#[test]
fn test_extract_duration_from_metadata_wav() {
    // Test with sample WAV file if available
    let test_path = Path::new("../../backend/whisper.cpp/samples/jfk.wav");
    if test_path.exists() {
        let result = extract_duration_from_metadata(test_path);
        // Should succeed and return a reasonable duration
        assert!(result.is_ok());
        let duration = result.unwrap();
        assert!(
            duration > 0.0 && duration < 60.0,
            "Duration {} seems unreasonable",
            duration
        );
    }
}

#[test]
fn test_extract_duration_from_metadata_mp3() {
    // Test with sample MP3 file if available
    let test_path = Path::new("../../backend/whisper.cpp/samples/jfk.mp3");
    if test_path.exists() {
        let result = extract_duration_from_metadata(test_path);
        // MP3 files may not have n_frames metadata, so fallback is expected
        // We just verify it doesn't panic
        let _ = result;
    }
}

#[test]
fn test_validate_audio_file_with_metadata() {
    // Test validation with actual audio file
    let test_path = Path::new("../../backend/whisper.cpp/samples/jfk.wav");
    if test_path.exists() {
        let result = validate_audio_file(test_path);
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.format, "WAV");
        assert!(info.duration_seconds > 0.0);
        assert!(info.size_bytes > 0);
    }
}

#[test]
fn test_validate_audio_file_nonexistent() {
    let result = validate_audio_file(Path::new("/nonexistent/file.mp4"));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("does not exist"));
}

#[test]
fn test_validate_audio_file_wrong_extension() {
    // Create a temporary file with wrong extension
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join("test_audio.txt");
    let _ = std::fs::write(&temp_file, b"dummy content");

    let result = validate_audio_file(&temp_file);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("Unsupported format"));

    // Cleanup
    let _ = std::fs::remove_file(temp_file);
}

#[test]
fn test_split_segment_at_silence_short_segment() {
    // Segment shorter than max — returned as-is
    let segment = crate::audio::vad::SpeechSegment {
        samples: vec![0.1; 16000], // 1 second
        start_timestamp_ms: 0.0,
        end_timestamp_ms: 1000.0,
        confidence: 0.9,
    };
    let result = split_segment_at_silence(&segment, 25 * 16000);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].samples.len(), 16000);
}

#[test]
fn test_split_segment_at_silence_splits_long_segment() {
    // 60-second segment of low-level noise with a silent gap at ~25s
    let mut samples = vec![0.01f32; 60 * 16000];
    // Insert silence at 25 seconds (sample 400000)
    for sample in samples.iter_mut().skip(25 * 16000).take(3200) {
        *sample = 0.0;
    }
    let segment = crate::audio::vad::SpeechSegment {
        samples,
        start_timestamp_ms: 0.0,
        end_timestamp_ms: 60_000.0,
        confidence: 0.9,
    };

    let result = split_segment_at_silence(&segment, 25 * 16000);
    assert!(
        result.len() >= 2,
        "Should split into at least 2 segments, got {}",
        result.len()
    );

    // All sub-segments should have samples
    for (i, seg) in result.iter().enumerate() {
        assert!(!seg.samples.is_empty(), "Segment {} is empty", i);
        assert!(
            seg.start_timestamp_ms < seg.end_timestamp_ms,
            "Segment {} has invalid timestamps: {} >= {}",
            i,
            seg.start_timestamp_ms,
            seg.end_timestamp_ms
        );
    }
}

#[test]
fn test_split_segment_at_silence_no_silence_uses_overlap() {
    // Continuous speech (constant energy) — should still split with overlap
    let segment = crate::audio::vad::SpeechSegment {
        samples: vec![0.5f32; 60 * 16000], // 60 seconds of "speech"
        start_timestamp_ms: 0.0,
        end_timestamp_ms: 60_000.0,
        confidence: 0.9,
    };

    let result = split_segment_at_silence(&segment, 25 * 16000);
    assert!(result.len() >= 2);

    // Total samples should exceed input due to overlap
    let total_samples: usize = result.iter().map(|s| s.samples.len()).sum();
    assert!(
        total_samples >= 60 * 16000,
        "Overlap should not lose samples"
    );
}

#[test]
fn test_write_transcripts_json() {
    let dir = tempfile::tempdir().unwrap();
    let segments = vec![
        TranscriptSegment {
            id: "t-1".to_string(),
            text: "Hello world".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            speaker: None,
            audio_start_time: Some(0.0),
            audio_end_time: Some(1.5),
            duration: Some(1.5),
        },
        TranscriptSegment {
            id: "t-2".to_string(),
            text: "Second segment".to_string(),
            timestamp: "2024-01-01T00:00:01Z".to_string(),
            speaker: None,
            audio_start_time: Some(2.0),
            audio_end_time: Some(3.5),
            duration: Some(1.5),
        },
    ];

    let result = write_transcripts_json(dir.path(), &segments);
    assert!(
        result.is_ok(),
        "write_transcripts_json failed: {:?}",
        result
    );

    // Verify file exists and is valid JSON
    let path = dir.path().join("transcripts.json");
    assert!(path.exists());

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["total_segments"], 2);
    assert_eq!(parsed["version"], "1.0");
    assert_eq!(parsed["segments"][0]["text"], "Hello world");
    assert_eq!(parsed["segments"][1]["text"], "Second segment");
    assert_eq!(parsed["segments"][0]["sequence_id"], 0);
    assert_eq!(parsed["segments"][1]["sequence_id"], 1);

    // Verify temp file was cleaned up
    assert!(!dir.path().join(".transcripts.json.tmp").exists());
}

#[test]
fn test_write_import_metadata() {
    let dir = tempfile::tempdir().unwrap();

    let result = write_import_metadata(
        dir.path(),
        "meeting-123",
        "Test Meeting",
        1800.0,
        "audio.mp4",
        "import",
    );
    assert!(result.is_ok(), "write_import_metadata failed: {:?}", result);

    let path = dir.path().join("metadata.json");
    assert!(path.exists());

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["version"], "1.0");
    assert_eq!(parsed["meeting_id"], "meeting-123");
    assert_eq!(parsed["meeting_name"], "Test Meeting");
    assert_eq!(parsed["duration_seconds"], 1800.0);
    assert_eq!(parsed["audio_file"], "audio.mp4");
    assert_eq!(parsed["status"], "completed");
    assert_eq!(parsed["source"], "import");
}

/// Integration test that decodes a real audio file and runs VAD.
/// Run with: TEST_AUDIO_PATH=/path/to/audio.mp4 cargo test -- --ignored --nocapture
#[test]
#[ignore]
fn test_import_pipeline_decode_vad() {
    let audio_path =
        std::env::var("TEST_AUDIO_PATH").expect("Set TEST_AUDIO_PATH to run this integration test");

    let path = Path::new(&audio_path);
    assert!(path.exists(), "Audio file not found: {}", audio_path);

    // Step 1: Decode
    println!("Decoding {}...", audio_path);
    let decoded =
        crate::audio::decoder::decode_audio_file(path).expect("Failed to decode audio file");
    println!(
        "Decoded: {:.2}s, {}Hz, {} channels, {} samples",
        decoded.duration_seconds,
        decoded.sample_rate,
        decoded.channels,
        decoded.samples.len()
    );

    // Step 2: Resample to 16kHz mono
    println!("Resampling to 16kHz mono...");
    let samples = decoded.to_whisper_format();
    println!(
        "Resampled: {} samples ({:.2}s at 16kHz)",
        samples.len(),
        samples.len() as f64 / 16000.0
    );

    // Step 3: Run VAD with both redemption times and compare
    for redemption_ms in [400u32, 2000] {
        println!("\n--- VAD with redemption_time={}ms ---", redemption_ms);
        let segments = crate::audio::vad::get_speech_chunks_with_progress(
            &samples,
            redemption_ms,
            |progress, count| {
                if progress % 20 == 0 {
                    println!("  VAD progress: {}% ({} segments)", progress, count);
                }
                true
            },
        )
        .expect("VAD failed");

        let total_segments = segments.len();
        println!("Found {} segments", total_segments);

        if !segments.is_empty() {
            let durations: Vec<f64> = segments
                .iter()
                .map(|s| s.end_timestamp_ms - s.start_timestamp_ms)
                .collect();
            let total_speech: f64 = durations.iter().sum();
            let avg = total_speech / durations.len() as f64;
            let min = durations.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = durations.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

            println!(
                "Stats: avg={:.0}ms, min={:.0}ms, max={:.0}ms, total_speech={:.1}s/{:.1}s ({:.0}%)",
                avg,
                min,
                max,
                total_speech / 1000.0,
                decoded.duration_seconds,
                (total_speech / 1000.0 / decoded.duration_seconds) * 100.0
            );

            // Segments over 25s that would be split
            let oversized = durations.iter().filter(|d| **d > 25_000.0).count();
            println!("Segments >25s (would be split): {}", oversized);

            // Basic sanity checks
            assert!(total_speech > 0.0, "No speech detected");
            for (i, seg) in segments.iter().enumerate() {
                assert!(!seg.samples.is_empty(), "Segment {} has no samples", i);
                assert!(
                    seg.end_timestamp_ms > seg.start_timestamp_ms,
                    "Segment {} has invalid timestamps",
                    i
                );
            }
        }
    }
}
