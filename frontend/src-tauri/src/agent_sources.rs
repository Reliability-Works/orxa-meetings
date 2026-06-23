use crate::state::AppState;
use chrono::{DateTime, NaiveDate, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_SCAN_FILES_PER_SOURCE: usize = 1_500;
const MAX_RECURSION_DEPTH: usize = 8;
const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_INDEXED_CHARS: usize = 120_000;
const CHAT_AGENT_HISTORY_LIMIT: i64 = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSourceConfig {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub paths: Vec<String>,
    pub index_full_content: bool,
    pub discovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSourceSearchResult {
    pub id: String,
    pub source_id: String,
    pub source_label: String,
    pub title: String,
    pub path: String,
    pub project_path: Option<String>,
    pub session_date: Option<String>,
    pub modified_at: String,
    pub snippet: String,
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSourceReindexResult {
    pub scanned_files: usize,
    pub indexed_documents: usize,
    pub skipped_files: usize,
    pub sources: usize,
}

#[derive(Debug, Clone)]
struct IndexedDocument {
    source_id: String,
    source_label: String,
    title: String,
    path: String,
    project_path: Option<String>,
    session_date: Option<String>,
    modified_at: String,
    content: String,
    summary: String,
}

#[tauri::command]
pub async fn agent_sources_get_config(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceConfig>, String> {
    let pool = state.db_manager.pool();
    ensure_schema(pool).await?;
    load_config(pool).await
}

#[tauri::command]
pub async fn agent_sources_save_config(
    sources: Vec<AgentSourceConfig>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceConfig>, String> {
    let pool = state.db_manager.pool();
    ensure_schema(pool).await?;
    save_config(pool, &sources).await?;
    load_config(pool).await
}

#[tauri::command]
pub async fn agent_sources_reindex(
    state: tauri::State<'_, AppState>,
) -> Result<AgentSourceReindexResult, String> {
    let pool = state.db_manager.pool();
    ensure_schema(pool).await?;
    let sources = load_config(pool).await?;
    reindex_sources(pool, &sources).await
}

#[tauri::command]
pub async fn agent_sources_search(
    query: String,
    source_ids: Option<Vec<String>>,
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let pool = state.db_manager.pool();
    ensure_schema(pool).await?;
    search_sources(pool, &query, source_ids.as_deref(), limit.unwrap_or(30)).await
}

#[tauri::command]
pub async fn agent_sources_activity_on(
    day: String,
    source_ids: Option<Vec<String>>,
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let pool = state.db_manager.pool();
    ensure_schema(pool).await?;
    activity_on(pool, &day, source_ids.as_deref(), limit.unwrap_or(50)).await
}

pub async fn search_agent_sources_for_chat(
    pool: &SqlitePool,
    query: &str,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    ensure_schema(pool).await?;
    search_sources(pool, query, None, CHAT_AGENT_HISTORY_LIMIT).await
}

pub fn format_agent_sources_context_for_chat(results: &[AgentSourceSearchResult]) -> String {
    if results.is_empty() {
        return "No indexed local agent history matched this message. Ask the user to enable and reindex Agent Sources if prior coding-session context is needed.".to_string();
    }

    results
        .iter()
        .map(|result| {
            format!(
                "- [{}] {} ({})\n  path: {}\n  project: {}\n  excerpt: {}",
                result.source_label,
                result.title,
                result
                    .session_date
                    .as_deref()
                    .unwrap_or(result.modified_at.as_str()),
                result.path,
                result.project_path.as_deref().unwrap_or("unknown"),
                compact_whitespace(&result.snippet)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_source_configs (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            paths_json TEXT NOT NULL,
            index_full_content INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create agent source config table: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_source_documents (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_label TEXT NOT NULL,
            title TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            project_path TEXT,
            session_date TEXT,
            modified_at TEXT NOT NULL,
            content TEXT NOT NULL,
            summary TEXT NOT NULL,
            indexed_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create agent source document table: {}", e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_agent_source_documents_source ON agent_source_documents(source_id, modified_at)")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create agent source index: {}", e))?;

    Ok(())
}

async fn load_config(pool: &SqlitePool) -> Result<Vec<AgentSourceConfig>, String> {
    let defaults = default_sources();
    let rows = sqlx::query(
        "SELECT id, label, enabled, paths_json, index_full_content FROM agent_source_configs",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load agent source settings: {}", e))?;

    let mut saved = rows
        .into_iter()
        .filter_map(|row| {
            let paths_json: String = row.get("paths_json");
            let paths = serde_json::from_str::<Vec<String>>(&paths_json).ok()?;
            Some(AgentSourceConfig {
                id: row.get("id"),
                label: row.get("label"),
                enabled: row.get::<i64, _>("enabled") != 0,
                paths,
                index_full_content: row.get::<i64, _>("index_full_content") != 0,
                discovered: false,
            })
        })
        .collect::<Vec<_>>();

    let saved_ids = saved
        .iter()
        .map(|source| source.id.clone())
        .collect::<HashSet<_>>();
    for default in defaults {
        if !saved_ids.contains(&default.id) {
            saved.push(default);
        }
    }

    for source in &mut saved {
        source.discovered = source.paths.iter().any(|path| expand_path(path).exists());
    }

    Ok(saved)
}

async fn save_config(pool: &SqlitePool, sources: &[AgentSourceConfig]) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for source in sources {
        let paths_json = serde_json::to_string(&source.paths)
            .map_err(|e| format!("Failed to serialize agent source paths: {}", e))?;
        sqlx::query(
            r#"
            INSERT INTO agent_source_configs
                (id, label, enabled, paths_json, index_full_content, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                enabled = excluded.enabled,
                paths_json = excluded.paths_json,
                index_full_content = excluded.index_full_content,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&source.id)
        .bind(&source.label)
        .bind(if source.enabled { 1_i64 } else { 0_i64 })
        .bind(paths_json)
        .bind(if source.index_full_content {
            1_i64
        } else {
            0_i64
        })
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save agent source {}: {}", source.label, e))?;
    }
    Ok(())
}

async fn reindex_sources(
    pool: &SqlitePool,
    sources: &[AgentSourceConfig],
) -> Result<AgentSourceReindexResult, String> {
    let enabled_sources = sources
        .iter()
        .filter(|source| source.enabled)
        .collect::<Vec<_>>();
    let mut scanned_files = 0;
    let mut indexed_documents = 0;
    let mut skipped_files = 0;

    for source in &enabled_sources {
        sqlx::query("DELETE FROM agent_source_documents WHERE source_id = ?")
            .bind(&source.id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to clear old agent source index: {}", e))?;

        let mut files = Vec::new();
        for path in &source.paths {
            collect_indexable_files(&expand_path(path), 0, &mut files);
            if files.len() >= MAX_SCAN_FILES_PER_SOURCE {
                files.truncate(MAX_SCAN_FILES_PER_SOURCE);
                break;
            }
        }

        for file in files {
            scanned_files += 1;
            match index_file(source, &file) {
                Ok(Some(document)) => {
                    upsert_document(pool, &document).await?;
                    indexed_documents += 1;
                }
                Ok(None) => skipped_files += 1,
                Err(error) => {
                    skipped_files += 1;
                    log::debug!("Skipped agent source file {}: {}", file.display(), error);
                }
            }
        }
    }

    Ok(AgentSourceReindexResult {
        scanned_files,
        indexed_documents,
        skipped_files,
        sources: enabled_sources.len(),
    })
}

async fn upsert_document(pool: &SqlitePool, document: &IndexedDocument) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let indexed_at = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO agent_source_documents
            (id, source_id, source_label, title, path, project_path, session_date, modified_at, content, summary, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            source_id = excluded.source_id,
            source_label = excluded.source_label,
            title = excluded.title,
            project_path = excluded.project_path,
            session_date = excluded.session_date,
            modified_at = excluded.modified_at,
            content = excluded.content,
            summary = excluded.summary,
            indexed_at = excluded.indexed_at
        "#,
    )
    .bind(id)
    .bind(&document.source_id)
    .bind(&document.source_label)
    .bind(&document.title)
    .bind(&document.path)
    .bind(&document.project_path)
    .bind(&document.session_date)
    .bind(&document.modified_at)
    .bind(&document.content)
    .bind(&document.summary)
    .bind(indexed_at)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to index agent source document: {}", e))?;
    Ok(())
}

async fn search_sources(
    pool: &SqlitePool,
    query: &str,
    source_ids: Option<&[String]>,
    limit: i64,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let clean_query = query.trim();
    let limit = limit.clamp(1, 100);
    let rows = sqlx::query(
        r#"
        SELECT id, source_id, source_label, title, path, project_path, session_date, modified_at, content, summary
        FROM agent_source_documents
        ORDER BY modified_at DESC
        LIMIT 800
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to search agent history: {}", e))?;

    let source_filter = source_ids
        .map(|ids| ids.iter().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let terms = tokenize(clean_query);

    let mut results = rows
        .into_iter()
        .filter(|row| {
            if source_filter.is_empty() {
                return true;
            }
            source_filter.contains(row.get::<String, _>("source_id").as_str())
        })
        .filter_map(|row| result_from_row(row, &terms, clean_query.is_empty()))
        .collect::<Vec<_>>();

    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.modified_at.cmp(&a.modified_at))
    });
    results.truncate(limit as usize);
    Ok(results)
}

async fn activity_on(
    pool: &SqlitePool,
    day: &str,
    source_ids: Option<&[String]>,
    limit: i64,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let parsed_day = NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|_| "Day must be YYYY-MM-DD".to_string())?;
    let date_prefix = parsed_day.format("%Y-%m-%d").to_string();
    let rows = sqlx::query(
        r#"
        SELECT id, source_id, source_label, title, path, project_path, session_date, modified_at, content, summary
        FROM agent_source_documents
        WHERE substr(COALESCE(session_date, modified_at), 1, 10) = ?
        ORDER BY COALESCE(session_date, modified_at) DESC
        LIMIT 500
        "#,
    )
    .bind(date_prefix)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load agent activity: {}", e))?;

    let source_filter = source_ids
        .map(|ids| ids.iter().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let mut results = rows
        .into_iter()
        .filter(|row| {
            if source_filter.is_empty() {
                return true;
            }
            source_filter.contains(row.get::<String, _>("source_id").as_str())
        })
        .filter_map(|row| result_from_row(row, &[], true))
        .collect::<Vec<_>>();
    results.truncate(limit.clamp(1, 100) as usize);
    Ok(results)
}

fn result_from_row(
    row: sqlx::sqlite::SqliteRow,
    terms: &[String],
    include_without_match: bool,
) -> Option<AgentSourceSearchResult> {
    let content: String = row.get("content");
    let title: String = row.get("title");
    let path: String = row.get("path");
    let haystack = format!("{} {} {}", title, path, content).to_lowercase();
    let score = if terms.is_empty() {
        1
    } else {
        terms
            .iter()
            .map(|term| haystack.matches(term).count() as i64)
            .sum::<i64>()
    };

    if score == 0 && !include_without_match {
        return None;
    }

    let snippet = if terms.is_empty() {
        row.get::<String, _>("summary")
    } else {
        build_snippet(&content, terms)
    };

    Some(AgentSourceSearchResult {
        id: row.get("id"),
        source_id: row.get("source_id"),
        source_label: row.get("source_label"),
        title,
        path,
        project_path: row
            .try_get::<Option<String>, _>("project_path")
            .ok()
            .flatten(),
        session_date: row
            .try_get::<Option<String>, _>("session_date")
            .ok()
            .flatten(),
        modified_at: row.get("modified_at"),
        snippet,
        score,
    })
}

fn default_sources() -> Vec<AgentSourceConfig> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    let cursor_base = home
        .join("Library")
        .join("Application Support")
        .join("Cursor")
        .join("User");
    vec![
        source(
            "codex_sessions",
            "Codex sessions",
            vec![home.join(".codex").join("sessions")],
            true,
        ),
        source(
            "codex_memories",
            "Codex memories",
            vec![home.join(".codex").join("memories")],
            true,
        ),
        source(
            "claude",
            "Claude sessions",
            vec![
                home.join(".claude").join("projects"),
                home.join(".claude.json"),
            ],
            true,
        ),
        source(
            "cursor",
            "Cursor history",
            vec![
                cursor_base.join("workspaceStorage"),
                cursor_base.join("globalStorage"),
            ],
            true,
        ),
        AgentSourceConfig {
            id: "custom".to_string(),
            label: "Custom folders".to_string(),
            enabled: false,
            paths: Vec::new(),
            index_full_content: true,
            discovered: false,
        },
    ]
}

fn source(
    id: &str,
    label: &str,
    paths: Vec<PathBuf>,
    index_full_content: bool,
) -> AgentSourceConfig {
    let discovered = paths.iter().any(|path| path.exists());
    AgentSourceConfig {
        id: id.to_string(),
        label: label.to_string(),
        enabled: discovered,
        paths: paths
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        index_full_content,
        discovered,
    }
}

fn collect_indexable_files(path: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    if files.len() >= MAX_SCAN_FILES_PER_SOURCE || depth > MAX_RECURSION_DEPTH || !path.exists() {
        return;
    }

    if path.is_file() {
        if is_indexable_file(path) {
            files.push(path.to_path_buf());
        }
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let child = entry.path();
        let name = child
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if name == ".git" || name == "node_modules" || name == "target" || name == "Cache" {
            continue;
        }
        collect_indexable_files(&child, depth + 1, files);
        if files.len() >= MAX_SCAN_FILES_PER_SOURCE {
            break;
        }
    }
}

fn is_indexable_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        extension.to_lowercase().as_str(),
        "jsonl" | "json" | "md" | "markdown" | "txt" | "log"
    )
}

fn index_file(source: &AgentSourceConfig, path: &Path) -> Result<Option<IndexedDocument>, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let extracted = extract_text(path, &raw);
    let content = truncate_chars(&extracted, MAX_INDEXED_CHARS);
    if content.trim().len() < 20 {
        return Ok(None);
    }

    let modified_at = system_time_to_iso(metadata.modified().unwrap_or(SystemTime::now()));
    let session_date = extract_session_date(path, &content).or_else(|| Some(modified_at.clone()));
    let title = extract_title(path, &content);
    let project_path = extract_project_path(&content);
    let summary = compact_whitespace(&truncate_chars(&content, 800));
    let indexed_content = if source.index_full_content {
        content
    } else {
        summary.clone()
    };

    Ok(Some(IndexedDocument {
        source_id: source.id.clone(),
        source_label: source.label.clone(),
        title,
        path: path.to_string_lossy().to_string(),
        project_path,
        session_date,
        modified_at,
        content: indexed_content,
        summary,
    }))
}

fn extract_text(path: &Path, raw: &str) -> String {
    if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
        let lines = raw
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|value| extract_json_text(&value))
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            return lines.join("\n");
        }
    }

    if matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("json")
    ) {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            if let Some(text) = extract_json_text(&value) {
                return text;
            }
        }
    }

    raw.to_string()
}

