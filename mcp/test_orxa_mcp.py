"""Aggregated unittest entrypoint for the Orxa MCP slice."""

from __future__ import annotations

# ruff: noqa: E402, I001

import sys
import unittest
from pathlib import Path

MCP_DIR = Path(__file__).resolve().parent
if str(MCP_DIR) not in sys.path:
    sys.path.insert(0, str(MCP_DIR))

from test_orxa_mcp_agent_sources import OrxaMcpAgentSourceTest
from test_orxa_mcp_core import OrxaMcpCoreTest
from test_orxa_mcp_meetings import OrxaMcpMeetingToolTest
from test_orxa_mcp_server import OrxaMcpServerProtocolTest

TEST_CASES = (
    OrxaMcpMeetingToolTest,
    OrxaMcpAgentSourceTest,
    OrxaMcpCoreTest,
    OrxaMcpServerProtocolTest,
)


def load_tests(
    loader: unittest.TestLoader,
    tests: unittest.TestSuite,
    pattern: str | None,
) -> unittest.TestSuite:
    del tests, pattern
    suite = unittest.TestSuite()
    for test_case in TEST_CASES:
        suite.addTests(loader.loadTestsFromTestCase(test_case))
    return suite


if __name__ == "__main__":
    unittest.main()
