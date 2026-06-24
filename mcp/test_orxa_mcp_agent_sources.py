"""Agent-source tests for the Orxa MCP server."""

from __future__ import annotations

import sqlite3
from contextlib import closing

from test_orxa_mcp_helpers import OrxaMcpTestCase, orxa_mcp


class OrxaMcpAgentSourceTest(OrxaMcpTestCase):
    def test_agent_sources_can_be_listed_and_searched(self):
        sources = orxa_mcp.list_agent_sources(self.db, {})
        search = orxa_mcp.search_agent_sessions(self.db, {"query": "calendar permission"})
        activity = orxa_mcp.get_agent_activity(self.db, {"day": "2026-06-22"})

        self.assertEqual(sources["indexed_documents"], 1)
        self.assertEqual(search["results"][0]["source_label"], "Codex sessions")
        self.assertIn("EventKit", search["results"][0]["snippet"])
        self.assertEqual(activity["results"][0]["title"], "Fix calendar access")

    def test_agent_sources_edge_cases(self):
        bad_path = self.db_path.with_name("bad_agent.sqlite")
        with closing(sqlite3.connect(bad_path)) as conn:
            conn.executescript(
                """
                CREATE TABLE agent_source_configs (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    enabled INTEGER NOT NULL,
                    paths_json TEXT NOT NULL,
                    index_full_content INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO agent_source_configs VALUES (
                    'bad', 'Bad source', 0, '{not-json', 0, '2026-06-22T09:05:00Z'
                );
                """
            )
            conn.commit()
        bad_db = orxa_mcp.OrxaDatabase(str(bad_path))
        sources = orxa_mcp.list_agent_sources(bad_db, {})
        self.assertEqual(sources["sources"][0]["paths"], [])
        self.assertEqual(sources["indexed_documents"], 0)

        no_agent_path = self.db_path.with_name("no_agent.sqlite")
        with closing(sqlite3.connect(no_agent_path)) as conn:
            conn.execute("CREATE TABLE meetings (id TEXT)")
        no_agent_db = orxa_mcp.OrxaDatabase(str(no_agent_path))
        self.assertEqual(orxa_mcp.list_agent_sources(no_agent_db, {})["sources"], [])
        no_agent_search = orxa_mcp.search_agent_sessions(no_agent_db, {})
        self.assertIn("No Agent Sources", no_agent_search["message"])
        self.assertIn(
            "No Agent Sources",
            orxa_mcp.get_agent_activity(no_agent_db, {"day": "2026-06-22"})["message"],
        )

        filtered = orxa_mcp.search_agent_sessions(
            self.db,
            {"query": "calendar", "source_ids": ["other"]},
        )
        self.assertEqual(filtered["results"], [])
        no_score = orxa_mcp.search_agent_sessions(self.db, {"query": "nonexistentterm"})
        self.assertEqual(no_score["results"], [])
        with self.assertRaisesRegex(orxa_mcp.McpServerError, "day must be YYYY-MM-DD"):
            orxa_mcp.get_agent_activity(self.db, {"day": "today"})
        filtered_activity = orxa_mcp.get_agent_activity(
            self.db,
            {"day": "2026-06-22", "source_ids": ["other"]},
        )
        self.assertEqual(filtered_activity["results"], [])
