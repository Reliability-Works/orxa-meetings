use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::askorxa::{truncate_chars, AskEvidence};

use super::{ChatMessage, ChatSession};

pub(super) async fn list_sessions(
    pool: &SqlitePool,
    limit: i64,
) -> Result<Vec<ChatSession>, String> {
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

pub(super) async fn create_session(
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

pub(super) async fn get_session(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<ChatSession, String> {
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

pub(super) async fn set_session_meeting(
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

pub(super) async fn update_session_title(
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

pub(super) async fn touch_session(pool: &SqlitePool, session_id: &str) -> Result<(), String> {
    sqlx::query("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update chat timestamp: {}", e))?;
    Ok(())
}

pub(super) async fn list_messages(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<ChatMessage>, String> {
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

pub(super) async fn list_recent_messages(
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

pub(super) async fn insert_message(
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

pub(super) fn short_title(value: &str) -> String {
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
