#!/usr/bin/env python3
"""MCP server for Meetily meeting data.

The server speaks JSON-RPC over stdio and exposes local Meetily transcripts,
summaries, and notes from the app's SQLite database. Transcript trimming is the
only write operation, and it requires explicit confirmation. The server
intentionally avoids reading settings/API key tables.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import sqlite3
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


SERVER_NAME = "meetily-local"
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL_VERSION = "2024-11-05"
DATABASE_ENV = "MEETILY_DB_PATH"
DATABASE_FILENAME = "meeting_minutes.sqlite"


class McpServerError(Exception):
    """Expected server-side error surfaced to MCP clients."""


class MeetilyDatabase:
    def __init__(self, configured_path: str | None = None) -> None:
        self.configured_path = configured_path

    def resolve_path(self) -> Path:
        candidates: list[Path] = []

        if self.configured_path:
            candidates.append(Path(self.configured_path).expanduser())

        env_path = os.environ.get(DATABASE_ENV)
        if env_path:
            candidates.append(Path(env_path).expanduser())

        candidates.extend(default_database_candidates())

        for candidate in candidates:
            if candidate.exists():
                return candidate

        checked = "\n".join(f"- {path}" for path in candidates) or "- no candidates"
        raise McpServerError(
            f"Meetily database not found. Set {DATABASE_ENV} or pass --database.\nChecked:\n{checked}"
        )

    def connect(self, readonly: bool = True) -> sqlite3.Connection:
        db_path = self.resolve_path()
        mode = "ro" if readonly else "rw"
        uri = f"file:{db_path.as_posix()}?mode={mode}"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn


def default_database_candidates() -> list[Path]:
    home = Path.home()
    names = ("com.meetily.ai", "meetily", "Meetily")
    system = platform.system().lower()

    if system == "darwin":
        base = home / "Library" / "Application Support"
        return [base / name / DATABASE_FILENAME for name in names]

    if system == "windows":
        appdata = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        return [appdata / name / DATABASE_FILENAME for name in names]

    data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
    return [
        *(data_home / name / DATABASE_FILENAME for name in names),
        *(config_home / name / DATABASE_FILENAME for name in names),
    ]


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def clamp_limit(value: Any, default: int, maximum: int) -> int:
    if value is None:
        return default
    try:
        limit = int(value)
    except (TypeError, ValueError) as exc:
        raise McpServerError("limit must be an integer") from exc
    return max(1, min(limit, maximum))


def parse_cutoff_seconds(args: dict[str, Any]) -> float:
    value = args.get("cutoff_seconds")
    if value is None:
        value = args.get("cutoff_time")

    if value is None:
        raise McpServerError("cutoff_seconds or cutoff_time is required")

    if isinstance(value, (int, float)):
        seconds = float(value)
    elif isinstance(value, str):
        seconds = parse_cutoff_time(value)
    else:
        raise McpServerError("cutoff must be a number of seconds or a time string")

    if not math.isfinite(seconds) or seconds < 0:
        raise McpServerError("cutoff_seconds must be a finite non-negative number")

    return seconds


def parse_cutoff_time(value: str) -> float:
    trimmed = value.strip()
    if not trimmed:
        raise McpServerError("cutoff_time cannot be empty")

    try:
        return float(trimmed)
    except ValueError:
        pass

    parts = trimmed.split(":")
    if len(parts) not in (2, 3):
        raise McpServerError("cutoff_time must look like MM:SS or HH:MM:SS")

    try:
        numbers = [float(part) for part in parts]
    except ValueError as exc:
        raise McpServerError("cutoff_time contains a non-numeric part") from exc

    if any(part < 0 for part in numbers):
        raise McpServerError("cutoff_time cannot be negative")

    if len(numbers) == 2:
        hours = 0.0
        minutes, seconds = numbers
    else:
        hours, minutes, seconds = numbers

    if minutes >= 60 or seconds >= 60:
        raise McpServerError("cutoff_time minutes and seconds must be less than 60")

    return hours * 3600 + minutes * 60 + seconds


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def table_has_column(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)


def transcript_speaker_expr(conn: sqlite3.Connection, alias: str | None = None) -> str:
    if not table_has_column(conn, "transcripts", "speaker"):
        return "NULL AS speaker"

    prefix = f"{alias}." if alias else ""
    return f"{prefix}speaker AS speaker"


def parse_summary_result(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}

    if isinstance(value, dict):
        return value

    return {"value": value}


def summary_markdown(summary_data: dict[str, Any] | None) -> str | None:
    if not summary_data:
        return None
    markdown = summary_data.get("markdown")
    if isinstance(markdown, str):
        return markdown
    raw = summary_data.get("raw")
    if isinstance(raw, str):
        return raw
    return None


def format_transcript_text_line(segment: dict[str, Any]) -> str:
    prefix = "Me: " if segment.get("speaker") == "me" else ""
    return f"{prefix}{segment['text']}"


def get_notes(conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any] | None:
    if not table_exists(conn, "meeting_notes"):
        return None
    row = conn.execute(
        """
        SELECT meeting_id, notes_markdown, notes_json, created_at, updated_at
        FROM meeting_notes
        WHERE meeting_id = ?
        """,
        (meeting_id,),
    ).fetchone()
    return row_to_dict(row) if row else None


def get_summary_row(conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any] | None:
    if not table_exists(conn, "summary_processes"):
        return None
    row = conn.execute(
        """
        SELECT meeting_id, status, created_at, updated_at, error, result,
               start_time, end_time, chunk_count, processing_time, metadata
        FROM summary_processes
        WHERE meeting_id = ?
        """,
        (meeting_id,),
    ).fetchone()
    if not row:
        return None
    data = row_to_dict(row)
    data["data"] = parse_summary_result(data.pop("result", None))
    return data


def require_meeting(conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, title, created_at, updated_at, folder_path
        FROM meetings
        WHERE id = ?
        """,
        (meeting_id,),
    ).fetchone()
    if not row:
        raise McpServerError(f"Meeting not found: {meeting_id}")
    return row_to_dict(row)


