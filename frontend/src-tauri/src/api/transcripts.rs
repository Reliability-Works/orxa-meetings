use log::{debug as log_debug, error as log_error, info as log_info};
use tauri::{AppHandle, Runtime};

use super::types::{
    MeetingTranscript, PaginatedTranscriptsResponse, TranscriptDeleteResult,
    TranscriptSearchResult, TranscriptSegment, TranscriptTrimResult,
};
use crate::{
    database::repositories::{meeting::MeetingsRepository, transcript::TranscriptsRepository},
    state::AppState,
};

pub(super) async fn api_search_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
    auth_token: Option<String>,
) -> Result<Vec<TranscriptSearchResult>, String> {
    log_info!(
        "api_search_transcripts called with query: '{}', auth_token: {}",
        query,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();
    match TranscriptsRepository::search_transcripts(pool, &query).await {
        Ok(results) => {
            log_info!(
                "Search completed successfully with {} results.",
                results.len()
            );
            Ok(results)
        }
        Err(e) => {
            log_error!("Error searching transcripts for query '{}': {}", query, e);
            Err(format!("Failed to search transcripts: {}", e))
        }
    }
}

pub(super) async fn api_get_meeting_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    limit: i64,
    offset: i64,
    state: tauri::State<'_, AppState>,
) -> Result<PaginatedTranscriptsResponse, String> {
    log_info!(
        "api_get_meeting_transcripts called for meeting_id: {}, limit: {}, offset: {}",
        meeting_id,
        limit,
        offset
    );

    let pool = state.db_manager.pool();
    match MeetingsRepository::get_meeting_transcripts_paginated(pool, &meeting_id, limit, offset)
        .await
    {
        Ok((transcripts, total_count)) => {
            log_info!(
                "Successfully retrieved {} transcripts for meeting {} (total: {})",
                transcripts.len(),
                meeting_id,
                total_count
            );

            let meeting_transcripts = transcripts
                .into_iter()
                .map(|t| MeetingTranscript {
                    id: t.id,
                    text: t.transcript,
                    timestamp: t.timestamp,
                    speaker: t.speaker,
                    audio_start_time: t.audio_start_time,
                    audio_end_time: t.audio_end_time,
                    duration: t.duration,
                })
                .collect::<Vec<_>>();

            let has_more = (offset + meeting_transcripts.len() as i64) < total_count;
            Ok(PaginatedTranscriptsResponse {
                transcripts: meeting_transcripts,
                total_count,
                has_more,
            })
        }
        Err(e) => {
            log_error!(
                "Error retrieving transcripts for meeting {}: {}",
                meeting_id,
                e
            );
            Err(format!("Failed to retrieve transcripts: {}", e))
        }
    }
}

pub(super) async fn api_preview_trim_meeting_transcript<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    cutoff_seconds: f64,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptTrimResult, String> {
    log_info!(
        "api_preview_trim_meeting_transcript called for meeting_id: {}, cutoff_seconds: {}",
        meeting_id,
        cutoff_seconds
    );

    let pool = state.db_manager.pool();
    MeetingsRepository::preview_trim_transcript(pool, &meeting_id, cutoff_seconds)
        .await
        .map_err(|e| {
            log_error!(
                "Failed to preview transcript trim for meeting {}: {}",
                meeting_id,
                e
            );
            format!("Failed to preview transcript trim: {}", e)
        })
}

pub(super) async fn api_trim_meeting_transcript<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    cutoff_seconds: f64,
    confirm: bool,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptTrimResult, String> {
    log_info!(
        "api_trim_meeting_transcript called for meeting_id: {}, cutoff_seconds: {}, confirm: {}",
        meeting_id,
        cutoff_seconds,
        confirm
    );

    if !confirm {
        return Err("Transcript trim requires confirm=true.".to_string());
    }

    let pool = state.db_manager.pool();
    MeetingsRepository::trim_transcript_after(pool, &meeting_id, cutoff_seconds)
        .await
        .map_err(|e| {
            log_error!(
                "Failed to trim transcript for meeting {}: {}",
                meeting_id,
                e
            );
            format!("Failed to trim transcript: {}", e)
        })
}

pub(super) async fn api_trim_meeting_transcript_from_segment<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    transcript_id: String,
    confirm: bool,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptTrimResult, String> {
    log_info!(
        "api_trim_meeting_transcript_from_segment called for meeting_id: {}, transcript_id: {}, confirm: {}",
        meeting_id,
        transcript_id,
        confirm
    );

    if !confirm {
        return Err("Transcript trim requires confirm=true.".to_string());
    }

    let pool = state.db_manager.pool();
    MeetingsRepository::trim_transcript_from_segment(pool, &meeting_id, &transcript_id)
        .await
        .map_err(|e| {
            log_error!(
                "Failed to trim transcript from segment {} for meeting {}: {}",
                transcript_id,
                meeting_id,
                e
            );
            format!("Failed to trim transcript: {}", e)
        })
}

pub(super) async fn api_delete_meeting_transcript_segment<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    transcript_id: String,
    confirm: bool,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptDeleteResult, String> {
    log_info!(
        "api_delete_meeting_transcript_segment called for meeting_id: {}, transcript_id: {}, confirm: {}",
        meeting_id,
        transcript_id,
        confirm
    );

    if !confirm {
        return Err("Transcript deletion requires confirm=true.".to_string());
    }

    let pool = state.db_manager.pool();
    MeetingsRepository::delete_transcript_segment(pool, &meeting_id, &transcript_id)
        .await
        .map_err(|e| {
            log_error!(
                "Failed to delete transcript segment {} for meeting {}: {}",
                transcript_id,
                meeting_id,
                e
            );
            format!("Failed to delete transcript segment: {}", e)
        })
}

pub(super) async fn api_save_transcript<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_title: String,
    transcripts: Vec<serde_json::Value>,
    folder_path: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript called for meeting: {}, transcripts: {}, folder_path: {:?}, auth_token: {}",
        meeting_title,
        transcripts.len(),
        folder_path,
        auth_token.is_some()
    );

    if let Some(first) = transcripts.first() {
        log_debug!(
            "First transcript data: {}",
            serde_json::to_string_pretty(first).unwrap_or_default()
        );
    }

    let transcripts_to_save: Vec<TranscriptSegment> = transcripts
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            log_error!("Failed to parse transcript segments: {}", e);
            format!(
                "Invalid transcript data format: {}. Please check the data structure.",
                e
            )
        })?;

    if let Some(first_seg) = transcripts_to_save.first() {
        log_debug!(
            "First parsed segment: text='{}', audio_start_time={:?}, audio_end_time={:?}, duration={:?}",
            first_seg.text.chars().take(50).collect::<String>(),
            first_seg.audio_start_time,
            first_seg.audio_end_time,
            first_seg.duration
        );
    }

    let pool = state.db_manager.pool();
    match TranscriptsRepository::save_transcript(
        pool,
        &meeting_title,
        &transcripts_to_save,
        folder_path,
    )
    .await
    {
        Ok(meeting_id) => {
            log_info!(
                "Successfully saved transcript and created meeting with id: {}",
                meeting_id
            );
            Ok(serde_json::json!({
                "status": "success",
                "message": "Transcript saved successfully",
                "meeting_id": meeting_id
            }))
        }
        Err(e) => {
            log_error!(
                "Error saving transcript for meeting '{}': {}",
                meeting_title,
                e
            );
            Err(format!("Failed to save transcript: {}", e))
        }
    }
}
