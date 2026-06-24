use super::SidecarManager;
use std::sync::atomic::Ordering;
use std::time::Duration;

impl SidecarManager {
    /// Start health check loop (runs in background)
    pub(super) fn start_health_check_loop(&self) {
        let manager = Self {
            child_process: self.child_process.clone(),
            stdin_writer: self.stdin_writer.clone(),
            stdout_reader: self.stdout_reader.clone(),
            last_activity: self.last_activity.clone(),
            is_healthy: self.is_healthy.clone(),
            should_shutdown: self.should_shutdown.clone(),
            active_request_count: self.active_request_count.clone(),
            helper_binary_path: self.helper_binary_path.clone(),
            current_model_path: self.current_model_path.clone(),
            idle_timeout_secs: self.idle_timeout_secs,
        };

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                if manager.should_shutdown.load(Ordering::SeqCst) {
                    log::debug!("Health check loop: shutdown flag set, exiting");
                    break;
                }

                if !manager.is_healthy() {
                    log::debug!("Health check loop: sidecar unhealthy, skipping ping");
                    continue;
                }

                // Don't ping if we are busy with a request
                if manager.active_request_count.load(Ordering::SeqCst) > 0 {
                    continue;
                }

                log::debug!("Health check: sending ping");
                if let Err(e) = manager.send_ping().await {
                    log::warn!("Health check failed: {}", e);
                    manager.is_healthy.store(false, Ordering::SeqCst);
                }
            }

            log::debug!("Health check loop exited");
        });
    }

    /// Start idle check loop (runs in background)
    pub(super) fn start_idle_check_loop(&self) {
        let manager = Self {
            child_process: self.child_process.clone(),
            stdin_writer: self.stdin_writer.clone(),
            stdout_reader: self.stdout_reader.clone(),
            last_activity: self.last_activity.clone(),
            is_healthy: self.is_healthy.clone(),
            should_shutdown: self.should_shutdown.clone(),
            active_request_count: self.active_request_count.clone(),
            helper_binary_path: self.helper_binary_path.clone(),
            current_model_path: self.current_model_path.clone(),
            idle_timeout_secs: self.idle_timeout_secs,
        };

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                if manager.should_shutdown.load(Ordering::SeqCst) {
                    log::debug!("Idle check loop: shutdown flag set, exiting");
                    break;
                }

                // Don't shutdown if we are busy
                if manager.active_request_count.load(Ordering::SeqCst) > 0 {
                    // Update activity to prevent timeout immediately after request finishes
                    manager.update_activity().await;
                    continue;
                }

                let idle_secs = manager.seconds_since_activity().await;
                log::debug!("Idle check: {}s since last activity", idle_secs);

                if idle_secs > manager.idle_timeout_secs {
                    log::info!(
                        "Sidecar idle for {}s (timeout: {}s), shutting down",
                        idle_secs,
                        manager.idle_timeout_secs
                    );

                    if let Err(e) = manager.shutdown().await {
                        log::error!("Failed to shutdown idle sidecar: {}", e);
                    }

                    break;
                }
            }

            log::debug!("Idle check loop exited");
        });
    }
}
