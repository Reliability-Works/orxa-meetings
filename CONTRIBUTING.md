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

## Maintainability

Run the full gate before pushing:

```bash
make validate
```

The repository has hard limits for file size, function/component size,
complexity, nesting, and parameter count. These limits apply to the whole
repository so the current code remains easy to follow.

Preferred shape for new work:

- Keep files under `350` lines; the hard limit is `500`.
- Keep functions and React components under `100` lines; the hard limit is
  `200`.
- Prefer small named helpers over deeply nested control flow.
- Keep Tauri command payloads explicit, but move internal workflow logic into
  smaller service functions.
- Add or update docs for any new agent, model, calendar, release, or MCP
  surface.

## Release Work

Release artifacts are produced through `.github/workflows/release.yml`. The updater manifest is published as `latest.json` on the latest GitHub release.

Do not commit updater private keys, Apple certificates, API keys, local databases, recordings, or transcripts.

## License

By contributing, you agree that your contributions are licensed under the MIT license in this repository.
