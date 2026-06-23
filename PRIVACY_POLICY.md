# Orxa Meetings Privacy Policy

Last updated: 2026-06-23

Orxa Meetings is designed around local ownership of meeting data. Recordings, transcripts, summaries, chat history, MCP data, and Calendar-derived meeting links are stored on the user's Mac unless the user explicitly configures an external model provider.

## Local Data

Orxa stores local application data under the app data directory for `com.orxa.ai`. This can include:

- audio recordings
- transcript segments
- summaries and notes
- action items and work context packs
- chat sessions
- model configuration
- calendar auto-start preferences

The app does not upload raw meeting content by default.

## Calendar Access

When the user grants macOS Calendar permission, Orxa reads event titles, calendars, and start/end times so it can:

- show real Calendar events in the Calendar view
- auto-start recording when configured
- attach overlapping Orxa recordings to matching events

Calendar data is read locally through EventKit and is not sent to Reliability Works.

## Model Providers

Local transcription and local summary models run on the user's machine. If the user configures an external provider, such as Anthropic, Groq, OpenRouter, OpenAI-compatible endpoints, or another API, meeting content sent to that provider is governed by that provider's terms and privacy policy.

## Analytics

Usage analytics is optional and off by default. When enabled, Orxa may collect product and performance events such as feature usage, app version, platform, and anonymized error categories.

Analytics must not include:

- meeting audio
- transcript text
- meeting titles
- participant names
- summaries
- chat content
- API keys

## MCP Access

The MCP server is a local process that exposes meeting data to tools configured by the user. It does not open a network service by default and does not send data anywhere on its own. Any agent connected to the MCP server should be treated as having access to the local meeting database configured for that server.

## Updates

The app checks GitHub Releases for update metadata at:

```text
https://github.com/Reliability-Works/orxa-meetings/releases/latest/download/latest.json
```

Update checks include the app version and platform information needed by the Tauri updater.

## Contact

Open an issue at [Reliability-Works/orxa-meetings](https://github.com/Reliability-Works/orxa-meetings/issues) for privacy questions or corrections.
