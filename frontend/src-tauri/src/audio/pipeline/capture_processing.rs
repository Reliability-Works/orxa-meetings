use super::mixer::rms_f32;
use super::*;

impl AudioCapture {
    /// Process audio data directly from callback
    pub fn process_audio_data(&self, data: &[f32]) {
        if !self.state.is_recording() {
            return;
        }

        let Some(mut mono_data) = self.prepare_callback_audio(data) else {
            return;
        };
        self.apply_microphone_enhancements(&mut mono_data);

        // Create audio chunk with stream-specific timestamp (get ID first for logging)
        let chunk_id = self
            .chunk_counter
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        // RAW AUDIO: No gain applied here - will be applied AFTER mixing
        // This prevents amplifying system audio bleed-through in the microphone

        // DIAGNOSTIC: Log audio levels for debugging (especially mic issues)
        // if chunk_id % 100 == 0 && !mono_data.is_empty() {
        //     let raw_rms = (mono_data.iter().map(|&x| x * x).sum::<f32>() / mono_data.len() as f32).sqrt();
        //     let raw_peak = mono_data.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);

        //         info!("🎙️ [{:?}] Chunk {} - Raw: RMS={:.6}, Peak={:.6}",
        //               self.device_type, chunk_id, raw_rms, raw_peak);

        //     // Warn if microphone is completely silent
        //     if matches!(self.device_type, DeviceType::Microphone) && raw_rms == 0.0 && raw_peak == 0.0 {
        //         warn!("⚠️ Microphone producing ZERO audio - check permissions or hardware!");
        //     }
        // }
        // else if chunk_id % 100 == 0 && matches!(self.device_type, DeviceType::System) {
        //     let raw_rms = (mono_data.iter().map(|&x| x * x).sum::<f32>() / mono_data.len() as f32).sqrt();
        //     let raw_peak = mono_data.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);
        //     info!("🔊 [{:?}] Chunk {} - Raw: RMS={:.6}, Peak={:.6}",
        //       self.device_type, chunk_id, raw_rms, raw_peak);

        //     // Warn if system audio is completely silent
        //     if raw_rms == 0.0 && raw_peak == 0.0 {
        //         warn!("⚠️ System audio producing ZERO audio - check permissions or hardware!");
        //     }
        // }

        // Use global recording timestamp for proper synchronization
        let timestamp = self.state.get_recording_duration().unwrap_or(0.0);

        // RAW AUDIO CHUNK: No gain applied - will be mixed and gained downstream
        // Use 48kHz if we resampled, otherwise use original rate
        let audio_chunk = AudioChunk {
            data: mono_data, // Raw audio (resampled if needed), no gain yet
            sample_rate: if self.needs_resampling {
                48000
            } else {
                self.sample_rate
            },
            timestamp,
            chunk_id,
            device_type: self.device_type.clone(),
            speaker: None,
        };

        // NOTE: Raw audio is NOT sent to recording saver to prevent echo
        // Only the mixed audio (from AudioPipeline) is saved to file (see pipeline.rs:726-736)
        // This ensures we only record once: mic + system properly mixed
        // Individual raw streams go only to the transcription pipeline below

        // Send to processing pipeline for transcription
        if let Err(e) = self.state.send_audio_chunk(audio_chunk) {
            // Check if this is the "pipeline not ready" error
            if e.to_string().contains("Audio pipeline not ready") {
                // This is expected during initialization, just log it as debug
                debug!("Audio pipeline not ready yet, skipping chunk {}", chunk_id);
                return;
            }

            warn!("Failed to send audio chunk: {}", e);
            // More specific error handling based on failure reason
            let error = if e.to_string().contains("channel closed") {
                AudioError::ChannelClosed
            } else if e.to_string().contains("full") {
                AudioError::BufferOverflow
            } else {
                AudioError::ProcessingFailed
            };
            self.state.report_error(error);
        } else {
            debug!("Sent audio chunk {} ({} samples)", chunk_id, data.len());
        }
    }

