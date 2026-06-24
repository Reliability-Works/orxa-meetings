use super::workflow::find_audio_file;
use super::*;

#[test]
fn test_create_transcript_segments_empty() {
    let transcripts: Vec<(String, f64, f64)> = vec![];
    let segments = create_transcript_segments(&transcripts);
    assert!(segments.is_empty());
}

#[test]
fn test_create_transcript_segments_single() {
    let transcripts = vec![
        ("Hello world".to_string(), 0.0, 1500.0), // 0-1.5 seconds
    ];
    let segments = create_transcript_segments(&transcripts);

    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].text, "Hello world");
    assert_eq!(segments[0].audio_start_time, Some(0.0));
    assert_eq!(segments[0].audio_end_time, Some(1.5));
    assert_eq!(segments[0].duration, Some(1.5));
}

#[test]
fn test_create_transcript_segments_multiple() {
    let transcripts = vec![
        ("First segment".to_string(), 0.0, 2000.0), // 0-2 seconds
        ("Second segment".to_string(), 3000.0, 5000.0), // 3-5 seconds
        ("Third segment".to_string(), 6500.0, 8000.0), // 6.5-8 seconds
    ];
    let segments = create_transcript_segments(&transcripts);

    assert_eq!(segments.len(), 3);

    // First segment
    assert_eq!(segments[0].text, "First segment");
    assert_eq!(segments[0].audio_start_time, Some(0.0));
    assert_eq!(segments[0].audio_end_time, Some(2.0));
    assert_eq!(segments[0].duration, Some(2.0));

    // Second segment
    assert_eq!(segments[1].text, "Second segment");
    assert_eq!(segments[1].audio_start_time, Some(3.0));
    assert_eq!(segments[1].audio_end_time, Some(5.0));
    assert_eq!(segments[1].duration, Some(2.0));

    // Third segment
    assert_eq!(segments[2].text, "Third segment");
    assert_eq!(segments[2].audio_start_time, Some(6.5));
    assert_eq!(segments[2].audio_end_time, Some(8.0));
    assert_eq!(segments[2].duration, Some(1.5));
}

#[test]
fn test_create_transcript_segments_trims_whitespace() {
    let transcripts = vec![("  Hello with spaces  ".to_string(), 0.0, 1000.0)];
    let segments = create_transcript_segments(&transcripts);

    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].text, "Hello with spaces");
}

#[test]
fn test_create_transcript_segments_generates_unique_ids() {
    let transcripts = vec![
        ("Segment one".to_string(), 0.0, 1000.0),
        ("Segment two".to_string(), 1000.0, 2000.0),
    ];
    let segments = create_transcript_segments(&transcripts);

    assert_eq!(segments.len(), 2);
    assert_ne!(segments[0].id, segments[1].id);
    assert!(segments[0].id.starts_with("transcript-"));
    assert!(segments[1].id.starts_with("transcript-"));
}

#[test]
fn test_cancellation_flag() {
    // Reset flag to known state
    RETRANSCRIPTION_CANCELLED.store(false, Ordering::SeqCst);
    RETRANSCRIPTION_IN_PROGRESS.store(false, Ordering::SeqCst);

    assert!(!is_retranscription_in_progress());

    // Test cancellation
    cancel_retranscription();
    assert!(RETRANSCRIPTION_CANCELLED.load(Ordering::SeqCst));

    // Reset for other tests
    RETRANSCRIPTION_CANCELLED.store(false, Ordering::SeqCst);
}

#[test]
fn test_vad_redemption_time_constant() {
    // Batch processing uses 2000ms to bridge natural pauses in full-file VAD
    assert_eq!(VAD_REDEMPTION_TIME_MS, 2000);
}

#[test]
fn test_find_audio_file_common_candidates() {
    let dir = tempfile::tempdir().unwrap();

    // No audio file → error
    assert!(find_audio_file(dir.path()).is_err());

    // Create audio.mp4 — should be found first
    std::fs::write(dir.path().join("audio.mp4"), b"fake").unwrap();
    let found = find_audio_file(dir.path()).unwrap();
    assert_eq!(found.file_name().unwrap(), "audio.mp4");
}

#[test]
fn test_find_audio_file_non_mp4_extensions() {
    let dir = tempfile::tempdir().unwrap();

    // Create audio.wav (imported as .wav, not .mp4)
    std::fs::write(dir.path().join("audio.wav"), b"fake").unwrap();
    let found = find_audio_file(dir.path()).unwrap();
    assert_eq!(found.file_name().unwrap(), "audio.wav");
}

#[test]
fn test_find_audio_file_fallback_scan() {
    let dir = tempfile::tempdir().unwrap();

    // Create a file with an audio extension but non-standard name
    std::fs::write(dir.path().join("my_recording.flac"), b"fake").unwrap();
    // Also add a non-audio file that should be ignored
    std::fs::write(dir.path().join("notes.txt"), b"text").unwrap();

    let found = find_audio_file(dir.path()).unwrap();
    assert_eq!(found.file_name().unwrap(), "my_recording.flac");
}

#[test]
fn test_find_audio_file_priority_order() {
    let dir = tempfile::tempdir().unwrap();

    // Create both audio.m4a and audio.mp4 — mp4 should win (listed first in candidates)
    std::fs::write(dir.path().join("audio.m4a"), b"fake").unwrap();
    std::fs::write(dir.path().join("audio.mp4"), b"fake").unwrap();
    let found = find_audio_file(dir.path()).unwrap();
    assert_eq!(found.file_name().unwrap(), "audio.mp4");
}

#[test]
fn test_find_audio_file_empty_folder() {
    let dir = tempfile::tempdir().unwrap();
    let result = find_audio_file(dir.path());
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("No audio file found"));
}

#[test]
fn test_find_audio_file_nonexistent_folder() {
    let result = find_audio_file(Path::new("/nonexistent/path/12345"));
    assert!(result.is_err());
}

#[test]
fn test_audio_extensions_constant() {
    // Verify all expected formats are covered
    assert!(AUDIO_EXTENSIONS.contains(&"mp4"));
    assert!(AUDIO_EXTENSIONS.contains(&"m4a"));
    assert!(AUDIO_EXTENSIONS.contains(&"wav"));
    assert!(AUDIO_EXTENSIONS.contains(&"mp3"));
    assert!(AUDIO_EXTENSIONS.contains(&"flac"));
    assert!(AUDIO_EXTENSIONS.contains(&"ogg"));
    assert!(AUDIO_EXTENSIONS.contains(&"aac"));
    // FFmpeg-backed formats
    assert!(AUDIO_EXTENSIONS.contains(&"mkv"));
    assert!(AUDIO_EXTENSIONS.contains(&"webm"));
    assert!(AUDIO_EXTENSIONS.contains(&"wma"));
    // Non-audio formats
    assert!(!AUDIO_EXTENSIONS.contains(&"txt"));
    assert!(!AUDIO_EXTENSIONS.contains(&"pdf"));
}
