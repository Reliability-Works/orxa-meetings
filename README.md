# Orxa Meetings

Orxa Meetings is a local-first macOS meeting workspace for recording calls, transcribing them on-device, producing detailed summaries, and giving coding agents access to the resulting meeting memory.

The codebase is derived from the original open-source Meetily project by Zackriya Solutions. Orxa keeps the local privacy model and moves the product toward agent-assisted meeting recall, Calendar-aware history, persistent chat, and Reliability Works release/update infrastructure.

## Current Product Surface

- Record microphone and system audio locally.
- Transcribe during a meeting with downloadable local transcription models.
- Label transcript segments as `Me` when the Mac owner's microphone is active.
- Generate expansive summaries with decisions, risks, questions, and action items/todos.
- Open the summary modal after a recording stops so summary creation is hard to miss.
- Browse macOS Calendar events alongside Orxa recordings and attach overlapping recordings to the matching event.
- Chat with a local meeting agent that can use selected meeting transcripts, summaries, and indexed local agent history.
- Index local Agent Sources such as Codex, Claude, Cursor, and memory-summary folders for meeting prep and follow-up context.
- Expose a local MCP server for agents that need raw transcripts, summaries, notes, todos, transcript search, trimming, and Agent Sources search.
- Deliver signed app updates through GitHub Releases and the Tauri updater.

Orxa is not a task manager. Action items remain part of meeting summaries and MCP output so they can be copied into the user's dedicated task system.

## Repository Layout

```text
frontend/              Next.js UI and Tauri app shell
frontend/src-tauri/    Rust app core, local database, audio, Calendar, models, chat, updates
llama-helper/          Rust sidecar used by local summary/chat models
mcp/                   Python standard-library MCP server and tests
docs/                  Current product, development, and release docs
backend/               Archived legacy backend kept for migration context only
```

The supported app path is the Tauri desktop app in `frontend/`. The archived Python/FastAPI backend is not used for current development, releases, or installs.

## Quick Start

Requirements:

- macOS for the primary supported app experience
- Node.js 20
- pnpm
- Bun for frontend unit tests
- Rust stable toolchain with `cargo fmt` and `cargo clippy`
- Xcode command line tools on macOS

```bash
cd /path/to/orxa-meetings
make bootstrap
make validate
```

`make validate` runs formatting, linting, type checks, tests, coverage,
duplication, and maintainability checks.

Run the desktop app locally:

```bash
cd frontend
pnpm tauri:dev
```

Build a production app:

```bash
cd frontend
pnpm tauri:build
```

Install the most recent macOS bundle into `/Applications`:

```bash
cd frontend
./install-macos.sh --skip-build --no-backup
```

## Agent And MCP Access

The bundled MCP server is `mcp/orxa_mcp.py`. It reads the local Orxa SQLite database and exposes:

- meetings and meeting metadata
- raw timestamped transcript segments
- summaries and meeting notes
- action items/todos extracted from summaries
- transcript search and meeting-specific evidence search
- confirmed transcript-tail trimming
- local Agent Sources configuration, search, and day activity

See [docs/MCP_SERVER.md](docs/MCP_SERVER.md).

## Documentation

- [Docs Index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Development And Building](docs/BUILDING.md)
- [Validation Gates](docs/VALIDATION.md)
- [Agent Sources](docs/AGENT_SOURCES.md)
- [Calendar Integration](docs/CALENDAR.md)
- [MCP Server](docs/MCP_SERVER.md)
- [Models](docs/MODELS.md)
- [Releases And Updates](docs/RELEASES.md)
- [GPU Acceleration](docs/GPU_ACCELERATION.md)
- [Privacy Policy](PRIVACY_POLICY.md)

## Releases And Updates

Releases are published from [Reliability-Works/orxa-meetings](https://github.com/Reliability-Works/orxa-meetings). The app checks:

```text
https://github.com/Reliability-Works/orxa-meetings/releases/latest/download/latest.json
```

`TAURI_SIGNING_PRIVATE_KEY` signs updater artifacts. Apple Developer ID credentials sign and notarize macOS app bundles. They are separate signing systems and both are required for a production macOS release with auto-update support.

See [docs/RELEASES.md](docs/RELEASES.md).

## Attribution

Orxa Meetings is derived from Meetily / meeting-minutes by Zackriya Solutions. The original project is MIT licensed, and the original copyright notice is retained in [LICENSE.md](LICENSE.md).

Substantial Orxa-specific work includes the Orxa app shell, macOS Calendar linking, local Agent Sources, persistent chat, MCP tooling, summary/todo flows, model-download surfaces, updater UX, and Reliability Works release automation.

## License

MIT. See [LICENSE.md](LICENSE.md).
