use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager, Runtime};

pub(crate) const MAX_SUMMARY_CHARS: usize = 6_000;
const MAX_PROMPT_EVIDENCE: usize = 14;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskEvidence {
    pub transcript_id: String,
    pub timestamp: String,
    pub audio_start_time: Option<f64>,
    pub speaker: Option<String>,
    pub text: String,
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskMeetingResponse {
    pub meeting_id: String,
    pub meeting_title: String,
    pub question: String,
    pub answer: String,
    pub evidence: Vec<AskEvidence>,
    pub generated: bool,
    pub model: Option<String>,
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn ask_orxa_meeting<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    question: String,
) -> Result<AskMeetingResponse, String> {
    let clean_question = question.trim();
    if clean_question.len() < 3 {
        return Err("Meeting queries need a question with at least 3 characters.".to_string());
    }

    let pool = state.db_manager.pool();
    let meeting = load_meeting(pool, &meeting_id).await?;
    let evidence = load_relevant_evidence(pool, &meeting_id, clean_question).await?;
    let summary = load_summary_markdown(pool, &meeting_id).await?;

    let (answer, generated, model, warning) = match generate_answer(
        &app,
        pool,
        &meeting.1,
        clean_question,
        summary.as_deref(),
        &evidence,
    )
    .await
    {
        Ok((answer, model)) => (answer, true, model, None),
        Err(error) => (
            build_extract_answer(clean_question, &evidence),
            false,
            None,
            Some(error),
        ),
    };

    Ok(AskMeetingResponse {
        meeting_id: meeting.0,
        meeting_title: meeting.1,
        question: clean_question.to_string(),
        answer,
        evidence,
        generated,
        model,
        warning,
    })
}

pub(crate) async fn load_meeting(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<(String, String), String> {
    let row = sqlx::query("SELECT id, title FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load meeting: {}", e))?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    Ok((row.get("id"), row.get("title")))
}

pub(crate) async fn load_relevant_evidence(
    pool: &SqlitePool,
    meeting_id: &str,
    question: &str,
) -> Result<Vec<AskEvidence>, String> {
    let rows = sqlx::query(
        r#"
        SELECT id, transcript, timestamp, speaker, audio_start_time
        FROM transcripts
        WHERE meeting_id = ?
        ORDER BY
          CASE WHEN audio_start_time IS NULL THEN 1 ELSE 0 END,
          audio_start_time ASC,
          timestamp ASC
        LIMIT 4000
        "#,
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))?;

    let question_words = keywords(question);
    let mut scored = rows
        .into_iter()
        .map(|row| {
            let text: String = row.get("transcript");
            let score = score_text(&text, &question_words);
            AskEvidence {
                transcript_id: row.get("id"),
                timestamp: row.get("timestamp"),
                audio_start_time: row.try_get("audio_start_time").ok(),
                speaker: row.try_get("speaker").ok(),
                text: text.trim().to_string(),
                score,
            }
        })
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| {
        b.score.cmp(&a.score).then_with(|| {
            a.audio_start_time
                .partial_cmp(&b.audio_start_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });

    let mut relevant = scored
        .iter()
        .filter(|item| item.score > 0)
        .take(18)
        .cloned()
        .collect::<Vec<_>>();

    if relevant.is_empty() {
        relevant = scored.into_iter().take(12).collect();
    }

    relevant.sort_by(|a, b| {
        a.audio_start_time
            .partial_cmp(&b.audio_start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(relevant)
}

async fn generate_answer<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    meeting_title: &str,
    question: &str,
    summary: Option<&str>,
    evidence: &[AskEvidence],
) -> Result<(String, Option<String>), String> {
    let setting = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to load summary model settings: {}", e))?
        .ok_or_else(|| "No summary model is configured yet.".to_string())?;

    let provider = setting.provider.parse::<LLMProvider>()?;
    let api_key = SettingsRepository::get_api_key(pool, &setting.provider)
        .await
        .map_err(|e| format!("Failed to load API key: {}", e))?
        .unwrap_or_default();

    let custom_config = if setting.provider == "custom-openai" {
        setting.get_custom_openai_config()
    } else {
        None
    };
    let model_name = custom_config
        .as_ref()
        .map(|config| config.model.as_str())
        .unwrap_or(setting.model.as_str());
    let custom_endpoint = custom_config.as_ref().map(|config| config.endpoint.clone());
    let max_tokens = custom_config
        .as_ref()
        .and_then(|config| config.max_tokens)
        .and_then(|value| u32::try_from(value).ok())
        .or(Some(900));
    let temperature = custom_config
        .as_ref()
        .and_then(|config| config.temperature)
        .or(Some(0.2));
    let top_p = custom_config.as_ref().and_then(|config| config.top_p);
    let ollama_endpoint = setting.ollama_endpoint.as_deref();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let system_prompt = "You answer questions about one meeting. Use only the supplied summary and transcript evidence. If the answer is not supported, say what is missing. Cite concrete transcript moments with their bracketed timestamps, such as [12:32]. Keep the answer concise and explain meaning or implication only when the evidence supports it.";
    let user_prompt = build_ask_prompt(meeting_title, question, summary, evidence);
    let client = Client::new();

    let answer = generate_summary(
        &client,
        &provider,
        model_name,
        &api_key,
        system_prompt,
        &user_prompt,
        ollama_endpoint,
        custom_endpoint.as_deref(),
        max_tokens,
        temperature,
        top_p,
        Some(&app_data_dir),
        None,
    )
    .await?;

    Ok((
        answer.trim().to_string(),
        Some(format!("{} / {}", setting.provider, model_name)),
    ))
}

pub(crate) async fn load_summary_markdown(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT result FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load meeting summary: {}", e))?;

    let Some(row) = row else {
        return Ok(None);
    };
    let raw: Option<String> = row.try_get("result").ok();
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
        if let Some(markdown) = value.get("markdown").and_then(|v| v.as_str()) {
            return Ok(Some(truncate_chars(markdown, MAX_SUMMARY_CHARS)));
        }
        if let Some(raw_text) = value.get("raw").and_then(|v| v.as_str()) {
            return Ok(Some(truncate_chars(raw_text, MAX_SUMMARY_CHARS)));
        }
        return Ok(Some(truncate_chars(&value.to_string(), MAX_SUMMARY_CHARS)));
    }

    Ok(Some(truncate_chars(&raw, MAX_SUMMARY_CHARS)))
}

fn build_ask_prompt(
    meeting_title: &str,
    question: &str,
    summary: Option<&str>,
    evidence: &[AskEvidence],
) -> String {
    let summary_block = summary.unwrap_or("No saved summary is available for this meeting.");
    let evidence_block = evidence
        .iter()
        .take(MAX_PROMPT_EVIDENCE)
        .map(format_evidence_line)
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Meeting: {meeting_title}\n\nQuestion:\n{question}\n\nSaved summary:\n<summary>\n{summary_block}\n</summary>\n\nTranscript evidence:\n<evidence>\n{evidence_block}\n</evidence>"
    )
}

pub(crate) fn build_extract_answer(question: &str, evidence: &[AskEvidence]) -> String {
    if evidence.is_empty() {
        return format!(
            "I could not find transcript evidence for \"{}\" in this meeting.",
            question
        );
    }

    let bullets = evidence
        .iter()
        .take(6)
        .map(|item| format!("- {}", format_evidence_line(item)))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "I could not generate a model answer, but I found these relevant transcript moments:\n\n{}",
        bullets
    )
}

pub(crate) fn format_evidence_line(item: &AskEvidence) -> String {
    let time = item
        .audio_start_time
        .map(format_seconds)
        .unwrap_or_else(|| item.timestamp.clone());
    let speaker = item
        .speaker
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Unknown");
    format!("[{}] {}: {}", time, speaker, item.text)
}

fn score_text(text: &str, words: &[String]) -> i64 {
    if words.is_empty() {
        return 0;
    }

    let lower = text.to_lowercase();
    words
        .iter()
        .map(|word| if lower.contains(word) { 2 } else { 0 })
        .sum()
}

fn keywords(text: &str) -> Vec<String> {
    let stopwords = [
        "about", "after", "also", "and", "are", "can", "did", "does", "for", "from", "had", "has",
        "have", "how", "into", "is", "it", "me", "of", "on", "or", "said", "say", "that", "the",
        "their", "there", "they", "this", "to", "was", "we", "what", "when", "where", "who", "why",
        "with", "you",
    ];

    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|word| word.trim().to_lowercase())
        .filter(|word| word.len() > 2 && !stopwords.contains(&word.as_str()))
        .take(20)
        .collect()
}

pub(crate) fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value.chars().take(limit).collect::<String>() + "\n..."
}

fn format_seconds(seconds: f64) -> String {
    let total_seconds = seconds.max(0.0).floor() as u64;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{:02}:{:02}", minutes, seconds)
}
