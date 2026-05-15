# /goal: AIMD production online updater

## Background

AIMD desktop packages are currently distributed through GitHub Releases and
manual installer downloads. The app does not yet notify users when a newer
version is available, and it cannot download and install updates in-app.

The production target is Tauri 2's official updater plugin backed by GitHub
Releases and a signed static update manifest. This is not a minimal viable
updater and not a placeholder integration. Completion requires a real,
repeatable production release path: signed artifacts, configured endpoints,
platform-aware installers, app-side update checks, release automation,
republish recovery, diagnostics, and manual verification on every supported
desktop platform.

This goal depends on production version management being in place first. The
updater must consume the canonical release version and must not introduce a
second app version source.

## Objective

Ship production-grade online update support for AIMD Desktop:

- App checks for available updates without interrupting editing.
- Users receive a clear, lightweight update notification.
- Update packages are cryptographically verified before installation.
- macOS and Windows update behavior is covered by release scripts and CI.
- GitHub Releases host the installers, signatures, and `latest.json` manifest.
- Failure states are visible and diagnosable without blocking normal app use.
- Release and republish flows are one-command npm workflows and generate every
  updater asset required by production distribution.
- The implementation is considered incomplete if any production release step
  still depends on undocumented manual file editing, manual signing, manual
  manifest construction, or hand-uploaded updater assets.

## Non-Negotiable Delivery Bar

This goal must be implemented as a complete production delivery, not a thin
wrapper around Tauri updater APIs.

Completion requires:

- A real app integration that can check, notify, download, install, and
  restart/quit according to platform behavior.
- A real release integration that builds installers, signs updater artifacts,
  writes signatures, generates the manifest, validates the manifest, uploads all
  assets, and fails closed when any required secret or artifact is missing.
- A real republish/recovery path for the current version tag that can recreate
  updater assets and replace the GitHub Release without bumping version.
- Cross-platform behavior for macOS and Windows, with Linux either explicitly
  supported or explicitly excluded in config, docs, and validation.
- Testable dry-run behavior that exercises release/update logic without
  mutating GitHub state.
- Documentation that is accurate enough for a local developer and CI release
  operator to publish, verify, republish, and troubleshoot an update.

The goal is not complete if the app merely exposes a "Check for Updates"
button, if CI only builds installers without updater signatures/manifest, if
the manifest must be edited by hand, or if release assets cannot be reproduced
from the committed scripts and GitHub Actions.

## Recommended Scheme

Use:

- Tauri 2 official updater plugin
- `@tauri-apps/plugin-updater`
- `@tauri-apps/plugin-process` for restart/install flow
- GitHub Releases as the static artifact host
- `latest.json` as the update manifest
- Tauri updater signing keys for artifact verification

This is the required production path for this goal unless a later requirement
demands dynamic rollouts, staged releases, forced updates, or server-side
targeting. If dynamic control becomes necessary, evaluate CrabNebula or a small
custom endpoint in a separate goal after the full static GitHub Releases flow is
complete and verified end to end.

## In Scope

### Tauri Updater Integration

- Add Tauri updater dependencies on Rust and TypeScript sides.
- Register the updater plugin in the Tauri builder.
- Configure updater `pubkey` and `endpoints` in Tauri config.
- Configure Windows updater `installMode` deliberately and document the choice.
- Ensure updater config is compatible with the release version source.
- Add updater permissions/capabilities required by Tauri 2.

### Signing and Key Management

- Provide a documented key-generation workflow for Tauri updater signing keys.
- Commit only the public key or a committed release config value that resolves
  deterministically to the reviewed public key.
- Store the private key only in secure CI secrets and local release-machine
  secret storage.
- Document key rotation procedure.
- Document exactly which GitHub Actions secrets are required, their expected
  format, and how to validate their presence without printing them.
- Release scripts must fail if updater signing secrets are missing in release
  mode.
- Every published updater artifact must have a matching `.sig`.
- Local dry-run must validate key/secret wiring enough to catch missing config
  before CI release time, while never requiring private key material to be
  committed.

### Release Manifest

- Generate `latest.json` from release artifacts and canonical version config.
- The manifest must include required fields:
  - `version`
  - platform-specific `url`
  - platform-specific `signature`
- Each platform entry must correspond to the exact artifact format the app can
  install on that platform.
- Optional release notes and publication date should be included when available.
- Manifest URLs must point to immutable release artifacts, not mutable local
  paths.
- Manifest generation must be deterministic and validated in CI.
- Manifest must be uploaded to GitHub Release as
  `latest.json` or channel-specific names such as `latest-stable.json`.
- Manifest validation must fetch or otherwise prove the uploaded artifact URLs
  are present in the GitHub Release before the release job is considered
  successful.
