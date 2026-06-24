"""JSON-RPC protocol tests for the Orxa MCP server."""

from __future__ import annotations

import io
import json
import runpy
import sys
from pathlib import Path
from unittest import mock

import orxa_mcp_server
from test_orxa_mcp_helpers import MCP_DIR, OrxaMcpTestCase, orxa_mcp


class OrxaMcpServerProtocolTest(OrxaMcpTestCase):
    def test_json_rpc_tool_call(self):
        server = orxa_mcp.OrxaMcpServer(self.db)
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

    def test_protocol_helpers_and_errors(self):
        server = orxa_mcp.OrxaMcpServer(self.db)

        self.assertIsNone(server.handle({"method": "notifications/initialized"}))
        self.assertEqual(
            server.handle({"id": 1, "method": "initialize", "params": {}})["result"][
                "protocolVersion"
            ],
            orxa_mcp.DEFAULT_PROTOCOL_VERSION,
        )
        self.assertEqual(server.handle({"id": 2, "method": "ping"})["result"], {})
        self.assertTrue(server.handle({"id": 3, "method": "tools/list"})["result"]["tools"])
        self.assertTrue(server.handle({"id": 4, "method": "resources/list"})["result"]["resources"])

        unknown = server.handle({"id": 5, "method": "wat"})
        self.assertEqual(unknown["error"]["code"], -32602)
        bad_call = server.handle({"id": 6, "method": "tools/call", "params": None})
        self.assertTrue(bad_call["result"]["isError"])
        unknown_tool = server.handle(
            {"id": 7, "method": "tools/call", "params": {"name": "missing"}}
        )
        self.assertTrue(unknown_tool["result"]["isError"])
        bad_args = server.handle(
            {"id": 8, "method": "tools/call", "params": {"name": "get_summary", "arguments": [1]}}
        )
        self.assertTrue(bad_args["result"]["isError"])
        resource_response = server.handle(
            {
                "id": 9,
                "method": "resources/read",
                "params": {"uri": "orxa://meeting/meeting-1/summary"},
            }
        )
        self.assertIn("Roadmap was discussed", resource_response["result"]["contents"][0]["text"])

    def test_resource_reads_cover_supported_and_invalid_uris(self):
        server = orxa_mcp.OrxaMcpServer(self.db)

        meetings = server.read_resource({"uri": "orxa://meetings"})
        self.assertIn("Roadmap Sync", meetings["contents"][0]["text"])
        transcript = server.read_resource({"uri": "orxa://meeting/meeting-1/transcript"})
        self.assertIn("Alice said Bob", transcript["contents"][0]["text"])
        summary = server.read_resource({"uri": "orxa://meeting/meeting-1/summary"})
        self.assertIn("Roadmap was discussed", summary["contents"][0]["text"])
        notes = server.read_resource({"uri": "orxa://meeting/meeting-1/notes"})
        self.assertIn("Customer asked", notes["contents"][0]["text"])

        invalid = [
            None,
            {"uri": 123},
            {"uri": "file:///tmp/nope"},
            {"uri": "orxa://meeting/meeting-1"},
            {"uri": "orxa://meeting/meeting-1/unknown"},
            {"uri": "orxa://unknown"},
        ]
        for params in invalid:
            with self.subTest(params=params), self.assertRaises(orxa_mcp.McpServerError):
                server.read_resource(params)

    def test_result_helpers(self):
        self.assertEqual(orxa_mcp.text_result({"a": 1})["content"][0]["type"], "text")
        self.assertTrue(orxa_mcp.tool_error("bad")["isError"])
        self.assertEqual(orxa_mcp.result(1, {"ok": True})["result"]["ok"], True)
        self.assertEqual(orxa_mcp.error(1, -1, "bad")["error"]["message"], "bad")

    def test_serve_handles_parse_errors_notifications_and_responses(self):
        server = orxa_mcp.OrxaMcpServer(self.db)
        fake_stdin = type(
            "FakeStdin",
            (),
            {
                "buffer": io.BytesIO(
                    b"\n"
                    b"not-json\n"
                    b"[]\n"
                    b'{"method":"notifications/initialized"}\n'
                    b'{"jsonrpc":"2.0","id":1,"method":"ping"}\n'
                )
            },
        )()
        fake_stdout = io.StringIO()

        with (
            mock.patch.object(sys, "stdin", fake_stdin),
            mock.patch.object(sys, "stdout", fake_stdout),
        ):
            orxa_mcp.serve(server)

        lines = [json.loads(line) for line in fake_stdout.getvalue().splitlines()]
        self.assertEqual(lines[0]["error"]["code"], -32700)
        self.assertEqual(lines[1]["error"]["code"], -32700)
        self.assertEqual(lines[2]["id"], 1)

    def test_parse_args_and_main(self):
        args = orxa_mcp.parse_args(["--database", str(self.db_path)])
        self.assertEqual(args.database, str(self.db_path))

        with mock.patch.object(orxa_mcp, "serve") as serve_mock:
            self.assertEqual(orxa_mcp.main(["--database", str(self.db_path)]), 0)
        serve_mock.assert_called_once()

    def test_server_module_main(self):
        args = orxa_mcp_server.parse_args(["--database", str(self.db_path)])
        self.assertEqual(args.database, str(self.db_path))

        with mock.patch.object(orxa_mcp_server, "serve") as serve_mock:
            self.assertEqual(orxa_mcp_server.main(["--database", str(self.db_path)]), 0)
        serve_mock.assert_called_once()

    def test_entrypoint_bootstrap_adds_module_dir(self):
        entrypoint = Path(MCP_DIR) / "orxa_mcp.py"
        original_path = list(sys.path)

        try:
            sys.path[:] = [path for path in sys.path if path != str(MCP_DIR)]
            runpy.run_path(str(entrypoint), run_name="orxa_mcp_path_bootstrap_test")
            self.assertIn(str(MCP_DIR), sys.path)
        finally:
            sys.path[:] = original_path
