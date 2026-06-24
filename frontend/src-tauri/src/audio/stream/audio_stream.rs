use super::*;

impl AudioStream {
    /// Create a new audio stream for the given device
    pub async fn create(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        device_type: DeviceType,
        recording_sender: Option<mpsc::UnboundedSender<crate::audio::recording_state::AudioChunk>>,
    ) -> Result<Self> {
        // Get current backend from global config
        let backend_type = get_current_backend();
        Self::create_with_backend(device, state, device_type, recording_sender, backend_type).await
    }

    /// Create a new audio stream with explicit backend selection
    pub async fn create_with_backend(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        device_type: DeviceType,
        recording_sender: Option<mpsc::UnboundedSender<crate::audio::recording_state::AudioChunk>>,
        backend_type: AudioCaptureBackend,
    ) -> Result<Self> {
        info!(
            "🎵 Stream: Creating audio stream for device: {} with backend: {:?}, device_type: {:?}",
            device.name, backend_type, device_type
        );

        // For system audio devices, use the selected backend
        // For microphone devices, always use CPAL
        #[cfg(target_os = "macos")]
        let use_core_audio =
            device_type == DeviceType::System && backend_type == AudioCaptureBackend::CoreAudio;

        #[cfg(not(target_os = "macos"))]
        let use_core_audio = false;

        #[cfg(target_os = "macos")]
        info!(
            "🎵 Stream: use_core_audio = {}, device_type == System: {}, backend == CoreAudio: {}",
            use_core_audio,
            device_type == DeviceType::System,
            backend_type == AudioCaptureBackend::CoreAudio
        );

        #[cfg(not(target_os = "macos"))]
        info!(
            "🎵 Stream: use_core_audio = {}, device_type == System: {}",
            use_core_audio,
            device_type == DeviceType::System
        );

        #[cfg(target_os = "macos")]
        if use_core_audio {
            info!("🎵 Stream: Using Core Audio backend (cidre) for system audio");
            return Self::create_core_audio_stream(device, state, device_type, recording_sender)
                .await;
        }

        // Default path: use CPAL
        #[cfg(target_os = "macos")]
        let backend_name = if backend_type == AudioCaptureBackend::ScreenCaptureKit {
            "ScreenCaptureKit"
        } else {
            "CPAL (default)"
        };

        #[cfg(not(target_os = "macos"))]
        let backend_name = "CPAL";

        info!(
            "🎵 Stream: Using CPAL backend ({}) for device: {}",
            backend_name, device.name
        );
        Self::create_cpal_stream(device, state, device_type, recording_sender).await
    }

    /// Create a CPAL-based stream (ScreenCaptureKit on macOS)
    async fn create_cpal_stream(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        device_type: DeviceType,
        _recording_sender: Option<mpsc::UnboundedSender<crate::audio::recording_state::AudioChunk>>,
    ) -> Result<Self> {
        info!("Creating CPAL stream for device: {}", device.name);

        // Get the underlying cpal device and config
        let (cpal_device, config) = get_device_and_config(&device).await?;

        info!(
            "Audio config - Sample rate: {}, Channels: {}, Format: {:?}",
            config.sample_rate().0,
            config.channels(),
            config.sample_format()
        );

        // Create audio capture processor
        let capture = AudioCapture::new(
            device.clone(),
            state.clone(),
            config.sample_rate().0,
            config.channels(),
            device_type,
        );

        // Build the appropriate stream based on sample format
        let stream = Self::build_stream(&cpal_device, &config, capture.clone())?;

        // Start the stream
        stream.play()?;
        info!("CPAL stream started for device: {}", device.name);

        Ok(Self {
            device,
            backend: StreamBackend::Cpal(stream),
        })
    }

