use chrono::Utc;
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::path::PathBuf;

use super::{extract::expand_path, schema::AgentSourceConfig};

pub(super) async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
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

pub(super) async fn load_config(pool: &SqlitePool) -> Result<Vec<AgentSourceConfig>, String> {
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

pub(super) async fn save_config(
    pool: &SqlitePool,
    sources: &[AgentSourceConfig],
) -> Result<(), String> {
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
