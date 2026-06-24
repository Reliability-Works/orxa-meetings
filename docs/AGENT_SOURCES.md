# Agent Sources

Agent Sources let Orxa index local coding-agent and assistant history so the chat agent and MCP server can answer questions with context outside a single meeting transcript.

## Why It Exists

Meeting transcripts explain what was said in Orxa. Agent Sources explain what happened in adjacent work tools after or before those meetings, such as:

- Codex sessions
- Codex memory summaries
- Claude sessions or memory folders
- Cursor history
- custom local folders

This lets Orxa help with meeting prep, follow-up briefs, and "what did we already do about this?" questions without becoming a task manager.

## Privacy Model

Agent Sources are local paths selected in Settings. Indexed content is stored in the local Orxa SQLite database. Orxa does not upload indexed source content unless the user chooses a remote chat/summary provider for a model request, in which case only the prompt context used for that request is sent to that provider.

## Settings

Settings includes an Agent Sources section for:

- enabling or disabling sources
- editing source paths
- choosing whether full content is indexed
- reindexing
- searching indexed sessions
- viewing day activity

If a source path does not exist, it is skipped and shown as unavailable.

## Chat Integration

The chat agent receives:

- current conversation history
- the selected meeting summary and transcript evidence when a meeting is selected
- recent meetings when no meeting is selected
- matching Agent Sources snippets for the current message

Agent Sources snippets are labelled with source and title. Answers should identify when context comes from a local agent session rather than a meeting transcript.

## MCP Integration

The MCP server exposes:

- `list_agent_sources`
- `search_agent_sessions`
- `get_agent_activity`

See [MCP_SERVER.md](MCP_SERVER.md).