- Manifest generation must support republish of the current version without
  requiring a SemVer bump.

### App UX

- Check for updates in the background after app startup.
- Do not block document opening, editing, saving, web import, or export while
  checking.
- Show a compact notification only when an update is available or when the user
  explicitly checks from settings/menu.
- Include:
  - current version
  - latest version
  - release notes summary when available
  - download/install action
  - dismiss/remind-later action
- If download or install fails, show a terse error and keep a diagnostic log.
- Provide a manual "Check for Updates" entry in settings or app menu.
- Avoid repeated nagging in the same session after dismiss.
- UI copy must distinguish:
  - no update available
  - update available
  - download in progress
  - install ready
  - install blocked by unsaved changes
  - check/download/install failed
- Update UI must work in the main app shell and remain understandable when
  multiple document windows are open.

### Install and Restart Flow

- Download progress must be observable in UI or status text.
- Download/install must be started only by explicit user action.
- Install action must clearly tell users whether the app will restart or quit.
- After successful install, restart the app where supported.
- If restart is not possible, show a clear "restart AIMD to finish updating"
  state.
- Do not risk unsaved document loss:
  - detect dirty documents before install/restart
  - ask user to save or cancel update install
  - never close dirty windows silently
- Multi-window dirty-state detection must be production-grade: install cannot
  proceed while any relevant document window has unsaved changes, not just the
  frontmost window.
- The app must not redownload the same update repeatedly in a tight loop after
  a failed install.

### Diagnostics and Observability

- Add structured updater diagnostics:
  - request id
  - current version
  - endpoint
  - update availability
  - latest version
  - download size when available
  - elapsed time
  - failure code/message
- Logs must not include secrets.
- Failed update checks must not spam the user on startup.
- Manual checks may show actionable failure messages.
- Diagnostics must cover both app-side updater checks and release-side manifest
  generation/upload validation.
- Release workflow logs must make it obvious which platform artifact or
  signature failed without exposing signing secrets.

### CI and Release Automation

- Release CI must:
  - verify version config and Git tag match
  - build macOS and Windows artifacts
  - generate updater signatures
  - generate `latest.json`
  - validate manifest schema and URLs
  - upload artifacts, signatures, and manifest to GitHub Releases
- Root npm scripts must expose the release/update publishing flows, including:
  - normal versioned release
  - dry-run release
  - republish of the current version
  - dry-run republish
- CI must fail if any artifact listed in the manifest is missing.
- CI must fail if a signature is missing or mismatched.
- CI must fail if manifest version differs from the canonical release config.
- CI must validate the updater release path on every supported runner that can
  build the platform artifacts, and must clearly skip or document unsupported
  runner/platform combinations.
- Release automation must not rely on a developer manually editing
  `latest.json`, manually attaching `.sig` files, or manually changing artifact
  names in GitHub Releases.
- Republish automation must replace the GitHub Release/tag assets in a
  deterministic way and must run the same updater asset validation as a normal
  release.

### Release Asset Contract

The release system must define and enforce a stable artifact contract:

- macOS artifact type, file name pattern, updater compatibility, signature
  file, and manifest platform key.
- Windows artifact type, file name pattern, updater compatibility, signature
  file, and manifest platform key.
- Release notes source.
- `latest.json` name and URL.
- Which artifacts are user-download installers and which are updater
  installable packages.

The contract must be encoded in scripts/config and validated in CI. README text
alone is not sufficient.

## Out of Scope

- Building a custom dynamic update server.
- Forced updates.
- User cohorts, percentage rollouts, or staged rollout policies.
- Silent background installation without explicit user action.
- Updating `.aimd` document format versions.
- Auto-updating CLI-only installations outside the desktop app bundle.
- Partial updater scaffolding that requires a future goal before AIMD can
  publish and consume a real production update.

## Required Architecture

The production update flow must be:

1. Version management goal provides canonical app version and release metadata.
2. Release CI builds signed desktop installers.
3. Release CI signs updater artifacts with the private updater key.
4. Release CI generates a Tauri-compatible `latest.json` manifest.
5. GitHub Release hosts installers, signatures, and manifest.
6. App starts and performs a background update check.
7. If no update exists, app stays silent.
8. If an update exists, app shows a lightweight notification.
9. User chooses install.
10. App verifies there are no unsaved changes or asks user to resolve them.
11. App downloads, verifies signature, installs, and restarts/quits according
    to platform behavior.
12. Failures are logged and shown only when relevant.
13. Republish can delete/recreate the current release/tag assets and regenerate
    updater signatures/manifest without changing the app version.
