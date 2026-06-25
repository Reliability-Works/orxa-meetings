"""Core database and validation helpers for the Orxa MCP server."""

from __future__ import annotations

import math
import os
import platform
import sqlite3
from pathlib import Path
from typing import Any

SERVER_NAME = "orxa-local"
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL_VERSION = "2024-11-05"
DATABASE_ENV = "ORXA_DB_PATH"
DATABASE_FILENAME = "meeting_minutes.sqlite"


class McpServerError(Exception):
    """Expected server-side error surfaced to MCP clients."""


class OrxaConnection(sqlite3.Connection):
    def __exit__(self, exc_type: Any, exc_value: Any, traceback_value: Any) -> bool | None:
        try:
            return super().__exit__(exc_type, exc_value, traceback_value)
        finally:
            self.close()


class OrxaDatabase:
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
            f"Orxa database not found. Set {DATABASE_ENV} or pass --database.\nChecked:\n{checked}"
        )

    def connect(self, readonly: bool = True) -> sqlite3.Connection:
        db_path = self.resolve_path()
        mode = "ro" if readonly else "rw"
        uri = f"file:{db_path.as_posix()}?mode={mode}"
        conn = sqlite3.connect(uri, uri=True, factory=OrxaConnection)
        conn.row_factory = sqlite3.Row
        return conn


def default_database_candidates() -> list[Path]:
    home = Path.home()
    names = ("com.orxa.ai", "orxa", "Orxa")
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
    return dict(zip(row.keys(), row, strict=True))


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
        if seconds >= 60:
            raise McpServerError("cutoff_time seconds must be less than 60")
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


def require_arg(args: dict[str, Any], name: str) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise McpServerError(f"{name} is required")
    return value.strip()
