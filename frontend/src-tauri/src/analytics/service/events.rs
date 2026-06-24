use super::*;

impl AnalyticsClient {
    // Meeting-specific event tracking methods
    pub async fn track_meeting_started(&self, meeting_id: &str) -> Result<(), String> {
        self.track_event(
            "meeting_started",
            Some(meeting_started_properties(meeting_id)),
        )
        .await
    }

    pub async fn track_recording_started(&self, meeting_id: &str) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("meeting_id".to_string(), meeting_id.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("recording_started", Some(properties))
            .await
    }

    pub async fn track_recording_stopped(
        &self,
        meeting_id: &str,
        duration_seconds: Option<u64>,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("meeting_id".to_string(), meeting_id.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        if let Some(duration) = duration_seconds {
            properties.insert("duration_seconds".to_string(), duration.to_string());
        }

        self.track_event("recording_stopped", Some(properties))
            .await
    }

    pub async fn track_meeting_deleted(&self, meeting_id: &str) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("meeting_id".to_string(), meeting_id.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("meeting_deleted", Some(properties)).await
    }

    pub async fn track_settings_changed(
        &self,
        setting_type: &str,
        new_value: &str,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("setting_type".to_string(), setting_type.to_string());
        properties.insert("new_value".to_string(), new_value.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("settings_changed", Some(properties)).await
    }

    pub async fn track_app_started(&self, version: &str) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("app_version".to_string(), version.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("app_started", Some(properties)).await
    }

    pub async fn track_feature_used(&self, feature_name: &str) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("feature_name".to_string(), feature_name.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("feature_used", Some(properties)).await
    }

    // Summary generation analytics
    pub async fn track_summary_generation_started(
        &self,
        model_provider: &str,
        model_name: &str,
        transcript_length: usize,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("model_provider".to_string(), model_provider.to_string());
        properties.insert("model_name".to_string(), model_name.to_string());
        properties.insert(
            "transcript_length".to_string(),
            transcript_length.to_string(),
        );
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("summary_generation_started", Some(properties))
            .await
    }

    pub async fn track_summary_generation_completed(
        &self,
        model_provider: &str,
        model_name: &str,
        success: bool,
        duration_seconds: Option<u64>,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("model_provider".to_string(), model_provider.to_string());
        properties.insert("model_name".to_string(), model_name.to_string());
        properties.insert("success".to_string(), success.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        if let Some(duration) = duration_seconds {
            properties.insert("duration_seconds".to_string(), duration.to_string());
        }

        if let Some(error) = error_message {
            properties.insert("error_message".to_string(), error.to_string());
        }

        self.track_event("summary_generation_completed", Some(properties))
            .await
    }

    pub async fn track_summary_regenerated(
        &self,
        model_provider: &str,
        model_name: &str,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("model_provider".to_string(), model_provider.to_string());
        properties.insert("model_name".to_string(), model_name.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("summary_regenerated", Some(properties))
            .await
    }

    pub async fn track_model_changed(
        &self,
        old_provider: &str,
        old_model: &str,
        new_provider: &str,
        new_model: &str,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("old_provider".to_string(), old_provider.to_string());
        properties.insert("old_model".to_string(), old_model.to_string());
        properties.insert("new_provider".to_string(), new_provider.to_string());
        properties.insert("new_model".to_string(), new_model.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("model_changed", Some(properties)).await
    }

    pub async fn track_custom_prompt_used(&self, prompt_length: usize) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("prompt_length".to_string(), prompt_length.to_string());
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("custom_prompt_used", Some(properties))
            .await
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "Meeting-end analytics records explicit scalar metrics without meeting content"
    )]
    pub async fn track_meeting_ended(
        &self,
        transcription_provider: &str,
        transcription_model: &str,
        summary_provider: &str,
        summary_model: &str,
        total_duration_seconds: Option<f64>,
        active_duration_seconds: f64,
        pause_duration_seconds: f64,
        microphone_device_type: &str,
        system_audio_device_type: &str,
        chunks_processed: u64,
        transcript_segments_count: u64,
        had_fatal_error: bool,
    ) -> Result<(), String> {
        let mut properties = HashMap::new();

        // Model information
        properties.insert(
            "transcription_provider".to_string(),
            transcription_provider.to_string(),
        );
        properties.insert(
            "transcription_model".to_string(),
            transcription_model.to_string(),
        );
        properties.insert("summary_provider".to_string(), summary_provider.to_string());
        properties.insert("summary_model".to_string(), summary_model.to_string());

        // Duration metrics
        if let Some(duration) = total_duration_seconds {
            properties.insert("total_duration_seconds".to_string(), duration.to_string());
        }
        properties.insert(
            "active_duration_seconds".to_string(),
            active_duration_seconds.to_string(),
        );
        properties.insert(
            "pause_duration_seconds".to_string(),
            pause_duration_seconds.to_string(),
        );

        // Privacy-safe device types
        properties.insert(
            "microphone_device_type".to_string(),
            microphone_device_type.to_string(),
        );
        properties.insert(
            "system_audio_device_type".to_string(),
            system_audio_device_type.to_string(),
        );

        // Processing stats
        properties.insert("chunks_processed".to_string(), chunks_processed.to_string());
        properties.insert(
            "transcript_segments_count".to_string(),
            transcript_segments_count.to_string(),
        );
        properties.insert("had_fatal_error".to_string(), had_fatal_error.to_string());

        // Timestamp
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("meeting_ended", Some(properties)).await
    }

    // Analytics consent tracking
    pub async fn track_analytics_enabled(&self) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("analytics_enabled", Some(properties))
            .await
    }

    pub async fn track_analytics_disabled(&self) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("analytics_disabled", Some(properties))
            .await
    }

    pub async fn track_analytics_transparency_viewed(&self) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());

        self.track_event("analytics_transparency_viewed", Some(properties))
            .await
    }
}
