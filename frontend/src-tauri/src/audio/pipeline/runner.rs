use super::mixer::{AudioMixerRingBuffer, ProfessionalAudioMixer, SpeakerActivityWindow};
use super::*;

/// VAD-driven audio processing pipeline
/// Uses Voice Activity Detection to segment speech in real-time and send only speech to Whisper
pub struct AudioPipeline {
    receiver: mpsc::UnboundedReceiver<AudioChunk>,
    transcription_sender: mpsc::UnboundedSender<AudioChunk>,
    vad_processor: ContinuousVadProcessor,
    sample_rate: u32,
    chunk_id_counter: u64,
    // Performance optimization: reduce logging frequency
    last_summary_time: std::time::Instant,
    processed_chunks: u64,
    // Smart batching for audio metrics
    metrics_batcher: Option<AudioMetricsBatcher>,
    // PROFESSIONAL AUDIO MIXING: Ring buffer + RMS-based mixer
    ring_buffer: AudioMixerRingBuffer,
    mixer: ProfessionalAudioMixer,
    speaker_activity_windows: VecDeque<SpeakerActivityWindow>,
    mixed_audio_position_ms: f64,
    // Recording sender for pre-mixed audio
    pub(super) recording_sender_for_mixed: Option<mpsc::UnboundedSender<AudioChunk>>,
}

