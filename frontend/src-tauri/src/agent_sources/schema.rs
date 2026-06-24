use serde::{Deserialize, Serialize};

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
pub(super) struct IndexedDocument {
    pub source_id: String,
    pub source_label: String,
    pub title: String,
    pub path: String,
    pub project_path: Option<String>,
    pub session_date: Option<String>,
    pub modified_at: String,
    pub content: String,
    pub summary: String,
}
