"""Agent Source tools for indexed local coding-agent history."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from orxa_mcp_core import McpServerError, OrxaDatabase, clamp_limit, row_to_dict, table_exists


def agent_sources_available(conn: sqlite3.Connection) -> bool:
    return table_exists(conn, "agent_source_documents")


def agent_source_result(row: sqlite3.Row, query_terms: list[str] | None = None) -> dict[str, Any]:
    content = row["content"] or ""
    summary = row["summary"] or ""
    terms = query_terms or []
    snippet = summary
    if terms:
        lowered = content.lower()
        positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
        if positions:
            start = max(0, min(positions) - 180)
            snippet = content[start : start + 520]

    score = 1
    if terms:
        haystack = f"{row['title']} {row['path']} {content}".lower()
        score = sum(haystack.count(term) for term in terms)

    return {
        "id": row["id"],
        "source_id": row["source_id"],
        "source_label": row["source_label"],
        "title": row["title"],
        "path": row["path"],
        "project_path": row["project_path"],
        "session_date": row["session_date"],
        "modified_at": row["modified_at"],
        "snippet": " ".join(snippet.split()),
        "score": score,
    }


def tokenize_agent_query(query: str) -> list[str]:
    return [term for term in re.split(r"[^A-Za-z0-9_-]+", query.lower()) if len(term) > 2][:12]


def list_agent_sources(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    with db.connect(readonly=True) as conn:
        if not table_exists(conn, "agent_source_configs"):
            return {"sources": [], "indexed_documents": 0}
        sources = [
            row_to_dict(row)
            for row in conn.execute(
                """
                SELECT id, label, enabled, paths_json, index_full_content, updated_at
                FROM agent_source_configs
                ORDER BY label
                """
            ).fetchall()
        ]
        for source in sources:
            _normalize_agent_source(source)
        indexed = 0
        if agent_sources_available(conn):
            indexed = conn.execute("SELECT COUNT(*) FROM agent_source_documents").fetchone()[0]
        return {"sources": sources, "indexed_documents": indexed}


def _normalize_agent_source(source: dict[str, Any]) -> None:
    source["enabled"] = bool(source["enabled"])
    source["index_full_content"] = bool(source["index_full_content"])
    try:
        source["paths"] = json.loads(source.pop("paths_json") or "[]")
    except json.JSONDecodeError:
        source["paths"] = []


def search_agent_sessions(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    query = (args.get("query") or "").strip()
    limit = clamp_limit(args.get("limit"), 20, 100)
    source_ids = set(args.get("source_ids") or [])
    terms = tokenize_agent_query(query)

    with db.connect(readonly=True) as conn:
        if not agent_sources_available(conn):
            return {"query": query, "results": [], "message": "No Agent Sources index exists yet."}
        rows = conn.execute(
            """
            SELECT id, source_id, source_label, title, path, project_path,
                   session_date, modified_at, content, summary
            FROM agent_source_documents
            ORDER BY modified_at DESC
            LIMIT 800
            """
        ).fetchall()

    results = []
    for row in rows:
        if source_ids and row["source_id"] not in source_ids:
            continue
        result = agent_source_result(row, terms)
        if terms and result["score"] <= 0:
            continue
        results.append(result)

    results.sort(key=lambda item: (item["score"], item["modified_at"]), reverse=True)
    return {"query": query, "results": results[:limit]}


def get_agent_activity(db: OrxaDatabase, args: dict[str, Any]) -> dict[str, Any]:
    day = (args.get("day") or "").strip()
    if not re.match(r"^20\d\d-\d\d-\d\d$", day):
        raise McpServerError("day must be YYYY-MM-DD")
    limit = clamp_limit(args.get("limit"), 50, 200)
    source_ids = set(args.get("source_ids") or [])

    with db.connect(readonly=True) as conn:
        if not agent_sources_available(conn):
            return {"day": day, "results": [], "message": "No Agent Sources index exists yet."}
        rows = conn.execute(
            """
            SELECT id, source_id, source_label, title, path, project_path,
                   session_date, modified_at, content, summary
            FROM agent_source_documents
            WHERE substr(COALESCE(session_date, modified_at), 1, 10) = ?
            ORDER BY COALESCE(session_date, modified_at) DESC
            LIMIT ?
            """,
            (day, limit),
        ).fetchall()

    results = []
    for row in rows:
        if source_ids and row["source_id"] not in source_ids:
            continue
        results.append(agent_source_result(row))
    return {"day": day, "results": results}
