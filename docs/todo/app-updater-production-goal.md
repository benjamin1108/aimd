# /goal: AIMD production online updater

## Background

AIMD desktop packages are currently distributed through GitHub Releases and
manual installer downloads. The app does not yet notify users when a newer
version is available, and it cannot download and install updates in-app.

The production target is Tauri 2's official updater plugin backed by GitHub
Releases and a signed static update manifest. This keeps infrastructure small
while using the mature Tauri update path: signed artifacts, configured
endpoints, platform-aware installers, and app-side update checks.

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

## Recommended Scheme

Use:

- Tauri 2 official updater plugin
- `@tauri-apps/plugin-updater`
- `@tauri-apps/plugin-process` for restart/install flow
- GitHub Releases as the static artifact host
- `latest.json` as the update manifest
- Tauri updater signing keys for artifact verification

This is the default production path unless a later requirement demands dynamic
rollouts, staged releases, forced updates, or server-side targeting. If dynamic
control becomes necessary, evaluate CrabNebula or a small custom endpoint after
the static GitHub Releases flow is working.

## In Scope

### Tauri Updater Integration

- Add Tauri updater dependencies on Rust and TypeScript sides.
- Register the updater plugin in the Tauri builder.
- Configure updater `pubkey` and `endpoints` in Tauri config.
- Configure Windows updater `installMode` deliberately and document the choice.
- Ensure updater config is compatible with the release version source.
- Add updater permissions/capabilities required by Tauri 2.

### Signing and Key Management

- Generate Tauri updater signing keypair.
- Commit only the public key.
- Store the private key only in secure CI secrets and local release-machine
  secret storage.
- Document key rotation procedure.
- Release scripts must fail if updater signing secrets are missing in release
  mode.
- Every published updater artifact must have a matching `.sig`.

### Release Manifest

- Generate `latest.json` from release artifacts and canonical version config.
- The manifest must include required fields:
  - `version`
  - platform-specific `url`
  - platform-specific `signature`
- Optional release notes and publication date should be included when available.
- Manifest URLs must point to immutable release artifacts, not mutable local
  paths.
- Manifest generation must be deterministic and validated in CI.
- Manifest must be uploaded to GitHub Release as
  `latest.json` or channel-specific names such as `latest-stable.json`.

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

### Install and Restart Flow

- Download progress must be observable in UI or status text.
- Install action must clearly tell users whether the app will restart or quit.
- After successful install, restart the app where supported.
- If restart is not possible, show a clear "restart AIMD to finish updating"
  state.
- Do not risk unsaved document loss:
  - detect dirty documents before install/restart
  - ask user to save or cancel update install
  - never close dirty windows silently

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

### CI and Release Automation

- Release CI must:
  - verify version config and Git tag match
  - build macOS and Windows artifacts
  - generate updater signatures
  - generate `latest.json`
  - validate manifest schema and URLs
  - upload artifacts, signatures, and manifest to GitHub Releases
- CI must fail if any artifact listed in the manifest is missing.
- CI must fail if a signature is missing or mismatched.
- CI must fail if manifest version differs from the canonical release config.

## Out of Scope

- Building a custom dynamic update server in the first production delivery.
- Forced updates.
- User cohorts, percentage rollouts, or staged rollout policies.
- Silent background installation without explicit user action.
- Updating `.aimd` document format versions.
- Auto-updating CLI-only installations outside the desktop app bundle.

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
- The final implementation passes:
  - `node scripts/sync-version.mjs --check`
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
- README documents the update behavior, release publishing flow, signing key
  handling, and platform caveats.
