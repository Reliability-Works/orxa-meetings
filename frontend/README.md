# Orxa Frontend

This directory contains the Orxa desktop app: a Next.js interface packaged by Tauri with a Rust backend.

## Main Responsibilities

- app shell, sidebar, chat, settings, calendar, and meeting detail UI
- recording controls and import flow
- model download surfaces
- update notification and progress UI
- calls into Tauri commands for audio, storage, summaries, Calendar, MCP setup, and work hub data

## Development

```bash
pnpm install
pnpm dev
```

Run the desktop app:

```bash
pnpm tauri:dev
```

Build the frontend:

```bash
pnpm build
```

Build the desktop app:

```bash
pnpm tauri:build
```

Install the newest built macOS app into `/Applications`:

```bash
./install-macos.sh --skip-build --no-backup
```

## App Data

The app identifier is `com.orxa.ai`. User data is stored in the platform app-data directory and includes local recordings, transcripts, summaries, chat data, and preferences.

## Update Flow

The Tauri updater reads the latest release manifest from:

```text
https://github.com/Reliability-Works/orxa-meetings/releases/latest/download/latest.json
```

The sidebar displays update availability and progress. Release artifacts and the updater manifest are produced by GitHub Actions.

## Native Commands

Rust commands live under `src-tauri/src`. New frontend features should prefer existing command families before adding new commands.

Key command areas:

- `audio` - recording, import, transcription, and playback
- `summary` - summary generation and local model management
- `calendar` - macOS Calendar permissions, auto-start, and event listing
- `chat` - persistent local agent chat
- `workhub` - actions, decisions, risks, questions, and context packs
- `mcp` - local MCP setup information

## Notes

The archived Python backend is not required for supported Orxa desktop development. Local transcription and summaries run through the Tauri app path.
