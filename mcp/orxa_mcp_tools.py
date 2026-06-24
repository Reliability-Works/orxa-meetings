"""MCP tool registry for Orxa local data."""

from __future__ import annotations

from typing import Any

from orxa_mcp_agent_sources import (
    get_agent_activity,
    list_agent_sources,
    search_agent_sessions,
)
from orxa_mcp_meetings import (
    ask_meeting,
    get_action_items,
    get_meeting,
    get_summary,
    get_transcript,
    list_meetings,
    preview_trim_transcript,
    search_transcripts,
    trim_transcript_after,
)

TOOLS: dict[str, dict[str, Any]] = {
    "list_meetings": {
        "description": "List local Orxa meetings with transcript and summary status.",
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
        "description": (
            "Get meeting metadata, summary state, and notes without transcript segments."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_meeting,
    },
    "get_transcript": {
        "description": (
            "Get raw transcript text and/or timestamped transcript segments for a meeting."
        ),
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
        "description": (
            "Get the stored summary process state and summary JSON/markdown for a meeting."
        ),
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
        "description": (
            "Ask a question about one meeting and return timestamped transcript "
            "evidence for the calling agent to synthesize."
        ),
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
        "description": (
            "Extract the action-items/todos section from a meeting summary, when present."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"meeting_id": {"type": "string"}},
            "required": ["meeting_id"],
        },
        "handler": get_action_items,
    },
    "list_agent_sources": {
        "description": (
            "List local Agent Sources configured in Orxa and the current indexed-document count."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
        "handler": list_agent_sources,
    },
    "search_agent_sessions": {
        "description": (
            "Search indexed local coding-agent history from enabled Agent "
            "Sources such as Codex, Claude, Cursor, and memory summaries."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "source_ids": {"type": "array", "items": {"type": "string"}},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
        },
        "handler": search_agent_sessions,
    },
    "get_agent_activity": {
        "description": "Fetch indexed local agent-session activity for a specific day.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "day": {"type": "string", "description": "YYYY-MM-DD"},
                "source_ids": {"type": "array", "items": {"type": "string"}},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "required": ["day"],
        },
        "handler": get_agent_activity,
    },
    "preview_trim_transcript": {
        "description": (
            "Preview removing transcript segments that start after a recording timestamp."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "cutoff_seconds": {
                    "type": "number",
                    "description": (
                        "Recording-relative cutoff in seconds. Segments with "
                        "audio_start_time greater than this are removed."
                    ),
                },
                "cutoff_time": {
                    "type": "string",
                    "description": (
                        "Alternative cutoff format such as MM:SS, HH:MM:SS, or seconds as a string."
                    ),
                },
            },
            "required": ["meeting_id"],
        },
        "handler": preview_trim_transcript,
    },
    "trim_transcript_after": {
        "description": (
            "Delete transcript segments that start after a recording timestamp "
            "and clear stale summary/cache data. Requires confirm=true."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "meeting_id": {"type": "string"},
                "cutoff_seconds": {
                    "type": "number",
                    "description": (
                        "Recording-relative cutoff in seconds. Segments with "
                        "audio_start_time greater than this are deleted."
                    ),
                },
                "cutoff_time": {
                    "type": "string",
                    "description": (
                        "Alternative cutoff format such as MM:SS, HH:MM:SS, or seconds as a string."
                    ),
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
