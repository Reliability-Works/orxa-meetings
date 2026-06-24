use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{
    extract::{
        compact_whitespace, expand_path, extract_project_path, extract_session_date, extract_text,
        extract_title, truncate_chars,
    },
    schema::{AgentSourceConfig, AgentSourceReindexResult, IndexedDocument},
};

const MAX_SCAN_FILES_PER_SOURCE: usize = 1_500;
const MAX_RECURSION_DEPTH: usize = 8;
const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_INDEXED_CHARS: usize = 120_000;

pub(super) async fn reindex_sources(
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

fn collect_indexable_files(path: &Path, depth: usize, files: &mut Vec<std::path::PathBuf>) {
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

fn system_time_to_iso(value: SystemTime) -> String {
    let duration = value.duration_since(UNIX_EPOCH).unwrap_or_default();
    DateTime::<Utc>::from(UNIX_EPOCH + duration).to_rfc3339()
}
