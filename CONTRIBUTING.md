# Contributing To Orxa Meetings

Thanks for improving Orxa Meetings. This repository is the Reliability Works continuation of the original Meetily codebase, with a focus on local meeting capture, agent workflows, and macOS-first release quality.

## Development Flow

Use small branches and small commits. Keep changes scoped to one behavior where possible.

```bash
git clone https://github.com/Reliability-Works/orxa-meetings.git
cd orxa-meetings
cd frontend
pnpm install
pnpm build
```

For local desktop development:

```bash
cd frontend
pnpm tauri:dev
```

For a production bundle:

```bash
cd frontend
pnpm tauri:build
```

## Pull Requests

- Explain the user-visible behavior you changed.
- Include screenshots for UI changes.
- Run the relevant frontend and Tauri checks.
- Keep generated model files and local app data out of commits.
- Update docs when behavior, setup, release, or MCP tooling changes.

## Release Work

Release artifacts are produced through `.github/workflows/release.yml`. The updater manifest is published as `latest.json` on the latest GitHub release.

Do not commit updater private keys, Apple certificates, API keys, local databases, recordings, or transcripts.

## License

By contributing, you agree that your contributions are licensed under the MIT license in this repository.