impl AudioPipeline {
    #[expect(
        clippy::too_many_arguments,
        reason = "Pipeline construction keeps audio channels and device metadata explicit"
    )]
    pub fn new(
        receiver: mpsc::UnboundedReceiver<AudioChunk>,
        transcription_sender: mpsc::UnboundedSender<AudioChunk>,
        target_chunk_duration_ms: u32,
        sample_rate: u32,
        mic_device_name: String,
        mic_device_kind: crate::audio::device_detection::InputDeviceKind,
        system_device_name: String,
        system_device_kind: crate::audio::device_detection::InputDeviceKind,
    ) -> Self {
        // Log device characteristics for adaptive buffering
        info!("🎛️ AudioPipeline initializing with device characteristics:");
        info!(
            "   Mic: '{}' ({:?}) - Buffer: {:?}",
            mic_device_name,
            mic_device_kind,
            mic_device_kind.buffer_timeout()
        );
        info!(
            "   System: '{}' ({:?}) - Buffer: {:?}",
            system_device_name,
            system_device_kind,
            system_device_kind.buffer_timeout()
        );

        // Device kind information can be used for adaptive buffering in the future
        // For now, we log it for monitoring and potential optimization
        let _ = (
            mic_device_name,
            mic_device_kind,
            system_device_name,
            system_device_kind,
        );

        // Create VAD processor with balanced redemption time for speech accumulation
        // The VAD processor now handles 48kHz->16kHz resampling internally
        // This bridges natural pauses without excessive fragmentation
        // For mac os core audio, 900ms, for windows 400ms seems good

        let redemption_time = 400;

        let vad_processor = match ContinuousVadProcessor::new(sample_rate, redemption_time) {
            Ok(processor) => {
                info!("VAD-driven pipeline: VAD segments will be sent directly to Whisper (no time-based accumulation)");
                processor
            }
            Err(e) => {
                error!("Failed to create VAD processor: {}", e);
                panic!("VAD processor creation failed: {}", e);
            }
        };

        // Initialize professional audio mixing components
        let ring_buffer = AudioMixerRingBuffer::new(sample_rate);
        let mixer = ProfessionalAudioMixer::new(sample_rate);

        // Note: target_chunk_duration_ms is ignored - VAD controls segmentation now
        let _ = target_chunk_duration_ms;

        Self {
            receiver,
            transcription_sender,
            vad_processor,
            sample_rate,
            chunk_id_counter: 0,
            // Performance optimization: reduce logging frequency
            last_summary_time: std::time::Instant::now(),
            processed_chunks: 0,
            // Initialize metrics batcher for smart batching
            metrics_batcher: Some(AudioMetricsBatcher::new()),
            // Initialize professional audio mixing
            ring_buffer,
            mixer,
            speaker_activity_windows: VecDeque::new(),
            mixed_audio_position_ms: 0.0,
            recording_sender_for_mixed: None, // Will be set by manager
        }
    }

    /// Run the VAD-driven audio processing pipeline
    pub async fn run(mut self) -> Result<()> {
        info!("VAD-driven audio pipeline started - segments sent in real-time based on speech detection");

        // CRITICAL FIX: Continue processing until channel is closed, not based on recording state
        // This ensures ALL chunks are processed during shutdown, fixing premature meeting completion
        // Previous bug: Loop checked `while self.state.is_recording()` which caused early exit when
        // stop_recording() was called, losing flush signals and remaining chunks in the pipeline
        loop {
            // Receive audio chunks with timeout
            match tokio::time::timeout(
                std::time::Duration::from_millis(50), // Shorter timeout for responsiveness
                self.receiver.recv(),
            )
            .await
            {
                Ok(Some(chunk)) => {
                    // PERFORMANCE: Check for flush signal (special chunk with ID >= u64::MAX - 10)
                    // Multiple flush signals may be sent to ensure processing
                    if chunk.chunk_id >= u64::MAX - 10 {
                        info!(
                            "📥 Received FLUSH signal #{} - flushing VAD processor",
                            u64::MAX - chunk.chunk_id
                        );
                        self.flush_remaining_audio()?;
                        // Continue processing to handle any remaining chunks
                        continue;
                    }

                    // PERFORMANCE OPTIMIZATION: Eliminate per-chunk logging overhead
                    // Logging in hot paths causes severe performance degradation
                    self.processed_chunks += 1;

                    // Smart batching: collect metrics instead of logging every chunk
                    if let Some(ref batcher) = self.metrics_batcher {
                        let avg_level = chunk.data.iter().map(|&x| x.abs()).sum::<f32>()
                            / chunk.data.len() as f32;
                        let duration_ms =
                            chunk.data.len() as f64 / chunk.sample_rate as f64 * 1000.0;

                        batch_audio_metric!(
                            Some(batcher),
                            chunk.chunk_id,
                            chunk.data.len(),
                            duration_ms,
                            avg_level
                        );
                    }

                    // CRITICAL: Log summary only every 200 chunks OR every 60 seconds (99.5% reduction)
                    // This eliminates I/O overhead in the audio processing hot path
                    // Use performance-optimized debug macro that compiles to nothing in release builds
                    if self.processed_chunks % 200 == 0
                        || self.last_summary_time.elapsed().as_secs() >= 60
                    {
                        perf_debug!(
                            "Pipeline processed {} chunks, current chunk: {} ({} samples)",
                            self.processed_chunks,
                            chunk.chunk_id,
                            chunk.data.len()
                        );
                        self.last_summary_time = std::time::Instant::now();
                    }

                    // STEP 1: Add raw audio to ring buffer for mixing
                    // Microphone audio is already normalized at capture level (AudioCapture)
                    // System audio remains raw
                    self.ring_buffer
                        .add_samples(chunk.device_type.clone(), chunk.data);

                    // STEP 2: Mix audio in fixed windows when both streams have sufficient data
                    while self.ring_buffer.can_mix() {
                        if let Some((mic_window, sys_window)) = self.ring_buffer.extract_window() {
                            let window_start_ms = self.mixed_audio_position_ms;
                            let window_duration_ms =
                                mic_window.len() as f64 / self.sample_rate as f64 * 1000.0;
                            let window_end_ms = window_start_ms + window_duration_ms;
                            self.mixed_audio_position_ms = window_end_ms;
                            self.speaker_activity_windows.push_back(
                                SpeakerActivityWindow::from_windows(
                                    window_start_ms,
                                    window_end_ms,
                                    &mic_window,
                                    &sys_window,
                                ),
                            );

                            // Simple mixing without aggressive ducking
                            let mixed_clean = self.mixer.mix_window(&mic_window, &sys_window);

                            // NO POST-GAIN NEEDED: Microphone already normalized by EBU R128 to -23 LUFS
                            // This is broadcast-standard loudness (Netflix/YouTube/Spotify level)
                            // System audio at natural levels
                            // Previous 2x gain was causing excessive limiting/distortion
                            let mixed_with_gain = mixed_clean;

                            // STEP 3: Send mixed audio for transcription (VAD + Whisper)
                            match self.vad_processor.process_audio(&mixed_with_gain) {
                                Ok(speech_segments) => {
                                    for segment in speech_segments {
                                        let duration_ms =
                                            segment.end_timestamp_ms - segment.start_timestamp_ms;

                                        if segment.samples.len() >= 800 {
                                            // Minimum 50ms at 16kHz - matches Parakeet capability
                                            info!(
                                                "📤 Sending VAD segment: {:.1}ms, {} samples",
                                                duration_ms,
                                                segment.samples.len()
                                            );

                                            let speaker = self.infer_speaker_for_segment(
                                                segment.start_timestamp_ms,
                                                segment.end_timestamp_ms,
                                            );
                                            let transcription_chunk = AudioChunk {
                                                data: segment.samples,
                                                sample_rate: 16000,
                                                timestamp: segment.start_timestamp_ms / 1000.0,
                                                chunk_id: self.chunk_id_counter,
                                                device_type: DeviceType::Microphone, // Mixed audio
                                                speaker,
                                            };

                                            if let Err(e) =
                                                self.transcription_sender.send(transcription_chunk)
                                            {
                                                warn!("Failed to send VAD segment: {}", e);
                                            } else {
                                                self.chunk_id_counter += 1;
                                            }
                                        } else {
                                            debug!("⏭️ Dropping short VAD segment: {:.1}ms ({} samples < 800)",
                                                   duration_ms, segment.samples.len());
                                        }
                                    }
                                }
                                Err(e) => {
                                    warn!("⚠️ VAD error: {}", e);
                                }
                            }

                            // STEP 4: Send mixed audio for recording (WAV file)
                            if let Some(ref sender) = self.recording_sender_for_mixed {
                                let recording_chunk = AudioChunk {
                                    data: mixed_with_gain.clone(),
                                    sample_rate: self.sample_rate,
                                    timestamp: chunk.timestamp,
                                    chunk_id: self.chunk_id_counter,
                                    device_type: DeviceType::Microphone, // Mixed audio
                                    speaker: None,
                                };
                                let _ = sender.send(recording_chunk);
                            }
                        }
                    }
                }
                Ok(None) => {
                    info!(
                        "Audio pipeline: sender closed after processing {} chunks",
                        self.processed_chunks
                    );
                    break;
                }
                Err(_) => {
                    // Timeout - just continue, VAD handles all segmentation
                    continue;
                }
            }
        }

        // Flush any remaining VAD segments
        self.flush_remaining_audio()?;

        info!("VAD-driven audio pipeline ended");
        Ok(())
    }

    fn infer_speaker_for_segment(&mut self, start_ms: f64, end_ms: f64) -> Option<String> {
        let mut total_overlap_ms = 0.0;
        let mut local_overlap_ms = 0.0;
        let mut max_mic_rms = 0.0;
        let mut max_system_rms = 0.0;

        for window in &self.speaker_activity_windows {
            let overlap_start = window.start_ms.max(start_ms);
            let overlap_end = window.end_ms.min(end_ms);
            if overlap_end <= overlap_start {
                continue;
            }

            let overlap_ms = overlap_end - overlap_start;
            total_overlap_ms += overlap_ms;
            if window.local_mic_active {
                local_overlap_ms += overlap_ms;
            }
            if window.mic_rms > max_mic_rms {
                max_mic_rms = window.mic_rms;
            }
            if window.system_rms > max_system_rms {
                max_system_rms = window.system_rms;
            }
        }

        let prune_before_ms = start_ms - 5000.0;
        while self
            .speaker_activity_windows
            .front()
            .is_some_and(|window| window.end_ms < prune_before_ms)
        {
            self.speaker_activity_windows.pop_front();
        }

        if total_overlap_ms <= 0.0 {
            return None;
        }

        let local_overlap_ratio = local_overlap_ms / total_overlap_ms;
        let strong_local_peak = max_mic_rms >= 0.012
            && (max_system_rms < 0.002 || max_mic_rms >= max_system_rms * 0.50);

        if local_overlap_ratio >= 0.30 || strong_local_peak {
            Some("me".to_string())
        } else {
            None
        }
    }

    fn flush_remaining_audio(&mut self) -> Result<()> {
        info!(
            "Flushing remaining audio from pipeline (processed {} chunks)",
            self.processed_chunks
        );

        // Flush any remaining audio from VAD processor and send segments to transcription
        match self.vad_processor.flush() {
            Ok(final_segments) => {
                for segment in final_segments {
                    let duration_ms = segment.end_timestamp_ms - segment.start_timestamp_ms;

                    // Send segments >= 50ms (800 samples at 16kHz) - matches main pipeline filter
                    if segment.samples.len() >= 800 {
                        info!(
                            "📤 Sending final VAD segment to Whisper: {:.1}ms duration, {} samples",
                            duration_ms,
                            segment.samples.len()
                        );

                        let speaker = self.infer_speaker_for_segment(
                            segment.start_timestamp_ms,
                            segment.end_timestamp_ms,
                        );
                        let transcription_chunk = AudioChunk {
                            data: segment.samples,
                            sample_rate: 16000,
                            timestamp: segment.start_timestamp_ms / 1000.0,
                            chunk_id: self.chunk_id_counter,
                            device_type: DeviceType::Microphone,
                            speaker,
                        };

                        if let Err(e) = self.transcription_sender.send(transcription_chunk) {
                            warn!("Failed to send final VAD segment: {}", e);
                        } else {
                            self.chunk_id_counter += 1;
                        }
                    } else {
                        info!(
                            "⏭️ Skipping short final segment: {:.1}ms ({} samples < 800)",
                            duration_ms,
                            segment.samples.len()
                        );
                    }
                }
            }
            Err(e) => {
                warn!("Failed to flush VAD processor: {}", e);
            }
        }

        Ok(())
    }
}
