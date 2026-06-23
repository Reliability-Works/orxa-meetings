import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("meetily_mcp.py")
SPEC = importlib.util.spec_from_file_location("meetily_mcp", MODULE_PATH)
meetily_mcp = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(meetily_mcp)


class MeetilyMcpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "meeting_minutes.sqlite"
        self._create_database(self.db_path)
        self.db = meetily_mcp.MeetilyDatabase(str(self.db_path))

    def tearDown(self):
        self.tmp.cleanup()

    def _create_database(self, path):
        conn = sqlite3.connect(path)
        conn.executescript(
            """
            CREATE TABLE meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                folder_path TEXT
            );

            CREATE TABLE transcripts (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                transcript TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                summary TEXT,
                action_items TEXT,
                key_points TEXT,
                audio_start_time REAL,
                audio_end_time REAL,
                duration REAL,
                speaker TEXT
            );

            CREATE TABLE summary_processes (
                meeting_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error TEXT,
                result TEXT,
                start_time TEXT,
                end_time TEXT,
                chunk_count INTEGER DEFAULT 0,
                processing_time REAL DEFAULT 0.0,
                metadata TEXT
            );

            CREATE TABLE meeting_notes (
                meeting_id TEXT PRIMARY KEY NOT NULL,
                notes_markdown TEXT,
                notes_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE transcript_chunks (
                meeting_id TEXT NOT NULL,
                meeting_name TEXT,
                transcript_text TEXT NOT NULL,
                model TEXT NOT NULL,
                model_name TEXT NOT NULL,
                chunk_size INTEGER,
                overlap INTEGER,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT INTO meetings VALUES (?, ?, ?, ?, ?)",
            ("meeting-1", "Roadmap Sync", "2026-06-22T09:00:00Z", "2026-06-22T10:00:00Z", "/tmp/meeting-1"),
        )
        conn.execute(
            "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
            ("transcript-1", "meeting-1", "Alice said Bob should send the deck by Friday.", "09:01:00", 5.0, 9.5, 4.5, "me"),
        )
        conn.execute(
            "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
            ("transcript-2", "meeting-1", "Bob confirmed he will follow up with Legal.", "09:02:00", 10.0, 13.0, 3.0, None),
        )
        conn.execute(
            "INSERT INTO summary_processes VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)",
            (
                "meeting-1",
                "completed",
                "2026-06-22T09:05:00Z",
                "2026-06-22T09:10:00Z",
                json.dumps(
                    {
                        "markdown": "**Summary**\n\nRoadmap was discussed.\n\n**Action Items / Todos**\n\n| **Owner** | Todo | Due | Status | Evidence |\n| --- | --- | --- | --- | --- |\n| Bob | Send the deck | Friday | Open | Alice said Bob should send the deck by Friday. |"
                    }
                ),
                "2026-06-22T09:05:00Z",
                "2026-06-22T09:10:00Z",
                1,
                2.0,
            ),
        )
        conn.execute(
            "INSERT INTO meeting_notes VALUES (?, ?, ?, ?, ?)",
            ("meeting-1", "- Customer asked for timeline", None, "2026-06-22T09:00:00Z", "2026-06-22T09:05:00Z"),
        )
        conn.execute(
            "INSERT INTO transcript_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("meeting-1", "Roadmap Sync", "Cached transcript content", "test", "test", None, None, "2026-06-22T09:05:00Z"),
        )
        conn.commit()
        conn.close()

    def test_list_meetings_includes_status_counts_and_notes(self):
        result = meetily_mcp.list_meetings(self.db, {})

        self.assertEqual(result["meetings"][0]["id"], "meeting-1")
        self.assertEqual(result["meetings"][0]["transcript_count"], 2)
        self.assertEqual(result["meetings"][0]["summary_status"], "completed")
        self.assertEqual(result["meetings"][0]["has_notes"], 1)

    def test_get_transcript_returns_ordered_segments_and_raw_text(self):
        result = meetily_mcp.get_transcript(self.db, {"meeting_id": "meeting-1"})

        self.assertEqual(result["segment_count"], 2)
        self.assertIn("Alice said Bob should send the deck", result["raw_text"])
        self.assertIn("Me: Alice said Bob should send the deck", result["raw_text"])
        self.assertEqual(result["segments"][0]["audio_start_time"], 5.0)
        self.assertEqual(result["segments"][0]["speaker"], "me")

    def test_get_summary_parses_stored_summary_json(self):
        result = meetily_mcp.get_summary(self.db, {"meeting_id": "meeting-1"})

        self.assertEqual(result["summary"]["status"], "completed")
        self.assertIn("Roadmap was discussed", result["summary"]["data"]["markdown"])

    def test_get_action_items_extracts_summary_section(self):
        result = meetily_mcp.get_action_items(self.db, {"meeting_id": "meeting-1"})

        self.assertIn("**Action Items / Todos**", result["action_items_markdown"])
        self.assertIn("Send the deck", result["action_items_markdown"])

    def test_sync_work_items_extracts_agent_ready_records(self):
        result = meetily_mcp.sync_work_items(self.db, {"meeting_id": "meeting-1"})

        self.assertGreaterEqual(result["item_count"], 1)
        actions = [item for item in result["items"] if item["kind"] == "action"]
        self.assertTrue(actions)
        self.assertIn("Send the deck", actions[0]["title"])
        self.assertEqual(actions[0]["status"], "open")

    def test_update_work_item_status_records_agent_notes(self):
        sync_result = meetily_mcp.sync_work_items(self.db, {"meeting_id": "meeting-1"})
        item_id = sync_result["items"][0]["id"]

        result = meetily_mcp.update_work_item_status(
            self.db,
            {"item_id": item_id, "status": "in_progress", "agent_notes": "Picked up by Codex"},
        )

        self.assertEqual(result["item"]["status"], "in_progress")
        self.assertEqual(result["item"]["agent_notes"], "Picked up by Codex")

    def test_create_context_pack_includes_actions_and_evidence(self):
        result = meetily_mcp.create_context_pack(
            self.db,
            {"meeting_id": "meeting-1", "role_scope": "engineering"},
        )

        markdown = result["context_pack"]["pack_markdown"]
        self.assertIn("Agent Context Pack", markdown)
        self.assertIn("Open Actions", markdown)
        self.assertIn("Alice said Bob should send the deck", markdown)

    def test_role_output_and_pre_meeting_brief_use_work_items(self):
        role_output = meetily_mcp.get_role_output(
            self.db,
            {"meeting_id": "meeting-1", "role_scope": "product"},
        )
        brief = meetily_mcp.create_pre_meeting_brief(
            self.db,
            {"title": "Roadmap Sync", "related_meeting_id": "meeting-1"},
        )

        self.assertIn("Product Output", role_output["markdown"])
        self.assertIn("Open Follow-Ups", brief["brief"]["brief_markdown"])
        self.assertIn("Send the deck", brief["brief"]["brief_markdown"])

    def test_search_transcripts_returns_context(self):
        result = meetily_mcp.search_transcripts(self.db, {"query": "Legal"})

        self.assertEqual(result["results"][0]["meeting_id"], "meeting-1")
        self.assertIn("Legal", result["results"][0]["context"])

    def test_ask_meeting_returns_cited_evidence(self):
        result = meetily_mcp.ask_meeting(
            self.db,
            {"meeting_id": "meeting-1", "question": "What was said about Legal?"},
        )

        self.assertFalse(result["generated"])
        self.assertIn("Legal", result["answer"])
        self.assertIn("[00:10]", result["evidence"][0]["citation"])
        self.assertEqual(result["evidence"][0]["speaker"], None)

    def test_json_rpc_tool_call(self):
        server = meetily_mcp.MeetilyMcpServer(self.db)
        response = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_summary", "arguments": {"meeting_id": "meeting-1"}},
            }
        )

        text = response["result"]["content"][0]["text"]
        self.assertIn("Roadmap Sync", text)

    def test_preview_trim_transcript_reports_tail_without_deleting(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
                ("transcript-junk", "meeting-1", "A video kept playing after the call.", "09:29:00", 1743.0, 1748.0, 5.0, None),
            )

        result = meetily_mcp.preview_trim_transcript(
            self.db,
            {"meeting_id": "meeting-1", "cutoff_time": "00:13"},
        )

        self.assertFalse(result["trim"]["applied"])
        self.assertEqual(result["trim"]["deleted_count"], 1)
        self.assertEqual(result["trim"]["remaining_count"], 2)
        self.assertTrue(result["trim"]["summary_invalidated"])
        self.assertIn("video kept playing", result["trim"]["first_removed_segment"]["text"])

        with sqlite3.connect(self.db_path) as conn:
            count = conn.execute("SELECT COUNT(*) FROM transcripts").fetchone()[0]
        self.assertEqual(count, 3)

    def test_trim_transcript_after_deletes_tail_and_invalidates_summary(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO transcripts VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)",
                ("transcript-junk", "meeting-1", "A video kept playing after the call.", "09:29:00", 1743.0, 1748.0, 5.0, None),
            )

        result = meetily_mcp.trim_transcript_after(
            self.db,
            {"meeting_id": "meeting-1", "cutoff_seconds": 13, "confirm": True},
        )

        self.assertTrue(result["trim"]["applied"])
        self.assertEqual(result["trim"]["deleted_count"], 1)
        self.assertEqual(result["trim"]["remaining_count"], 2)
        self.assertTrue(result["trim"]["summary_invalidated"])

        with sqlite3.connect(self.db_path) as conn:
            transcript_count = conn.execute("SELECT COUNT(*) FROM transcripts").fetchone()[0]
            summary_count = conn.execute("SELECT COUNT(*) FROM summary_processes").fetchone()[0]
            chunk_count = conn.execute("SELECT COUNT(*) FROM transcript_chunks").fetchone()[0]

        self.assertEqual(transcript_count, 2)
        self.assertEqual(summary_count, 0)
        self.assertEqual(chunk_count, 0)


if __name__ == "__main__":
    unittest.main()
