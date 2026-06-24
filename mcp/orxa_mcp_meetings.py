"""Meeting, transcript, summary, and trim tools for the Orxa MCP server."""

from __future__ import annotations

import sqlite3
from typing import Any

from orxa_mcp_core import (
    McpServerError,
    OrxaDatabase,
    clamp_limit,
    parse_cutoff_seconds,
    require_arg,
    row_to_dict,
    table_exists,
    transcript_speaker_expr,
)
from orxa_mcp_text import (
    build_extract_ask_answer,
    extract_action_section,
    format_evidence_citation,
    format_transcript_text_line,
    make_context,
    parse_summary_result,
    question_keywords,
    score_question_match,
    summary_markdown,
)


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


def list_meetings(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
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


def get_meeting(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
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


def get_transcript(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    include_segments = bool(args.get("include_segments", True))
    include_raw_text = bool(args.get("include_raw_text", True))
    limit_clause = ""
    params: list[Any] = [meeting_id]

    if args.get("limit_segments") is not None:
        limit_clause = "LIMIT ?"
        params.append(clamp_limit(args.get("limit_segments"), default=1000, maximum=10000))

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


def get_summary(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    with db.connect() as conn:
        meeting = require_meeting(conn, meeting_id)
        summary = get_summary_row(conn, meeting_id)
    return {"meeting": meeting, "summary": summary}


def search_transcripts(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    query = require_arg(args, "query").strip()
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


def ask_meeting(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
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

    words = question_keywords(question)
    evidence = []
    for row in rows:
        item = row_to_dict(row)
        item["score"] = score_question_match(item["text"], words)
        item["citation"] = format_evidence_citation(item)
        evidence.append(item)

    evidence.sort(
        key=lambda item: (
            -item["score"],
            item.get("audio_start_time") is None,
            item.get("audio_start_time") or 0,
        )
    )
    selected = [item for item in evidence if item["score"] > 0][:limit]
    if not selected:
        selected = evidence[: min(limit, len(evidence))]
    selected.sort(
        key=lambda item: (
            item.get("audio_start_time") is None,
            item.get("audio_start_time") or 0,
        )
    )

    return {
        "meeting": meeting,
        "question": question,
        "answer": build_extract_ask_answer(question, selected),
        "evidence": selected,
        "summary": summary,
        "generated": False,
        "note": (
            "MCP ask_meeting returns transcript evidence only; let the calling "
            "agent synthesize further if needed."
        ),
    }


def get_action_items(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
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


def preview_trim_transcript(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    cutoff_seconds = parse_cutoff_seconds(args)

    with db.connect(readonly=True) as conn:
        meeting = require_meeting(conn, meeting_id)
        trim = build_trim_preview(conn, meeting_id, cutoff_seconds, applied=False)

    return {"meeting": meeting, "trim": trim}


def trim_transcript_after(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    meeting_id = require_arg(args, "meeting_id")
    cutoff_seconds = parse_cutoff_seconds(args)
    if args.get("confirm") is not True:
        raise McpServerError("trim_transcript_after requires confirm=true")

    with db.connect(readonly=False) as conn:
        conn.execute("BEGIN")
        try:
            meeting = require_meeting(conn, meeting_id)
            preview = build_trim_preview(conn, meeting_id, cutoff_seconds, applied=False)
            _apply_trim(conn, meeting_id, cutoff_seconds, preview)
            preview["applied"] = True
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {"meeting": meeting, "trim": preview}


def _apply_trim(
    conn: sqlite3.Connection,
    meeting_id: str,
    cutoff_seconds: float,
    preview: dict[str, Any],
) -> None:
    if preview["deleted_count"] <= 0:
        return

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
    conn.execute("DELETE FROM transcript_chunks WHERE meeting_id = ?", (meeting_id,))
    conn.execute("UPDATE meetings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (meeting_id,))
    preview["deleted_count"] = deleted
    preview["remaining_count"] = preview["total_count"] - deleted
    preview["summary_invalidated"] = summary_invalidated


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
