use super::*;

/// Generate synthetic speech-like audio with alternating speech/silence
fn generate_test_audio_with_speech(duration_seconds: f32, sample_rate: u32) -> Vec<f32> {
    let total_samples = (duration_seconds * sample_rate as f32) as usize;
    let mut samples = vec![0.0f32; total_samples];

    // Create speech-like patterns: bursts of sine waves with varying amplitude
    // Speech every 10 seconds for 5 seconds
    let speech_interval = 10.0; // seconds between speech starts
    let speech_duration = 5.0; // seconds of speech

    for (i, sample) in samples.iter_mut().enumerate().take(total_samples) {
        let time = i as f32 / sample_rate as f32;
        let cycle_time = time % speech_interval;

        // Speech occurs in the first `speech_duration` seconds of each cycle
        if cycle_time < speech_duration {
            // Generate speech-like signal: multiple frequencies with amplitude modulation
            let freq1 = 200.0 + (time * 50.0).sin() * 100.0; // Varying fundamental
            let freq2 = freq1 * 2.0; // Harmonic
            let freq3 = freq1 * 3.0; // Another harmonic

            let amplitude = 0.3 + 0.1 * (time * 5.0).sin(); // Amplitude modulation
            *sample = amplitude
                * (0.5 * (2.0 * std::f32::consts::PI * freq1 * time).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * freq2 * time).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * freq3 * time).sin());
        }
        // else: silence (already 0.0)
    }

    samples
}

#[test]
fn test_vad_chunked_vs_single_processing() {
    // Generate 60 seconds of audio with speech patterns at 16kHz
    let audio = generate_test_audio_with_speech(60.0, 16000);
    println!(
        "Generated {} samples ({:.1}s)",
        audio.len(),
        audio.len() as f32 / 16000.0
    );

    // Process all at once (like small files)
    let segments_single = get_speech_chunks(&audio, 2000).expect("Single processing failed");
    println!("Single processing found {} segments", segments_single.len());

    // Process in chunks (like large files)
    let segments_chunked = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
        println!("Chunked progress: {}%, {} segments", progress, segments);
        true // Don't cancel
    })
    .expect("Chunked processing failed");
    println!(
        "Chunked processing found {} segments",
        segments_chunked.len()
    );

    // Both should find the same number of segments (approximately)
    // Allow some variance due to chunk boundary effects
    let diff = (segments_single.len() as i32 - segments_chunked.len() as i32).abs();
    assert!(
        diff <= 1,
        "Chunked and single processing found different segment counts: {} vs {} (diff: {})",
        segments_single.len(),
        segments_chunked.len(),
        diff
    );
}

#[test]
fn test_vad_large_file_progress() {
    // Generate 120 seconds (2 minutes) of audio - triggers large file threshold
    let audio = generate_test_audio_with_speech(120.0, 16000);
    let total_samples = audio.len();
    println!(
        "Generated {} samples ({:.1}s)",
        total_samples,
        total_samples as f32 / 16000.0
    );

    // This should trigger the large file path (>960,000 samples)
    assert!(
        total_samples > 960_000,
        "Audio should be large enough to trigger chunked processing"
    );

    let mut progress_updates = Vec::new();
    let segments = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
        progress_updates.push((progress, segments));
        true // Don't cancel
    })
    .expect("Processing failed");

    println!(
        "Found {} segments with {} progress updates",
        segments.len(),
        progress_updates.len()
    );

    // The synthetic signal is not real speech, so Silero may merge it into
    // one long segment. This test is specifically for the large-file path:
    // it must still emit speech and report monotonic progress through 100%.
    assert!(!segments.is_empty(), "Expected at least one speech segment");
    assert!(
        segments.iter().all(|segment| !segment.samples.is_empty()
            && segment.end_timestamp_ms > segment.start_timestamp_ms),
        "Expected all speech segments to contain audio with positive duration"
    );

    // Should have received progress updates
    assert!(
        !progress_updates.is_empty(),
        "Expected progress updates for large file"
    );
    assert_eq!(
        progress_updates.last().map(|(progress, _)| *progress),
        Some(100),
        "Expected progress to reach 100%"
    );
    assert!(
        progress_updates
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0),
        "Expected progress updates to increase monotonically: {:?}",
        progress_updates
    );
}

#[test]
fn test_vad_cancellation() {
    let audio = generate_test_audio_with_speech(120.0, 16000);

    // Cancel at 50%
    let result = get_speech_chunks_with_progress(&audio, 2000, |progress, _| {
        progress < 50 // Cancel when reaching 50%
    });

    // Should return error due to cancellation
    assert!(result.is_err(), "Expected cancellation error");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("cancelled"),
        "Error should mention cancellation: {}",
        err_msg
    );
}

#[test]
fn test_vad_continuous_processor_state_across_chunks() {
    // Test that VAD state is correctly maintained across chunk boundaries
    let mut processor =
        ContinuousVadProcessor::new(16000, 2000).expect("Failed to create processor");

    // Generate audio with a speech segment that spans a chunk boundary
    let chunk_size = 160_000; // 10 seconds
    let audio = generate_test_audio_with_speech(30.0, 16000); // 30 seconds

    // Process in 10-second chunks
    let mut all_segments = Vec::new();
    for (i, chunk) in audio.chunks(chunk_size).enumerate() {
        let segments = processor.process_audio(chunk).expect("Processing failed");
        println!(
            "Chunk {}: processed {} samples, found {} segments",
            i,
            chunk.len(),
            segments.len()
        );
        all_segments.extend(segments);
    }

    // Flush remaining
    let final_segments = processor.flush().expect("Flush failed");
    all_segments.extend(final_segments);

    println!("Total segments found: {}", all_segments.len());

    // Should find speech segments
    assert!(
        !all_segments.is_empty(),
        "Expected at least 1 speech segment"
    );
}

#[test]
fn test_vad_400ms_vs_2000ms_segmentation() {
    // Demonstrates why 2000ms redemption is needed for batch processing:
    // 400ms creates excessive fragmentation, 2000ms bridges natural pauses.
    //
    // Audio pattern: 60s with 5s speech / 5s silence cycles
    // Natural pauses within speech (sentence gaps) are 500ms-1.5s
    let audio = generate_test_audio_with_speech(60.0, 16000);

    let segments_400 = get_speech_chunks(&audio, 400).expect("400ms processing failed");
    let segments_2000 = get_speech_chunks(&audio, 2000).expect("2000ms processing failed");

    println!(
        "400ms redemption: {} segments, 2000ms redemption: {} segments",
        segments_400.len(),
        segments_2000.len()
    );

    // 2000ms should produce fewer or equal segments (bridges more pauses)
    assert!(
        segments_2000.len() <= segments_400.len(),
        "2000ms redemption ({} segments) should not produce more segments than 400ms ({} segments)",
        segments_2000.len(),
        segments_400.len()
    );

    // Verify segments have reasonable durations with 2000ms
    for (i, seg) in segments_2000.iter().enumerate() {
        let duration_ms = seg.end_timestamp_ms - seg.start_timestamp_ms;
        println!("2000ms segment {}: {:.0}ms duration", i, duration_ms);
        // Each segment should be at least 250ms (min_speech_time)
        assert!(
            duration_ms >= 200.0,
            "Segment {} too short: {:.0}ms",
            i,
            duration_ms
        );
    }
}
