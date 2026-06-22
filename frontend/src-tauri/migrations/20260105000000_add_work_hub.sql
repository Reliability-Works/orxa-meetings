-- Local work loop layer for actions, decisions, risks, context packs, and briefs.

CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('action', 'decision', 'risk', 'question')),
    title TEXT NOT NULL,
    details TEXT,
    owner TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    role_scope TEXT,
    evidence TEXT,
    agent_notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_items_kind_status ON work_items(kind, status);
CREATE INDEX IF NOT EXISTS idx_work_items_meeting ON work_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_work_items_owner ON work_items(owner);

CREATE TABLE IF NOT EXISTS work_context_packs (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    work_item_id TEXT,
    title TEXT NOT NULL,
    role_scope TEXT NOT NULL DEFAULT 'general',
    pack_markdown TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'generated',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_context_packs_meeting ON work_context_packs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_work_context_packs_work_item ON work_context_packs(work_item_id);

CREATE TABLE IF NOT EXISTS work_pre_meeting_briefs (
    id TEXT PRIMARY KEY,
    meeting_id TEXT,
    title TEXT NOT NULL,
    starts_at TEXT,
    attendee_hint TEXT,
    brief_markdown TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'generated',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_pre_meeting_briefs_meeting ON work_pre_meeting_briefs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_work_pre_meeting_briefs_starts_at ON work_pre_meeting_briefs(starts_at);