    fn prepare_callback_audio(&self, data: &[f32]) -> Option<Vec<f32>> {
        let mono_data = if self.channels > 1 {
            audio_to_mono(data, self.channels)
        } else {
            data.to_vec()
        };

        if self.needs_resampling {
            self.resample_callback_audio(mono_data)
        } else {
            Some(mono_data)
        }
    }

    fn resample_callback_audio(&self, mono_data: Vec<f32>) -> Option<Vec<f32>> {
        const TARGET_SAMPLE_RATE: u32 = 48000;

        let before_len = mono_data.len();
        let before_rms = rms_f32(&mono_data);
        let (resampled_output, used_persistent_resampler) =
            self.process_buffered_resampler(&mono_data);

        let has_resampled_output = !resampled_output.is_empty();
        if has_resampled_output {
            self.log_resampling(before_len, before_rms, &resampled_output);
            Some(resampled_output)
        } else if used_persistent_resampler {
            None
        } else {
            Some(crate::audio::audio_processing::resample_audio(
                &mono_data,
                self.sample_rate,
                TARGET_SAMPLE_RATE,
            ))
        }
    }

    fn process_buffered_resampler(&self, mono_data: &[f32]) -> (Vec<f32>, bool) {
        let mut resampled_output = Vec::new();
        let mut used_persistent_resampler = false;

        if let Ok(mut buffer_lock) = self.resampler_input_buffer.lock() {
            buffer_lock.extend_from_slice(mono_data);
            if let Ok(mut resampler_lock) = self.resampler.lock() {
                if let Some(ref mut resampler) = *resampler_lock {
                    used_persistent_resampler = self.process_resampler_chunks(
                        &mut buffer_lock,
                        resampler,
                        &mut resampled_output,
                    );
                }
            }
        }

        (resampled_output, used_persistent_resampler)
    }

    fn process_resampler_chunks(
        &self,
        buffer_lock: &mut Vec<f32>,
        resampler: &mut SincFixedIn<f32>,
        resampled_output: &mut Vec<f32>,
    ) -> bool {
        while buffer_lock.len() >= self.resampler_chunk_size {
            let chunk: Vec<f32> = buffer_lock.drain(0..self.resampler_chunk_size).collect();
            let waves_in = vec![chunk];

            match resampler.process(&waves_in, None) {
                Ok(mut waves_out) => {
                    if let Some(output) = waves_out.pop() {
                        resampled_output.extend_from_slice(&output);
                    }
                }
                Err(e) => {
                    warn!("⚠️ Persistent resampler processing failed: {}", e);
                    return false;
                }
            }
        }

        true
    }

    fn log_resampling(&self, before_len: usize, before_rms: f32, mono_data: &[f32]) {
        const TARGET_SAMPLE_RATE: u32 = 48000;

        let chunk_id = self.chunk_counter.load(std::sync::atomic::Ordering::SeqCst);
        if chunk_id % 100 != 0 {
            return;
        }

        let after_len = mono_data.len();
        let after_rms = rms_f32(mono_data);
        let ratio = TARGET_SAMPLE_RATE as f64 / self.sample_rate as f64;
        let rms_preservation = if before_rms > 0.0 {
            (after_rms / before_rms) * 100.0
        } else {
            100.0
        };
        let buffer_size = self
            .resampler_input_buffer
            .lock()
            .map_or(0, |buf| buf.len());

        info!(
            "🔄 [{:?}] Persistent buffered resampler: {}Hz → {}Hz (ratio: {:.2}x)",
            self.device_type, self.sample_rate, TARGET_SAMPLE_RATE, ratio
        );
        info!(
            "   Chunk {}: {} → {} samples, RMS preservation: {:.1}%, buffer: {}",
            chunk_id, before_len, after_len, rms_preservation, buffer_size
        );
    }