    /// Create a Core Audio stream (macOS only)
    #[cfg(target_os = "macos")]
    async fn create_core_audio_stream(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        device_type: DeviceType,
        _recording_sender: Option<mpsc::UnboundedSender<crate::audio::recording_state::AudioChunk>>,
    ) -> Result<Self> {
        info!(
            "🔊 Stream: Creating Core Audio stream for device: {}",
            device.name
        );

        // Create Core Audio capture
        info!("🔊 Stream: Calling CoreAudioCapture::new()...");
        let capture_impl = CoreAudioCapture::new().map_err(|e| {
            error!("❌ Stream: CoreAudioCapture::new() failed: {}", e);
            anyhow::anyhow!("Failed to create Core Audio capture: {}", e)
        })?;

        info!("✅ Stream: CoreAudioCapture created, calling stream()...");
        let core_stream = capture_impl.stream().map_err(|e| {
            error!("❌ Stream: capture_impl.stream() failed: {}", e);
            anyhow::anyhow!("Failed to create Core Audio stream: {}", e)
        })?;

        let sample_rate = core_stream.sample_rate();
        info!(
            "✅ Stream: Core Audio stream created with sample rate: {} Hz",
            sample_rate
        );

        // Create audio capture processor for pipeline integration
        // CRITICAL: Core Audio tap is MONO (with_mono_global_tap_excluding_processes)
        let capture = AudioCapture::new(
            device.clone(),
            state.clone(),
            sample_rate,
            1, // Core Audio tap is MONO (not stereo!)
            device_type,
        );

        // Spawn task to process Core Audio stream samples
        // The stream needs to be polled continuously to produce samples
        let device_name = device.name.clone();
        info!("🔊 Stream: Spawning tokio task to poll Core Audio stream...");
        let task = tokio::spawn({
            let capture = capture.clone();
            let mut stream = core_stream;

            async move {
                use futures_util::StreamExt;

                let mut buffer = Vec::new();
                let mut frame_count = 0;
                let frames_per_chunk = 1024; // Process in chunks of 1024 samples

                info!(
                    "✅ Stream: Core Audio processing task started for {}",
                    device_name
                );

                let mut _sample_count = 0u64;
                while let Some(sample) = stream.next().await {
                    _sample_count += 1;
                    // if _sample_count % 48000 == 0 {
                    //     info!("📊 Stream: Received {} samples from Core Audio stream", _sample_count);
                    // }

                    buffer.push(sample);
                    frame_count += 1;

                    // Process when we have enough samples
                    if frame_count >= frames_per_chunk {
                        capture.process_audio_data(&buffer);
                        buffer.clear();
                        frame_count = 0;
                    }
                }

                // Process any remaining samples
                if !buffer.is_empty() {
                    capture.process_audio_data(&buffer);
                }

                info!(
                    "⚠️ Stream: Core Audio processing task ended for {}",
                    device_name
                );
            }
        });

        info!(
            "✅ Stream: Core Audio stream fully initialized for device: {}",
            device.name
        );

        Ok(Self {
            device: device.clone(),
            backend: StreamBackend::CoreAudio { task: Some(task) },
        })
    }

    /// Build stream based on sample format
    fn build_stream(
        device: &Device,
        config: &SupportedStreamConfig,
        capture: AudioCapture,
    ) -> Result<Stream> {
        let config_copy = config.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                let capture_clone = capture.clone();
                device.build_input_stream(
                    &config_copy.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        capture.process_audio_data(data);
                    },
                    move |err| {
                        capture_clone.handle_stream_error(err);
                    },
                    None,
                )?
            }
            cpal::SampleFormat::I16 => {
                let capture_clone = capture.clone();
                device.build_input_stream(
                    &config_copy.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i16::MAX as f32)
                            .collect();
                        capture.process_audio_data(&f32_data);
                    },
                    move |err| {
                        capture_clone.handle_stream_error(err);
                    },
                    None,
                )?
            }
            cpal::SampleFormat::I32 => {
                let capture_clone = capture.clone();
                device.build_input_stream(
                    &config_copy.into(),
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i32::MAX as f32)
                            .collect();
                        capture.process_audio_data(&f32_data);
                    },
                    move |err| {
                        capture_clone.handle_stream_error(err);
                    },
                    None,
                )?
            }
            cpal::SampleFormat::I8 => {
                let capture_clone = capture.clone();
                device.build_input_stream(
                    &config_copy.into(),
                    move |data: &[i8], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i8::MAX as f32)
                            .collect();
                        capture.process_audio_data(&f32_data);
                    },
                    move |err| {
                        capture_clone.handle_stream_error(err);
                    },
                    None,
                )?
            }
            _ => {
                return Err(anyhow::anyhow!(
                    "Unsupported sample format: {:?}",
                    config.sample_format()
                ));
            }
        };

        Ok(stream)
    }

    /// Get device info
    pub fn device(&self) -> &AudioDevice {
        &self.device
    }

    /// Stop the stream
    pub fn stop(self) -> Result<()> {
        info!("Stopping audio stream for device: {}", self.device.name);

        match self.backend {
            StreamBackend::Cpal(stream) => {
                // CRITICAL: Pause the stream first to stop callbacks immediately
                // This ensures closures stop executing before we drop the stream,
                // allowing Arc references captured in callbacks to be released
                if let Err(e) = stream.pause() {
                    warn!("Failed to pause stream before drop: {}", e);
                }
                info!("Stream paused, now dropping to release callbacks");
                drop(stream);
            }
            #[cfg(target_os = "macos")]
            StreamBackend::CoreAudio { task } => {
                // Abort the processing task and wait briefly for cleanup
                if let Some(task_handle) = task {
                    info!("Aborting Core Audio task...");
                    task_handle.abort();
                    // Give the runtime a moment to clean up the aborted task
                    // This helps ensure Arc references in the closure are dropped
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    info!("Core Audio task aborted");
                }
            }
        }

        // Explicitly drop self.device Arc reference
        drop(self.device);
        info!("Audio stream stopped and device reference dropped");
        Ok(())
    }
}