fn extract_json_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(extract_json_text)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.trim().is_empty()).then_some(text)
        }
        Value::Object(map) => {
            let mut parts = Vec::new();
            for key in [
                "cwd",
                "objective",
                "summary",
                "content",
                "message",
                "text",
                "title",
                "cmd",
                "output",
            ] {
                if let Some(value) = map.get(key).and_then(extract_json_text) {
                    parts.push(format!("{key}: {value}"));
                }
            }
            for key in ["payload", "turn_context", "response_item"] {
                if let Some(value) = map.get(key).and_then(extract_json_text) {
                    parts.push(value);
                }
            }
            let text = parts.join("\n");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn extract_title(path: &Path, content: &str) -> String {
    for line in content.lines().take(30) {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return trimmed.trim_start_matches("# ").trim().to_string();
        }
        if let Some(rest) = trimmed.strip_prefix("title:") {
            let value = rest.trim();
            if !value.is_empty() {
                return truncate_chars(value, 100);
            }
        }
    }

    path.file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace(['_', '-'], " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Agent session".to_string())
}

fn extract_project_path(content: &str) -> Option<String> {
    let patterns = [
        r#"cwd[=:]\s*"?([^"\n,]+)"?"#,
        r#"/Users/[^ \n"']+/Repos/[^ \n"']+"#,
        r#"/Users/[^ \n"']+/Documents/Codex/[^ \n"']+"#,
    ];

    for pattern in patterns {
        let Ok(regex) = Regex::new(pattern) else {
            continue;
        };
        if let Some(captures) = regex.captures(content) {
            let value = captures
                .get(1)
                .or_else(|| captures.get(0))
                .map(|match_| match_.as_str().trim_matches('"').trim().to_string());
            if let Some(value) = value.filter(|value| value.starts_with("/")) {
                return Some(value);
            }
        }
    }

    None
}

