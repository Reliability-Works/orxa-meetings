#!/usr/bin/env python3
"""MCP server for Meetily meeting data.

The server speaks JSON-RPC over stdio and exposes local Meetily transcripts,
summaries, and notes from the app's SQLite database. Transcript trimming is the
only write operation, and it requires explicit confirmation. The server
intentionally avoids reading settings/API key tables.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import sqlite3
import sys
import traceback
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
    "get_action_items": {
        "description": "Extract the action-items/todos section from a meeting summary, when present.",
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_action_items,
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
