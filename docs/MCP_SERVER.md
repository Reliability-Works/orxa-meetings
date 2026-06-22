# Meetily MCP Server

Meetily includes a read-only MCP server for local meeting data. It lets agents inspect meetings, raw transcript segments, summaries, meeting notes, and action-item sections without starting the archived FastAPI backend.

## What It Exposes

- `list_meetings` - local meetings with transcript counts, summary status, and notes presence.
- `get_meeting` - meeting metadata, summary state, and notes.
- `get_transcript` - raw transcript text and timestamped transcript segments.
- `get_summary` - stored summary status and summary JSON/Markdown.
- `search_transcripts` - full-text substring search across raw transcript segments.
- `get_action_items` - the action-items/todos section from the stored summary, when present.

The server only reads meeting content tables. It does not read settings, API keys, or model-provider configuration.

## Run It

Use the database path shown by the app's database-folder command or set `MEETILY_DB_PATH`.

```bash
python3 mcp/meetily_mcp.py --database "/path/to/meeting_minutes.sqlite"
```

or:

```bash
MEETILY_DB_PATH="/path/to/meeting_minutes.sqlite" python3 mcp/meetily_mcp.py
```

If no path is provided, the server tries common Tauri app-data locations for `meeting_minutes.sqlite`.

## MCP Client Config

Example client configuration:

```json
{
  "mcpServers": {
    "meetily": {
      "command": "python3",
      "args": [
        "/absolute/path/to/meetily/mcp/meetily_mcp.py",
        "--database",
        "/absolute/path/to/meeting_minutes.sqlite"
      ]
    }
  }
}
```

For a local checkout at `/Users/me/repos/meetily`:

```json
{
  "mcpServers": {
    "meetily": {
      "command": "python3",
      "args": [
        "/Users/me/repos/meetily/mcp/meetily_mcp.py"
      ],
      "env": {
        "MEETILY_DB_PATH": "/Users/me/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite"
      }
    }
  }
}
```

## Development

The server uses only Python standard-library modules.

```bash
python3 -m unittest mcp/test_meetily_mcp.py
```
