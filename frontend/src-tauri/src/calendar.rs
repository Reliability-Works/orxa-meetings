#![allow(unexpected_cfgs)]

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;

const CALENDAR_PREFERENCES_STORE: &str = "calendar_auto_start_preferences.json";
const CALENDAR_PREFERENCES_KEY: &str = "preferences";
const WATCH_INTERVAL_SECONDS: u64 = 30;
const START_GRACE_SECONDS: i64 = 60;

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
    fn can_read_events(self) -> bool {
        matches!(self, Self::FullAccess)
    }
}

pub async fn load_calendar_auto_start_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> anyhow::Result<CalendarAutoStartPreferences> {
    let store = match app.store(CALENDAR_PREFERENCES_STORE) {
        Ok(store) => store,
        Err(error) => {
            log::warn!(
                "Failed to access calendar preferences store: {}, using defaults",
                error
            );
            return Ok(CalendarAutoStartPreferences::default());
        }
    };

    let mut preferences = store
        .get(CALENDAR_PREFERENCES_KEY)
        .and_then(|value| {
            serde_json::from_value::<CalendarAutoStartPreferences>(value.clone()).ok()
        })
        .unwrap_or_default();

    normalize_calendar_preferences(&mut preferences);
    Ok(preferences)
}

pub async fn save_calendar_auto_start_preferences<R: Runtime>(
    app: &AppHandle<R>,
    mut preferences: CalendarAutoStartPreferences,
) -> anyhow::Result<()> {
    normalize_calendar_preferences(&mut preferences);

    let store = app.store(CALENDAR_PREFERENCES_STORE).map_err(|error| {
        anyhow::anyhow!("Failed to access calendar preferences store: {}", error)
    })?;
    let value = serde_json::to_value(preferences)
        .map_err(|error| anyhow::anyhow!("Failed to serialize calendar preferences: {}", error))?;

    store.set(CALENDAR_PREFERENCES_KEY, value);
    store
        .save()
        .map_err(|error| anyhow::anyhow!("Failed to save calendar preferences: {}", error))?;

    Ok(())
}

fn normalize_calendar_preferences(preferences: &mut CalendarAutoStartPreferences) {
    preferences.lead_time_minutes = preferences.lead_time_minutes.min(30);
}

#[tauri::command]
pub async fn get_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CalendarAutoStartPreferences, String> {
    load_calendar_auto_start_preferences(&app)
        .await
        .map_err(|error| format!("Failed to load calendar auto-start preferences: {}", error))
}

#[tauri::command]
pub async fn set_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: CalendarAutoStartPreferences,
) -> Result<(), String> {
    save_calendar_auto_start_preferences(&app, preferences)
        .await
        .map_err(|error| format!("Failed to save calendar auto-start preferences: {}", error))
}

#[tauri::command]
pub async fn get_calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
    calendar_permission_status()
}

#[tauri::command]
pub async fn request_calendar_permission() -> Result<CalendarPermissionStatus, String> {
    request_calendar_access().await
}

#[tauri::command]
pub async fn list_calendar_events(
    start_unix_ms: i64,
    end_unix_ms: i64,
    include_all_day_events: Option<bool>,
) -> Result<Vec<CalendarEvent>, String> {
    if end_unix_ms <= start_unix_ms {
        return Err("Calendar range end must be after start".to_string());
    }

    let include_all_day_events = include_all_day_events.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        platform::calendar_events_in_range(start_unix_ms, end_unix_ms, include_all_day_events)
    })
    .await
    .map_err(|error| format!("Failed to join calendar query task: {}", error))?
}

pub fn start_calendar_auto_start_watcher<R>(app: AppHandle<R>)
where
    R: Runtime + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut seen_event_ids: VecDeque<String> = VecDeque::new();
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        loop {
            if let Err(error) = run_calendar_auto_start_tick(&app, &mut seen_event_ids).await {
                log::warn!("Calendar auto-start tick failed: {}", error);
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(WATCH_INTERVAL_SECONDS)).await;
        }
    });
}

