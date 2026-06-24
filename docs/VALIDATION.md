# Validation Gates

The root validation entrypoint is:

```bash
make validate
```

It is intentionally split into named gates so failures are easy to diagnose.

## Gates

- `make format-check` checks Rust formatting and supported text formatting.
- `make prepare-sidecars` creates the validation-only `llama-helper` external-bin
  stub expected by Tauri during clean Rust lint/test builds. Release workflows
  build the real sidecar.
- `make lint` runs ESLint for the frontend, Markdown linting for docs, and Rust/Python static checks.
- `make typecheck` runs TypeScript type checking.
- `make test` runs frontend unit tests, Rust workspace tests, and MCP Python unit tests.
- `make coverage` runs configured coverage checks.
- `make duplication` runs duplication detection with a zero threshold for hand-written source/docs.
- `make maintainability` checks contributor-facing size limits and required docs.

## Maintainability Rules

These rules keep the project navigable for contributors. They apply to the
whole current repository, not only new code.

- Source files: hard limit `500` lines.
- Test files: hard limit `500` lines.
- Documentation files: hard limit `500` lines.
- Detected functions/components: hard limit `200` lines.
- Preferred refactor target: source files under `350` lines.
- Preferred refactor target: functions/components under `100` lines.
- TypeScript/React ESLint complexity: max `20`.
- TypeScript/React nesting depth: max `4`.
- TypeScript/React parameters: max `5`.
- Rust Clippy cognitive complexity: max `35`.
- Rust Clippy function length: max `200`.
- Python Ruff McCabe complexity: max `10`.

Required documentation:

- `README.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/VALIDATION.md`
- `docs/MCP_SERVER.md`
- `docs/CALENDAR.md`
- `docs/MODELS.md`
- `docs/RELEASES.md`
- `docs/AGENT_SOURCES.md`
- `docs/architecture.md`

## Hooks

Install repo-local Git hooks with:

```bash
make install-hooks
```

The hooks call the same Make targets developers can run manually.

- Pre-commit runs formatting, linting, type checking, duplication, and
  maintainability.
- Pre-push runs the full `make validate` gate.

## CI

Pull requests and pushes run the local validation entrypoint through GitHub Actions. Release/build workflows remain separate because they package and sign the app.

## Exclusions

Validation excludes generated, dependency, build, and binary artifacts only:

- `node_modules`
- `.next`
- `target`
- coverage output
- lockfiles
- Tauri bundled binaries
- archived/generated backend model artifacts
- binary images and icons

Exclusions are visible in the relevant config files.
