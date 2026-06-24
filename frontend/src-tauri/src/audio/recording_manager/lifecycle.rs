use super::*;

impl RecordingManager {
    /// Create a new recording manager
    pub fn new() -> Self {
        let state = RecordingState::new();
        let stream_manager = AudioStreamManager::new(state.clone());
        let pipeline_manager = AudioPipelineManager::new();
        let (device_monitor, device_event_receiver) = AudioDeviceMonitor::new();

        Self {
            state,
            stream_manager,
            pipeline_manager,
            recording_saver: RecordingSaver::new(),
            device_monitor: Some(device_monitor),
            device_event_receiver: Some(device_event_receiver),
        }
    }

    // Remove app handle storage for now - will be passed directly when saving

    /// Start recording with specified devices
    ///
    /// # Arguments
    /// * `microphone_device` - Optional microphone device to use
    /// * `system_device` - Optional system audio device to use
    /// * `auto_save` - Whether to save audio checkpoints (true) or just transcripts/metadata (false)
    pub async fn start_recording(
        &mut self,
        microphone_device: Option<Arc<AudioDevice>>,
        system_device: Option<Arc<AudioDevice>>,
        auto_save: bool,
    ) -> Result<mpsc::UnboundedReceiver<AudioChunk>> {
        info!("Starting recording manager (auto_save: {})", auto_save);

        // Set up transcription channel
        let (transcription_sender, transcription_receiver) =
            mpsc::unbounded_channel::<AudioChunk>();

        // CRITICAL FIX: Create recording sender for pre-mixed audio from pipeline
        // Pipeline will mix mic + system audio professionally and send to this channel
        // Pass auto_save to control whether audio checkpoints are created
        let recording_sender = self.recording_saver.start_accumulation(auto_save);

        // Start recording state first
        self.state.start_recording()?;

        // Get device information for adaptive mixing
        // The pipeline uses device kind (Bluetooth vs Wired) to apply adaptive buffering:
        // - Bluetooth: Larger buffers (80-200ms) to handle jitter
        // - Wired: Smaller buffers (20-50ms) for low latency
        let (mic_name, mic_kind) = if let Some(ref mic) = microphone_device {
            let device_kind =
                crate::audio::device_detection::InputDeviceKind::detect(&mic.name, 512, 48000);
            (mic.name.clone(), device_kind)
        } else {
            (
                "No Microphone".to_string(),
                crate::audio::device_detection::InputDeviceKind::Unknown,
            )
        };

        let (sys_name, sys_kind) = if let Some(ref sys) = system_device {
            let device_kind =
                crate::audio::device_detection::InputDeviceKind::detect(&sys.name, 512, 48000);
            (sys.name.clone(), device_kind)
        } else {
            (
                "No System Audio".to_string(),
                crate::audio::device_detection::InputDeviceKind::Unknown,
            )
        };

        // Update recording metadata with device information
        self.recording_saver.set_device_info(
            microphone_device.as_ref().map(|d| d.name.clone()),
            system_device.as_ref().map(|d| d.name.clone()),
        );

        // Start the audio processing pipeline with FFmpeg adaptive mixer
        // Pipeline will: 1) Mix mic+system audio with adaptive buffering, 2) Send mixed to recording_sender,
        // 3) Apply VAD and send speech segments to transcription
        self.pipeline_manager.start(
            self.state.clone(),
            transcription_sender,
            0,                      // Ignored - using dynamic sizing internally
            48000,                  // 48kHz sample rate
            Some(recording_sender), // CRITICAL: Pass recording sender to receive pre-mixed audio
            mic_name,
            mic_kind,
            sys_name,
            sys_kind,
        )?;

        // Give the pipeline a moment to fully initialize before starting streams
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // Start audio streams - they send RAW unmixed chunks to pipeline for mixing
        // Pipeline handles mixing and distribution to both recording and transcription
        self.stream_manager
            .start_streams(microphone_device.clone(), system_device.clone(), None)
            .await?;

        // Start device monitoring to detect disconnects
        if let Some(ref mut monitor) = self.device_monitor {
            if let Err(e) = monitor.start_monitoring(microphone_device, system_device) {
                warn!("Failed to start device monitoring: {}", e);
                // Non-fatal - continue without monitoring
            } else {
                info!("✅ Device monitoring started");
            }
        }

        info!(
            "Recording manager started successfully with {} active streams",
            self.stream_manager.active_stream_count()
        );

        Ok(transcription_receiver)
    }

