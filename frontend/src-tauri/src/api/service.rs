#[path = "client.rs"]
mod client;
#[path = "config.rs"]
mod config;
#[path = "custom_openai.rs"]
mod custom_openai;
#[path = "meetings.rs"]
mod meetings;
#[path = "profile.rs"]
mod profile;
#[path = "transcripts.rs"]
mod transcripts;
#[path = "types.rs"]
mod types;

use tauri::{AppHandle, Runtime};

use crate::{state::AppState, summary::CustomOpenAIConfig};

pub use types::*;

#[tauri::command]
pub async fn api_get_meetings<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Vec<Meeting>, String> {
    meetings::api_get_meetings(app, state, auth_token).await
}

#[tauri::command]
pub async fn api_get_meeting_calendar_items<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MeetingCalendarItem>, String> {
    meetings::api_get_meeting_calendar_items(app, state).await
}

#[tauri::command]
pub async fn api_search_transcripts<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
    auth_token: Option<String>,
) -> Result<Vec<TranscriptSearchResult>, String> {
    transcripts::api_search_transcripts(app, state, query, auth_token).await
}

#[tauri::command]
pub async fn api_get_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    auth_token: Option<String>,
) -> Result<Profile, String> {
    profile::api_get_profile(app, email, license_key, auth_token).await
}

#[tauri::command]
pub async fn api_save_profile<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    email: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    profile::api_save_profile(app, id, email, auth_token).await
}

#[tauri::command]
pub async fn api_update_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    company: String,
    position: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    profile::api_update_profile(app, email, license_key, company, position, auth_token).await
}

#[tauri::command]
pub async fn api_get_model_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<ModelConfig>, String> {
    config::api_get_model_config(app, state, auth_token).await
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri IPC command preserves the persisted model configuration payload"
)]
pub async fn api_save_model_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    config::api_save_model_config(
        app,
        state,
        provider,
        model,
        whisper_model,
        api_key,
        ollama_endpoint,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_get_api_key<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<String, String> {
    config::api_get_api_key(app, state, provider, auth_token).await
}

#[tauri::command]
pub async fn api_get_transcript_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Option<TranscriptConfig>, String> {
    config::api_get_transcript_config(app, state, auth_token).await
}

#[tauri::command]
pub async fn api_save_transcript_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    config::api_save_transcript_config(app, state, provider, model, api_key, auth_token).await
}

#[tauri::command]
pub async fn api_get_transcript_api_key<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<String, String> {
    config::api_get_transcript_api_key(app, state, provider, auth_token).await
}

#[tauri::command]
pub async fn api_delete_api_key<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    config::api_delete_api_key(app, state, provider, auth_token).await
}

#[tauri::command]
pub async fn api_delete_meeting<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    meetings::api_delete_meeting(app, state, meeting_id, auth_token).await
}

#[tauri::command]
pub async fn api_get_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<MeetingDetails, String> {
    meetings::api_get_meeting(app, meeting_id, state, auth_token).await
}

#[tauri::command]
pub async fn api_get_meeting_metadata<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<MeetingMetadata, String> {
    meetings::api_get_meeting_metadata(app, meeting_id, state).await
}

#[tauri::command]
pub async fn api_get_meeting_transcripts<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    limit: i64,
    offset: i64,
    state: tauri::State<'_, AppState>,
) -> Result<PaginatedTranscriptsResponse, String> {
    transcripts::api_get_meeting_transcripts(app, meeting_id, limit, offset, state).await
}

#[tauri::command]
pub async fn api_preview_trim_meeting_transcript<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    cutoff_seconds: f64,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptTrimResult, String> {
    transcripts::api_preview_trim_meeting_transcript(app, meeting_id, cutoff_seconds, state).await
}

#[tauri::command]
pub async fn api_trim_meeting_transcript<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    cutoff_seconds: f64,
    confirm: bool,
    state: tauri::State<'_, AppState>,
) -> Result<TranscriptTrimResult, String> {
    transcripts::api_trim_meeting_transcript(app, meeting_id, cutoff_seconds, confirm, state).await
}

#[tauri::command]
pub async fn api_save_meeting_title<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    title: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    meetings::api_save_meeting_title(app, state, meeting_id, title, auth_token).await
}

#[tauri::command]
pub async fn api_save_transcript<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_title: String,
    transcripts: Vec<serde_json::Value>,
    folder_path: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    transcripts::api_save_transcript(
        app,
        state,
        meeting_title,
        transcripts,
        folder_path,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn open_meeting_folder<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    meetings::open_meeting_folder(app, state, meeting_id).await
}

#[tauri::command]
pub async fn test_backend_connection<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<String, String> {
    client::test_backend_connection(app, auth_token).await
}

#[tauri::command]
pub async fn debug_backend_connection<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    client::debug_backend_connection(app).await
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    client::open_external_url(url).await
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri IPC command preserves the custom OpenAI configuration payload"
)]
pub async fn api_save_custom_openai_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> Result<serde_json::Value, String> {
    custom_openai::api_save_custom_openai_config(
        app,
        state,
        endpoint,
        api_key,
        model,
        max_tokens,
        temperature,
        top_p,
    )
    .await
}

#[tauri::command]
pub async fn api_get_custom_openai_config<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<CustomOpenAIConfig>, String> {
    custom_openai::api_get_custom_openai_config(app, state).await
}

#[tauri::command]
pub async fn api_test_custom_openai_connection<R: Runtime>(
    app: AppHandle<R>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
) -> Result<serde_json::Value, String> {
    custom_openai::api_test_custom_openai_connection(app, endpoint, api_key, model).await
}
