# Development And Building

This is the supported development path for Orxa Meetings. The active app is the Tauri desktop application in `frontend/`.

## Requirements

- Node.js 20
- pnpm
- Bun
- Rust stable with `cargo fmt` and `cargo clippy`
- Xcode command line tools on macOS
- platform build tools for Windows or Linux when building those targets

The root validation entrypoint is:

```bash
make validate
```

Install dependencies:

```bash
make bootstrap
```

## Frontend Development

Run the Next.js UI only:

```bash
cd frontend
pnpm dev
```

Run the desktop app:

```bash
cd frontend
pnpm tauri:dev
```

The app uses Tauri commands/events for local audio capture, transcription, summaries, Calendar access, chat, Agent Sources, model downloads, and MCP setup. Do not add new behavior to the archived backend.

## Production Build

```bash
cd frontend
pnpm build
pnpm tauri:build
```

On macOS, the app and installers are written under:

```text
frontend/src-tauri/target/release/bundle/
```

## Local macOS Install

After a successful build:

```bash
cd frontend
./install-macos.sh --skip-build --no-backup
```

## Validation

Run the full local gate:

```bash
make validate
```

Individual gates are also available:

```bash
make format-check
make lint
make typecheck
make test
make coverage
make duplication
```

See [VALIDATION.md](VALIDATION.md) for the exact tools and exclusions.

## Archived Backend

The Python/FastAPI backend under `backend/` is retained for historical migration context only. It is not part of supported app startup, release, MCP setup, or validation beyond documentation that explicitly references the archive.

## More Reading

- [Architecture](architecture.md)
- [Calendar Integration](CALENDAR.md)
- [Agent Sources](AGENT_SOURCES.md)
- [MCP Server](MCP_SERVER.md)
- [Models](MODELS.md)
- [Releases And Updates](RELEASES.md)
