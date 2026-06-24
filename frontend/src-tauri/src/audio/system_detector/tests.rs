use super::*;

#[tokio::test]
#[ignore] // Only run manually as it requires audio hardware
async fn test_system_audio_detector() {
    let mut detector = SystemAudioDetector::new();
    detector.start(new_system_audio_callback(|event| {
        println!("System audio event: {:?}", event);
    }));

    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    detector.stop();
}