async fn run_calendar_auto_start_tick<R: Runtime>(
    app: &AppHandle<R>,
    seen_event_ids: &mut VecDeque<String>,
) -> Result<(), String> {
    let preferences = load_calendar_auto_start_preferences(app)
        .await
        .map_err(|error| error.to_string())?;

    if !preferences.enabled {
        return Ok(());
    }

    if !calendar_permission_status()?.can_read_events() {
        return Ok(());
    }

    if crate::audio::recording_commands::is_recording().await {
        return Ok(());
    }

    let events = upcoming_calendar_events(
        preferences.lead_time_minutes,
        preferences.include_all_day_events,
    )
    .await?;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let lead_ms = i64::from(preferences.lead_time_minutes) * 60_000;
    let grace_ms = START_GRACE_SECONDS * 1_000;

    if let Some(event) = events.into_iter().find(|event| {
        !seen_event_ids.contains(&event.id)
            && event.end_unix_ms > now_ms
            && event.start_unix_ms >= now_ms - grace_ms
            && event.start_unix_ms <= now_ms + lead_ms
    }) {
        log::info!(
            "Calendar auto-start matched event '{}' from calendar {:?}",
            event.title,
            event.calendar_title
        );

        crate::tray::set_tray_state(app, crate::tray::RecordingState::Starting);

        match crate::audio::recording_commands::start_recording_with_devices_and_meeting(
            app.clone(),
            None,
            None,
            Some(event.title.clone()),
        )
        .await
        {
            Ok(_) => {
                remember_event_id(seen_event_ids, event.id.clone());

                let notification_manager_state =
                    app.state::<crate::notifications::commands::NotificationManagerState<R>>();
                if let Err(error) =
                    crate::notifications::commands::show_recording_started_notification(
                        app,
                        &notification_manager_state,
                        Some(event.title.clone()),
                    )
                    .await
                {
                    log::error!("Failed to show calendar auto-start notification: {}", error);
                }

                let payload = CalendarAutoStartPayload {
                    event_id: event.id,
                    title: event.title,
                    calendar_title: event.calendar_title,
                    start_unix_ms: event.start_unix_ms,
                    end_unix_ms: event.end_unix_ms,
                };
                let _ = app.emit("calendar-auto-recording-started", payload);
            }
            Err(error) => {
                crate::tray::update_tray_menu(app);
                return Err(format!("Failed to auto-start recording: {}", error));
            }
        }
    }

    Ok(())
}

fn remember_event_id(seen_event_ids: &mut VecDeque<String>, event_id: String) {
    if seen_event_ids.contains(&event_id) {
        return;
    }

    seen_event_ids.push_back(event_id);
    while seen_event_ids.len() > 100 {
        seen_event_ids.pop_front();
    }
}

async fn upcoming_calendar_events(
    lead_time_minutes: u32,
    include_all_day_events: bool,
) -> Result<Vec<CalendarEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::upcoming_calendar_events(lead_time_minutes, include_all_day_events)
    })
    .await
    .map_err(|error| format!("Failed to join calendar query task: {}", error))?
}

fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
    platform::calendar_permission_status()
}

async fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(platform::request_calendar_access)
        .await
        .map_err(|error| format!("Failed to join calendar permission task: {}", error))?
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
mod platform {
    use super::{CalendarEvent, CalendarPermissionStatus, START_GRACE_SECONDS};
    use block::ConcreteBlock;
    use objc::rc::autoreleasepool;
    use objc::runtime::{Object, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;
    use std::ptr;
    use std::sync::mpsc;
    use std::time::Duration;

    const EK_ENTITY_TYPE_EVENT: u64 = 0;

    type Id = *mut Object;

    pub fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
        Ok(status_from_raw(raw_calendar_permission_status()))
    }

    pub fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
        let current = status_from_raw(raw_calendar_permission_status());
        if current != CalendarPermissionStatus::NotDetermined {
            return Ok(current);
        }

