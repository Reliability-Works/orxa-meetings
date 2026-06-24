mod config;
mod extract;
mod index;
mod schema;
mod search;

use crate::state::AppState;
use sqlx::SqlitePool;

pub use schema::{AgentSourceConfig, AgentSourceReindexResult, AgentSourceSearchResult};

const CHAT_AGENT_HISTORY_LIMIT: i64 = 6;

#[tauri::command]
pub async fn agent_sources_get_config(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceConfig>, String> {
    let pool = state.db_manager.pool();
    config::ensure_schema(pool).await?;
    config::load_config(pool).await
}

#[tauri::command]
pub async fn agent_sources_save_config(
    sources: Vec<AgentSourceConfig>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceConfig>, String> {
    let pool = state.db_manager.pool();
    config::ensure_schema(pool).await?;
    config::save_config(pool, &sources).await?;
    config::load_config(pool).await
}

#[tauri::command]
pub async fn agent_sources_reindex(
    state: tauri::State<'_, AppState>,
) -> Result<AgentSourceReindexResult, String> {
    let pool = state.db_manager.pool();
    config::ensure_schema(pool).await?;
    let sources = config::load_config(pool).await?;
    index::reindex_sources(pool, &sources).await
}

#[tauri::command]
pub async fn agent_sources_search(
    query: String,
    source_ids: Option<Vec<String>>,
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let pool = state.db_manager.pool();
    config::ensure_schema(pool).await?;
    search::search_sources(pool, &query, source_ids.as_deref(), limit.unwrap_or(30)).await
}

#[tauri::command]
pub async fn agent_sources_activity_on(
    day: String,
    source_ids: Option<Vec<String>>,
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    let pool = state.db_manager.pool();
    config::ensure_schema(pool).await?;
    search::activity_on(pool, &day, source_ids.as_deref(), limit.unwrap_or(50)).await
}

pub async fn search_agent_sources_for_chat(
    pool: &SqlitePool,
    query: &str,
) -> Result<Vec<AgentSourceSearchResult>, String> {
    config::ensure_schema(pool).await?;
    search::search_sources(pool, query, None, CHAT_AGENT_HISTORY_LIMIT).await
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
                extract::compact_whitespace(&result.snippet)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
