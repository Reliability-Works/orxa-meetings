use crate::state::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: String,
    pub meeting_id: String,
    pub meeting_title: Option<String>,
    pub kind: String,
    pub title: String,
    pub details: Option<String>,
    pub owner: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub role_scope: Option<String>,
    pub evidence: Option<String>,
    pub agent_notes: Option<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkContextPack {
    pub id: String,
    pub meeting_id: String,
    pub meeting_title: Option<String>,
    pub work_item_id: Option<String>,
    pub title: String,
    pub role_scope: String,
    pub pack_markdown: String,
    pub source_kind: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkPreMeetingBrief {
    pub id: String,
    pub meeting_id: Option<String>,
    pub title: String,
    pub starts_at: Option<String>,
    pub attendee_hint: Option<String>,
    pub brief_markdown: String,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkHubOverview {
    pub open_actions: i64,
    pub in_progress_actions: i64,
    pub blocked_actions: i64,
    pub recent_items: Vec<WorkItem>,
    pub stale_items: Vec<WorkItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkHubSyncResult {
    pub meeting_id: String,
    pub inserted_or_updated: usize,
    pub item_count: usize,
    pub items: Vec<WorkItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoleOutput {
    pub meeting_id: String,
    pub role_scope: String,
    pub markdown: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecurringMemory {
    pub meeting_id: String,
    pub title_pattern: String,
    pub related_meetings: Vec<MeetingLite>,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingLite {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
struct MeetingContext {
    id: String,
    title: String,
    created_at: String,
    transcript_text: String,
    transcript_lines: Vec<String>,
    summary_markdown: Option<String>,
}

#[derive(Debug, Clone)]
struct CandidateWorkItem {
    kind: String,
    title: String,
    details: Option<String>,
    owner: Option<String>,
    due_date: Option<String>,
    role_scope: Option<String>,
    evidence: Option<String>,
    source: String,
}

#[tauri::command]
pub async fn workhub_sync_meeting(
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorkHubSyncResult, String> {
    let pool = state.db_manager.pool();
    sync_meeting(pool, &meeting_id).await
}

#[tauri::command]
pub async fn workhub_get_overview(
    state: tauri::State<'_, AppState>,
) -> Result<WorkHubOverview, String> {
    let pool = state.db_manager.pool();
    let open_actions = count_actions(pool, "open").await?;
    let in_progress_actions = count_actions(pool, "in_progress").await?;
    let blocked_actions = count_actions(pool, "blocked").await?;
    let recent_items = list_items(pool, None, None, None, 20).await?;
    let stale_items = list_items(pool, Some("action"), Some("open"), None, 8).await?;

    Ok(WorkHubOverview {
        open_actions,
        in_progress_actions,
        blocked_actions,
        recent_items,
        stale_items,
    })
}

#[tauri::command]
pub async fn workhub_list_items(
    kind: Option<String>,
    status: Option<String>,
    meeting_id: Option<String>,
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkItem>, String> {
    list_items(
        state.db_manager.pool(),
        kind.as_deref(),
        status.as_deref(),
        meeting_id.as_deref(),
        limit.unwrap_or(100),
    )
    .await
}

#[tauri::command]
pub async fn workhub_update_item_status(
    item_id: String,
    status: String,
    agent_notes: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<WorkItem, String> {
    update_item_status(state.db_manager.pool(), &item_id, &status, agent_notes.as_deref()).await
}

#[tauri::command]
pub async fn workhub_create_context_pack(
    meeting_id: String,
    work_item_id: Option<String>,
    role_scope: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<WorkContextPack, String> {
    create_context_pack(
        state.db_manager.pool(),
        &meeting_id,
        work_item_id.as_deref(),
        role_scope.as_deref().unwrap_or("engineering"),
    )
    .await
}

#[tauri::command]
pub async fn workhub_list_context_packs(
    meeting_id: Option<String>,
    work_item_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkContextPack>, String> {
    list_context_packs(
        state.db_manager.pool(),
        meeting_id.as_deref(),
        work_item_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn workhub_get_role_output(
    meeting_id: String,
    role_scope: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RoleOutput, String> {
    get_role_output(
        state.db_manager.pool(),
        &meeting_id,
        role_scope.as_deref().unwrap_or("general"),
    )
    .await
}

#[tauri::command]
pub async fn workhub_get_recurring_memory(
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RecurringMemory, String> {
    get_recurring_memory(state.db_manager.pool(), &meeting_id).await
}

#[tauri::command]
pub async fn workhub_create_pre_meeting_brief(
    title: String,
    starts_at: Option<String>,
    attendee_hint: Option<String>,
    related_meeting_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<WorkPreMeetingBrief, String> {
    create_pre_meeting_brief(
        state.db_manager.pool(),
        &title,
        starts_at.as_deref(),
        attendee_hint.as_deref(),
        related_meeting_id.as_deref(),
    )
    .await
}

async fn sync_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<WorkHubSyncResult, String> {
    let context = load_meeting_context(pool, meeting_id).await?;
    let candidates = extract_candidates(&context);

    let mut changed = 0usize;
    for candidate in candidates {
        let id = work_item_id(meeting_id, &candidate.kind, &candidate.title);
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            r#"
            INSERT INTO work_items
                (id, meeting_id, kind, title, details, owner, due_date, status, role_scope, evidence, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                details = excluded.details,
                owner = COALESCE(work_items.owner, excluded.owner),
                due_date = COALESCE(work_items.due_date, excluded.due_date),
                role_scope = COALESCE(work_items.role_scope, excluded.role_scope),
                evidence = excluded.evidence,
                source = excluded.source,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(&candidate.kind)
        .bind(&candidate.title)
        .bind(&candidate.details)
        .bind(&candidate.owner)
        .bind(&candidate.due_date)
        .bind(&candidate.role_scope)
        .bind(&candidate.evidence)
        .bind(&candidate.source)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to sync work item: {}", e))?;
        if result.rows_affected() > 0 {
            changed += 1;
        }
    }

    let items = list_items(pool, None, None, Some(meeting_id), 200).await?;
    Ok(WorkHubSyncResult {
        meeting_id: meeting_id.to_string(),
        inserted_or_updated: changed,
        item_count: items.len(),
        items,
    })
}

async fn count_actions(pool: &SqlitePool, status: &str) -> Result<i64, String> {
    let row = sqlx::query("SELECT COUNT(*) AS count FROM work_items WHERE kind = 'action' AND status = ?")
        .bind(status)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to count actions: {}", e))?;
    Ok(row.get::<i64, _>("count"))
}

async fn list_items(
    pool: &SqlitePool,
    kind: Option<&str>,
    status: Option<&str>,
    meeting_id: Option<&str>,
    limit: i64,
) -> Result<Vec<WorkItem>, String> {
    let rows = sqlx::query(
        r#"
        SELECT wi.id, wi.meeting_id, m.title AS meeting_title, wi.kind, wi.title, wi.details,
               wi.owner, wi.due_date, wi.status, wi.role_scope, wi.evidence, wi.agent_notes,
               wi.source, wi.created_at, wi.updated_at, wi.completed_at
        FROM work_items wi
        JOIN meetings m ON m.id = wi.meeting_id
        WHERE (? IS NULL OR wi.kind = ?)
          AND (? IS NULL OR wi.status = ?)
          AND (? IS NULL OR wi.meeting_id = ?)
        ORDER BY
          CASE wi.status
            WHEN 'blocked' THEN 0
            WHEN 'open' THEN 1
            WHEN 'in_progress' THEN 2
            WHEN 'done' THEN 3
            ELSE 4
          END,
          wi.updated_at DESC
        LIMIT ?
        "#,
    )
    .bind(kind)
    .bind(kind)
    .bind(status)
    .bind(status)
    .bind(meeting_id)
    .bind(meeting_id)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list work items: {}", e))?;

    Ok(rows.into_iter().map(work_item_from_row).collect())
}

async fn update_item_status(
    pool: &SqlitePool,
    item_id: &str,
    status: &str,
    agent_notes: Option<&str>,
) -> Result<WorkItem, String> {
    if !matches!(status, "open" | "in_progress" | "blocked" | "done" | "dismissed") {
        return Err("status must be open, in_progress, blocked, done, or dismissed".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let completed_at: Option<String> = if status == "done" {
        Some(now.clone())
    } else {
        None
    };

    let result = sqlx::query(
        r#"
        UPDATE work_items
        SET status = ?,
            agent_notes = COALESCE(?, agent_notes),
            updated_at = ?,
            completed_at = CASE WHEN ? = 'done' THEN ? ELSE NULL END
        WHERE id = ?
        "#,
    )
    .bind(status)
    .bind(agent_notes)
    .bind(&now)
    .bind(status)
    .bind(completed_at.as_deref())
    .bind(item_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to update work item: {}", e))?;

    if result.rows_affected() == 0 {
        return Err(format!("Work item not found: {}", item_id));
    }

    let items = sqlx::query(
        r#"
        SELECT wi.id, wi.meeting_id, m.title AS meeting_title, wi.kind, wi.title, wi.details,
               wi.owner, wi.due_date, wi.status, wi.role_scope, wi.evidence, wi.agent_notes,
               wi.source, wi.created_at, wi.updated_at, wi.completed_at
        FROM work_items wi
        JOIN meetings m ON m.id = wi.meeting_id
        WHERE wi.id = ?
        "#,
    )
    .bind(item_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to reload work item: {}", e))?;

    items
        .into_iter()
        .next()
        .map(work_item_from_row)
        .ok_or_else(|| format!("Work item not found: {}", item_id))
}

async fn create_context_pack(
    pool: &SqlitePool,
    meeting_id: &str,
    work_item_id: Option<&str>,
    role_scope: &str,
) -> Result<WorkContextPack, String> {
    sync_meeting(pool, meeting_id).await?;
    let context = load_meeting_context(pool, meeting_id).await?;
    let selected_item = match work_item_id {
        Some(id) => list_items(pool, None, None, Some(meeting_id), 500)
            .await?
            .into_iter()
            .find(|item| item.id == id),
        None => None,
    };
    if work_item_id.is_some() && selected_item.is_none() {
        return Err(format!("Work item not found for meeting: {}", work_item_id.unwrap()));
    }

    let all_items = list_items(pool, None, None, Some(meeting_id), 500).await?;
    let title = selected_item
        .as_ref()
        .map(|item| item.title.clone())
        .unwrap_or_else(|| format!("{} context pack", context.title));
    let markdown = build_context_pack_markdown(&context, selected_item.as_ref(), &all_items, role_scope);
    let pack_id = format!("context-{}", uuid::Uuid::new_v4());
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO work_context_packs
            (id, meeting_id, work_item_id, title, role_scope, pack_markdown, source_kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?)
        "#,
    )
    .bind(&pack_id)
    .bind(meeting_id)
    .bind(work_item_id)
    .bind(&title)
    .bind(role_scope)
    .bind(&markdown)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create context pack: {}", e))?;

    list_context_packs(pool, Some(meeting_id), None)
        .await?
        .into_iter()
        .find(|pack| pack.id == pack_id)
        .ok_or_else(|| "Context pack was created but could not be reloaded".to_string())
}

async fn list_context_packs(
    pool: &SqlitePool,
    meeting_id: Option<&str>,
    work_item_id: Option<&str>,
) -> Result<Vec<WorkContextPack>, String> {
    let rows = sqlx::query(
        r#"
        SELECT cp.id, cp.meeting_id, m.title AS meeting_title, cp.work_item_id, cp.title,
               cp.role_scope, cp.pack_markdown, cp.source_kind, cp.created_at, cp.updated_at
        FROM work_context_packs cp
        JOIN meetings m ON m.id = cp.meeting_id
        WHERE (? IS NULL OR cp.meeting_id = ?)
          AND (? IS NULL OR cp.work_item_id = ?)
        ORDER BY cp.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(meeting_id)
    .bind(meeting_id)
    .bind(work_item_id)
    .bind(work_item_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list context packs: {}", e))?;

    Ok(rows.into_iter().map(context_pack_from_row).collect())
}

async fn get_role_output(
    pool: &SqlitePool,
    meeting_id: &str,
    role_scope: &str,
) -> Result<RoleOutput, String> {
    sync_meeting(pool, meeting_id).await?;
    let context = load_meeting_context(pool, meeting_id).await?;
    let items = list_items(pool, None, None, Some(meeting_id), 500).await?;
    let markdown = build_role_output_markdown(&context, &items, role_scope);
    Ok(RoleOutput {
        meeting_id: meeting_id.to_string(),
        role_scope: role_scope.to_string(),
        markdown,
    })
}

async fn get_recurring_memory(pool: &SqlitePool, meeting_id: &str) -> Result<RecurringMemory, String> {
    sync_meeting(pool, meeting_id).await?;
    let context = load_meeting_context(pool, meeting_id).await?;
    let title_pattern = title_pattern(&context.title);
    let like = format!("%{}%", title_pattern);
    let rows = sqlx::query(
        r#"
        SELECT id, title, created_at
        FROM meetings
        WHERE id != ?
          AND LOWER(title) LIKE LOWER(?)
        ORDER BY created_at DESC
        LIMIT 8
        "#,
    )
    .bind(meeting_id)
    .bind(&like)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load recurring meetings: {}", e))?;

    let related_meetings: Vec<MeetingLite> = rows
        .into_iter()
        .map(|row| MeetingLite {
            id: row.get("id"),
            title: row.get("title"),
            created_at: row.get("created_at"),
        })
        .collect();

    let mut related_items = Vec::new();
    for meeting in &related_meetings {
        related_items.extend(list_items(pool, None, None, Some(&meeting.id), 50).await?);
    }

    let markdown = build_recurring_memory_markdown(&context, &related_meetings, &related_items);
    Ok(RecurringMemory {
        meeting_id: meeting_id.to_string(),
        title_pattern,
        related_meetings,
        markdown,
    })
}

async fn create_pre_meeting_brief(
    pool: &SqlitePool,
    title: &str,
    starts_at: Option<&str>,
    attendee_hint: Option<&str>,
    related_meeting_id: Option<&str>,
) -> Result<WorkPreMeetingBrief, String> {
    let title_pattern = title_pattern(title);
    let like = format!("%{}%", title_pattern);
    let rows = sqlx::query(
        r#"
        SELECT id, title, created_at
        FROM meetings
        WHERE (? IS NULL OR id = ?)
           OR LOWER(title) LIKE LOWER(?)
        ORDER BY created_at DESC
        LIMIT 8
        "#,
    )
    .bind(related_meeting_id)
    .bind(related_meeting_id)
    .bind(&like)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load meeting history for brief: {}", e))?;

    let related_meetings: Vec<MeetingLite> = rows
        .into_iter()
        .map(|row| MeetingLite {
            id: row.get("id"),
            title: row.get("title"),
            created_at: row.get("created_at"),
        })
        .collect();

    let mut related_items = Vec::new();
    for meeting in &related_meetings {
        let _ = sync_meeting(pool, &meeting.id).await;
        related_items.extend(list_items(pool, None, None, Some(&meeting.id), 50).await?);
    }

    let markdown = build_pre_meeting_brief_markdown(title, starts_at, attendee_hint, &related_meetings, &related_items);
    let id = format!("brief-{}", uuid::Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO work_pre_meeting_briefs
            (id, meeting_id, title, starts_at, attendee_hint, brief_markdown, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?)
        "#,
    )
    .bind(&id)
    .bind(related_meeting_id)
    .bind(title)
    .bind(starts_at)
    .bind(attendee_hint)
    .bind(&markdown)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save pre-meeting brief: {}", e))?;

    Ok(WorkPreMeetingBrief {
        id,
        meeting_id: related_meeting_id.map(ToString::to_string),
        title: title.to_string(),
        starts_at: starts_at.map(ToString::to_string),
        attendee_hint: attendee_hint.map(ToString::to_string),
        brief_markdown: markdown,
        source: "generated".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

async fn load_meeting_context(pool: &SqlitePool, meeting_id: &str) -> Result<MeetingContext, String> {
    let meeting = sqlx::query("SELECT id, title, created_at FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load meeting: {}", e))?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let transcript_rows = sqlx::query(
        r#"
        SELECT transcript, speaker, audio_start_time, timestamp
        FROM transcripts
        WHERE meeting_id = ?
        ORDER BY
          CASE WHEN audio_start_time IS NULL THEN 1 ELSE 0 END,
          audio_start_time ASC,
          timestamp ASC
        LIMIT 3000
        "#,
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))?;

    let mut transcript_lines = Vec::new();
    for row in transcript_rows {
        let text: String = row.get("transcript");
        let speaker: Option<String> = row.try_get("speaker").ok();
        let audio_start_time: Option<f64> = row.try_get("audio_start_time").ok();
        let label = if speaker.as_deref() == Some("me") { "Me: " } else { "" };
        let time = audio_start_time
            .map(format_seconds)
            .unwrap_or_else(|| row.get::<String, _>("timestamp"));
        transcript_lines.push(format!("[{}] {}{}", time, label, text.trim()));
    }

    let transcript_text = transcript_lines.join("\n");
    let summary_markdown = load_summary_markdown(pool, meeting_id).await?;

    Ok(MeetingContext {
        id: meeting.get("id"),
        title: meeting.get("title"),
        created_at: meeting.get("created_at"),
        transcript_text,
        transcript_lines,
        summary_markdown,
    })
}

async fn load_summary_markdown(pool: &SqlitePool, meeting_id: &str) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT result FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load summary: {}", e))?;

    let Some(row) = row else {
        return Ok(None);
    };
    let raw: Option<String> = row.try_get("result").ok();
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
        if let Some(markdown) = value.get("markdown").and_then(|v| v.as_str()) {
            return Ok(Some(markdown.to_string()));
        }
        if let Some(raw_text) = value.get("raw").and_then(|v| v.as_str()) {
            return Ok(Some(raw_text.to_string()));
        }
        return Ok(Some(value_to_markdown(&value)));
    }

    Ok(Some(raw))
}

fn extract_candidates(context: &MeetingContext) -> Vec<CandidateWorkItem> {
    let mut candidates = Vec::new();
    let source_text = context
        .summary_markdown
        .as_deref()
        .unwrap_or(&context.transcript_text);

    for line in source_text.lines() {
        let cleaned = clean_line(line);
        if cleaned.len() < 6 || is_section_heading(&cleaned) {
            continue;
        }

        let lower = cleaned.to_lowercase();
        if is_action_like(&lower) {
            candidates.push(build_candidate("action", &cleaned, context, "summary-sync"));
        } else if is_decision_like(&lower) {
            candidates.push(build_candidate("decision", &cleaned, context, "summary-sync"));
        } else if is_risk_like(&lower) {
            candidates.push(build_candidate("risk", &cleaned, context, "summary-sync"));
        } else if is_question_like(&lower) {
            candidates.push(build_candidate("question", &cleaned, context, "summary-sync"));
        }
    }

    for line in context.transcript_lines.iter().take(500) {
        let lower = line.to_lowercase();
        if is_decision_like(&lower) || is_risk_like(&lower) || is_question_like(&lower) {
            let kind = if is_decision_like(&lower) {
                "decision"
            } else if is_risk_like(&lower) {
                "risk"
            } else {
                "question"
            };
            candidates.push(build_candidate(kind, line, context, "transcript-heuristic"));
        }
    }

    dedupe_candidates(candidates)
}

fn build_candidate(kind: &str, text: &str, context: &MeetingContext, source: &str) -> CandidateWorkItem {
    let (owner, due_date, title) = parse_owner_due_title(text);
    let evidence = find_evidence(context, &title).or_else(|| Some(text.to_string()));
    CandidateWorkItem {
        kind: kind.to_string(),
        title: title.chars().take(220).collect(),
        details: Some(text.to_string()),
        owner,
        due_date,
        role_scope: infer_role_scope(text),
        evidence,
        source: source.to_string(),
    }
}

fn build_context_pack_markdown(
    context: &MeetingContext,
    selected_item: Option<&WorkItem>,
    all_items: &[WorkItem],
    role_scope: &str,
) -> String {
    let mut sections = Vec::new();
    sections.push(format!("# Agent Context Pack: {}", context.title));
    sections.push(format!("- Meeting: {}\n- Created: {}\n- Role lens: {}", context.id, context.created_at, role_scope));

    if let Some(item) = selected_item {
        sections.push(format!(
            "## Target Work Item\n- ID: {}\n- Type: {}\n- Status: {}\n- Owner: {}\n- Due: {}\n\n{}",
            item.id,
            item.kind,
            item.status,
            item.owner.as_deref().unwrap_or("Unknown"),
            item.due_date.as_deref().unwrap_or("TBD"),
            item.details.as_deref().unwrap_or(&item.title)
        ));
    }

    sections.push(format!("## Acceptance Criteria\n{}", acceptance_for_role(role_scope)));
    sections.push("## Open Actions\n".to_string() + &item_list_markdown(all_items, "action", false));
    sections.push("## Decisions\n".to_string() + &item_list_markdown(all_items, "decision", false));
    sections.push("## Risks And Questions\n".to_string() + &item_list_markdown(all_items, "risk", false) + &item_list_markdown(all_items, "question", false));
    sections.push(format!("## Relevant Transcript Excerpts\n{}", relevant_transcript_excerpt(context, selected_item.map(|item| item.title.as_str()))));

    sections.join("\n\n")
}

fn build_role_output_markdown(context: &MeetingContext, items: &[WorkItem], role_scope: &str) -> String {
    let mut output = Vec::new();
    output.push(format!("# {} Output: {}", title_case(role_scope), context.title));
    output.push(role_guidance(role_scope).to_string());
    output.push(format!("## Actions\n{}", item_list_markdown(items, "action", true)));
    output.push(format!("## Decisions\n{}", item_list_markdown(items, "decision", true)));
    output.push(format!("## Risks\n{}", item_list_markdown(items, "risk", true)));
    output.push(format!("## Open Questions\n{}", item_list_markdown(items, "question", true)));
    output.push(format!("## Evidence\n{}", relevant_transcript_excerpt(context, None)));
    output.join("\n\n")
}

fn build_recurring_memory_markdown(
    context: &MeetingContext,
    related_meetings: &[MeetingLite],
    related_items: &[WorkItem],
) -> String {
    let mut output = Vec::new();
    output.push(format!("# Recurring Meeting Memory: {}", context.title));
    if related_meetings.is_empty() {
        output.push("No closely matching prior meetings were found yet.".to_string());
    } else {
        output.push(format!(
            "## Related Meetings\n{}",
            related_meetings
                .iter()
                .map(|meeting| format!("- {} ({})", meeting.title, meeting.created_at))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    output.push(format!("## Carry-Forward Open Items\n{}", item_list_markdown(related_items, "action", true)));
    output.push(format!("## Prior Decisions\n{}", item_list_markdown(related_items, "decision", true)));
    output.push(format!("## Prior Risks And Questions\n{}{}", item_list_markdown(related_items, "risk", true), item_list_markdown(related_items, "question", true)));
    output.join("\n\n")
}

fn build_pre_meeting_brief_markdown(
    title: &str,
    starts_at: Option<&str>,
    attendee_hint: Option<&str>,
    related_meetings: &[MeetingLite],
    related_items: &[WorkItem],
) -> String {
    let mut output = Vec::new();
    output.push(format!("# Pre-Meeting Brief: {}", title));
    output.push(format!(
        "- Starts: {}\n- Attendees/context: {}",
        starts_at.unwrap_or("TBD"),
        attendee_hint.unwrap_or("Not provided")
    ));
    output.push(format!("## Open Follow-Ups To Review\n{}", item_list_markdown(related_items, "action", true)));
    output.push(format!("## Decisions To Carry Forward\n{}", item_list_markdown(related_items, "decision", true)));
    output.push(format!("## Risks / Open Questions\n{}{}", item_list_markdown(related_items, "risk", true), item_list_markdown(related_items, "question", true)));
    output.push(format!(
        "## Related Meetings\n{}",
        if related_meetings.is_empty() {
            "None found.".to_string()
        } else {
            related_meetings
                .iter()
                .map(|meeting| format!("- {} ({})", meeting.title, meeting.created_at))
                .collect::<Vec<_>>()
                .join("\n")
        }
    ));
    output.join("\n\n")
}

fn item_list_markdown(items: &[WorkItem], kind: &str, only_active: bool) -> String {
    let filtered: Vec<&WorkItem> = items
        .iter()
        .filter(|item| item.kind == kind)
        .filter(|item| !only_active || !matches!(item.status.as_str(), "done" | "dismissed"))
        .collect();

    if filtered.is_empty() {
        return "- None captured yet.\n".to_string();
    }

    filtered
        .into_iter()
        .map(|item| {
            format!(
                "- [{}] {} — owner: {}; due: {}; evidence: {}",
                item.status,
                item.title,
                item.owner.as_deref().unwrap_or("Unknown"),
                item.due_date.as_deref().unwrap_or("TBD"),
                item.evidence.as_deref().unwrap_or("Not captured")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn relevant_transcript_excerpt(context: &MeetingContext, focus: Option<&str>) -> String {
    let focus_words = focus
        .map(keywords)
        .filter(|words| !words.is_empty())
        .unwrap_or_else(|| keywords(&context.title));
    let mut excerpts = Vec::new();

    for line in &context.transcript_lines {
        let lower = line.to_lowercase();
        if focus_words.iter().any(|word| lower.contains(word)) {
            excerpts.push(format!("- {}", line));
        }
        if excerpts.len() >= 8 {
            break;
        }
    }

    if excerpts.is_empty() {
        context
            .transcript_lines
            .iter()
            .take(8)
            .map(|line| format!("- {}", line))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        excerpts.join("\n")
    }
}

fn work_item_from_row(row: sqlx::sqlite::SqliteRow) -> WorkItem {
    WorkItem {
        id: row.get("id"),
        meeting_id: row.get("meeting_id"),
        meeting_title: row.try_get("meeting_title").ok(),
        kind: row.get("kind"),
        title: row.get("title"),
        details: row.try_get("details").ok(),
        owner: row.try_get("owner").ok(),
        due_date: row.try_get("due_date").ok(),
        status: row.get("status"),
        role_scope: row.try_get("role_scope").ok(),
        evidence: row.try_get("evidence").ok(),
        agent_notes: row.try_get("agent_notes").ok(),
        source: row.get("source"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        completed_at: row.try_get("completed_at").ok(),
    }
}

fn context_pack_from_row(row: sqlx::sqlite::SqliteRow) -> WorkContextPack {
    WorkContextPack {
        id: row.get("id"),
        meeting_id: row.get("meeting_id"),
        meeting_title: row.try_get("meeting_title").ok(),
        work_item_id: row.try_get("work_item_id").ok(),
        title: row.get("title"),
        role_scope: row.get("role_scope"),
        pack_markdown: row.get("pack_markdown"),
        source_kind: row.get("source_kind"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn value_to_markdown(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => map
            .iter()
            .filter_map(|(key, value)| {
                if key.starts_with('_') || key == "MeetingName" {
                    return None;
                }
                Some(format!("## {}\n{}", key, json_value_to_text(value)))
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => value.to_string(),
    }
}

fn json_value_to_text(value: &serde_json::Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(blocks) = value.get("blocks").and_then(|v| v.as_array()) {
        return blocks
            .iter()
            .filter_map(|block| block.get("content").and_then(|content| content.as_str()))
            .map(|content| format!("- {}", content))
            .collect::<Vec<_>>()
            .join("\n");
    }
    value.to_string()
}

fn parse_owner_due_title(text: &str) -> (Option<String>, Option<String>, String) {
    let mut title = text.trim().trim_matches('|').trim().to_string();
    let mut owner = None;
    let mut due_date = None;

    if title.to_lowercase().starts_with("me:") {
        owner = Some("Me".to_string());
        title = title[3..].trim().to_string();
    }

    if title.contains('|') {
        let parts: Vec<String> = title
            .split('|')
            .map(|part| part.trim().trim_matches('-').trim().to_string())
            .filter(|part| !part.is_empty())
            .collect();
        if parts.len() >= 2 && !parts[0].eq_ignore_ascii_case("owner") {
            owner = non_placeholder(&parts[0]);
            title = parts.get(1).cloned().unwrap_or(title);
            due_date = parts.get(2).and_then(|part| non_placeholder(part));
        }
    }

    let lower = title.to_lowercase();
    for prefix in ["owner:", "assignee:", "assigned to:"] {
        if let Some(index) = lower.find(prefix) {
            let remainder = title[index + prefix.len()..].trim();
            owner = remainder
                .split([',', ';', '.'])
                .next()
                .and_then(non_placeholder);
        }
    }

    if lower.contains(" i ") || lower.starts_with("i ") || lower.contains(" i'll") || lower.contains(" i’ll") {
        owner.get_or_insert_with(|| "Me".to_string());
    }

    for marker in ["by ", "due ", "before "] {
        if let Some(index) = lower.find(marker) {
            let candidate = title[index + marker.len()..]
                .split([',', ';', '.'])
                .next()
                .unwrap_or("")
                .trim();
            if !candidate.is_empty() && candidate.len() <= 40 {
                due_date = Some(candidate.to_string());
                break;
            }
        }
    }

    (owner, due_date, title)
}

fn non_placeholder(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || matches!(
            trimmed.to_lowercase().as_str(),
            "unknown" | "owner" | "tbd" | "n/a" | "none" | "-"
        )
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn infer_role_scope(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let role = if contains_any(&lower, &["pr", "pull request", "deploy", "bug", "api", "frontend", "backend", "repo", "code"]) {
        "engineering"
    } else if contains_any(&lower, &["customer", "renewal", "deal", "pricing", "objection", "account"]) {
        "sales_cs"
    } else if contains_any(&lower, &["roadmap", "requirement", "user story", "launch", "experiment"]) {
        "product"
    } else if contains_any(&lower, &["candidate", "interview", "hiring", "onboarding", "policy"]) {
        "people"
    } else if contains_any(&lower, &["risk", "budget", "board", "strategy", "metric"]) {
        "leadership"
    } else {
        "general"
    };
    Some(role.to_string())
}

fn clean_line(line: &str) -> String {
    let mut value = line.trim().trim_start_matches(['-', '*', '•']).trim().to_string();
    while value.starts_with('#') {
        value = value[1..].trim().to_string();
    }
    value.trim_matches('*').trim().to_string()
}

fn is_section_heading(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower == "action items"
        || lower == "actions"
        || lower == "decisions"
        || lower == "risks"
        || lower == "open questions"
        || lower.starts_with("owner |")
}

fn is_action_like(lower: &str) -> bool {
    contains_any(
        lower,
        &[
            "todo",
            "to-do",
            "action item",
            "follow up",
            "needs to",
            "will ",
            "should ",
            "assigned",
            "owner:",
            " due ",
        ],
    )
}

fn is_decision_like(lower: &str) -> bool {
    contains_any(lower, &["decided", "decision", "agreed", "approved", "confirmed", "finalized"])
}

fn is_risk_like(lower: &str) -> bool {
    contains_any(lower, &["risk", "concern", "blocked", "blocker", "issue", "problem", "uncertain"])
}

fn is_question_like(lower: &str) -> bool {
    contains_any(lower, &["open question", "question", "unclear", "need to clarify", "tbd"])
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn dedupe_candidates(candidates: Vec<CandidateWorkItem>) -> Vec<CandidateWorkItem> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for candidate in candidates {
        let key = format!("{}:{}", candidate.kind, normalize_key(&candidate.title));
        if seen.insert(key) {
            result.push(candidate);
        }
        if result.len() >= 80 {
            break;
        }
    }
    result
}

fn find_evidence(context: &MeetingContext, title: &str) -> Option<String> {
    let words = keywords(title);
    if words.is_empty() {
        return None;
    }
    context
        .transcript_lines
        .iter()
        .find(|line| {
            let lower = line.to_lowercase();
            words.iter().take(4).any(|word| lower.contains(word))
        })
        .cloned()
}

fn keywords(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|word| word.to_lowercase())
        .filter(|word| word.len() > 3)
        .filter(|word| !matches!(word.as_str(), "that" | "with" | "this" | "from" | "they" | "will" | "should"))
        .collect()
}

fn work_item_id(meeting_id: &str, kind: &str, title: &str) -> String {
    format!("work-{}-{}-{:x}", meeting_id, kind, stable_hash(&normalize_key(title)))
}

fn normalize_key(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn title_pattern(title: &str) -> String {
    let words: Vec<&str> = title
        .split_whitespace()
        .filter(|word| word.len() > 2)
        .filter(|word| !matches!(word.to_lowercase().as_str(), "the" | "and" | "for" | "with" | "meeting" | "sync" | "call"))
        .take(3)
        .collect();
    if words.is_empty() {
        title.split_whitespace().take(2).collect::<Vec<_>>().join(" ")
    } else {
        words.join(" ")
    }
}

fn format_seconds(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, seconds)
    } else {
        format!("{:02}:{:02}", minutes, seconds)
    }
}

fn acceptance_for_role(role_scope: &str) -> &'static str {
    match role_scope {
        "engineering" => "- Changes are scoped to the stated task.\n- Relevant tests/build checks pass.\n- PR/commit notes include evidence from the meeting.",
        "product" => "- Requirement and decision changes are captured.\n- Open questions are separated from committed scope.\n- Next customer/user validation step is clear.",
        "sales_cs" => "- Follow-up owner and customer-facing next step are explicit.\n- Risks/objections are captured with evidence.\n- CRM/update copy can be reviewed before sending.",
        "people" => "- Sensitive notes stay factual and evidence-based.\n- Follow-up questions/actions have owner and timing.\n- Candidate or staff feedback avoids unsupported inference.",
        "leadership" => "- Decisions, risks, and owners are visible.\n- Strategic tradeoffs are separated from operational tasks.\n- Stale commitments are called out.",
        _ => "- Owner, next step, and evidence are clear.\n- Open questions are not treated as decisions.\n- Any downstream agent work can cite meeting context.",
    }
}

fn role_guidance(role_scope: &str) -> &'static str {
    match role_scope {
        "engineering" => "Engineering lens: tickets, code tasks, bugs, acceptance criteria, PR follow-ups, and technical decisions.",
        "product" => "Product lens: requirements, roadmap deltas, user pain, experiments, decisions, and open questions.",
        "sales_cs" => "Sales/CS lens: account follow-ups, objections, renewal risks, customer promises, and stakeholder asks.",
        "people" => "People lens: interview notes, onboarding actions, feedback, policy questions, and sensitive follow-ups.",
        "leadership" => "Leadership lens: decisions, risks, ownership, stale commitments, and cross-functional blockers.",
        _ => "General lens: actions, decisions, risks, and questions with evidence.",
    }
}

fn title_case(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
