# Orxa Meetings

Orxa Meetings is a local-first macOS meeting assistant for recording, transcribing, summarizing, and handing meeting context to coding agents and other staff workflows.

The app is based on the original open-source Meetily project by Zackriya Solutions. Orxa keeps the local privacy model and extends it with agent access, persistent chat, work extraction, calendar-aware meeting history, and a Reliability Works release/update flow.

## What It Does

- Records microphone and system audio locally.
- Transcribes meetings during the call with downloadable local transcription models.
- Detects when the Mac owner's microphone is active and labels those transcript lines as `Me`.
- Generates expansive summaries, decisions, risks, open questions, and action items.
- Opens a summary modal after a recording stops so the next step is obvious.
- Exposes a local MCP server so Codex, Claude, and other agents can inspect transcripts, summaries, notes, and work items.
- Supports a persistent chat agent for asking questions across meetings.
- Shows macOS Calendar events and attaches overlapping Orxa recordings to the matching event.
- Publishes signed updater artifacts through GitHub Releases.

## Calendar Linking

Orxa reads the user's macOS Calendar with EventKit after permission is granted. The Calendar page shows real Calendar events and local Orxa recordings in one view.

When a recording overlaps a Calendar event, Orxa displays that transcript under the event. If there is no matching event, the recording remains a standalone meeting, which preserves the current ad hoc transcription flow.

Calendar data stays local. Orxa does not upload event details.

## Agent Access

The bundled MCP server lives in `mcp/orxa_mcp.py` and reads the local Orxa SQLite database. It provides tools for:

- listing meetings
- reading raw transcript segments
- reading summaries and meeting notes
- extracting and updating action items
- trimming transcript tails after a confirmed cutoff
- preparing role-specific context packs

See [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for setup.

## Install And Update

Orxa is distributed from [Reliability-Works/orxa-meetings releases](https://github.com/Reliability-Works/orxa-meetings/releases).

The app checks:

```text
https://github.com/Reliability-Works/orxa-meetings/releases/latest/download/latest.json
```

When an update is available, the left sidebar shows an update notice above the bottom icons. Starting the update displays download progress and relaunches the app after installation.

Updater signing requires these GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

macOS Developer ID distribution additionally uses the Apple signing and notarization secrets referenced in `.github/workflows/build.yml`.

## Build Locally

Requirements:

- Node.js 20
- pnpm 8+
- Rust stable
- Xcode command line tools on macOS

```bash
cd frontend
pnpm install
pnpm build
pnpm tauri:build
```

For a local app install on macOS:

```bash
cd frontend
./install-macos.sh --skip-build --no-backup
```

## Release

Release builds are created by `.github/workflows/release.yml`.

Manual release:

1. Set `frontend/src-tauri/tauri.conf.json` and `frontend/package.json` to the desired version.
2. Push to the default branch.
3. Run the `Release` workflow, or push a `vX.Y.Z` tag.
4. Publish the draft release after checking the generated assets and `latest.json`.

The current app version has been reset to `0.0.1` for the new Orxa Meetings repository.

## Documentation

- [Architecture](docs/architecture.md)
- [Building](docs/BUILDING.md)
- [MCP Server](docs/MCP_SERVER.md)
- [GPU Acceleration](docs/GPU_ACCELERATION.md)
- [Privacy Policy](PRIVACY_POLICY.md)

## Attribution

Orxa Meetings is derived from Meetily / meeting-minutes by Zackriya Solutions. The original project is MIT licensed, and the original copyright notice is retained in [LICENSE.md](LICENSE.md).

Substantial Orxa-specific additions include the Orxa app shell, local agent workflows, MCP tooling, calendar linking, work extraction, update UX, and Reliability Works release automation.

## License

MIT. See [LICENSE.md](LICENSE.md).
