# Building Orxa Meetings

This guide covers the supported desktop build path for Orxa Meetings.

## Requirements

- Node.js 20
- pnpm 8+
- Rust stable
- Xcode command line tools on macOS
- platform build tools for Windows or Linux when building those targets

## Install Dependencies

```bash
cd frontend
pnpm install
```

## Development Build

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

## Production Build

```bash
cd frontend
pnpm build
pnpm tauri:build
```

On macOS, the bundled app and DMG are written under:

```text
frontend/src-tauri/target/release/bundle/
```

## Local macOS Install

After building:

```bash
cd frontend
./install-macos.sh --skip-build --no-backup
```

## Updater Builds

The Tauri updater requires signed updater artifacts. Local builds that create updater artifacts require:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

GitHub Actions uses the same secrets to publish `latest.json` and signed update archives to GitHub Releases.

## Release Build

The release workflow is `.github/workflows/release.yml`.

It can be triggered manually or by pushing a version tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

The workflow creates a draft GitHub release with app bundles, installers, updater archives, signatures, and `latest.json`.

## Acceleration

Orxa supports local transcription acceleration through platform-specific Rust features. See [GPU Acceleration](GPU_ACCELERATION.md) for details.

## Archived Backend

The Python/FastAPI backend under `backend/` is retained for historical context only. Supported builds use the Tauri app in `frontend/`.
