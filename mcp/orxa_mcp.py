#!/usr/bin/env python3
"""Thin MCP entrypoint for Orxa meeting data.

The server speaks JSON-RPC over stdio and exposes local Orxa transcripts,
summaries, and notes from the app's SQLite database. Transcript trimming is the
only write operation, and it requires explicit confirmation. The server
intentionally avoids reading settings/API key tables.
"""

from __future__ import annotations

# ruff: noqa: E402, I001

import sys
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from orxa_mcp_agent_sources import (
    agent_source_result,
    agent_sources_available,
    get_agent_activity,
    list_agent_sources,
    search_agent_sessions,
    tokenize_agent_query,
)
from orxa_mcp_core import (
    DATABASE_ENV,
    DATABASE_FILENAME,
    DEFAULT_PROTOCOL_VERSION,
    SERVER_NAME,
    SERVER_VERSION,
    McpServerError,
    OrxaConnection,
    OrxaDatabase,
    clamp_limit,
    default_database_candidates,
    parse_cutoff_seconds,
    parse_cutoff_time,
    require_arg,
    row_to_dict,
    table_exists,
    table_has_column,
    transcript_speaker_expr,
)
from orxa_mcp_meetings import (
    ask_meeting,
    build_trim_preview,
    get_action_items,
    get_meeting,
    get_notes,
    get_summary,
    get_summary_row,
    get_transcript,
    get_trim_boundary_segment,
    list_meetings,
    preview_trim_transcript,
    require_meeting,
    search_transcripts,
    trim_transcript_after,
)
from orxa_mcp_server import (
    OrxaMcpServer,
    error,
    parse_args,
    result,
    serve,
    text_result,
    tool_error,
)
from orxa_mcp_text import (
    build_extract_ask_answer,
    extract_action_section,
    format_evidence_citation,
    format_seconds,
    format_transcript_text_line,
    make_context,
    now_iso,
    parse_summary_result,
    question_keywords,
    score_question_match,
    summary_markdown,
)
from orxa_mcp_tools import TOOLS, tool_definitions

__all__ = [
    "DATABASE_ENV",
    "DATABASE_FILENAME",
    "DEFAULT_PROTOCOL_VERSION",
    "SERVER_NAME",
    "SERVER_VERSION",
    "TOOLS",
    "McpServerError",
    "OrxaConnection",
    "OrxaDatabase",
    "OrxaMcpServer",
    "agent_source_result",
    "agent_sources_available",
    "ask_meeting",
    "build_extract_ask_answer",
    "build_trim_preview",
    "clamp_limit",
    "default_database_candidates",
    "error",
    "extract_action_section",
    "format_evidence_citation",
    "format_seconds",
    "format_transcript_text_line",
    "get_action_items",
    "get_agent_activity",
    "get_meeting",
    "get_notes",
    "get_summary",
    "get_summary_row",
    "get_transcript",
    "get_trim_boundary_segment",
    "list_agent_sources",
    "list_meetings",
    "main",
    "make_context",
    "now_iso",
    "parse_args",
    "parse_cutoff_seconds",
    "parse_cutoff_time",
    "parse_summary_result",
    "preview_trim_transcript",
    "question_keywords",
    "require_arg",
    "require_meeting",
    "result",
    "row_to_dict",
    "score_question_match",
    "search_agent_sessions",
    "search_transcripts",
    "serve",
    "summary_markdown",
    "table_exists",
    "table_has_column",
    "text_result",
    "tokenize_agent_query",
    "tool_definitions",
    "tool_error",
    "transcript_speaker_expr",
    "trim_transcript_after",
]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    serve(OrxaMcpServer(OrxaDatabase(args.database)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
