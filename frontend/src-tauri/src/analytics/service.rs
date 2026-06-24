use chrono::{DateTime, Utc};
use posthog_rs::{Client, Event};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

mod events;

const SENSITIVE_ANALYTICS_KEYS: &[&str] = &[
    "meeting_title",
    "meetingTitle",
    "meeting_name",
    "meetingName",
    "file_name",
    "filename",
    "file_path",
    "folder_path",
    "path",
    "source_path",
    "meeting_folder_path",
    "device_name",
    "user_agent",
];

fn sanitize_analytics_properties(
    mut properties: HashMap<String, String>,
) -> HashMap<String, String> {
    properties.retain(|key, _| !SENSITIVE_ANALYTICS_KEYS.contains(&key.as_str()));
    properties
}

fn meeting_started_properties(meeting_id: &str) -> HashMap<String, String> {
    let mut properties = HashMap::new();
    properties.insert("meeting_id".to_string(), meeting_id.to_string());
    properties.insert("timestamp".to_string(), chrono::Utc::now().to_rfc3339());
    properties
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsConfig {
    pub api_key: String,
    pub host: Option<String>,
    pub enabled: bool,
}

impl Default for AnalyticsConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            host: Some("https://us.i.posthog.com".to_string()),
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub session_id: String,
    pub user_id: String,
    pub start_time: DateTime<Utc>,
    pub is_active: bool,
}

impl UserSession {
    pub fn new(user_id: String) -> Self {
        let now = Utc::now();
        Self {
            session_id: format!("session_{}", Uuid::new_v4()),
            user_id,
            start_time: now,
            is_active: true,
        }
    }

    pub fn duration_seconds(&self) -> i64 {
        (Utc::now() - self.start_time).num_seconds()
    }
}

pub struct AnalyticsClient {
    client: Option<Arc<Client>>,
    config: AnalyticsConfig,
    user_id: Arc<Mutex<Option<String>>>,
    current_session: Arc<Mutex<Option<UserSession>>>,
}

