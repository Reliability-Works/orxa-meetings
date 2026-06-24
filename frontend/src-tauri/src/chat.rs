mod agent_context;
mod commands;
mod storage;

use crate::{askorxa::AskEvidence, state::AppState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub meeting_id: Option<String>,
    pub meeting_title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub evidence: Vec<AskEvidence>,
    pub model: Option<String>,
    pub warning: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatThread {
    pub session: ChatSession,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentConfig {
    pub provider: String,
    pub model: String,
    pub whisper_model: String,
    pub api_key: Option<String>,
    pub ollama_endpoint: Option<String>,
    #[serde(rename = "customOpenAIEndpoint")]
    pub custom_open_ai_endpoint: Option<String>,
    #[serde(rename = "customOpenAIModel")]
    pub custom_open_ai_model: Option<String>,
    #[serde(rename = "customOpenAIApiKey")]
    pub custom_open_ai_api_key: Option<String>,
    pub max_tokens: Option<i64>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSendResponse {
    pub session: ChatSession,
    pub user_message: ChatMessage,
    pub assistant_message: ChatMessage,
}

#[tauri::command]
pub async fn chat_list_sessions(
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, String> {
    commands::chat_list_sessions(state, limit).await
}

#[tauri::command]
pub async fn chat_create_session(
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
) -> Result<ChatSession, String> {
    commands::chat_create_session(state, meeting_id).await
}

#[tauri::command]
pub async fn chat_get_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<ChatThread, String> {
    commands::chat_get_session(state, session_id).await
}

#[tauri::command]
pub async fn chat_send_message<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
    meeting_id: Option<String>,
    message: String,
) -> Result<ChatSendResponse, String> {
    commands::chat_send_message(app, state, session_id, meeting_id, message).await
}

#[tauri::command]
pub async fn chat_get_agent_config(
    state: tauri::State<'_, AppState>,
) -> Result<ChatAgentConfig, String> {
    commands::chat_get_agent_config(state).await
}

#[tauri::command]
pub async fn chat_save_agent_config(
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
) -> Result<ChatAgentConfig, String> {
    commands::chat_save_agent_config(
        state,
        provider,
        model,
        whisper_model,
        api_key,
        ollama_endpoint,
    )
    .await
}
