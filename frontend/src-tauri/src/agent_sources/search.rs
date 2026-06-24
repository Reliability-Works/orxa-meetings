use chrono::NaiveDate;
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;

use super::{extract::compact_whitespace, schema::AgentSourceSearchResult};

pub(super) async fn search_sources(
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

pub(super) async fn activity_on(
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
