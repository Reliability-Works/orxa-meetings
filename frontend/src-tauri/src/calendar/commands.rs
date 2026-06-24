use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::CalendarAutoStartPreferences;

const CALENDAR_PREFERENCES_STORE: &str = "calendar_auto_start_preferences.json";
const CALENDAR_PREFERENCES_KEY: &str = "preferences";

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

pub(super) async fn get_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CalendarAutoStartPreferences, String> {
    load_calendar_auto_start_preferences(&app)
        .await
        .map_err(|error| format!("Failed to load calendar auto-start preferences: {}", error))
}

pub(super) async fn set_calendar_auto_start_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: CalendarAutoStartPreferences,
) -> Result<(), String> {
    save_calendar_auto_start_preferences(&app, preferences)
        .await
        .map_err(|error| format!("Failed to save calendar auto-start preferences: {}", error))
}

fn normalize_calendar_preferences(preferences: &mut CalendarAutoStartPreferences) {
    preferences.lead_time_minutes = preferences.lead_time_minutes.min(30);
}
