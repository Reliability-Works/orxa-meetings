"""Meeting-tool tests for the Orxa MCP server."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from unittest import mock

import orxa_mcp_meetings
from test_orxa_mcp_helpers import OrxaMcpTestCase, insert_tail_segment, orxa_mcp


class OrxaMcpMeetingToolTest(OrxaMcpTestCase):
    def test_list_meetings_includes_status_counts_and_notes(self):
        result = orxa_mcp.list_meetings(self.db, {})

        self.assertEqual(result["meetings"][0]["id"], "meeting-1")
        self.assertEqual(result["meetings"][0]["transcript_count"], 2)
        self.assertEqual(result["meetings"][0]["summary_status"], "completed")
        self.assertEqual(result["meetings"][0]["has_notes"], 1)

    def test_list_meetings_filters_by_query(self):
        result = orxa_mcp.list_meetings(self.db, {"query": "roadmap", "limit": "5"})

        self.assertEqual([meeting["id"] for meeting in result["meetings"]], ["meeting-1"])

    def test_get_transcript_returns_ordered_segments_and_raw_text(self):
        result = orxa_mcp.get_transcript(self.db, {"meeting_id": "meeting-1"})

        self.assertEqual(result["segment_count"], 2)
        self.assertIn("Alice said Bob should send the deck", result["raw_text"])
        self.assertIn("Me: Alice said Bob should send the deck", result["raw_text"])
        self.assertEqual(result["segments"][0]["audio_start_time"], 5.0)
        self.assertEqual(result["segments"][0]["speaker"], "me")

    def test_get_summary_parses_stored_summary_json(self):
        result = orxa_mcp.get_summary(self.db, {"meeting_id": "meeting-1"})

        self.assertEqual(result["summary"]["status"], "completed")
        self.assertIn("Roadmap was discussed", result["summary"]["data"]["markdown"])

    def test_get_action_items_extracts_summary_section(self):
        result = orxa_mcp.get_action_items(self.db, {"meeting_id": "meeting-1"})

        self.assertIn("**Action Items / Todos**", result["action_items_markdown"])
        self.assertIn("Send the deck", result["action_items_markdown"])

    def test_search_transcripts_returns_context(self):
        result = orxa_mcp.search_transcripts(self.db, {"query": "Legal"})

        self.assertEqual(result["results"][0]["meeting_id"], "meeting-1")
        self.assertIn("Legal", result["results"][0]["context"])

    def test_ask_meeting_returns_cited_evidence(self):
        result = orxa_mcp.ask_meeting(
            self.db,
            {"meeting_id": "meeting-1", "question": "What was said about Legal?"},
        )

        self.assertFalse(result["generated"])
        self.assertIn("Legal", result["answer"])
        self.assertIn("[00:10]", result["evidence"][0]["citation"])
        self.assertEqual(result["evidence"][0]["speaker"], None)

    def test_preview_trim_transcript_reports_tail_without_deleting(self):
        insert_tail_segment(self.db_path)

        result = orxa_mcp.preview_trim_transcript(
            self.db,
            {"meeting_id": "meeting-1", "cutoff_time": "00:13"},
        )

        self.assertFalse(result["trim"]["applied"])
        self.assertEqual(result["trim"]["deleted_count"], 1)
        self.assertEqual(result["trim"]["remaining_count"], 2)
        self.assertTrue(result["trim"]["summary_invalidated"])
        self.assertIn("video kept playing", result["trim"]["first_removed_segment"]["text"])

        with closing(sqlite3.connect(self.db_path)) as conn:
            count = conn.execute("SELECT COUNT(*) FROM transcripts").fetchone()[0]
        self.assertEqual(count, 3)

    def test_trim_transcript_after_deletes_tail_and_invalidates_summary(self):
        insert_tail_segment(self.db_path)

        result = orxa_mcp.trim_transcript_after(
            self.db,
            {"meeting_id": "meeting-1", "cutoff_seconds": 13, "confirm": True},
        )

        self.assertTrue(result["trim"]["applied"])
        self.assertEqual(result["trim"]["deleted_count"], 1)
        self.assertEqual(result["trim"]["remaining_count"], 2)
        self.assertTrue(result["trim"]["summary_invalidated"])

        with closing(sqlite3.connect(self.db_path)) as conn:
            transcript_count = conn.execute("SELECT COUNT(*) FROM transcripts").fetchone()[0]
            summary_count = conn.execute("SELECT COUNT(*) FROM summary_processes").fetchone()[0]
            chunk_count = conn.execute("SELECT COUNT(*) FROM transcript_chunks").fetchone()[0]

        self.assertEqual(transcript_count, 2)
        self.assertEqual(summary_count, 0)
        self.assertEqual(chunk_count, 0)

    def test_get_meeting_and_transcript_options(self):
        meeting = orxa_mcp.get_meeting(self.db, {"meeting_id": "meeting-1"})
        self.assertEqual(meeting["meeting"]["transcript_count"], 2)
        self.assertIn("summary", meeting["meeting"])

        transcript = orxa_mcp.get_transcript(
            self.db,
            {"meeting_id": "meeting-1", "include_segments": False, "include_raw_text": False},
        )
        self.assertEqual(transcript["segment_count"], 2)
        self.assertNotIn("segments", transcript)
        self.assertNotIn("raw_text", transcript)

        limited = orxa_mcp.get_transcript(self.db, {"meeting_id": "meeting-1", "limit_segments": 1})
        self.assertEqual(limited["segment_count"], 1)

    def test_search_and_ask_error_or_fallback_paths(self):
        with self.assertRaisesRegex(orxa_mcp.McpServerError, "query is required"):
            orxa_mcp.search_transcripts(self.db, {"query": ""})

        result = orxa_mcp.ask_meeting(
            self.db,
            {"meeting_id": "meeting-1", "question": "???", "limit": 1},
        )
        self.assertEqual(len(result["evidence"]), 1)

    def test_action_items_without_matching_summary_section(self):
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.execute(
                "UPDATE summary_processes SET result = ? WHERE meeting_id = ?",
                (json.dumps({"markdown": "**Summary**\nNothing assigned."}), "meeting-1"),
            )
            conn.commit()

        result = orxa_mcp.get_action_items(self.db, {"meeting_id": "meeting-1"})

        self.assertIsNone(result["action_items_markdown"])

    def test_trim_validation_and_noop_paths(self):
        with self.assertRaisesRegex(orxa_mcp.McpServerError, "confirm=true"):
            orxa_mcp.trim_transcript_after(
                self.db,
                {"meeting_id": "meeting-1", "cutoff_seconds": 13},
            )

        result = orxa_mcp.trim_transcript_after(
            self.db,
            {"meeting_id": "meeting-1", "cutoff_seconds": 9999, "confirm": True},
        )
        self.assertEqual(result["trim"]["deleted_count"], 0)
        self.assertFalse(result["trim"]["summary_invalidated"])

        with (
            self.db.connect() as conn,
            self.assertRaisesRegex(orxa_mcp.McpServerError, "Invalid trim boundary"),
        ):
            orxa_mcp.get_trim_boundary_segment(
                conn,
                "meeting-1",
                1,
                comparator="!=",
                order="ASC",
            )

        with (
            mock.patch.object(
                orxa_mcp_meetings,
                "build_trim_preview",
                side_effect=RuntimeError("boom"),
            ),
            self.assertRaisesRegex(RuntimeError, "boom"),
        ):
            orxa_mcp.trim_transcript_after(
                self.db,
                {"meeting_id": "meeting-1", "cutoff_seconds": 10, "confirm": True},
            )
