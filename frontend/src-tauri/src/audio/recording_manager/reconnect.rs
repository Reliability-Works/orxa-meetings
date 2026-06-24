use super::*;

impl RecordingManager {
    /// Check for device events (disconnects/reconnects)
    /// Returns Some(DeviceEvent) if an event occurred, None otherwise
    pub fn poll_device_events(&mut self) -> Option<DeviceEvent> {
        if let Some(ref mut receiver) = self.device_event_receiver {
            receiver.try_recv().ok()
        } else {
            None
        }
    }

    /// Attempt to reconnect a disconnected device
    /// Returns true if reconnection successful
    pub async fn attempt_device_reconnect(
        &mut self,
        device_name: &str,
        device_type: DeviceMonitorType,
    ) -> Result<bool> {
        info!(
            "🔄 Attempting to reconnect device: {} ({:?})",
            device_name, device_type
        );

        // List current devices
        let available_devices = list_audio_devices().await?;

        // Find the device by name
        let device = available_devices
            .iter()
            .find(|d| d.name == device_name)
            .cloned();

        if let Some(device) = device {
            info!("✅ Device '{}' found, recreating stream...", device_name);

            // Determine which device to reconnect based on type
            let device_arc: Arc<AudioDevice> = Arc::new(device);
            match device_type {
                DeviceMonitorType::Microphone => {
                    // Stop existing mic stream and start new one
                    // We need to keep system audio running if it exists
                    let system_device = self.state.get_system_device();

                    // Restart streams with new microphone
                    self.stream_manager.stop_streams()?;
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                    self.stream_manager
                        .start_streams(Some(device_arc.clone()), system_device, None)
                        .await?;
                    self.state.set_microphone_device(device_arc);

                    info!("✅ Microphone reconnected successfully");
                    Ok(true)
                }
                DeviceMonitorType::SystemAudio => {
                    // Stop existing system audio stream and start new one
                    let microphone_device = self.state.get_microphone_device();

                    // Restart streams with new system audio
                    self.stream_manager.stop_streams()?;
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                    self.stream_manager
                        .start_streams(microphone_device, Some(device_arc.clone()), None)
                        .await?;
                    self.state.set_system_device(device_arc);

                    info!("✅ System audio reconnected successfully");
                    Ok(true)
                }
            }
        } else {
            warn!("❌ Device '{}' not yet available", device_name);
            Ok(false)
        }
    }

    /// Handle a device disconnect event
    /// Pauses recording and attempts reconnection
    pub async fn handle_device_disconnect(
        &mut self,
        device_name: String,
        device_type: DeviceMonitorType,
    ) {
        warn!(
            "📱 Device disconnected: {} ({:?})",
            device_name, device_type
        );

        // Mark state as reconnecting (keeps recording alive but in waiting state)
        let device = match device_type {
            DeviceMonitorType::Microphone => self.state.get_microphone_device(),
            DeviceMonitorType::SystemAudio => self.state.get_system_device(),
        };

        if let Some(device) = device {
            let recording_device_type = match device_type {
                DeviceMonitorType::Microphone => RecordingDeviceType::Microphone,
                DeviceMonitorType::SystemAudio => RecordingDeviceType::System,
            };
            self.state.start_reconnecting(device, recording_device_type);
        }
    }

    /// Handle a device reconnect event
    pub async fn handle_device_reconnect(
        &mut self,
        device_name: String,
        device_type: DeviceMonitorType,
    ) -> Result<()> {
        info!("📱 Device reconnected: {} ({:?})", device_name, device_type);

        // Attempt to reconnect the device
        match self
            .attempt_device_reconnect(&device_name, device_type)
            .await
        {
            Ok(true) => {
                info!("✅ Successfully reconnected device: {}", device_name);
                self.state.stop_reconnecting();
                Ok(())
            }
            Ok(false) => {
                warn!("Device reconnect attempt failed (device not yet available)");
                Err(anyhow::anyhow!("Device not available"))
            }
            Err(e) => {
                error!("Device reconnect failed: {}", e);
                Err(e)
            }
        }
    }

    /// Check if currently attempting to reconnect
    pub fn is_reconnecting(&self) -> bool {
        self.state.is_reconnecting()
    }

    /// Get reference to recording state for external access
    pub fn get_state(&self) -> &Arc<RecordingState> {
        &self.state
    }
}
