"""Shared fixtures for Orxa MCP unit tests."""

from __future__ import annotations

# ruff: noqa: E402, I001

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

MCP_DIR = Path(__file__).resolve().parent
if str(MCP_DIR) not in sys.path:
    sys.path.insert(0, str(MCP_DIR))

import orxa_mcp


class OrxaMcpTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "meeting_minutes.sqlite"
        create_database(self.db_path)
        self.db = orxa_mcp.OrxaDatabase(str(self.db_path))

    def tearDown(self) -> None:
        self.tmp.cleanup()


def create_database(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            folder_path TEXT
        );

        CREATE TABLE transcripts (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            transcript TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            summary TEXT,
            action_items TEXT,
            key_points TEXT,
            audio_start_time REAL,
            audio_end_time REAL,
            duration REAL,
            speaker TEXT
        );

        CREATE TABLE summary_processes (
            meeting_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            error TEXT,
            result TEXT,
            start_time TEXT,
            end_time TEXT,
            chunk_count INTEGER DEFAULT 0,
            processing_time REAL DEFAULT 0.0,
            metadata TEXT
        );

        CREATE TABLE meeting_notes (
            meeting_id TEXT PRIMARY KEY NOT NULL,
            notes_markdown TEXT,
            notes_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE transcript_chunks (
            meeting_id TEXT NOT NULL,
            meeting_name TEXT,
            transcript_text TEXT NOT NULL,
            model TEXT NOT NULL,
            model_name TEXT NOT NULL,
            chunk_size INTEGER,
            overlap INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE TABLE agent_source_configs (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            paths_json TEXT NOT NULL,
            index_full_content INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_source_documents (
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
        );
        """
    )
    _insert_meeting_data(conn)
    _insert_agent_source_data(conn)
    conn.commit()
    conn.close()


def _insert_meeting_data(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO meetings VALUES (?, ?, ?, ?, ?)",
        (
            "meeting-1",
            "Roadmap Sync",
            "2026-06-22T09:00:00Z",
            "2026-06-22T10:00:00Z",
            "/tmp/meeting-1",
        ),
    )
    conn.execute(
        "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
        (
            "transcript-1",
            "meeting-1",
            "Alice said Bob should send the deck by Friday.",
            "09:01:00",
            5.0,
            9.5,
            4.5,
            "me",
        ),
    )
    conn.execute(
        "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
        (
            "transcript-2",
            "meeting-1",
            "Bob confirmed he will follow up with Legal.",
            "09:02:00",
            10.0,
            13.0,
            3.0,
            None,
        ),
    )
    conn.execute(
        "INSERT INTO summary_processes VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)",
        (
            "meeting-1",
            "completed",
            "2026-06-22T09:05:00Z",
            "2026-06-22T09:10:00Z",
            json.dumps(
                {
                    "markdown": (
                        "**Summary**\n\nRoadmap was discussed.\n\n"
                        "**Action Items / Todos**\n\n"
                        "| **Owner** | Todo | Due | Status | Evidence |\n"
                        "| --- | --- | --- | --- | --- |\n"
                        "| Bob | Send the deck | Friday | Open | "
                        "Alice said Bob should send the deck by Friday. |"
                    )
                }
            ),
            "2026-06-22T09:05:00Z",
            "2026-06-22T09:10:00Z",
            1,
            2.0,
        ),
    )
    conn.execute(
        "INSERT INTO meeting_notes VALUES (?, ?, ?, ?, ?)",
        (
            "meeting-1",
            "- Customer asked for timeline",
            None,
            "2026-06-22T09:00:00Z",
            "2026-06-22T09:05:00Z",
        ),
    )
    conn.execute(
        "INSERT INTO transcript_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "meeting-1",
            "Roadmap Sync",
            "Cached transcript content",
            "test",
            "test",
            None,
            None,
            "2026-06-22T09:05:00Z",
        ),
    )


def _insert_agent_source_data(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO agent_source_configs VALUES (?, ?, ?, ?, ?, ?)",
        (
            "codex_sessions",
            "Codex sessions",
            1,
            json.dumps(["/Users/callumspencer/.codex/sessions"]),
            1,
            "2026-06-22T09:05:00Z",
        ),
    )
    conn.execute(
        "INSERT INTO agent_source_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "agent-doc-1",
            "codex_sessions",
            "Codex sessions",
            "Fix calendar access",
            "/Users/callumspencer/.codex/sessions/rollout.jsonl",
            "/Users/callumspencer/Repos/mac/orxa-meetings",
            "2026-06-22T09:06:00Z",
            "2026-06-22T09:06:00Z",
            (
                "Calendar permission was fixed by switching to EventKit "
                "full access and reloading Orxa events."
            ),
            "Calendar permission was fixed by switching to EventKit full access.",
            "2026-06-22T09:07:00Z",
        ),
    )


def insert_tail_segment(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
        (
            "transcript-junk",
            "meeting-1",
            "A video kept playing after the call.",
            "09:29:00",
            1743.0,
            1748.0,
            5.0,
            None,
        ),
    )
    conn.commit()
    conn.close()