def list_meetings(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    limit = clamp_limit(args.get("limit"), default=25, maximum=200)
    query = str(args.get("query", "")).strip()

    with db.connect() as conn:
        where = ""
        params: list[Any] = []
        if query:
            where = "WHERE LOWER(m.title) LIKE ?"
            params.append(f"%{query.lower()}%")

        rows = conn.execute(
            f"""
            SELECT
                m.id,
                m.title,
                m.created_at,
                m.updated_at,
                m.folder_path,
                COUNT(t.id) AS transcript_count,
                sp.status AS summary_status,
                CASE WHEN mn.meeting_id IS NULL THEN 0 ELSE 1 END AS has_notes
            FROM meetings m
            LEFT JOIN transcripts t ON t.meeting_id = m.id
            LEFT JOIN summary_processes sp ON sp.meeting_id = m.id
            LEFT JOIN meeting_notes mn ON mn.meeting_id = m.id
            {where}
            GROUP BY m.id
            ORDER BY m.created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        ).fetchall()

    return {
        "database_path": str(db.resolve_path()),
        "meetings": [row_to_dict(row) for row in rows],
    }


def get_meeting(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")

    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        transcript_count = conn.execute(
            "SELECT COUNT(*) AS count FROM transcripts WHERE meeting_id = ?",
            (meeting_id,),
        ).fetchone()["count"]

        meeting["transcript_count"] = transcript_count
        meeting["summary"] = get_summary_row(conn, meeting_id)
        meeting["notes"] = get_notes(conn, meeting_id)

    return {"meeting": meeting}


def get_transcript(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    include_segments = bool(args.get("include_segments", True))
    include_raw_text = bool(args.get("include_raw_text", True))
    limit_segments = args.get("limit_segments")
    limit_clause = ""
    params: list[Any] = [meeting_id]

    if limit_segments is not None:
        limit_clause = "LIMIT ?"
        params.append(clamp_limit(limit_segments, default=1000, maximum=10000))

    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        speaker_expr = transcript_speaker_expr(conn)
        rows = conn.execute(
            f"""
            SELECT id, transcript AS text, timestamp, {speaker_expr},
                   audio_start_time,
                   audio_end_time, duration
            FROM transcripts
            WHERE meeting_id = ?
            ORDER BY
                CASE WHEN audio_start_time IS NULL THEN 1 ELSE 0 END,
                audio_start_time ASC,
                timestamp ASC
            {limit_clause}
            """,
            tuple(params),
        ).fetchall()

    segments = [row_to_dict(row) for row in rows]
    result: dict[str, Any] = {"meeting": meeting, "segment_count": len(segments)}
    if include_segments:
        result["segments"] = segments
    if include_raw_text:
        result["raw_text"] = "\n".join(format_transcript_text_line(segment) for segment in segments)
    return result


def get_summary(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        summary = get_summary_row(conn, meeting_id)
    return {"meeting": meeting, "summary": summary}


def search_transcripts(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    query = require_arg(args, "query").strip()
    if not query:
        raise McpServerError("query cannot be empty")
    limit = clamp_limit(args.get("limit"), default=20, maximum=100)

    search = f"%{query.lower()}%"
    with db.connect() as conn:
        speaker_expr = transcript_speaker_expr(conn, "t")
        rows = conn.execute(
            f"""
            SELECT m.id AS meeting_id, m.title, t.id AS transcript_id,
                   t.transcript AS text, t.timestamp, {speaker_expr},
                   t.audio_start_time,
                   t.audio_end_time, t.duration
            FROM meetings m
            JOIN transcripts t ON t.meeting_id = m.id
            WHERE LOWER(t.transcript) LIKE ?
            ORDER BY m.created_at DESC, t.audio_start_time ASC
            LIMIT ?
            """,
            (search, limit),
        ).fetchall()

    results = []
    for row in rows:
        item = row_to_dict(row)
        item["context"] = make_context(item["text"], query)
        results.append(item)

    return {"query": query, "results": results}


def ask_meeting(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    question = require_arg(args, "question")
    limit = clamp_limit(args.get("limit"), default=12, maximum=40)

    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        summary = get_summary_row(conn, meeting_id)
        speaker_expr = transcript_speaker_expr(conn)
        rows = conn.execute(
            f"""
            SELECT id AS transcript_id, transcript AS text, timestamp, {speaker_expr},
                   audio_start_time, audio_end_time, duration
            FROM transcripts
            WHERE meeting_id = ?
            ORDER BY
                CASE WHEN audio_start_time IS NULL THEN 1 ELSE 0 END,
                audio_start_time ASC,
                timestamp ASC
            LIMIT 4000
            """,
            (meeting_id,),
        ).fetchall()

    keywords_for_question = question_keywords(question)
    evidence = []
    for row in rows:
        item = row_to_dict(row)
        item["score"] = score_question_match(item["text"], keywords_for_question)
        item["citation"] = format_evidence_citation(item)
        evidence.append(item)

    evidence.sort(key=lambda item: (-item["score"], item.get("audio_start_time") is None, item.get("audio_start_time") or 0))
    selected = [item for item in evidence if item["score"] > 0][:limit]
    if not selected:
        selected = evidence[: min(limit, len(evidence))]
    selected.sort(key=lambda item: (item.get("audio_start_time") is None, item.get("audio_start_time") or 0))

    return {
        "meeting": meeting,
        "question": question,
        "answer": build_extract_ask_answer(question, selected),
        "evidence": selected,
        "summary": summary,
        "generated": False,
        "note": "MCP ask_meeting returns transcript evidence only; let the calling agent synthesize further if needed.",
    }


def get_action_items(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        summary = get_summary_row(conn, meeting_id)

    markdown = summary_markdown(summary.get("data") if summary else None)
    action_markdown = extract_action_section(markdown or "")
    return {
        "meeting": meeting,
        "summary_status": summary.get("status") if summary else None,
        "action_items_markdown": action_markdown,
    }


def preview_trim_transcript(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    cutoff_seconds = parse_cutoff_seconds(args)

    with db.connect(readonly=True) as conn:
        meeting = require_meeting(conn, meeting_id)
        trim = build_trim_preview(conn, meeting_id, cutoff_seconds, applied=False)

    return {"meeting": meeting, "trim": trim}


def trim_transcript_after(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    cutoff_seconds = parse_cutoff_seconds(args)
    if args.get("confirm") is not True:
        raise McpServerError("trim_transcript_after requires confirm=true")

    with db.connect(readonly=False) as conn:
        conn.execute("BEGIN")
        try:
            meeting = require_meeting(conn, meeting_id)
            preview = build_trim_preview(conn, meeting_id, cutoff_seconds, applied=False)

            if preview["deleted_count"] > 0:
                deleted = conn.execute(
                    """
                    DELETE FROM transcripts
                    WHERE meeting_id = ?
                      AND audio_start_time IS NOT NULL
                      AND audio_start_time > ?
                    """,
                    (meeting_id, cutoff_seconds),
                ).rowcount
                summary_invalidated = (
                    conn.execute(
                        "DELETE FROM summary_processes WHERE meeting_id = ?",
                        (meeting_id,),
                    ).rowcount
                    > 0
                )
                conn.execute(
                    "DELETE FROM transcript_chunks WHERE meeting_id = ?",
                    (meeting_id,),
                )
                conn.execute(
                    "UPDATE meetings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (meeting_id,),
                )
                preview["deleted_count"] = deleted
                preview["remaining_count"] = preview["total_count"] - deleted
                preview["summary_invalidated"] = summary_invalidated

            preview["applied"] = True
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {"meeting": meeting, "trim": preview}


def build_trim_preview(
    conn: sqlite3.Connection,
    meeting_id: str,
    cutoff_seconds: float,
    applied: bool,
) -> dict[str, Any]:
    total_count = conn.execute(
        "SELECT COUNT(*) AS count FROM transcripts WHERE meeting_id = ?",
        (meeting_id,),
    ).fetchone()["count"]
    deleted_count = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM transcripts
        WHERE meeting_id = ?
          AND audio_start_time IS NOT NULL
          AND audio_start_time > ?
        """,
        (meeting_id, cutoff_seconds),
    ).fetchone()["count"]
    summary_count = conn.execute(
        "SELECT COUNT(*) AS count FROM summary_processes WHERE meeting_id = ?",
        (meeting_id,),
    ).fetchone()["count"]

    return {
        "meeting_id": meeting_id,
        "cutoff_seconds": cutoff_seconds,
        "deleted_count": deleted_count,
        "remaining_count": total_count - deleted_count,
        "total_count": total_count,
        "summary_invalidated": summary_count > 0 and deleted_count > 0,
        "last_kept_segment": get_trim_boundary_segment(
            conn,
            meeting_id,
            cutoff_seconds,
            comparator="<=",
            order="DESC",
        ),
        "first_removed_segment": get_trim_boundary_segment(
            conn,
            meeting_id,
            cutoff_seconds,
            comparator=">",
            order="ASC",
        ),
        "last_removed_segment": get_trim_boundary_segment(
            conn,
            meeting_id,
            cutoff_seconds,
            comparator=">",
            order="DESC",
        ),
        "applied": applied,
    }


def get_trim_boundary_segment(
    conn: sqlite3.Connection,
    meeting_id: str,
    cutoff_seconds: float,
    comparator: str,
    order: str,
) -> dict[str, Any] | None:
    if comparator not in ("<=", ">") or order not in ("ASC", "DESC"):
        raise McpServerError("Invalid trim boundary query")

    speaker_expr = transcript_speaker_expr(conn)
    row = conn.execute(
        f"""
        SELECT id, transcript AS text, timestamp, {speaker_expr},
               audio_start_time, audio_end_time
        FROM transcripts
        WHERE meeting_id = ?
          AND audio_start_time IS NOT NULL
          AND audio_start_time {comparator} ?
        ORDER BY audio_start_time {order}
        LIMIT 1
        """,
        (meeting_id, cutoff_seconds),
    ).fetchone()

    return row_to_dict(row) if row else None


def require_arg(args: dict[str, Any], name: str) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise McpServerError(f"{name} is required")
    return value.strip()


def make_context(text: str, query: str, radius: int = 180) -> str:
    lower_text = text.lower()
    lower_query = query.lower()
    idx = lower_text.find(lower_query)
    if idx == -1:
        return text[: radius * 2]
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def question_keywords(question: str) -> list[str]:
    stopwords = {
        "about",
        "after",
        "also",
        "and",
        "are",
        "can",
        "did",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "how",
        "into",
        "is",
        "it",
        "me",
        "of",
        "on",
        "or",
        "said",
        "say",
        "that",
        "the",
        "their",
        "there",
        "they",
        "this",
        "to",
        "was",
        "we",
        "what",
        "when",
        "where",
        "who",
        "why",
        "with",
        "you",
    }
    words = []
    for word in re.findall(r"[a-zA-Z0-9]+", question.lower()):
        if len(word) > 2 and word not in stopwords:
            words.append(word)
        if len(words) >= 20:
            break
    return words


def score_question_match(text: str, words: list[str]) -> int:
    lower = text.lower()
    return sum(2 for word in words if word in lower)


def format_evidence_citation(item: dict[str, Any]) -> str:
    timestamp = format_seconds(item.get("audio_start_time")) if item.get("audio_start_time") is not None else item.get("timestamp", "")
    speaker = item.get("speaker") or "Unknown"
    return f"[{timestamp}] {speaker}: {item.get('text', '').strip()}"


def build_extract_ask_answer(question: str, evidence: list[dict[str, Any]]) -> str:
    if not evidence:
        return f"No transcript evidence found for: {question}"
    bullets = "\n".join(f"- {item['citation']}" for item in evidence[:6])
    return f"Relevant transcript evidence for: {question}\n\n{bullets}"


def extract_action_section(markdown: str) -> str | None:
    if not markdown.strip():
        return None

    section_markers = (
        "**Action Items / Todos**",
        "**Action Items**",
        "**Todos**",
        "## Action Items / Todos",
        "## Action Items",
        "## Todos",
    )

    lines = markdown.splitlines()
    start_index = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if any(stripped.startswith(marker) for marker in section_markers):
            start_index = index
            break

    if start_index is None:
        return None

    collected = [lines[start_index]]
    for line in lines[start_index + 1 :]:
        stripped = line.strip()
        if stripped.startswith("**") and stripped.endswith("**") and collected:
            break
        if stripped.startswith("## ") and collected:
            break
        collected.append(line)

    value = "\n".join(collected).strip()
    return value or None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_workhub_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
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
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_work_items_kind_status
            ON work_items(kind, status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_work_items_meeting
            ON work_items(meeting_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_work_items_owner
            ON work_items(owner, status);

        CREATE TABLE IF NOT EXISTS work_context_packs (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            work_item_id TEXT,
            title TEXT NOT NULL,
            role_scope TEXT NOT NULL,
            pack_markdown TEXT NOT NULL,
            source_kind TEXT NOT NULL DEFAULT 'generated',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
            FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_context_packs_meeting
            ON work_context_packs(meeting_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_work_context_packs_item
            ON work_context_packs(work_item_id, created_at);

        CREATE TABLE IF NOT EXISTS work_pre_meeting_briefs (
            id TEXT PRIMARY KEY,
            meeting_id TEXT,
            title TEXT NOT NULL,
            starts_at TEXT,
            attendee_hint TEXT,
            brief_markdown TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'generated',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_pre_meeting_briefs_meeting
            ON work_pre_meeting_briefs(meeting_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_work_pre_meeting_briefs_starts_at
            ON work_pre_meeting_briefs(starts_at);
        """
    )


def workhub_available(conn: sqlite3.Connection) -> bool:
    return table_exists(conn, "work_items")


def format_seconds(value: Any) -> str:
    try:
        seconds = max(0, int(float(value)))
    except (TypeError, ValueError):
        return str(value or "")
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def clean_work_line(line: str) -> str:
    value = line.strip().strip("|").strip()
    value = re.sub(r"^\s*[-*]\s+", "", value)
    value = re.sub(r"^\s*\d+[.)]\s+", "", value)
    value = re.sub(r"\*\*", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def is_section_heading(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("#") or (stripped.startswith("**") and stripped.endswith("**"))


def is_action_like(lower: str) -> bool:
    return any(
        marker in lower
        for marker in (
            "todo",
            "action item",
            "follow up",
            "needs to",
            "need to",
            "should ",
            "will ",
            "assigned",
            "owner",
            " due ",
        )
    )


def is_decision_like(lower: str) -> bool:
    return any(marker in lower for marker in ("decided", "decision", "agreed", "approved", "confirmed", "finalized"))


def is_risk_like(lower: str) -> bool:
    return any(marker in lower for marker in ("risk", "concern", "blocked", "blocker", "issue", "problem", "uncertain"))


def is_question_like(lower: str) -> bool:
    return any(marker in lower for marker in ("open question", "question", "unclear", "clarify", "tbd"))


def role_scope_for(text: str) -> str:
    lower = text.lower()
    if any(word in lower for word in ("deploy", "api", "bug", "code", "frontend", "backend", "kubernetes", "pull request", "documentation")):
        return "engineering"
    if any(word in lower for word in ("customer", "sales", "account", "renewal", "support")):
        return "sales_cs"
    if any(word in lower for word in ("roadmap", "feature", "user story", "launch", "priority")):
        return "product"
    if any(word in lower for word in ("hire", "people", "team", "onboarding", "workshop")):
        return "people"
    if any(word in lower for word in ("strategy", "budget", "revenue", "risk", "decision")):
        return "leadership"
    return "general"


def parse_owner_due_title(text: str) -> tuple[str | None, str | None, str]:
    parts = [part.strip() for part in text.split("|") if part.strip() and not set(part.strip()) <= {"-", ":"}]
    owner = None
    due = None
    title = text

    if len(parts) >= 4 and not parts[0].lower().startswith("owner"):
        owner = None if parts[0].lower() in ("unknown", "tbd", "none") else parts[0]
        title = parts[1]
        due = None if parts[2].lower() in ("unknown", "tbd", "none") else parts[2]

    owner_match = re.search(r"\bowner\s*:\s*([^;,.|]+)", text, flags=re.IGNORECASE)
    if owner_match:
        owner = owner_match.group(1).strip()

    due_match = re.search(r"\bdue\s*:\s*([^;,.|]+)", text, flags=re.IGNORECASE)
    if due_match:
        due = due_match.group(1).strip()

    if re.search(r"\bI\b|\bI'm\b|\bme\b|Me:", text):
        owner = owner or "Me"

    title = re.sub(r"\bowner\s*:\s*[^;,.|]+", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\bdue\s*:\s*[^;,.|]+", "", title, flags=re.IGNORECASE)
    title = clean_work_line(title)
    return owner, due, title[:220] or clean_work_line(text)[:220]


def work_item_id(meeting_id: str, kind: str, title: str) -> str:
    digest = hashlib.sha1(f"{meeting_id}:{kind}:{title.lower()}".encode("utf-8")).hexdigest()[:16]
    return f"work-{meeting_id}-{kind}-{digest}"


def load_workhub_context(conn: sqlite3.Connection, meeting_id: str) -> dict[str, Any]:
    meeting = require_meeting(conn, meeting_id)
    speaker_expr = transcript_speaker_expr(conn)
    rows = conn.execute(
        f"""
        SELECT transcript AS text, timestamp, {speaker_expr}, audio_start_time
        FROM transcripts
        WHERE meeting_id = ?
        ORDER BY
            CASE WHEN audio_start_time IS NULL THEN 1 ELSE 0 END,
            audio_start_time ASC,
            timestamp ASC
        LIMIT 3000
        """,
        (meeting_id,),
    ).fetchall()

    transcript_lines = []
    for row in rows:
        data = row_to_dict(row)
        timestamp = format_seconds(data.get("audio_start_time")) if data.get("audio_start_time") is not None else data["timestamp"]
        prefix = "Me: " if data.get("speaker") == "me" else ""
        transcript_lines.append(f"[{timestamp}] {prefix}{data['text'].strip()}")

    summary = get_summary_row(conn, meeting_id)
    return {
        "meeting": meeting,
        "transcript_lines": transcript_lines,
        "transcript_text": "\n".join(transcript_lines),
        "summary_markdown": summary_markdown(summary.get("data") if summary else None),
    }


def find_evidence(context: dict[str, Any], title: str) -> str:
    words = [word.lower() for word in re.findall(r"[a-zA-Z0-9]{4,}", title)[:6]]
    for line in context["transcript_lines"]:
        lower = line.lower()
        if words and any(word in lower for word in words):
            return line
    return context["transcript_lines"][0] if context["transcript_lines"] else title


def extract_work_candidates(context: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = []
    source_text = context.get("summary_markdown") or context["transcript_text"]

    for raw_line in source_text.splitlines():
        line = clean_work_line(raw_line)
        lower = line.lower()
        if len(line) < 6 or is_section_heading(raw_line) or set(line) <= {"-", "|", ":"}:
            continue

        kind = None
        if is_action_like(lower):
            kind = "action"
        elif is_decision_like(lower):
            kind = "decision"
        elif is_risk_like(lower):
            kind = "risk"
        elif is_question_like(lower):
            kind = "question"

        if kind:
            owner, due, title = parse_owner_due_title(line)
            candidates.append(
                {
                    "kind": kind,
                    "title": title,
                    "details": line,
                    "owner": owner,
                    "due_date": due,
                    "role_scope": role_scope_for(line),
                    "evidence": find_evidence(context, title),
                    "source": "summary-sync",
                }
            )

    for line in context["transcript_lines"][:500]:
        lower = line.lower()
        kind = "decision" if is_decision_like(lower) else "risk" if is_risk_like(lower) else "question" if is_question_like(lower) else None
        if kind:
            owner, due, title = parse_owner_due_title(line)
            candidates.append(
                {
                    "kind": kind,
                    "title": title,
                    "details": line,
                    "owner": owner,
                    "due_date": due,
                    "role_scope": role_scope_for(line),
                    "evidence": line,
                    "source": "transcript-heuristic",
                }
            )

    seen = set()
    unique = []
    for candidate in candidates:
        key = (candidate["kind"], candidate["title"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique[:80]


def sync_work_items(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    with db.connect(readonly=False) as conn:
        conn.execute("BEGIN")
        try:
            ensure_workhub_schema(conn)
            context = load_workhub_context(conn, meeting_id)
            candidates = extract_work_candidates(context)
            changed = 0
            for candidate in candidates:
                item_id = work_item_id(meeting_id, candidate["kind"], candidate["title"])
                stamp = now_iso()
                changed += conn.execute(
                    """
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
                    """,
                    (
                        item_id,
                        meeting_id,
                        candidate["kind"],
                        candidate["title"],
                        candidate["details"],
                        candidate["owner"],
                        candidate["due_date"],
                        candidate["role_scope"],
                        candidate["evidence"],
                        candidate["source"],
                        stamp,
                        stamp,
                    ),
                ).rowcount
            items = query_work_items(conn, meeting_id=meeting_id, limit=200)
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {"meeting_id": meeting_id, "inserted_or_updated": changed, "item_count": len(items), "items": items}


def query_work_items(
    conn: sqlite3.Connection,
    *,
    kind: str | None = None,
    status: str | None = None,
    meeting_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if not workhub_available(conn):
        return []
    rows = conn.execute(
        """
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
        """,
        (kind, kind, status, status, meeting_id, meeting_id, limit),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def list_work_items(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    limit = clamp_limit(args.get("limit"), default=100, maximum=500)
    with db.connect(readonly=True) as conn:
        items = query_work_items(
            conn,
            kind=args.get("kind"),
            status=args.get("status"),
            meeting_id=args.get("meeting_id"),
            limit=limit,
        )
    return {"items": items}


def update_work_item_status(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    item_id = require_arg(args, "item_id")
    status = require_arg(args, "status")
    if status not in ("open", "in_progress", "blocked", "done", "dismissed"):
        raise McpServerError("status must be open, in_progress, blocked, done, or dismissed")
    agent_notes = args.get("agent_notes")
    if agent_notes is not None and not isinstance(agent_notes, str):
        raise McpServerError("agent_notes must be a string")

    stamp = now_iso()
    completed_at = stamp if status == "done" else None
    with db.connect(readonly=False) as conn:
        ensure_workhub_schema(conn)
        changed = conn.execute(
            """
            UPDATE work_items
            SET status = ?,
                agent_notes = COALESCE(?, agent_notes),
                updated_at = ?,
                completed_at = CASE WHEN ? = 'done' THEN ? ELSE NULL END
            WHERE id = ?
            """,
            (status, agent_notes, stamp, status, completed_at, item_id),
        ).rowcount
        if changed == 0:
            raise McpServerError(f"Work item not found: {item_id}")
        row = conn.execute(
            """
            SELECT wi.id, wi.meeting_id, m.title AS meeting_title, wi.kind, wi.title, wi.details,
                   wi.owner, wi.due_date, wi.status, wi.role_scope, wi.evidence, wi.agent_notes,
                   wi.source, wi.created_at, wi.updated_at, wi.completed_at
            FROM work_items wi
            JOIN meetings m ON m.id = wi.meeting_id
            WHERE wi.id = ?
            """,
            (item_id,),
        ).fetchone()
    return {"item": row_to_dict(row)}


def item_list_markdown(items: list[dict[str, Any]], kind: str, only_active: bool = True) -> str:
    filtered = [
        item
        for item in items
        if item["kind"] == kind and (not only_active or item["status"] not in ("done", "dismissed"))
    ]
    if not filtered:
        return "- None captured yet.\n"
    return "\n".join(
        f"- [{item['status']}] {item['title']} - owner: {item.get('owner') or 'Unknown'}; due: {item.get('due_date') or 'TBD'}; evidence: {item.get('evidence') or 'Not captured'}"
        for item in filtered
    ) + "\n"


def relevant_transcript_excerpt(context: dict[str, Any], focus: str | None = None) -> str:
    source = focus or context["meeting"]["title"]
    words = [word.lower() for word in re.findall(r"[a-zA-Z0-9]{4,}", source)[:6]]
    excerpts = []
    for line in context["transcript_lines"]:
        lower = line.lower()
        if not words or any(word in lower for word in words):
            excerpts.append(f"- {line}")
        if len(excerpts) >= 8:
            break
    if not excerpts:
        excerpts = [f"- {line}" for line in context["transcript_lines"][:8]]
    return "\n".join(excerpts) or "- No transcript excerpts available."


def acceptance_for_role(role_scope: str) -> str:
    return {
        "engineering": "- Link code changes to evidence.\n- Include test commands and outcomes.\n- Call out rollout and rollback notes.",
        "product": "- State user impact.\n- Separate committed decisions from open questions.\n- Identify success metrics.",
        "sales_cs": "- Convert asks into customer-safe follow-ups.\n- Keep dates and owners explicit.\n- Note risks that affect commitments.",
        "people": "- Capture owners, attendees, and follow-up timing.\n- Separate policy/process decisions from suggestions.",
        "leadership": "- Summarize decisions, risks, owners, and deadlines.\n- Highlight blockers needing escalation.",
        "general": "- Keep owner, due date, source evidence, and status explicit.",
    }.get(role_scope, "- Keep owner, due date, source evidence, and status explicit.")


def role_guidance(role_scope: str) -> str:
    return {
        "engineering": "Focus on implementation tasks, technical risks, dependencies, and verification evidence.",
        "product": "Focus on decisions, open questions, customer impact, and roadmap implications.",
        "sales_cs": "Focus on customer commitments, relationship risks, and follow-up messages.",
        "people": "Focus on people/process actions, workshops, enablement, and ownership clarity.",
        "leadership": "Focus on decisions, risks, deadlines, and items needing escalation.",
        "general": "Focus on clear actions, decisions, risks, and useful context.",
    }.get(role_scope, "Focus on clear actions, decisions, risks, and useful context.")


def build_context_pack_markdown(
    context: dict[str, Any],
    selected_item: dict[str, Any] | None,
    items: list[dict[str, Any]],
    role_scope: str,
) -> str:
    meeting = context["meeting"]
    sections = [
        f"# Agent Context Pack: {meeting['title']}",
        f"- Meeting: {meeting['id']}\n- Created: {meeting['created_at']}\n- Role lens: {role_scope}",
        f"## Acceptance Criteria\n{acceptance_for_role(role_scope)}",
    ]
    if selected_item:
        sections.insert(
            2,
            (
                "## Target Work Item\n"
                f"- ID: {selected_item['id']}\n"
                f"- Type: {selected_item['kind']}\n"
                f"- Status: {selected_item['status']}\n"
                f"- Owner: {selected_item.get('owner') or 'Unknown'}\n"
                f"- Due: {selected_item.get('due_date') or 'TBD'}\n\n"
                f"{selected_item.get('details') or selected_item['title']}"
            ),
        )
    sections.extend(
        [
            "## Open Actions\n" + item_list_markdown(items, "action"),
            "## Decisions\n" + item_list_markdown(items, "decision", only_active=False),
            "## Risks And Questions\n" + item_list_markdown(items, "risk") + item_list_markdown(items, "question"),
            "## Relevant Transcript Excerpts\n" + relevant_transcript_excerpt(context, selected_item["title"] if selected_item else None),
        ]
    )
    return "\n\n".join(sections)


def create_context_pack(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    work_item_id = args.get("work_item_id")
    role_scope = str(args.get("role_scope") or "engineering")
    sync_work_items(db, {"meeting_id": meeting_id})

    with db.connect(readonly=False) as conn:
        ensure_workhub_schema(conn)
        context = load_workhub_context(conn, meeting_id)
        items = query_work_items(conn, meeting_id=meeting_id, limit=500)
        selected_item = None
        if work_item_id:
            selected_item = next((item for item in items if item["id"] == work_item_id), None)
            if selected_item is None:
                raise McpServerError(f"Work item not found for meeting: {work_item_id}")

        markdown = build_context_pack_markdown(context, selected_item, items, role_scope)
        stamp = now_iso()
        pack_id = f"context-{hashlib.sha1((meeting_id + role_scope + stamp).encode('utf-8')).hexdigest()[:16]}"
        title = selected_item["title"] if selected_item else f"{context['meeting']['title']} context pack"
        conn.execute(
            """
            INSERT INTO work_context_packs
                (id, meeting_id, work_item_id, title, role_scope, pack_markdown, source_kind, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?)
            """,
            (pack_id, meeting_id, work_item_id, title, role_scope, markdown, stamp, stamp),
        )

    return {
        "context_pack": {
            "id": pack_id,
            "meeting_id": meeting_id,
            "work_item_id": work_item_id,
            "title": title,
            "role_scope": role_scope,
            "pack_markdown": markdown,
            "source_kind": "generated",
            "created_at": stamp,
            "updated_at": stamp,
        }
    }


def get_role_output(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    role_scope = str(args.get("role_scope") or "general")
    sync_work_items(db, {"meeting_id": meeting_id})
    with db.connect(readonly=True) as conn:
        context = load_workhub_context(conn, meeting_id)
        items = query_work_items(conn, meeting_id=meeting_id, limit=500)
    markdown = "\n\n".join(
        [
            f"# {role_scope.replace('_', ' ').title()} Output: {context['meeting']['title']}",
            role_guidance(role_scope),
            "## Actions\n" + item_list_markdown(items, "action"),
            "## Decisions\n" + item_list_markdown(items, "decision", only_active=False),
            "## Risks\n" + item_list_markdown(items, "risk"),
            "## Open Questions\n" + item_list_markdown(items, "question"),
            "## Evidence\n" + relevant_transcript_excerpt(context),
        ]
    )
    return {"meeting_id": meeting_id, "role_scope": role_scope, "markdown": markdown}


def title_pattern(title: str) -> str:
    cleaned = re.sub(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[:.]\d{2}\b", "", title.lower())
    words = [word for word in re.findall(r"[a-z0-9]+", cleaned) if len(word) > 2]
    return " ".join(words[:5]) or title.lower().strip()


def get_recurring_memory(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    sync_work_items(db, {"meeting_id": meeting_id})
    with db.connect(readonly=False) as conn:
        ensure_workhub_schema(conn)
        context = load_workhub_context(conn, meeting_id)
        pattern = title_pattern(context["meeting"]["title"])
        rows = conn.execute(
            """
            SELECT id, title, created_at
            FROM meetings
            WHERE id != ?
              AND LOWER(title) LIKE LOWER(?)
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (meeting_id, f"%{pattern}%"),
        ).fetchall()
        related_meetings = [row_to_dict(row) for row in rows]
        related_items: list[dict[str, Any]] = []
        for meeting in related_meetings:
            try:
                sync_work_items(db, {"meeting_id": meeting["id"]})
            except McpServerError:
                pass
            related_items.extend(query_work_items(conn, meeting_id=meeting["id"], limit=50))

    markdown = "\n\n".join(
        [
            f"# Recurring Meeting Memory: {context['meeting']['title']}",
            "## Related Meetings\n"
            + ("\n".join(f"- {meeting['title']} ({meeting['created_at']})" for meeting in related_meetings) or "- None found yet."),
            "## Carry-Forward Open Items\n" + item_list_markdown(related_items, "action"),
            "## Prior Decisions\n" + item_list_markdown(related_items, "decision", only_active=False),
            "## Prior Risks And Questions\n" + item_list_markdown(related_items, "risk") + item_list_markdown(related_items, "question"),
        ]
    )
    return {"meeting_id": meeting_id, "title_pattern": pattern, "related_meetings": related_meetings, "markdown": markdown}


def create_pre_meeting_brief(db: MeetilyDatabase, args: dict[str, Any]) -> dict[str, Any]:
    title = require_arg(args, "title")
    starts_at = args.get("starts_at")
    attendee_hint = args.get("attendee_hint")
    related_meeting_id = args.get("related_meeting_id")
    pattern = title_pattern(title)

    with db.connect(readonly=False) as conn:
        ensure_workhub_schema(conn)
        rows = conn.execute(
            """
            SELECT id, title, created_at
            FROM meetings
            WHERE (? IS NULL OR id = ?)
               OR LOWER(title) LIKE LOWER(?)
            ORDER BY created_at DESC
            LIMIT 8
            """,
            (related_meeting_id, related_meeting_id, f"%{pattern}%"),
        ).fetchall()
        related_meetings = [row_to_dict(row) for row in rows]
        related_items: list[dict[str, Any]] = []
        for meeting in related_meetings:
            try:
                sync_work_items(db, {"meeting_id": meeting["id"]})
            except McpServerError:
                pass
            related_items.extend(query_work_items(conn, meeting_id=meeting["id"], limit=50))

        markdown = "\n\n".join(
            [
                f"# Pre-Meeting Brief: {title}",
                f"- Starts: {starts_at or 'TBD'}\n- Attendees/context: {attendee_hint or 'Not provided'}",
                "## Open Follow-Ups To Review\n" + item_list_markdown(related_items, "action"),
                "## Decisions To Carry Forward\n" + item_list_markdown(related_items, "decision", only_active=False),
                "## Risks / Open Questions\n" + item_list_markdown(related_items, "risk") + item_list_markdown(related_items, "question"),
                "## Related Meetings\n"
                + ("\n".join(f"- {meeting['title']} ({meeting['created_at']})" for meeting in related_meetings) or "- None found."),
            ]
        )
        stamp = now_iso()
        brief_id = f"brief-{hashlib.sha1((title + stamp).encode('utf-8')).hexdigest()[:16]}"
        conn.execute(
            """
            INSERT INTO work_pre_meeting_briefs
                (id, meeting_id, title, starts_at, attendee_hint, brief_markdown, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?)
            """,
            (brief_id, related_meeting_id, title, starts_at, attendee_hint, markdown, stamp, stamp),
        )

    return {
        "brief": {
            "id": brief_id,
            "meeting_id": related_meeting_id,
            "title": title,
            "starts_at": starts_at,
            "attendee_hint": attendee_hint,
            "brief_markdown": markdown,
            "source": "generated",
            "created_at": stamp,
            "updated_at": stamp,
        }
    }


TOOLS: dict[str, dict[str, Any]] = {
    "list_meetings": {
        "description": "List local Meetily meetings with transcript and summary status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                "query": {"type": "string", "description": "Optional title search."},
            },
        },
        "handler": list_meetings,
    },
    "get_meeting": {
        "description": "Get meeting metadata, summary state, and notes without transcript segments.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_meeting,
    },
    "get_transcript": {
        "description": "Get raw transcript text and/or timestamped transcript segments for a meeting.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "include_segments": {"type": "boolean", "default": True},
                "include_raw_text": {"type": "boolean", "default": True},
                "limit_segments": {"type": "integer", "minimum": 1, "maximum": 10000},
            },
            "required": ["meeting_id"],
        },
        "handler": get_transcript,
    },
    "get_summary": {
        "description": "Get the stored summary process state and summary JSON/markdown for a meeting.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_summary,
    },
    "search_transcripts": {
        "description": "Search raw transcript segments across local meetings.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
        },
        "handler": search_transcripts,
    },
    "ask_meeting": {
        "description": "Ask a question about one meeting and return timestamped transcript evidence for the calling agent to synthesize.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "question": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 40},
            },
            "required": ["meeting_id", "question"],
        },
        "handler": ask_meeting,
    },
    "get_action_items": {
        "description": "Extract the action-items/todos section from a meeting summary, when present.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_action_items,
    },
    "sync_work_items": {
        "description": "Sync local Work Hub items for a meeting from its summary/transcript into action, decision, risk, and question records.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": sync_work_items,
    },
    "list_work_items": {
        "description": "List Work Hub items for agents to pick up, filtered by kind, status, or meeting.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["action", "decision", "risk", "question"]},
                "status": {"type": "string", "enum": ["open", "in_progress", "blocked", "done", "dismissed"]},
                "meeting_id": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500},
            },
        },
        "handler": list_work_items,
    },
    "update_work_item_status": {
        "description": "Let an agent mark a Work Hub item open, in_progress, blocked, done, or dismissed with optional notes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string"},
                "status": {"type": "string", "enum": ["open", "in_progress", "blocked", "done", "dismissed"]},
                "agent_notes": {"type": "string"},
            },
            "required": ["item_id", "status"],
        },
        "handler": update_work_item_status,
    },
    "create_context_pack": {
        "description": "Generate a markdown context pack for a meeting or specific Work Hub item for a coding/business agent.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "work_item_id": {"type": "string"},
                "role_scope": {
                    "type": "string",
                    "enum": ["engineering", "product", "sales_cs", "people", "leadership", "general"],
                },
            },
            "required": ["meeting_id"],
        },
        "handler": create_context_pack,
    },
    "get_role_output": {
        "description": "Generate a role-specific meeting output for engineering, product, sales/customer success, people, leadership, or general use.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "role_scope": {
                    "type": "string",
                    "enum": ["engineering", "product", "sales_cs", "people", "leadership", "general"],
                },
            },
            "required": ["meeting_id"],
        },
        "handler": get_role_output,
    },
    "get_recurring_memory": {
        "description": "Build local recurring-meeting memory from similarly titled prior meetings and their Work Hub items.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_recurring_memory,
    },
    "create_pre_meeting_brief": {
        "description": "Generate and store a local pre-meeting brief from prior matching meetings and open Work Hub items.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "starts_at": {"type": "string"},
                "attendee_hint": {"type": "string"},
                "related_meeting_id": {"type": "string"},
            },
            "required": ["title"],
        },
        "handler": create_pre_meeting_brief,
    },
    "preview_trim_transcript": {
        "description": "Preview removing transcript segments that start after a recording timestamp.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "cutoff_seconds": {
                    "type": "number",
                    "description": "Recording-relative cutoff in seconds. Segments with audio_start_time greater than this are removed.",
                },
                "cutoff_time": {
                    "type": "string",
                    "description": "Alternative cutoff format such as MM:SS, HH:MM:SS, or seconds as a string.",
                },
            },
            "required": ["meeting_id"],
        },
        "handler": preview_trim_transcript,
    },
    "trim_transcript_after": {
        "description": "Delete transcript segments that start after a recording timestamp and clear stale summary/cache data. Requires confirm=true.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "cutoff_seconds": {
                    "type": "number",
                    "description": "Recording-relative cutoff in seconds. Segments with audio_start_time greater than this are deleted.",
                },
                "cutoff_time": {
                    "type": "string",
                    "description": "Alternative cutoff format such as MM:SS, HH:MM:SS, or seconds as a string.",
                },
                "confirm": {
                    "type": "boolean",
                    "description": "Must be true to apply the destructive trim.",
                },
            },
            "required": ["meeting_id", "confirm"],
        },
        "handler": trim_transcript_after,
    },
}


