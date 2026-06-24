use log::{error as log_error, info as log_info, warn as log_warn};
use tauri::{AppHandle, Runtime};

use super::types::{Meeting, MeetingCalendarItem, MeetingDetails, MeetingMetadata};
use crate::{
    database::{models::MeetingModel, repositories::meeting::MeetingsRepository},
    state::AppState,
};

pub(super) async fn api_get_meetings<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Vec<Meeting>, String> {
    log_info!(
        "api_get_meetings called with auth_token(native) : {}",
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();

    match MeetingsRepository::get_meetings(pool).await {
        Ok(meeting_models) => {
            log_info!("Successfully got {} meetings", meeting_models.len());
            Ok(meeting_models
                .into_iter()
                .map(|m| Meeting {
                    id: m.id,
                    title: m.title,
                })
                .collect())
        }
        Err(e) => {
            log_error!("Error getting meetings: {}", e);
            Err(e.to_string())
        }
    }
}

pub(super) async fn api_get_meeting_calendar_items<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MeetingCalendarItem>, String> {
    log_info!("api_get_meeting_calendar_items called");
    let pool = state.db_manager.pool();

    sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<f64>, i64)>(
        r#"
        SELECT
            m.id,
            m.title,
            m.created_at,
            m.updated_at,
            m.folder_path,
            MAX(COALESCE(t.audio_end_time, t.audio_start_time, t.duration)) AS recording_duration_seconds,
            COUNT(t.id) AS transcript_count
        FROM meetings m
        LEFT JOIN transcripts t ON t.meeting_id = m.id
        GROUP BY m.id, m.title, m.created_at, m.updated_at, m.folder_path
        ORDER BY m.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(
                |(
                    id,
                    title,
                    created_at,
                    updated_at,
                    folder_path,
                    recording_duration_seconds,
                    transcript_count,
                )| MeetingCalendarItem {
                    id,
                    title,
                    created_at,
                    updated_at,
                    folder_path,
                    recording_duration_seconds,
                    transcript_count,
                },
            )
            .collect()
    })
    .map_err(|error| {
        log_error!("Failed to load meeting calendar items: {}", error);
        format!("Failed to load meeting calendar items: {}", error)
    })
}

pub(super) async fn api_delete_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_delete_meeting called for meeting_id(native): {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();
    match MeetingsRepository::delete_meeting(pool, &meeting_id).await {
        Ok(true) => {
            log_info!("Successfully deleted meeting {}", meeting_id);
            Ok(serde_json::json!({
                "status": "success",
                "message": "Meeting deleted successfully"
            }))
        }
        Ok(false) => {
            log_warn!("Meeting not found or already deleted: {}", meeting_id);
            Err(format!(
                "Meeting not found or could not be deleted: {}",
                meeting_id
            ))
        }
        Err(e) => {
            log_error!("Error deleting meeting {}: {}", meeting_id, e);
            Err(format!("Failed to delete meeting: {}", e))
        }
    }
}

pub(super) async fn api_get_meeting<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<MeetingDetails, String> {
    log_info!(
        "api_get_meeting called(native) for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();
    match MeetingsRepository::get_meeting(pool, &meeting_id).await {
        Ok(Some(meeting)) => {
            log_info!("Successfully retrieved meeting {}", meeting_id);
            Ok(meeting)
        }
        Ok(None) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error retrieving meeting {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve meeting: {}", e))
        }
    }
}

pub(super) async fn api_get_meeting_metadata<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<MeetingMetadata, String> {
    log_info!(
        "api_get_meeting_metadata called for meeting_id: {}",
        meeting_id
    );

    let pool = state.db_manager.pool();
    match MeetingsRepository::get_meeting_metadata(pool, &meeting_id).await {
        Ok(Some(meeting)) => {
            log_info!("Successfully retrieved meeting metadata {}", meeting_id);
            Ok(MeetingMetadata {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at.0.to_rfc3339(),
                updated_at: meeting.updated_at.0.to_rfc3339(),
                folder_path: meeting.folder_path,
            })
        }
        Ok(None) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error retrieving meeting metadata {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve meeting metadata: {}", e))
        }
    }
}

pub(super) async fn api_save_meeting_title<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    title: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_title called for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();

    match MeetingsRepository::update_meeting_title(pool, &meeting_id, &title).await {
        Ok(true) => {
            log_info!("Successfully saved meeting title");
            Ok(serde_json::json!({"message": "Meeting title saved successfully"}))
        }
        Ok(false) => {
            log_error!("No meeting found with id {}", meeting_id);
            Err(format!("No meeting found with id {}", meeting_id))
        }
        Err(e) => {
            log_error!("Failed to update meeting {}", e);
            Err(format!("Failed to update meeting: {}", e))
        }
    }
}

pub(super) async fn open_meeting_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    log_info!("open_meeting_folder called for meeting_id: {}", meeting_id);
    let pool = state.db_manager.pool();

    let meeting: Option<MeetingModel> = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    match meeting {
        Some(m) => open_folder_for_meeting(&meeting_id, m.folder_path),
        None => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err("Meeting not found".to_string())
        }
    }
}

fn open_folder_for_meeting(meeting_id: &str, folder_path: Option<String>) -> Result<(), String> {
    let Some(folder_path) = folder_path else {
        log_warn!("Meeting {} has no folder_path set", meeting_id);
        return Err("Recording folder path not available for this meeting".to_string());
    };

    log_info!("Opening meeting folder: {}", folder_path);

    let path = std::path::Path::new(&folder_path);
    if !path.exists() {
        log_warn!("Folder path does not exist: {}", folder_path);
        return Err(format!("Recording folder not found: {}", folder_path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    log_info!("Successfully opened folder: {}", folder_path);
    Ok(())
}
