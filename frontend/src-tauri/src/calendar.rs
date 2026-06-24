#![allow(unexpected_cfgs)]

mod commands;
mod permissions;
mod watcher;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

pub use commands::{load_calendar_auto_start_preferences, save_calendar_auto_start_preferences};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarAutoStartPreferences {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_lead_time_minutes")]
    pub lead_time_minutes: u32,
    #[serde(default)]
    pub include_all_day_events: bool,
}

impl Default for CalendarAutoStartPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            lead_time_minutes: default_lead_time_minutes(),
            include_all_day_events: false,
        }
    }
}

fn default_lead_time_minutes() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub calendar_title: Option<String>,
    pub start_unix_ms: i64,
    pub end_unix_ms: i64,
    pub is_all_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarAutoStartPayload {
    pub event_id: String,
    pub title: String,
    pub calendar_title: Option<String>,
    pub start_unix_ms: i64,
    pub end_unix_ms: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarPermissionStatus {
    NotDetermined,
    Restricted,
    Denied,
    FullAccess,
    WriteOnly,
    Unavailable,
    Unknown,
}

impl CalendarPermissionStatus {
    pub(crate) fn can_read_events(self) -> bool {
        matches!(self, Self::FullAccess)
    }
}

#[tauri::command]
pub async fn get_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CalendarAutoStartPreferences, String> {
    commands::get_calendar_auto_start_preferences(app).await
}

#[tauri::command]
pub async fn set_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: CalendarAutoStartPreferences,
) -> Result<(), String> {
    commands::set_calendar_auto_start_preferences(app, preferences).await
}

#[tauri::command]
pub async fn get_calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
    permissions::calendar_permission_status()
}

#[tauri::command]
pub async fn request_calendar_permission() -> Result<CalendarPermissionStatus, String> {
    permissions::request_calendar_access().await
}

#[tauri::command]
pub async fn list_calendar_events(
    start_unix_ms: i64,
    end_unix_ms: i64,
    include_all_day_events: Option<bool>,
    allow_permission_probe: Option<bool>,
) -> Result<Vec<CalendarEvent>, String> {
    permissions::list_calendar_events(
        start_unix_ms,
        end_unix_ms,
        include_all_day_events,
        allow_permission_probe,
    )
    .await
}

pub fn start_calendar_auto_start_watcher<R>(app: AppHandle<R>)
where
    R: Runtime + 'static,
{
    watcher::start_calendar_auto_start_watcher(app);
}