def tool_definitions() -> list[dict[str, Any]]:
    result = []
    for name, definition in TOOLS.items():
        result.append(
            {
                "name": name,
                "description": definition["description"],
                "inputSchema": definition["inputSchema"],
            }
        )
    return result


class MeetilyMcpServer:
    def __init__(self, db: MeetilyDatabase) -> None:
        self.db = db

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        request_id = message.get("id")

        if method and method.startswith("notifications/"):
            return None

        try:
            if method == "initialize":
                params = message.get("params") if isinstance(message.get("params"), dict) else {}
                protocol_version = params.get("protocolVersion", DEFAULT_PROTOCOL_VERSION)
                return result(
                    request_id,
                    {
                        "protocolVersion": protocol_version,
                        "capabilities": {"tools": {}, "resources": {}},
                        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                    },
                )

            if method == "ping":
                return result(request_id, {})

            if method == "tools/list":
                return result(request_id, {"tools": tool_definitions()})

            if method == "tools/call":
                return result(request_id, self.call_tool(message.get("params")))

            if method == "resources/list":
                return result(request_id, self.list_resources())

            if method == "resources/read":
                return result(request_id, self.read_resource(message.get("params")))

            raise McpServerError(f"Unknown method: {method}")
        except McpServerError as exc:
            if method == "tools/call":
                return result(request_id, tool_error(str(exc)))
            return error(request_id, -32602, str(exc))
        except Exception as exc:  # pragma: no cover - defensive server boundary
            print(traceback.format_exc(), file=sys.stderr)
            return error(request_id, -32603, f"Internal error: {exc}")

    def call_tool(self, params: Any) -> dict[str, Any]:
        if not isinstance(params, dict):
            raise McpServerError("tools/call params must be an object")
        name = params.get("name")
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            raise McpServerError("tool arguments must be an object")
        tool = TOOLS.get(str(name))
        if not tool:
            raise McpServerError(f"Unknown tool: {name}")
        data = tool["handler"](self.db, args)
        return text_result(data)

    def list_resources(self) -> dict[str, Any]:
        payload = list_meetings(self.db, {"limit": 50})
        resources = [{"uri": "meetily://meetings", "name": "Meetily meetings", "mimeType": "application/json"}]
        for meeting in payload["meetings"]:
            meeting_id = meeting["id"]
            title = meeting["title"]
            resources.extend(
                [
                    {
                        "uri": f"meetily://meeting/{meeting_id}/transcript",
                        "name": f"{title} transcript",
                        "mimeType": "application/json",
                    },
                    {
                        "uri": f"meetily://meeting/{meeting_id}/summary",
                        "name": f"{title} summary",
                        "mimeType": "application/json",
                    },
                    {
                        "uri": f"meetily://meeting/{meeting_id}/notes",
                        "name": f"{title} notes",
                        "mimeType": "application/json",
                    },
                ]
            )
        return {"resources": resources}

    def read_resource(self, params: Any) -> dict[str, Any]:
        if not isinstance(params, dict) or not isinstance(params.get("uri"), str):
            raise McpServerError("resources/read requires a uri")

        uri = params["uri"]
        parsed = urlparse(uri)
        if parsed.scheme != "meetily":
            raise McpServerError(f"Unsupported resource URI: {uri}")

        if parsed.netloc == "meetings" and not parsed.path:
            data = list_meetings(self.db, {"limit": 100})
        elif parsed.netloc == "meeting":
            parts = [unquote(part) for part in parsed.path.split("/") if part]
            if len(parts) != 2:
                raise McpServerError(f"Unsupported meeting resource URI: {uri}")
            meeting_id, kind = parts
            if kind == "transcript":
                data = get_transcript(self.db, {"meeting_id": meeting_id})
            elif kind == "summary":
                data = get_summary(self.db, {"meeting_id": meeting_id})
            elif kind == "notes":
                with self.db.connect() as conn:
                    data = {
                        "meeting": require_meeting(conn, meeting_id),
                        "notes": get_notes(conn, meeting_id),
                    }
            else:
                raise McpServerError(f"Unsupported meeting resource kind: {kind}")
        else:
            raise McpServerError(f"Unsupported resource URI: {uri}")

        return {
            "contents": [
                {
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json.dumps(data, ensure_ascii=False, indent=2),
                }
            ]
        }


def text_result(data: Any) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(data, ensure_ascii=False, indent=2),
            }
        ]
    }


def tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def result(request_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def serve(server: MeetilyMcpServer) -> None:
    for raw_line in sys.stdin.buffer:
        line = raw_line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("message must be an object")
        except Exception as exc:
            response = error(None, -32700, f"Parse error: {exc}")
        else:
            response = server.handle(message)

        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MCP server for Meetily local data")
    parser.add_argument(
        "--database",
        help=f"Path to {DATABASE_FILENAME}. Defaults to {DATABASE_ENV} or app data directory lookup.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    serve(MeetilyMcpServer(MeetilyDatabase(args.database)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
