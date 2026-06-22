# Meetily MCP Server

Meetily includes an MCP server for local meeting data. It lets agents inspect meetings, raw transcript segments, summaries, meeting notes, and action-item sections without starting the archived FastAPI backend. It can also trim transcript segments recorded after a known meeting end point when explicitly confirmed.

## What It Exposes

- `list_meetings` - local meetings with transcript counts, summary status, and notes presence.
- `get_meeting` - meeting metadata, summary state, and notes.
- `get_transcript` - raw transcript text and timestamped transcript segments.
- `get_summary` - stored summary status and summary JSON/Markdown.
- `search_transcripts` - full-text substring search across raw transcript segments.
- `get_action_items` - the action-items/todos section from the stored summary, when present.
- `preview_trim_transcript` - preview transcript tail segments that would be removed after a cutoff.
- `trim_transcript_after` - delete transcript segments after a cutoff and clear stale summary/cache data. Requires `confirm: true`.

The server does not read settings, API keys, or model-provider configuration. All tools are read-only except `trim_transcript_after`, which only deletes timestamped transcript rows for the requested meeting after the requested cutoff.

## Trim A Transcript Tail

Use this when recording continued after the actual meeting ended.

```json
{
  "meeting_id": "meeting-123",
  "cutoff_time": "17:52"
}
```

Preview first with `preview_trim_transcript`. To apply, call `trim_transcript_after` with the same cutoff and `confirm: true`.

```json
{
  "meeting_id": "meeting-123",
  "cutoff_time": "17:52",
  "confirm": true
}
```

The cutoff is recording-relative. Segments with `audio_start_time` greater than the cutoff are deleted; exact cutoff matches are kept. Segments without recording-relative timestamps are left untouched. Any stored summary for that meeting is cleared so it can be regenerated from the cleaned transcript.

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