    /// Start recording with default devices and auto_save setting
    ///
    /// # Arguments
    /// * `auto_save` - Whether to save audio checkpoints (true) or just transcripts/metadata (false)
    ///
    /// # Platform-Specific Behavior
    ///
    /// **macOS**: Uses smart device selection that automatically overrides
    /// Bluetooth devices to built-in wired devices for stable, consistent sample rates.
    /// This prevents Core Audio/ScreenCaptureKit from delivering variable sample rate
    /// streams that cause sync issues when mixing mic + system audio.
    ///
    /// **Windows/Linux**: Uses system default devices directly without override.
    ///
    /// # macOS Bluetooth Override Strategy
    ///
    /// - Microphone: If Bluetooth → Use built-in MacBook mic
    /// - Speaker: If Bluetooth → Use built-in MacBook speaker (for ScreenCaptureKit)
    /// - Each device is checked INDEPENDENTLY
    ///
    /// Rationale: Bluetooth devices on macOS can have variable sample rates as Core Audio
    /// and the Bluetooth stack may resample dynamically. Built-in devices provide
    /// fixed, consistent sample rates for reliable audio mixing.
    ///
    /// User still hears audio via Bluetooth (playback), but recording captures
    /// via stable wired path for best quality.
    pub async fn start_recording_with_defaults_and_auto_save(
        &mut self,
        auto_save: bool,
    ) -> Result<mpsc::UnboundedReceiver<AudioChunk>> {
        #[cfg(target_os = "macos")]
        {
            info!("🎙️ [macOS] Starting recording with smart device selection (Bluetooth override enabled)");

            // Get safe recording devices with automatic Bluetooth fallback
            // This function handles all the detection and override logic for macOS
            let (microphone_device, system_device) = get_safe_recording_devices_macos()?;

            // Wrap in Arc for sharing across threads
            let microphone_device = microphone_device.map(Arc::new);
            let system_device = system_device.map(Arc::new);

            // Ensure at least microphone is available
            if microphone_device.is_none() {
                return Err(anyhow::anyhow!(
                    "❌ No microphone device available for recording"
                ));
            }

            // Start recording with selected devices and auto_save setting
            self.start_recording(microphone_device, system_device, auto_save)
                .await
        }

        #[cfg(not(target_os = "macos"))]
        {
            info!("Starting recording with default devices");

            // Get default devices (no Bluetooth override on Windows/Linux)
            let microphone_device = match default_input_device() {
                Ok(device) => {
                    info!("Using default microphone: {}", device.name);
                    Some(Arc::new(device))
                }
                Err(e) => {
                    warn!("No default microphone available: {}", e);
                    None
                }
            };

            let system_device = match default_output_device() {
                Ok(device) => {
                    info!("Using default system audio: {}", device.name);
                    Some(Arc::new(device))
                }
                Err(e) => {
                    warn!("No default system audio available: {}", e);
                    None
                }
            };

            // Ensure at least microphone is available
            if microphone_device.is_none() {
                return Err(anyhow::anyhow!("No microphone device available"));
            }

            self.start_recording(microphone_device, system_device, auto_save)
                .await
        }
    }

    /// Stop recording streams without saving (for use when waiting for transcription)
    pub async fn stop_streams_only(&mut self) -> Result<()> {
        info!("Stopping recording streams only");

        // Stop device monitoring
        if let Some(ref mut monitor) = self.device_monitor {
            monitor.stop_monitoring().await;
        }

        // Stop recording state first
        self.state.stop_recording();

        // Stop audio streams
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // Stop audio pipeline
        if let Err(e) = self.pipeline_manager.stop().await {
            error!("Error stopping audio pipeline: {}", e);
        }

        debug!("Recording streams stopped successfully");
        Ok(())
    }

    /// Stop streams and force immediate pipeline flush to process all accumulated audio
    pub async fn stop_streams_and_force_flush(&mut self) -> Result<()> {
        info!("🚀 Stopping recording streams with IMMEDIATE pipeline flush");

        // CRITICAL: Stop device monitor FIRST to prevent continuous WASAPI polling on Windows
        // This fixes the slow shutdown issue where device enumeration runs for 90+ seconds
        if let Some(ref mut monitor) = self.device_monitor {
            info!("Stopping device monitor first...");
            monitor.stop_monitoring().await;
        }

        // Stop recording state first - this clears device references
        self.state.stop_recording();

        // Stop audio streams immediately
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // CRITICAL: Force pipeline to flush ALL accumulated audio before stopping
        debug!("💨 Forcing pipeline to flush accumulated audio immediately");
        if let Err(e) = self.pipeline_manager.force_flush_and_stop().await {
            error!("Error during force flush: {}", e);
        }

        // CRITICAL: Full cleanup to release all Arc references and resources
        // This ensures microphone is released even if Drop is delayed
        self.state.cleanup();

        info!("✅ Recording streams stopped with immediate flush completed");
        Ok(())
    }

    /// Save recording after transcription is complete
    pub async fn save_recording_only<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
    ) -> Result<()> {
        debug!("Saving recording with transcript chunks");

        // Get actual recording duration from state
        let recording_duration = self.state.get_active_recording_duration();
        info!("Recording duration from state: {:?}s", recording_duration);

        // Save the recording with actual duration
        match self
            .recording_saver
            .stop_and_save(app, recording_duration)
            .await
        {
            Ok(Some(file_path)) => {
                info!("Recording saved successfully to: {}", file_path);
            }
            Ok(None) => {
                debug!("Recording not saved (auto-save disabled or no audio data)");
            }
            Err(e) => {
                error!("Failed to save recording: {}", e);
                // Don't fail the stop operation if saving fails
            }
        }

        debug!("Recording save operation completed");
        Ok(())
    }

    /// Stop recording and save audio (legacy method)
    pub async fn stop_recording<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
    ) -> Result<()> {
        info!("Stopping recording manager");

        // Get recording duration BEFORE stopping (important!)
        let recording_duration = self.state.get_active_recording_duration();
        info!("Recording duration before stop: {:?}s", recording_duration);

        // Stop recording state first
        self.state.stop_recording();

        // Stop audio streams
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // Stop audio pipeline
        if let Err(e) = self.pipeline_manager.stop().await {
            error!("Error stopping audio pipeline: {}", e);
        }

        // Save the recording with actual duration
        match self
            .recording_saver
            .stop_and_save(app, recording_duration)
            .await
        {
            Ok(Some(file_path)) => {
                info!("Recording saved successfully to: {}", file_path);
            }
            Ok(None) => {
                info!("Recording not saved (auto-save disabled or no audio data)");
            }
            Err(e) => {
                error!("Failed to save recording: {}", e);
                // Don't fail the stop operation if saving fails
            }
        }

        info!("Recording manager stopped");
        Ok(())
    }
}