fn extract_session_date(path: &Path, content: &str) -> Option<String> {
    let source = format!(
        "{} {}",
        path.to_string_lossy(),
        content.lines().take(8).collect::<Vec<_>>().join(" ")
    );
    let regex =
        Regex::new(r#"(20\d\d)[-/](\d\d)[-/](\d\d)[T_ -](\d\d)[:\-](\d\d)[:\-](\d\d)"#).ok()?;
    let captures = regex.captures(&source)?;
    let normalized = format!(
        "{}-{}-{}T{}:{}:{}Z",
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str(),
        captures.get(3)?.as_str(),
        captures.get(4)?.as_str(),
        captures.get(5)?.as_str(),
        captures.get(6)?.as_str(),
    );
    DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|date| date.with_timezone(&Utc).to_rfc3339())
}

fn build_snippet(content: &str, terms: &[String]) -> String {
    let lower = content.to_lowercase();
    let start = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0);
    let safe_start = start.saturating_sub(180);
    let snippet = content
        .chars()
        .skip(safe_start)
        .take(520)
        .collect::<String>();
    compact_whitespace(&snippet)
}

fn tokenize(query: &str) -> Vec<String> {
    query
        .split(|character: char| {
            !character.is_alphanumeric() && character != '-' && character != '_'
        })
        .map(|value| value.trim().to_lowercase())
        .filter(|value| value.len() > 2)
        .take(12)
        .collect()
}

fn expand_path(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

fn system_time_to_iso(value: SystemTime) -> String {
    let duration = value.duration_since(UNIX_EPOCH).unwrap_or_default();
    DateTime::<Utc>::from(UNIX_EPOCH + duration).to_rfc3339()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect::<String>()
}

fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
