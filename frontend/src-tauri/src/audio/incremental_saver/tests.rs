use super::super::recording_state::DeviceType;
use super::*;
use tempfile::tempdir;

#[tokio::test]
async fn test_checkpoint_creation() {
    // Create temp meeting folder
    let temp_dir = tempdir().unwrap();
    let meeting_folder = temp_dir.path().join("Test_Meeting");
    std::fs::create_dir_all(&meeting_folder).unwrap();
    std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

    let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000).unwrap();

    // Add 60 seconds worth of audio (should create 2 checkpoints)
    for i in 0..120 {
        // 120 chunks of 0.5s each
        let chunk = AudioChunk {
            data: vec![0.5f32; 24000], // 0.5s at 48kHz
            sample_rate: 48000,
            timestamp: i as f64 * 0.5, // timestamp in seconds
            chunk_id: i as u64,
            device_type: DeviceType::Microphone,
            speaker: None,
        };
        saver.add_chunk(chunk).unwrap();
    }

    // Verify 2 checkpoints created
    assert_eq!(saver.checkpoint_count, 2);

    // Finalize and verify merge
    let final_path = saver.finalize().await.unwrap();
    assert!(final_path.exists());

    // Verify checkpoints directory deleted
    assert!(!meeting_folder.join(".checkpoints").exists());
}

#[tokio::test]
async fn test_empty_recording() {
    let temp_dir = tempdir().unwrap();
    let meeting_folder = temp_dir.path().join("Empty_Test");
    std::fs::create_dir_all(&meeting_folder).unwrap();
    std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

    let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000).unwrap();

    // Try to finalize without adding any chunks
    let result = saver.finalize().await;
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("No audio checkpoints"));
}