14. A maintainer can prove the release is usable by installing version `X.Y.Z`,
    publishing `X.Y.Z+1`, checking in-app, installing, and confirming the app
    reports `X.Y.Z+1`.

## Acceptance Criteria

- Tauri updater plugin is installed, registered, and configured.
- Updater public key is present in app config; private key is not committed.
- App can manually check for updates from a visible settings/menu action.
- App performs one non-blocking startup check and stays silent when no update is
  available.
- App shows a compact update notification when manifest version is newer than
  current app version.
- Update install is blocked or deferred when any window has unsaved changes.
- Download/install failures produce actionable UI state and structured logs.
- GitHub Release contains installers, signatures, and update manifest.
- `latest.json` validates against the Tauri updater schema expected by the app.
- Manifest version, artifact names, and Git tag match the canonical release
  config.
- Windows install mode is documented and manually verified.
- macOS release signing/notarization requirements are documented before public
  distribution.
- Normal release and republish release are exposed through root npm commands.
- Release dry-run and republish dry-run validate updater asset planning without
  mutating GitHub state.
- Production release workflow produces the same updater asset contract that the
  app is configured to consume.
- A release cannot succeed if updater assets are missing, stale, unsigned, or
  inconsistent with the canonical version.
- The final implementation passes:
  - `node scripts/sync-version.mjs --check`
  - release dry-run script for normal release path
  - release dry-run script for republish path
  - updater manifest validation script
  - `npm --prefix apps/desktop run check`
  - `cargo check --workspace`
  - relevant Playwright test for update notification UX
  - `git diff --check`

## Suggested Test Matrix

### Unit and Integration

- Manifest parser accepts a valid newer version.
- Manifest parser rejects missing `version`.
- Manifest parser rejects missing platform URL.
- Manifest parser rejects missing signature.
- Update check returns "no update" when manifest version equals current version.
- Update check returns "available" when manifest version is newer.
- Update check failure does not show startup noise.
- Manual check failure shows actionable message.
- Dirty document state blocks install/restart.

### E2E

- No-update startup path stays quiet.
- Manual "Check for Updates" displays "up to date".
- Mock newer update displays notification with current/latest versions.
- Dismiss update notification suppresses repeat notification in the same
  session.
- Dirty document plus install click shows save/cancel guard.
- Failed download shows error and preserves document state.

### Release CI

- Release tag/config mismatch fails.
- Missing private updater key fails release job.
- Missing `.sig` fails manifest validation.
- Manifest URL points to uploaded artifact.
- Manifest version equals canonical release version.
- macOS and Windows artifacts both appear in release manifest.
- Republish dry-run does not mutate GitHub state.
- Republish release regenerates and validates signatures and manifest for the
  existing canonical version.
- GitHub Release asset names match the artifact contract exactly.

## Manual Verification Checklist

1. Build and install version `X.Y.Z`.
2. Publish a test GitHub Release for `X.Y.Z+1` with installers, signatures, and
   manifest.
3. Launch installed `X.Y.Z`.
4. Confirm startup does not block the main window.
5. Trigger manual "Check for Updates".
6. Confirm UI shows `X.Y.Z -> X.Y.Z+1`.
7. Open or edit a document so it is dirty.
8. Click install and confirm update is blocked until save/cancel is resolved.
9. Save the document and retry install.
10. Confirm download, signature verification, install, and restart/quit behavior.
11. Relaunch and confirm app reports version `X.Y.Z+1`.
12. Confirm logs contain updater diagnostics and no secrets.
13. Run release dry-run and confirm it plans all installer, signature, and
    manifest assets.
14. Run republish dry-run and confirm it targets the current canonical version
    without requiring `patch`, `minor`, or `major`.
15. For a test release, run republish and confirm the recreated GitHub Release
    still updates an installed older app.

## Security Requirements

- Private updater signing key must never be committed.
- Public key must be reviewed in config changes.
- CI secrets must be scoped to release workflows only.
- Update URLs must use HTTPS.
- App must reject unsigned or incorrectly signed artifacts.
- Release manifest must not be generated from untrusted pull-request artifacts.
- Release jobs that can access signing secrets must require trusted branch/tag
  context.

## Delivery Requirements

This goal is complete only when online updates are production-ready:

- Version management goal is already complete.
- Static GitHub Release updater flow works end to end on macOS and Windows.
- Signing, manifest generation, upload, and validation are automated in CI.
- App UX is non-blocking, protects unsaved work, and exposes manual checks.
- Diagnostics make update failures debuggable.
- Normal release, dry-run release, republish, and dry-run republish are
  documented npm commands and are wired to the same production artifact
  contract.
- README documents the update behavior, release publishing flow, signing key
  handling, and platform caveats.
- A maintainer can execute the manual verification checklist without inventing
  missing steps.
