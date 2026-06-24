use std::collections::VecDeque;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::{
    commands::load_calendar_auto_start_preferences, permissions, CalendarAutoStartPayload,
};

const WATCH_INTERVAL_SECONDS: u64 = 30;
const START_GRACE_SECONDS: i64 = 60;

pub(super) fn start_calendar_auto_start_watcher<R>(app: AppHandle<R>)
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

    if !permissions::calendar_permission_status()?.can_read_events() {
        return Ok(());
    }

    if crate::audio::recording_commands::is_recording().await {
        return Ok(());
    }

    let events = permissions::upcoming_calendar_events(
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
        start_recording_for_event(app, seen_event_ids, event).await?;
    }

    Ok(())
}

async fn start_recording_for_event<R: Runtime>(
    app: &AppHandle<R>,
    seen_event_ids: &mut VecDeque<String>,
    event: super::CalendarEvent,
) -> Result<(), String> {
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
            show_recording_started_notification(app, &event).await;
            emit_calendar_auto_recording_started(app, event);
            Ok(())
        }
        Err(error) => {
            crate::tray::update_tray_menu(app);
            Err(format!("Failed to auto-start recording: {}", error))
        }
    }
}

async fn show_recording_started_notification<R: Runtime>(
    app: &AppHandle<R>,
    event: &super::CalendarEvent,
) {
    let notification_manager_state =
        app.state::<crate::notifications::commands::NotificationManagerState<R>>();
    if let Err(error) = crate::notifications::commands::show_recording_started_notification(
        app,
        &notification_manager_state,
        Some(event.title.clone()),
    )
    .await
    {
        log::error!("Failed to show calendar auto-start notification: {}", error);
    }
}

fn emit_calendar_auto_recording_started<R: Runtime>(
    app: &AppHandle<R>,
    event: super::CalendarEvent,
) {
    let payload = CalendarAutoStartPayload {
        event_id: event.id,
        title: event.title,
        calendar_title: event.calendar_title,
        start_unix_ms: event.start_unix_ms,
        end_unix_ms: event.end_unix_ms,
    };
    let _ = app.emit("calendar-auto-recording-started", payload);
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
