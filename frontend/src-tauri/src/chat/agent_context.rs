use reqwest::Client;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager, Runtime};

use crate::{
    agent_sources::{format_agent_sources_context_for_chat, search_agent_sources_for_chat},
    askorxa::{
        format_evidence_line, load_meeting, load_relevant_evidence, load_summary_markdown,
        truncate_chars, AskEvidence, MAX_SUMMARY_CHARS,
    },
    database::repositories::setting::SettingsRepository,
    summary::llm_client::{generate_summary, LLMProvider},
};

use super::{ChatAgentConfig, ChatMessage, ChatSession};

const CHAT_CONTEXT_SUMMARY_CHARS: usize = MAX_SUMMARY_CHARS;
const CHAT_EVIDENCE_LIMIT: usize = 14;

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

pub(super) async fn generate_agent_answer<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    session: &ChatSession,
    current_message: &str,
    history: &[ChatMessage],
) -> Result<(String, Vec<AskEvidence>, Option<String>), String> {
    let config = resolve_agent_config(pool).await?;
    let provider = config.provider.parse::<LLMProvider>()?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let (meeting_context, evidence) =
        load_context_for_session(pool, session, current_message).await?;
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

pub(super) async fn load_chat_or_summary_config(
    pool: &SqlitePool,
) -> Result<ChatAgentConfig, String> {
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

async fn load_context_for_session(
    pool: &SqlitePool,
    session: &ChatSession,
    current_message: &str,
) -> Result<(String, Vec<AskEvidence>), String> {
    match session.meeting_id.as_deref() {
        Some(meeting_id) => {
            let (loaded_id, title) = load_meeting(pool, meeting_id).await?;
            let summary = load_summary_markdown(pool, meeting_id).await?;
            let evidence = load_relevant_evidence(pool, meeting_id, current_message).await?;
            let context = format_meeting_context(&loaded_id, &title, summary.as_deref(), &evidence);
            Ok((context, evidence))
        }
        None => Ok((format_recent_meetings(pool).await?, Vec::new())),
    }
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