        unsafe {
            autoreleasepool(|| {
                let store = new_event_store();
                if store.is_null() {
                    return Err("Failed to create EventKit event store".to_string());
                }

                let (sender, receiver) = mpsc::channel();
                let completion = ConcreteBlock::new(move |granted: BOOL, _error: Id| {
                    let _ = sender.send(granted == YES);
                })
                .copy();

                let supports_full_access: BOOL = msg_send![store, respondsToSelector: sel!(requestFullAccessToEventsWithCompletion:)];

                if supports_full_access == YES {
                    let _: () =
                        msg_send![store, requestFullAccessToEventsWithCompletion: &*completion];
                } else {
                    let _: () = msg_send![store, requestAccessToEntityType: EK_ENTITY_TYPE_EVENT completion: &*completion];
                }

                let result = receiver
                    .recv_timeout(Duration::from_secs(120))
                    .map_err(|_| "Timed out waiting for calendar permission response".to_string());

                release_object(store);

                match result {
                    Ok(true) => Ok(CalendarPermissionStatus::FullAccess),
                    Ok(false) => Ok(status_from_raw(raw_calendar_permission_status())),
                    Err(error) => Err(error),
                }
            })
        }
    }

    pub fn upcoming_calendar_events(
        lead_time_minutes: u32,
        include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let start_ms = now_ms - (START_GRACE_SECONDS * 1_000);
        let end_ms = now_ms + i64::from(lead_time_minutes) * 60_000;

        calendar_events_in_range(start_ms, end_ms.max(now_ms + 1), include_all_day_events)
    }

    pub fn calendar_events_in_range(
        start_ms: i64,
        end_ms: i64,
        include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        if !calendar_permission_status()?.can_read_events() {
            return Ok(Vec::new());
        }

        let end_ms = end_ms.max(start_ms + 1);

        unsafe {
            autoreleasepool(|| {
                let store = new_event_store();
                if store.is_null() {
                    return Err("Failed to create EventKit event store".to_string());
                }

                let start_date = nsdate_from_unix_ms(start_ms);
                let end_date = nsdate_from_unix_ms(end_ms);
                let predicate: Id = msg_send![store,
                    predicateForEventsWithStartDate: start_date
                    endDate: end_date
                    calendars: ptr::null_mut::<Object>()
                ];

                let ns_events: Id = msg_send![store, eventsMatchingPredicate: predicate];
                let mut events = Vec::new();

                if !ns_events.is_null() {
                    let count: usize = msg_send![ns_events, count];
                    for index in 0..count {
                        let event: Id = msg_send![ns_events, objectAtIndex: index];
                        if event.is_null() {
                            continue;
                        }

                        let is_all_day: BOOL = msg_send![event, isAllDay];
                        let is_all_day = is_all_day == YES;
                        if is_all_day && !include_all_day_events {
                            continue;
                        }

                        if let Some(calendar_event) = calendar_event_from_ek_event(event) {
                            events.push(calendar_event);
                        }
                    }
                }

                release_object(store);

                events.sort_by_key(|event| event.start_unix_ms);
                Ok(events)
            })
        }
    }

    fn raw_calendar_permission_status() -> i64 {
        unsafe {
            let status: i64 = msg_send![class!(EKEventStore), authorizationStatusForEntityType: EK_ENTITY_TYPE_EVENT];
            status
        }
    }

    fn status_from_raw(status: i64) -> CalendarPermissionStatus {
        match status {
            0 => CalendarPermissionStatus::NotDetermined,
            1 => CalendarPermissionStatus::Restricted,
            2 => CalendarPermissionStatus::Denied,
            3 => CalendarPermissionStatus::FullAccess,
            4 => CalendarPermissionStatus::WriteOnly,
            _ => CalendarPermissionStatus::Unknown,
        }
    }

    unsafe fn new_event_store() -> Id {
        let store: Id = msg_send![class!(EKEventStore), alloc];
        let store: Id = msg_send![store, init];
        store
    }

    unsafe fn release_object(object: Id) {
        if !object.is_null() {
            let _: () = msg_send![object, release];
        }
    }

    unsafe fn nsdate_from_unix_ms(unix_ms: i64) -> Id {
        let seconds = unix_ms as f64 / 1_000.0;
        msg_send![class!(NSDate), dateWithTimeIntervalSince1970: seconds]
    }

    unsafe fn calendar_event_from_ek_event(event: Id) -> Option<CalendarEvent> {
        let title_obj: Id = msg_send![event, title];
        let title = nsstring_to_string(title_obj)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Calendar Meeting".to_string());

        let start_date: Id = msg_send![event, startDate];
        let end_date: Id = msg_send![event, endDate];
        if start_date.is_null() || end_date.is_null() {
            return None;
        }

        let start_unix_ms = nsdate_to_unix_ms(start_date);
        let end_unix_ms = nsdate_to_unix_ms(end_date);

        let id_obj: Id = msg_send![event, eventIdentifier];
        let fallback_id = format!("{}:{}", title, start_unix_ms);
        let id = nsstring_to_string(id_obj)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_id);

        let calendar: Id = msg_send![event, calendar];
        let calendar_title = if calendar.is_null() {
            None
        } else {
            let calendar_title_obj: Id = msg_send![calendar, title];
            nsstring_to_string(calendar_title_obj)
        };

        let is_all_day: BOOL = msg_send![event, isAllDay];
        let is_all_day = is_all_day == YES;

        Some(CalendarEvent {
            id,
            title,
            calendar_title,
            start_unix_ms,
            end_unix_ms,
            is_all_day,
        })
    }

    unsafe fn nsdate_to_unix_ms(date: Id) -> i64 {
        let seconds: f64 = msg_send![date, timeIntervalSince1970];
        (seconds * 1_000.0).round() as i64
    }

    unsafe fn nsstring_to_string(value: Id) -> Option<String> {
        if value.is_null() {
            return None;
        }

        let utf8: *const c_char = msg_send![value, UTF8String];
        if utf8.is_null() {
            return None;
        }

        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{CalendarEvent, CalendarPermissionStatus};

    pub fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
        Ok(CalendarPermissionStatus::Unavailable)
    }

    pub fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
        Ok(CalendarPermissionStatus::Unavailable)
    }

    pub fn upcoming_calendar_events(
        _lead_time_minutes: u32,
        _include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        Ok(Vec::new())
    }

    pub fn calendar_events_in_range(
        _start_unix_ms: i64,
        _end_unix_ms: i64,
        _include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        Ok(Vec::new())
    }
}
