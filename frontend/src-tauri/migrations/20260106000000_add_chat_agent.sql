CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    meeting_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    evidence_json TEXT,
    model TEXT,
    warning TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_agent_settings (
    id TEXT PRIMARY KEY CHECK (id = '1'),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    whisperModel TEXT NOT NULL DEFAULT '',
    ollamaEndpoint TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