impl AnalyticsClient {
    pub async fn new(config: AnalyticsConfig) -> Self {
        let client = if config.enabled && !config.api_key.is_empty() {
            Some(Arc::new(posthog_rs::client(config.api_key.as_str()).await))
        } else {
            None
        };

        Self {
            client,
            config,
            user_id: Arc::new(Mutex::new(None)),
            current_session: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn identify(
        &self,
        user_id: String,
        properties: Option<HashMap<String, String>>,
    ) -> Result<(), String> {
        let client = match &self.client {
            Some(client) => Arc::clone(client),
            None => return Ok(()),
        };

        // Store user ID for future events
        *self.user_id.lock().await = Some(user_id.clone());

        let properties = sanitize_analytics_properties(properties.unwrap_or_default());

        let mut event = Event::new("$identify", &user_id);

        // Add user properties
        for (key, value) in properties {
            if let Err(e) = event.insert_prop(&key, value) {
                eprintln!("Failed to add property {}: {}", key, e);
            }
        }

        if let Err(e) = client.capture(event).await {
            eprintln!("Failed to identify user: {}", e);
        }

        Ok(())
    }

    pub async fn track_event(
        &self,
        event_name: &str,
        properties: Option<HashMap<String, String>>,
    ) -> Result<(), String> {
        let client = match &self.client {
            Some(client) => Arc::clone(client),
            None => return Ok(()),
        };

        let user_id = match self.user_id.lock().await.clone() {
            Some(id) => id,
            None => {
                // Don't create anonymous users, wait for proper identification
                log::warn!(
                    "Attempted to track event '{}' before user identification",
                    event_name
                );
                return Ok(());
            }
        };

        let event_name = event_name.to_string();
        let mut properties = sanitize_analytics_properties(properties.unwrap_or_default());

        // Add app version to all events
        properties.insert(
            "app_version".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
        );

        // Add session information to all events
        if let Some(session) = self.current_session.lock().await.as_ref() {
            properties.insert("session_id".to_string(), session.session_id.clone());
            properties.insert(
                "session_duration".to_string(),
                session.duration_seconds().to_string(),
            );
        }

        let mut event = Event::new(&event_name, &user_id);

        // Add event properties
        for (key, value) in properties {
            if let Err(e) = event.insert_prop(&key, value) {
                log::warn!("Failed to add property {}: {}", key, e);
            }
        }

        if let Err(e) = client.capture(event).await {
            log::warn!("Failed to track event {}: {}", event_name, e);
        }

        Ok(())
    }

    // Enhanced user tracking methods
    pub async fn start_session(&self, user_id: String) -> Result<String, String> {
        let session = UserSession::new(user_id.clone());
        let session_id = session.session_id.clone();

        *self.current_session.lock().await = Some(session);

        let mut properties = HashMap::new();
        properties.insert("session_id".to_string(), session_id.clone());
        properties.insert("timestamp".to_string(), Utc::now().to_rfc3339());

        self.track_event("session_started", Some(properties))
            .await?;

        Ok(session_id)
    }

    pub async fn end_session(&self) -> Result<(), String> {
        let mut session_guard = self.current_session.lock().await;

        if let Some(session) = session_guard.take() {
            let mut properties = HashMap::new();
            properties.insert("session_id".to_string(), session.session_id.clone());
            properties.insert(
                "session_duration".to_string(),
                session.duration_seconds().to_string(),
            );
            properties.insert("timestamp".to_string(), Utc::now().to_rfc3339());

            self.track_event("session_ended", Some(properties)).await?;
        }

        Ok(())
    }

    pub async fn track_daily_active_user(&self) -> Result<(), String> {
        let user_id = match self.user_id.lock().await.clone() {
            Some(id) => id,
            None => {
                log::warn!("Attempted to track daily active user before user identification");
                return Ok(());
            }
        };

        let mut properties = HashMap::new();
        properties.insert("user_id".to_string(), user_id);
        properties.insert(
            "date".to_string(),
            Utc::now().format("%Y-%m-%d").to_string(),
        );
        properties.insert("timestamp".to_string(), Utc::now().to_rfc3339());

        self.track_event("daily_active_user", Some(properties))
            .await
    }

    pub async fn track_user_first_launch(&self) -> Result<(), String> {
        let mut properties = HashMap::new();
        properties.insert("timestamp".to_string(), Utc::now().to_rfc3339());
        properties.insert(
            "app_version".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
        );

        self.track_event("user_first_launch", Some(properties))
            .await
    }

    pub async fn get_current_session(&self) -> Option<UserSession> {
        self.current_session.lock().await.clone()
    }

    pub async fn is_session_active(&self) -> bool {
        self.current_session.lock().await.is_some()
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled && self.client.is_some()
    }

    pub async fn set_user_properties(
        &self,
        properties: HashMap<String, String>,
    ) -> Result<(), String> {
        let client = match &self.client {
            Some(client) => Arc::clone(client),
            None => return Ok(()),
        };

        let user_id = match self.user_id.lock().await.clone() {
            Some(id) => id,
            None => {
                eprintln!("Warning: Attempted to set user properties before user identification");
                return Ok(());
            }
        };

        let properties = sanitize_analytics_properties(properties);
        let mut event = Event::new("$set", &user_id);

        // Add user properties
        for (key, value) in properties {
            if let Err(e) = event.insert_prop(&key, value) {
                eprintln!("Failed to add property {}: {}", key, e);
            }
        }

        if let Err(e) = client.capture(event).await {
            eprintln!("Failed to set user properties: {}", e);
        }

        Ok(())
    }
}

// Helper function to create analytics client from config
pub async fn create_analytics_client(config: AnalyticsConfig) -> AnalyticsClient {
    AnalyticsClient::new(config).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analytics_properties_drop_sensitive_meeting_metadata() {
        let mut properties = HashMap::new();
        properties.insert("meeting_title".to_string(), "Board Strategy".to_string());
        properties.insert("meetingTitle".to_string(), "Board Strategy".to_string());
        properties.insert("meeting_name".to_string(), "Client Call".to_string());
        properties.insert("meetingName".to_string(), "Client Call".to_string());
        properties.insert("file_name".to_string(), "acquisition.wav".to_string());
        properties.insert("filename".to_string(), "acquisition.wav".to_string());
        properties.insert(
            "file_path".to_string(),
            "C:\\meetings\\acquisition.wav".to_string(),
        );
        properties.insert("folder_path".to_string(), "C:\\meetings".to_string());
        properties.insert(
            "path".to_string(),
            "C:\\meetings\\acquisition.wav".to_string(),
        );
        properties.insert(
            "source_path".to_string(),
            "C:\\imports\\source.wav".to_string(),
        );
        properties.insert(
            "meeting_folder_path".to_string(),
            "C:\\meetings\\private".to_string(),
        );
        properties.insert("device_name".to_string(), "Jane's AirPods".to_string());
        properties.insert("user_agent".to_string(), "Mozilla/5.0".to_string());
        properties.insert("meeting_id".to_string(), "meeting-123".to_string());
        properties.insert("duration_seconds".to_string(), "125".to_string());
        properties.insert("segments_count".to_string(), "42".to_string());
        properties.insert("model_name".to_string(), "parakeet".to_string());
        properties.insert("platform".to_string(), "Windows".to_string());

        let sanitized = sanitize_analytics_properties(properties);

        for key in [
            "meeting_title",
            "meetingTitle",
            "meeting_name",
            "meetingName",
            "file_name",
            "filename",
            "file_path",
            "folder_path",
            "path",
            "source_path",
            "meeting_folder_path",
            "device_name",
            "user_agent",
        ] {
            assert!(
                !sanitized.contains_key(key),
                "sensitive key remained: {}",
                key
            );
        }

        assert_eq!(
            sanitized.get("meeting_id"),
            Some(&"meeting-123".to_string())
        );
        assert_eq!(sanitized.get("duration_seconds"), Some(&"125".to_string()));
        assert_eq!(sanitized.get("segments_count"), Some(&"42".to_string()));
        assert_eq!(sanitized.get("model_name"), Some(&"parakeet".to_string()));
        assert_eq!(sanitized.get("platform"), Some(&"Windows".to_string()));
    }

    #[test]
    fn meeting_started_properties_do_not_include_title() {
        let properties = meeting_started_properties("meeting-123");

        assert_eq!(
            properties.get("meeting_id"),
            Some(&"meeting-123".to_string())
        );
        assert!(properties.contains_key("timestamp"));
        assert!(!properties.contains_key("meeting_title"));
    }
}
