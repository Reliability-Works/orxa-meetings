# Orxa MCP Server

Orxa includes a local MCP server for agents that need access to meeting memory without opening the app UI.

The server is:

```text
mcp/orxa_mcp.py
```

It uses only Python standard-library modules and reads the local Orxa SQLite database. It does not read model-provider API keys, app settings secrets, or recordings.

## Tools

Meeting tools:

- `list_meetings` lists local meetings with transcript counts, summary status, and notes status.
- `get_meeting` returns meeting metadata, summary state, and notes.
- `get_transcript` returns raw transcript text and/or timestamped transcript segments.
- `get_summary` returns the stored summary process state and summary JSON/Markdown.
- `search_transcripts` searches raw transcript segments across local meetings.
- `ask_meeting` returns transcript-backed evidence for a question about one meeting.
- `get_action_items` extracts the action-items/todos section from a stored summary.

Agent Sources tools:

- `list_agent_sources` lists configured local Agent Sources and indexed-document counts.
- `search_agent_sessions` searches indexed Codex, Claude, Cursor, memory-summary, or custom session folders.
- `get_agent_activity` returns indexed agent-session activity for a specific day.

Transcript cleanup tools:

- `preview_trim_transcript` previews transcript segments that would be removed after a cutoff.
- `trim_transcript_after` deletes transcript segments after a cutoff and clears stale summary/cache data. It requires `confirm: true`.

The MCP server also exposes JSON resources for meetings, transcripts, summaries, and notes.

## Local Speaker Labels

Transcript segments may include:

```json
{ "speaker": "me" }
```

That label means Orxa detected the local microphone was active for that segment. `get_transcript.raw_text` prefixes those lines with `Me:` so agents can reason about what the Mac owner likely said without full speaker diarization.

## Trim A Transcript Tail

Use the trim tools when recording continued after the actual meeting ended.

Preview first:

```json
{
  "meeting_id": "meeting-123",
  "cutoff_time": "17:52"
}
```

Apply only after confirming the preview:

```json
{
  "meeting_id": "meeting-123",
  "cutoff_time": "17:52",
  "confirm": true
}
```

The cutoff is recording-relative. Segments with `audio_start_time` greater than the cutoff are deleted. Exact cutoff matches are kept. Segments without recording-relative timestamps are left untouched.

Any stored summary for that meeting is cleared so the user can regenerate it from the cleaned transcript.

## Run The Server

Use the app's MCP setup panel or pass the database path manually:

```bash
python3 mcp/orxa_mcp.py --database "/path/to/meeting_minutes.sqlite"
```

or:

```bash
ORXA_DB_PATH="/path/to/meeting_minutes.sqlite" python3 mcp/orxa_mcp.py
```

If no path is provided, the server tries common app-data locations for `meeting_minutes.sqlite`, including:

```text
~/Library/Application Support/com.orxa.ai/meeting_minutes.sqlite
```

## Client Config

Example MCP client configuration:

```json
{
  "mcpServers": {
    "orxa": {
      "command": "python3",
      "args": [
        "/absolute/path/to/orxa-meetings/mcp/orxa_mcp.py",
        "--database",
        "/absolute/path/to/meeting_minutes.sqlite"
      ]
    }
  }
}
```

For an installed macOS app, the bundled script normally lives under:

```text
/Applications/Orxa.app/Contents/Resources/_up_/mcp/orxa_mcp.py
```

## Development

```bash
python3 -m unittest mcp/test_orxa_mcp.py
```

The root validation gate includes the MCP test suite.
