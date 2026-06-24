"""Text parsing and formatting helpers for Orxa MCP responses."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any


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


def format_seconds(value: Any) -> str:
    try:
        total = max(0, int(float(value)))
    except (TypeError, ValueError):
        return ""
    minutes, seconds = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def format_evidence_citation(item: dict[str, Any]) -> str:
    timestamp = (
        format_seconds(item.get("audio_start_time"))
        if item.get("audio_start_time") is not None
        else item.get("timestamp", "")
    )
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
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