    fn apply_microphone_enhancements(&self, mono_data: &mut Vec<f32>) {
        if !matches!(self.device_type, DeviceType::Microphone) {
            return;
        }

        self.apply_high_pass_filter(mono_data);
        self.apply_noise_suppression(mono_data);
        self.apply_loudness_normalizer(mono_data);
    }

    fn apply_high_pass_filter(&self, mono_data: &mut Vec<f32>) {
        if let Ok(mut hpf_lock) = self.high_pass_filter.lock() {
            if let Some(ref mut filter) = *hpf_lock {
                *mono_data = filter.process(mono_data);
            }
        }
    }

    fn apply_noise_suppression(&self, mono_data: &mut Vec<f32>) {
        if !crate::audio::ffmpeg_mixer::RNNOISE_APPLY_ENABLED {
            return;
        }

        if let Ok(mut ns_lock) = self.noise_suppressor.lock() {
            if let Some(ref mut suppressor) = *ns_lock {
                let before_len = mono_data.len();
                *mono_data = suppressor.process(mono_data);
                self.log_noise_suppression_health(before_len, mono_data, suppressor);
            }
        }
    }

    fn log_noise_suppression_health(
        &self,
        before_len: usize,
        mono_data: &[f32],
        suppressor: &NoiseSuppressionProcessor,
    ) {
        let chunk_id = self.chunk_counter.load(std::sync::atomic::Ordering::SeqCst);
        if chunk_id % 100 != 0 {
            return;
        }

        let after_len = mono_data.len();
        let buffered = suppressor.buffered_samples();
        let length_delta = (before_len as i32 - after_len as i32).abs();

        debug!(
            "🔇 Noise suppression health: in={}, out={}, delta={}, buffered={}, RMS={:.4}",
            before_len,
            after_len,
            length_delta,
            buffered,
            rms_f32(mono_data)
        );

        if buffered > 1000 {
            warn!(
                "⚠️ RNNoise accumulating samples: {} buffered (potential latency issue!)",
                buffered
            );
        }

        if length_delta > 50 {
            warn!(
                "⚠️ RNNoise length mismatch: input={} output={} (delta={})",
                before_len, after_len, length_delta
            );
        }
    }

    fn apply_loudness_normalizer(&self, mono_data: &mut Vec<f32>) {
        if let Ok(mut normalizer_lock) = self.normalizer.lock() {
            if let Some(ref mut normalizer) = *normalizer_lock {
                *mono_data = normalizer.normalize_loudness(mono_data);
                self.log_normalized_audio(mono_data);
            }
        }
    }

    fn log_normalized_audio(&self, mono_data: &[f32]) {
        let chunk_id = self.chunk_counter.load(std::sync::atomic::Ordering::SeqCst);
        if chunk_id % 200 != 0 || mono_data.is_empty() {
            return;
        }

        let peak = mono_data.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);
        debug!(
            "🎤 After normalization chunk {}: RMS={:.4}, Peak={:.4}",
            chunk_id,
            rms_f32(mono_data),
            peak
        );
    }

    /// Handle stream errors with enhanced disconnect detection
    pub fn handle_stream_error(&self, error: cpal::StreamError) {
        error!("Audio stream error for {}: {}", self.device.name, error);

        let error_str = error.to_string().to_lowercase();

        // Enhanced error detection for device disconnection
        let audio_error = if error_str.contains("device is no longer available")
            || error_str.contains("device not found")
            || error_str.contains("device disconnected")
            || error_str.contains("no such device")
            || error_str.contains("device unavailable")
            || error_str.contains("device removed")
        {
            warn!("🔌 Device disconnect detected for: {}", self.device.name);
            AudioError::DeviceDisconnected
        } else if error_str.contains("permission") || error_str.contains("access denied") {
            AudioError::PermissionDenied
        } else if error_str.contains("channel closed") {
            AudioError::ChannelClosed
        } else if error_str.contains("stream") && error_str.contains("failed") {
            AudioError::StreamFailed
        } else {
            warn!("Unknown audio error: {}", error);
            AudioError::StreamFailed
        };

        self.state.report_error(audio_error);
    }
}
