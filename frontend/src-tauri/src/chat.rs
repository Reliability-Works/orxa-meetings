use crate::agent_sources::{format_agent_sources_context_for_chat, search_agent_sources_for_chat};
use crate::askorxa::{
    build_extract_answer, format_evidence_line, load_meeting, load_relevant_evidence,
    load_summary_markdown, truncate_chars, AskEvidence, MAX_SUMMARY_CHARS,
};
use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

const CHAT_CONTEXT_SUMMARY_CHARS: usize = MAX_SUMMARY_CHARS;
const CHAT_HISTORY_LIMIT: i64 = 12;
const CHAT_EVIDENCE_LIMIT: usize = 14;

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

#[derive(Debug, Clone)]
struct ResolvedAgentConfig {
    provider: String,
    model: String,
    api_key: String,
    ollama_endpoint: Option<String>,
    custom_endpoint: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}

#[tauri::command]
pub async fn chat_list_sessions(
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, String> {
    list_sessions(state.db_manager.pool(), limit.unwrap_or(80)).await
}

#[tauri::command]
pub async fn chat_create_session(
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

#[tauri::command]
pub async fn chat_get_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<ChatThread, String> {
    let pool = state.db_manager.pool();
    let session = get_session(pool, &session_id).await?;
    let messages = list_messages(pool, &session_id).await?;
    Ok(ChatThread { session, messages })
}

#[tauri::command]
pub async fn chat_send_message<R: Runtime>(
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

    let (answer, evidence, model, warning) = match generate_agent_answer(
        &app, pool, &session, content, &history,
    )
    .await
    {
        Ok((answer, evidence, model)) => (answer, evidence, model, None),
        Err(error) => {
            let evidence = if let Some(meeting_id) = session.meeting_id.as_deref() {
                load_relevant_evidence(pool, meeting_id, content)
                    .await
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            let fallback = if evidence.is_empty() {
                format!(
                    "I could not run the chat agent yet. {}",
                    if session.meeting_id.is_some() {
                        "Try checking the Chat agent model in Settings, or choose a meeting with transcript content."
                    } else {
                        "Choose a meeting under the composer so I have local context to inspect."
                    }
                )
            } else {
                build_extract_answer(content, &evidence)
            };
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

#[tauri::command]
pub async fn chat_get_agent_config(
    state: tauri::State<'_, AppState>,
) -> Result<ChatAgentConfig, String> {
    let pool = state.db_manager.pool();
    let config = load_chat_or_summary_config(pool).await?;
    Ok(config)
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

async fn list_sessions(pool: &SqlitePool, limit: i64) -> Result<Vec<ChatSession>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            s.id,
            s.title,
            s.meeting_id,
            m.title AS meeting_title,
            s.created_at,
            s.updated_at,
            (
                SELECT content
                FROM chat_messages cm
                WHERE cm.session_id = s.id
                ORDER BY cm.created_at DESC
                LIMIT 1
            ) AS last_message
        FROM chat_sessions s
        LEFT JOIN meetings m ON m.id = s.meeting_id
        ORDER BY s.updated_at DESC
        LIMIT ?
        "#,
    )
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list chats: {}", e))?;

    Ok(rows.into_iter().map(row_to_session).collect())
}

async fn create_session(
    pool: &SqlitePool,
    title: Option<String>,
    meeting_id: Option<&str>,
) -> Result<ChatSession, String> {
    let id = format!("chat-{}", Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let title = title
        .map(|value| short_title(&value))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "New chat".to_string());

    sqlx::query(
        r#"
        INSERT INTO chat_sessions (id, title, meeting_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(title)
    .bind(meeting_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create chat: {}", e))?;

    get_session(pool, &id).await
}

async fn get_session(pool: &SqlitePool, session_id: &str) -> Result<ChatSession, String> {
    let row = sqlx::query(
        r#"
        SELECT
            s.id,
            s.title,
            s.meeting_id,
            m.title AS meeting_title,
            s.created_at,
            s.updated_at,
            (
                SELECT content
                FROM chat_messages cm
                WHERE cm.session_id = s.id
                ORDER BY cm.created_at DESC
                LIMIT 1
            ) AS last_message
        FROM chat_sessions s
        LEFT JOIN meetings m ON m.id = s.meeting_id
        WHERE s.id = ?
        LIMIT 1
        "#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load chat: {}", e))?
    .ok_or_else(|| format!("Chat not found: {}", session_id))?;

    Ok(row_to_session(row))
}

async fn set_session_meeting(
    pool: &SqlitePool,
    session_id: &str,
    meeting_id: Option<&str>,
) -> Result<(), String> {
    sqlx::query("UPDATE chat_sessions SET meeting_id = ?, updated_at = ? WHERE id = ?")
        .bind(meeting_id)
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update chat meeting: {}", e))?;
    Ok(())
}

async fn update_session_title(
    pool: &SqlitePool,
    session_id: &str,
    title: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
        .bind(short_title(title))
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update chat title: {}", e))?;
    Ok(())
}

async fn touch_session(pool: &SqlitePool, session_id: &str) -> Result<(), String> {
    sqlx::query("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update chat timestamp: {}", e))?;
    Ok(())
}

async fn list_messages(pool: &SqlitePool, session_id: &str) -> Result<Vec<ChatMessage>, String> {
    let rows = sqlx::query(
        r#"
        SELECT id, session_id, role, content, evidence_json, model, warning, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list chat messages: {}", e))?;

    Ok(rows.into_iter().map(row_to_message).collect())
}

async fn list_recent_messages(
    pool: &SqlitePool,
    session_id: &str,
    limit: i64,
) -> Result<Vec<ChatMessage>, String> {
    let mut rows = sqlx::query(
        r#"
        SELECT id, session_id, role, content, evidence_json, model, warning, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        "#,
    )
    .bind(session_id)
    .bind(limit.clamp(1, 30))
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load chat history: {}", e))?;

    rows.reverse();
    Ok(rows.into_iter().map(row_to_message).collect())
}

async fn insert_message(
    pool: &SqlitePool,
    session_id: &str,
    role: &str,
    content: &str,
    evidence: &[AskEvidence],
    model: Option<String>,
    warning: Option<String>,
) -> Result<ChatMessage, String> {
    let id = format!("msg-{}", Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let evidence_json = if evidence.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(evidence)
                .map_err(|e| format!("Failed to store evidence: {}", e))?,
        )
    };

    sqlx::query(
        r#"
        INSERT INTO chat_messages (id, session_id, role, content, evidence_json, model, warning, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(session_id)
    .bind(role)
    .bind(content)
    .bind(evidence_json)
    .bind(model)
    .bind(warning)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save chat message: {}", e))?;

    sqlx::query(
        "SELECT id, session_id, role, content, evidence_json, model, warning, created_at FROM chat_messages WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map(row_to_message)
    .map_err(|e| format!("Failed to reload chat message: {}", e))
}

async fn generate_agent_answer<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    session: &ChatSession,
    current_message: &str,
    history: &[ChatMessage],
) -> Result<(String, Vec<AskEvidence>, Option<String>), String> {
    let config = resolve_agent_config(pool).await?;
    let provider = LLMProvider::from_str(&config.provider)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let (meeting_context, evidence) = match session.meeting_id.as_deref() {
        Some(meeting_id) => {
            let (loaded_id, title) = load_meeting(pool, meeting_id).await?;
            let summary = load_summary_markdown(pool, meeting_id).await?;
            let evidence = load_relevant_evidence(pool, meeting_id, current_message).await?;
            let context = format_meeting_context(&loaded_id, &title, summary.as_deref(), &evidence);
            (context, evidence)
        }
        None => (format_recent_meetings(pool).await?, Vec::new()),
    };
    let agent_history = search_agent_sources_for_chat(pool, current_message)
        .await
        .unwrap_or_default();
    let agent_history_context = format_agent_sources_context_for_chat(&agent_history);
    let combined_context = format!(
        "{}\n\nIndexed local agent history:\n<agent_history>\n{}\n</agent_history>",
        meeting_context, agent_history_context
    );

    let system_prompt = "You are Orxa's local meeting agent. You help the user reason over their saved meetings, transcripts, summaries, and indexed local agent-session history from enabled sources such as Codex, Claude, Cursor, and local memories. Use only the supplied local context and conversation history. When you use transcript evidence, cite bracketed timestamps such as [12:32]. When you use agent-history context, name the source and session/file title. If the answer is not supported, say what is missing and suggest the exact meeting or Agent Sources index needed. Be practical, precise, and willing to turn meeting discussion into plans and explanations without pretending Orxa is a task manager.";
    let history_block = history
        .iter()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                truncate_chars(&message.content, 2_000)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let user_prompt = format!(
        "Conversation so far:\n<conversation>\n{}\n</conversation>\n\nLocal tools/context available:\n<context>\n{}\n</context>\n\nUser message:\n{}",
        history_block, combined_context, current_message
    );

    let client = Client::new();
    let answer = generate_summary(
        &client,
        &provider,
        &config.model,
        &config.api_key,
        system_prompt,
        &user_prompt,
        config.ollama_endpoint.as_deref(),
        config.custom_endpoint.as_deref(),
        config.max_tokens.or(Some(2048)),
        config.temperature.or(Some(0.25)),
        config.top_p,
        Some(&app_data_dir),
        None,
    )
    .await?;

    Ok((
        answer.trim().to_string(),
        evidence,
        Some(format!("{} / {}", config.provider, config.model)),
    ))
}

async fn resolve_agent_config(pool: &SqlitePool) -> Result<ResolvedAgentConfig, String> {
    let row = sqlx::query(
        "SELECT provider, model, ollamaEndpoint FROM chat_agent_settings WHERE id = '1' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load chat agent settings: {}", e))?;

    let (provider, model, ollama_endpoint) = if let Some(row) = row {
        (
            row.get::<String, _>("provider"),
            row.get::<String, _>("model"),
            row.try_get::<Option<String>, _>("ollamaEndpoint")
                .ok()
                .flatten(),
        )
    } else {
        let summary = SettingsRepository::get_model_config(pool)
            .await
            .map_err(|e| format!("Failed to load summary model settings: {}", e))?
            .ok_or_else(|| "No chat or summary model is configured yet.".to_string())?;
        (summary.provider, summary.model, summary.ollama_endpoint)
    };

    let custom_config = if provider == "custom-openai" {
        SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|e| format!("Failed to load custom OpenAI config: {}", e))?
    } else {
        None
    };
    let api_key = if provider == "custom-openai" {
        custom_config
            .as_ref()
            .and_then(|config| config.api_key.clone())
            .unwrap_or_default()
    } else {
        SettingsRepository::get_api_key(pool, &provider)
            .await
            .map_err(|e| format!("Failed to load chat agent API key: {}", e))?
            .unwrap_or_default()
    };
    let model = custom_config
        .as_ref()
        .map(|config| config.model.clone())
        .unwrap_or(model);
    let custom_endpoint = custom_config.as_ref().map(|config| config.endpoint.clone());
    let max_tokens = custom_config
        .as_ref()
        .and_then(|config| config.max_tokens)
        .and_then(|value| u32::try_from(value).ok());
    let temperature = custom_config.as_ref().and_then(|config| config.temperature);
    let top_p = custom_config.as_ref().and_then(|config| config.top_p);

    Ok(ResolvedAgentConfig {
        provider,
        model,
        api_key,
        ollama_endpoint,
        custom_endpoint,
        max_tokens,
        temperature,
        top_p,
    })
}

async fn load_chat_or_summary_config(pool: &SqlitePool) -> Result<ChatAgentConfig, String> {
    let row = sqlx::query(
        "SELECT provider, model, whisperModel, ollamaEndpoint FROM chat_agent_settings WHERE id = '1' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load chat agent settings: {}", e))?;

    let (provider, model, whisper_model, ollama_endpoint) = if let Some(row) = row {
        (
            row.get::<String, _>("provider"),
            row.get::<String, _>("model"),
            row.try_get::<String, _>("whisperModel").unwrap_or_default(),
            row.try_get::<Option<String>, _>("ollamaEndpoint")
                .ok()
                .flatten(),
        )
    } else {
        let summary = SettingsRepository::get_model_config(pool)
            .await
            .map_err(|e| format!("Failed to load summary model settings: {}", e))?
            .ok_or_else(|| "No summary model is configured yet.".to_string())?;
        (
            summary.provider,
            summary.model,
            summary.whisper_model,
            summary.ollama_endpoint,
        )
    };

    let custom_config = SettingsRepository::get_custom_openai_config(pool)
        .await
        .map_err(|e| format!("Failed to load custom OpenAI config: {}", e))?;
    let api_key = SettingsRepository::get_api_key(pool, &provider)
        .await
        .ok()
        .flatten();

    Ok(ChatAgentConfig {
        provider,
        model,
        whisper_model,
        api_key,
        ollama_endpoint,
        custom_open_ai_endpoint: custom_config.as_ref().map(|config| config.endpoint.clone()),
        custom_open_ai_model: custom_config.as_ref().map(|config| config.model.clone()),
        custom_open_ai_api_key: custom_config
            .as_ref()
            .and_then(|config| config.api_key.clone()),
        max_tokens: custom_config
            .as_ref()
            .and_then(|config| config.max_tokens)
            .map(i64::from),
        temperature: custom_config.as_ref().and_then(|config| config.temperature),
        top_p: custom_config.as_ref().and_then(|config| config.top_p),
    })
}

fn row_to_session(row: sqlx::sqlite::SqliteRow) -> ChatSession {
    ChatSession {
        id: row.get("id"),
        title: row.get("title"),
        meeting_id: row
            .try_get::<Option<String>, _>("meeting_id")
            .ok()
            .flatten(),
        meeting_title: row
            .try_get::<Option<String>, _>("meeting_title")
            .ok()
            .flatten(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        last_message: row
            .try_get::<Option<String>, _>("last_message")
            .ok()
            .flatten(),
    }
}

fn row_to_message(row: sqlx::sqlite::SqliteRow) -> ChatMessage {
    let evidence_json: Option<String> = row.try_get("evidence_json").ok().flatten();
    let evidence = evidence_json
        .and_then(|raw| serde_json::from_str::<Vec<AskEvidence>>(&raw).ok())
        .unwrap_or_default();

    ChatMessage {
        id: row.get("id"),
        session_id: row.get("session_id"),
        role: row.get("role"),
        content: row.get("content"),
        evidence,
        model: row.try_get::<Option<String>, _>("model").ok().flatten(),
        warning: row.try_get::<Option<String>, _>("warning").ok().flatten(),
        created_at: row.get("created_at"),
    }
}

fn format_meeting_context(
    meeting_id: &str,
    title: &str,
    summary: Option<&str>,
    evidence: &[AskEvidence],
) -> String {
    let summary = summary
        .map(|value| truncate_chars(value, CHAT_CONTEXT_SUMMARY_CHARS))
        .unwrap_or_else(|| "No saved summary is available.".to_string());
    let evidence_block = evidence
        .iter()
        .take(CHAT_EVIDENCE_LIMIT)
        .map(format_evidence_line)
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Selected meeting:\n- id: {meeting_id}\n- title: {title}\n\nMeeting summary:\n<summary>\n{summary}\n</summary>\n\nRelevant transcript search results:\n<transcript_evidence>\n{evidence_block}\n</transcript_evidence>"
    )
}

async fn format_recent_meetings(pool: &SqlitePool) -> Result<String, String> {
    let rows = sqlx::query(
        r#"
        SELECT id, title, created_at
        FROM meetings
        ORDER BY created_at DESC
        LIMIT 20
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load recent meetings: {}", e))?;

    let meetings = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let title: String = row.get("title");
            let created_at: String = row.get("created_at");
            format!("- {title} ({id}, {created_at})")
        })
        .collect::<Vec<_>>()
        .join("\n");

    Ok(format!(
        "No meeting is selected for this chat. Recent meetings available for selection:\n{meetings}"
    ))
}

fn short_title(value: &str) -> String {
    let trimmed = value
        .split_whitespace()
        .take(9)
        .collect::<Vec<_>>()
        .join(" ");
    let clipped = truncate_chars(&trimmed, 64);
    if clipped.trim().is_empty() {
        "New chat".to_string()
    } else {
        clipped
    }
}
