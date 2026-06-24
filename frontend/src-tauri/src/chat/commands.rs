use chrono::Utc;
use tauri::{AppHandle, Runtime};

use crate::{
    askorxa::{build_extract_answer, load_meeting, load_relevant_evidence},
    database::repositories::setting::SettingsRepository,
    state::AppState,
};

use super::{
    agent_context::{generate_agent_answer, load_chat_or_summary_config},
    storage::{
        create_session, get_session, insert_message, list_messages, list_recent_messages,
        list_sessions, set_session_meeting, short_title, touch_session, update_session_title,
    },
    ChatAgentConfig, ChatSendResponse, ChatSession, ChatThread,
};

const CHAT_HISTORY_LIMIT: i64 = 12;

pub(super) async fn chat_list_sessions(
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, String> {
    list_sessions(state.db_manager.pool(), limit.unwrap_or(80)).await
}

pub(super) async fn chat_create_session(
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
) -> Result<ChatSession, String> {
    let pool = state.db_manager.pool();
    let title = if let Some(meeting_id) = meeting_id.as_deref() {
        load_meeting(pool, meeting_id)
            .await
            .map(|(_, title)| title)
            .unwrap_or_else(|_| "New chat".to_string())
    } else {
        "New chat".to_string()
    };
    create_session(pool, Some(title), meeting_id.as_deref()).await
}

pub(super) async fn chat_get_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<ChatThread, String> {
    let pool = state.db_manager.pool();
    let session = get_session(pool, &session_id).await?;
    let messages = list_messages(pool, &session_id).await?;
    Ok(ChatThread { session, messages })
}

pub(super) async fn chat_send_message<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
    meeting_id: Option<String>,
    message: String,
) -> Result<ChatSendResponse, String> {
    let content = message.trim();
    if content.len() < 2 {
        return Err("Type a slightly longer message.".to_string());
    }

    let pool = state.db_manager.pool();
    let mut session = match session_id.as_deref().filter(|id| !id.trim().is_empty()) {
        Some(id) => get_session(pool, id).await?,
        None => {
            let title = short_title(content);
            create_session(pool, Some(title), meeting_id.as_deref()).await?
        }
    };

    if meeting_id != session.meeting_id {
        set_session_meeting(pool, &session.id, meeting_id.as_deref()).await?;
        session.meeting_id = meeting_id.clone();
        session.meeting_title = if let Some(id) = meeting_id.as_deref() {
            load_meeting(pool, id).await.ok().map(|(_, title)| title)
        } else {
            None
        };
    }

    if session.title == "New chat" {
        update_session_title(pool, &session.id, &short_title(content)).await?;
    }

    let user_message = insert_message(pool, &session.id, "user", content, &[], None, None).await?;
    let history = list_recent_messages(pool, &session.id, CHAT_HISTORY_LIMIT).await?;

    let (answer, evidence, model, warning) =
        match generate_agent_answer(&app, pool, &session, content, &history).await {
            Ok((answer, evidence, model)) => (answer, evidence, model, None),
            Err(error) => {
                let evidence =
                    fallback_evidence(pool, session.meeting_id.as_deref(), content).await;
                let fallback = fallback_answer(session.meeting_id.is_some(), content, &evidence);
                (fallback, evidence, None, Some(error))
            }
        };

    let assistant_message = insert_message(
        pool,
        &session.id,
        "assistant",
        &answer,
        &evidence,
        model,
        warning,
    )
    .await?;
    touch_session(pool, &session.id).await?;
    session = get_session(pool, &session.id).await?;

    Ok(ChatSendResponse {
        session,
        user_message,
        assistant_message,
    })
}

pub(super) async fn chat_get_agent_config(
    state: tauri::State<'_, AppState>,
) -> Result<ChatAgentConfig, String> {
    load_chat_or_summary_config(state.db_manager.pool()).await
}

pub(super) async fn chat_save_agent_config(
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
) -> Result<ChatAgentConfig, String> {
    let pool = state.db_manager.pool();
    if let Some(api_key) = api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if provider != "builtin-ai" && provider != "custom-openai" {
            SettingsRepository::save_api_key(pool, provider.trim(), api_key)
                .await
                .map_err(|e| format!("Failed to save chat agent API key: {}", e))?;
        }
    }

    sqlx::query(
        r#"
        INSERT INTO chat_agent_settings (id, provider, model, whisperModel, ollamaEndpoint, updated_at)
        VALUES ('1', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            whisperModel = excluded.whisperModel,
            ollamaEndpoint = excluded.ollamaEndpoint,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(provider.trim())
    .bind(model.trim())
    .bind(whisper_model.trim())
    .bind(ollama_endpoint.as_deref().filter(|value| !value.trim().is_empty()))
    .bind(Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save chat agent settings: {}", e))?;

    load_chat_or_summary_config(pool).await
}

async fn fallback_evidence(
    pool: &sqlx::SqlitePool,
    meeting_id: Option<&str>,
    content: &str,
) -> Vec<crate::askorxa::AskEvidence> {
    let Some(meeting_id) = meeting_id else {
        return Vec::new();
    };
    load_relevant_evidence(pool, meeting_id, content)
        .await
        .unwrap_or_default()
}

fn fallback_answer(
    has_meeting: bool,
    content: &str,
    evidence: &[crate::askorxa::AskEvidence],
) -> String {
    if !evidence.is_empty() {
        return build_extract_answer(content, evidence);
    }

    format!(
        "I could not run the chat agent yet. {}",
        if has_meeting {
            "Try checking the Chat agent model in Settings, or choose a meeting with transcript content."
        } else {
            "Choose a meeting under the composer so I have local context to inspect."
        }
    )
}
