# Releases And Updates

Orxa releases are published from the `Reliability-Works/orxa-meetings` repository.

## Versioning

The new Orxa repository starts at:

```text
0.0.1
```

Keep these versions in sync before a release:

- `frontend/package.json`
- `frontend/src-tauri/tauri.conf.json`
- `frontend/src-tauri/Cargo.toml`

## Signing Systems

There are two separate signing concerns.

Tauri updater signing:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

These produce `.sig` files and allow the app to trust updater artifacts listed in `latest.json`.

Apple macOS distribution signing:

- Apple Developer ID certificate
- certificate password/keychain secrets
- Apple API key/issuer/team details for notarization

These sign and notarize the macOS app so Gatekeeper accepts it.

An Apple `.p8` key cannot replace the Tauri updater private key. The `.p8` key is for Apple APIs; the Tauri key signs update payloads.

## Release Workflow

The release workflow is:

```text
.github/workflows/release.yml
```

It creates a draft GitHub release, builds macOS and Windows artifacts, uploads installers and updater archives, and publishes `latest.json`.

Run a manual release from GitHub Actions, or push a version tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Review the draft release before publishing it.

## Update Endpoint

The app checks:

```text
https://github.com/Reliability-Works/orxa-meetings/releases/latest/download/latest.json
```

When a newer version is available, the sidebar shows an update notice. The user can download it, see progress, and relaunch into the updated app.

## Local Update Testing

Use:

```bash
node scripts/test-update-locally.js
```

or generate a manifest manually with:

```bash
node scripts/generate-update-manifest-github.js
```

Do not commit signing keys, certificates, local app data, recordings, transcripts, or generated release bundles.
