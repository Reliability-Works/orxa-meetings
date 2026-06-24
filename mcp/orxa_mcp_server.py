"""JSON-RPC server boundary for the Orxa MCP server."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from typing import Any
from urllib.parse import unquote, urlparse

from orxa_mcp_core import (
    DATABASE_ENV,
    DATABASE_FILENAME,
    DEFAULT_PROTOCOL_VERSION,
    SERVER_NAME,
    SERVER_VERSION,
    McpServerError,
    OrxaDatabase,
)
from orxa_mcp_meetings import (
    get_notes,
    get_summary,
    get_transcript,
    list_meetings,
    require_meeting,
)
from orxa_mcp_tools import TOOLS, tool_definitions


class OrxaMcpServer:
    def __init__(self, db: OrxaDatabase) -> None:
        self.db = db

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        request_id = message.get("id")

        if method and method.startswith("notifications/"):
            return None

        try:
            return self._dispatch(method, request_id, message)
        except McpServerError as exc:
            if method == "tools/call":
                return result(request_id, tool_error(str(exc)))
            return error(request_id, -32602, str(exc))
        except Exception as exc:  # pragma: no cover - defensive server boundary
            print(traceback.format_exc(), file=sys.stderr)
            return error(request_id, -32603, f"Internal error: {exc}")

    def _dispatch(
        self,
        method: Any,
        request_id: Any,
        message: dict[str, Any],
    ) -> dict[str, Any]:
        if method == "initialize":
            params = message.get("params") if isinstance(message.get("params"), dict) else {}
            protocol_version = params.get("protocolVersion", DEFAULT_PROTOCOL_VERSION)
            return result(request_id, self._initialize_payload(protocol_version))

        if method == "ping":
            return result(request_id, {})

        if method == "tools/list":
            return result(request_id, {"tools": tool_definitions()})

        if method == "tools/call":
            return result(request_id, self.call_tool(message.get("params")))

        if method == "resources/list":
            return result(request_id, self.list_resources())

        if method == "resources/read":
            return result(request_id, self.read_resource(message.get("params")))

        raise McpServerError(f"Unknown method: {method}")

    def _initialize_payload(self, protocol_version: str) -> dict[str, Any]:
        return {
            "protocolVersion": protocol_version,
            "capabilities": {"tools": {}, "resources": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    def call_tool(self, params: Any) -> dict[str, Any]:
        if not isinstance(params, dict):
            raise McpServerError("tools/call params must be an object")
        name = params.get("name")
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            raise McpServerError("tool arguments must be an object")
        tool = TOOLS.get(str(name))
        if not tool:
            raise McpServerError(f"Unknown tool: {name}")
        data = tool["handler"](self.db, args)
        return text_result(data)

    def list_resources(self) -> dict[str, Any]:
        payload = list_meetings(self.db, {"limit": 50})
        resources = [
            {"uri": "orxa://meetings", "name": "Orxa meetings", "mimeType": "application/json"}
        ]
        for meeting in payload["meetings"]:
            resources.extend(_meeting_resources(meeting["id"], meeting["title"]))
        return {"resources": resources}

    def read_resource(self, params: Any) -> dict[str, Any]:
        uri = _require_resource_uri(params)
        data = self._read_resource_data(uri)
        return {
            "contents": [
                {
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json.dumps(data, ensure_ascii=False, indent=2),
                }
            ]
        }

    def _read_resource_data(self, uri: str) -> dict[str, Any]:
        parsed = urlparse(uri)
        if parsed.scheme != "orxa":
            raise McpServerError(f"Unsupported resource URI: {uri}")

        if parsed.netloc == "meetings" and not parsed.path:
            return list_meetings(self.db, {"limit": 100})

        if parsed.netloc == "meeting":
            return self._read_meeting_resource(uri, parsed.path)

        raise McpServerError(f"Unsupported resource URI: {uri}")

    def _read_meeting_resource(self, uri: str, path: str) -> dict[str, Any]:
        parts = [unquote(part) for part in path.split("/") if part]
        if len(parts) != 2:
            raise McpServerError(f"Unsupported meeting resource URI: {uri}")

        meeting_id, kind = parts
        if kind == "transcript":
            return get_transcript(self.db, {"meeting_id": meeting_id})
        if kind == "summary":
            return get_summary(self.db, {"meeting_id": meeting_id})
        if kind == "notes":
            with self.db.connect() as conn:
                return {
                    "meeting": require_meeting(conn, meeting_id),
                    "notes": get_notes(conn, meeting_id),
                }
        raise McpServerError(f"Unsupported meeting resource kind: {kind}")


def _meeting_resources(meeting_id: str, title: str) -> list[dict[str, str]]:
    return [
        {
            "uri": f"orxa://meeting/{meeting_id}/transcript",
            "name": f"{title} transcript",
            "mimeType": "application/json",
        },
        {
            "uri": f"orxa://meeting/{meeting_id}/summary",
            "name": f"{title} summary",
            "mimeType": "application/json",
        },
        {
            "uri": f"orxa://meeting/{meeting_id}/notes",
            "name": f"{title} notes",
            "mimeType": "application/json",
        },
    ]


def _require_resource_uri(params: Any) -> str:
    if not isinstance(params, dict) or not isinstance(params.get("uri"), str):
        raise McpServerError("resources/read requires a uri")
    return params["uri"]


def text_result(data: Any) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(data, ensure_ascii=False, indent=2),
            }
        ]
    }


def tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def result(request_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def serve(server: OrxaMcpServer) -> None:
    for raw_line in sys.stdin.buffer:
        line = raw_line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("message must be an object")
        except Exception as exc:
            response = error(None, -32700, f"Parse error: {exc}")
        else:
            response = server.handle(message)

        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MCP server for Orxa local data")
    parser.add_argument(
        "--database",
        help=(
            f"Path to {DATABASE_FILENAME}. Defaults to {DATABASE_ENV} or app data directory lookup."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    serve(OrxaMcpServer(OrxaDatabase(args.database)))
    return 0
