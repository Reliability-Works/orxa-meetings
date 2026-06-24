use super::*;

#[test]
fn test_source_buffer_basic() {
    let mut buffer = SourceBuffer::new("Test Mic".to_string(), InputDeviceKind::Wired, 48000);

    // Push some samples
    buffer.push(vec![0.1, 0.2, 0.3, 0.4]);

    assert_eq!(buffer.buffer_size(), 4);
    assert_eq!(buffer.chunks_received, 1);
}

#[test]
fn test_ffmpeg_mixer_creation() {
    let mixer = FFmpegAudioMixer::new(
        "Test Mic".to_string(),
        InputDeviceKind::Wired,
        "Test System".to_string(),
        InputDeviceKind::Wired,
        48000,
    );

    assert_eq!(mixer.sample_rate, 48000);
    assert_eq!(mixer.mixing_window_samples, 2400); // 50ms at 48kHz
}

#[test]
fn test_rms_calculation() {
    let samples = vec![0.5, -0.5, 0.5, -0.5];
    let rms = calculate_rms(&samples);
    assert!((rms - 0.5).abs() < 0.001);
}

#[test]
fn test_audio_mixer_clipping_prevention() {
    let mut mixer = AudioMixer::new(false);

    // Test clipping prevention with extreme values
    let mic = vec![0.8, 0.8, 0.8, 0.8];
    let system = vec![0.8, 0.8, 0.8, 0.8];

    let mixed = mixer.mix(&mic, &system);

    // All values should be clamped to 1.0
    for sample in mixed {
        assert!((-1.0..=1.0).contains(&sample));
    }
}
