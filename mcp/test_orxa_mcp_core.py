"""Core helper tests for the Orxa MCP server."""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from unittest import mock

import orxa_mcp_core
from test_orxa_mcp_helpers import OrxaMcpTestCase, orxa_mcp


class OrxaMcpCoreTest(OrxaMcpTestCase):
    def test_default_database_candidates_cover_platforms(self):
        with (
            mock.patch.object(orxa_mcp_core.Path, "home", return_value=Path("/Users/tester")),
            mock.patch.object(orxa_mcp_core.platform, "system", return_value="Darwin"),
        ):
            darwin = orxa_mcp.default_database_candidates()
        self.assertIn(
            Path("/Users/tester/Library/Application Support/com.orxa.ai/meeting_minutes.sqlite"),
            darwin,
        )

        with (
            mock.patch.object(orxa_mcp_core.Path, "home", return_value=Path("/Users/tester")),
            mock.patch.object(orxa_mcp_core.platform, "system", return_value="Windows"),
            mock.patch.dict(os.environ, {"APPDATA": "/Users/tester/AppData/Roaming"}),
        ):
            windows = orxa_mcp.default_database_candidates()
        self.assertIn(Path("/Users/tester/AppData/Roaming/orxa/meeting_minutes.sqlite"), windows)

        with (
            mock.patch.object(orxa_mcp_core.Path, "home", return_value=Path("/home/tester")),
            mock.patch.object(orxa_mcp_core.platform, "system", return_value="Linux"),
            mock.patch.dict(
                os.environ,
                {"XDG_DATA_HOME": "/data", "XDG_CONFIG_HOME": "/config"},
            ),
        ):
            linux = orxa_mcp.default_database_candidates()
        self.assertEqual(linux[0], Path("/data/com.orxa.ai/meeting_minutes.sqlite"))
        self.assertEqual(linux[-1], Path("/config/Orxa/meeting_minutes.sqlite"))

    def test_resolve_path_uses_env_and_reports_missing_candidates(self):
        with (
            mock.patch.dict(os.environ, {orxa_mcp.DATABASE_ENV: str(self.db_path)}),
            mock.patch.object(orxa_mcp_core, "default_database_candidates", return_value=[]),
        ):
            self.assertEqual(orxa_mcp.OrxaDatabase().resolve_path(), self.db_path)

        missing = self.db_path.with_name("missing.sqlite")
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch.object(orxa_mcp_core, "default_database_candidates", return_value=[missing]),
            self.assertRaisesRegex(orxa_mcp.McpServerError, "Orxa database not found"),
        ):
            orxa_mcp.OrxaDatabase().resolve_path()

    def test_limit_and_cutoff_parsing_validation(self):
        self.assertEqual(orxa_mcp.clamp_limit(None, 10, 20), 10)
        self.assertEqual(orxa_mcp.clamp_limit("500", 10, 20), 20)
        self.assertEqual(orxa_mcp.clamp_limit("-3", 10, 20), 1)
        with self.assertRaisesRegex(orxa_mcp.McpServerError, "limit must be an integer"):
            orxa_mcp.clamp_limit("many", 10, 20)

        self.assertEqual(orxa_mcp.parse_cutoff_seconds({"cutoff_time": "01:02:03"}), 3723)
        self.assertEqual(orxa_mcp.parse_cutoff_seconds({"cutoff_time": "111:42"}), 6702)
        self.assertEqual(orxa_mcp.parse_cutoff_seconds({"cutoff_time": "12.5"}), 12.5)
        invalid_args = [
            {},
            {"cutoff_seconds": object()},
            {"cutoff_seconds": float("inf")},
            {"cutoff_time": ""},
            {"cutoff_time": "1:2:3:4"},
            {"cutoff_time": "1:nope"},
            {"cutoff_time": "-1:00"},
            {"cutoff_time": "01:99"},
            {"cutoff_time": "1:61:42"},
        ]
        for args in invalid_args:
            with self.subTest(args=args), self.assertRaises(orxa_mcp.McpServerError):
                orxa_mcp.parse_cutoff_seconds(args)

    def test_summary_and_format_helpers_cover_edge_cases(self):
        self.assertIsNone(orxa_mcp.parse_summary_result(None))
        self.assertEqual(orxa_mcp.parse_summary_result("not json"), {"raw": "not json"})
        self.assertEqual(orxa_mcp.parse_summary_result("[1]"), {"value": [1]})
        self.assertIsNone(orxa_mcp.summary_markdown(None))
        self.assertEqual(orxa_mcp.summary_markdown({"raw": "plain"}), "plain")
        self.assertIsNone(orxa_mcp.summary_markdown({"value": []}))
        self.assertEqual(orxa_mcp.make_context("abcdef", "zzz", radius=2), "abcd")
        self.assertEqual(orxa_mcp.format_seconds("bad"), "")
        self.assertEqual(orxa_mcp.format_seconds(3661), "01:01:01")
        self.assertIn("No transcript evidence", orxa_mcp.build_extract_ask_answer("anything", []))
        self.assertIsNone(orxa_mcp.extract_action_section(""))
        self.assertIsNone(orxa_mcp.extract_action_section("## Summary\nNo action heading"))
        keywords = orxa_mcp.question_keywords(" ".join(f"word{i}" for i in range(30)))
        self.assertEqual(keywords[-1], "word19")
        self.assertRegex(orxa_mcp.now_iso(), r"Z$")

    def test_action_section_stops_at_next_section_styles(self):
        bold = "**Action Items**\n- one\n**Risks**\n- no"
        heading = "## Todos\n- one\n## Risks\n- no"

        self.assertEqual(orxa_mcp.extract_action_section(bold), "**Action Items**\n- one")
        self.assertEqual(orxa_mcp.extract_action_section(heading), "## Todos\n- one")

    def test_optional_tables_and_missing_rows_return_none(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            self.assertIsNone(orxa_mcp.get_notes(conn, "missing"))
            self.assertIsNone(orxa_mcp.get_summary_row(conn, "missing"))

        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE meetings (
                    id TEXT,
                    title TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    folder_path TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE transcripts (
                    id TEXT,
                    meeting_id TEXT,
                    transcript TEXT,
                    timestamp TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE summary_processes (
                    meeting_id TEXT PRIMARY KEY,
                    status TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    error TEXT,
                    result TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    chunk_count INTEGER,
                    processing_time REAL,
                    metadata TEXT
                )
                """
            )
            self.assertEqual(orxa_mcp.transcript_speaker_expr(conn), "NULL AS speaker")
            self.assertIsNone(orxa_mcp.get_summary_row(conn, "missing"))
            self.assertIsNone(orxa_mcp.get_notes(conn, "missing"))
            with self.assertRaisesRegex(orxa_mcp.McpServerError, "Meeting not found"):
                orxa_mcp.require_meeting(conn, "missing")

    def test_require_arg_validation(self):
        with self.assertRaisesRegex(orxa_mcp.McpServerError, "meeting_id is required"):
            orxa_mcp.require_arg({"meeting_id": " "}, "meeting_id")
