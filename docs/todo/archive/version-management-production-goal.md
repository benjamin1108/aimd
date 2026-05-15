# /goal: AIMD production version management

## Background

AIMD currently has app and package versions duplicated across multiple files:

- `Cargo.toml` workspace package version
- `apps/desktop/package.json` desktop package version
- `apps/desktop/src-tauri/tauri.conf.json` Tauri app version
- README download examples and release text

This is fragile for production releases. A release can accidentally ship with
one installer version, another Rust/package version, and stale README download
names. The fix must not depend on a developer remembering to manually run a
version sync command.

This goal tracks production-grade version governance. The implementation must
make one configuration file the source of truth and wire synchronization into
normal development, build, packaging, CI, and release flows.

## Objective

Make AIMD versioning deterministic and release-safe:

- One repo-local release configuration is the authoritative version source.
- App, package, Rust workspace, README, build output names, and updater metadata
  derive from that source.
- Version synchronization is automatic in normal workflows, not a manual
  prerequisite.
- CI fails early if generated or derived version fields drift.
- Release artifacts can be traced back to the exact version config and Git tag.

## In Scope

### Source of Truth

- Add a single release config file at repo root, for example
  `release.config.json`.
- The config must include at minimum:
  - `version`
  - `channel`
  - `releaseUrl`
  - updater endpoint base or manifest URL placeholder
- `version` must be valid SemVer and compatible with Tauri updater comparison.
- `channel` must be explicit, for example `stable`, `beta`, or `dev`.
- Pre-release versions such as `1.2.0-beta.1` must be accepted only when the
  channel policy allows them.

### Automatic Synchronization

- Add a deterministic sync script, for example `scripts/sync-version.mjs`.
- Version sync and check logic must be implemented in a cross-platform Node
  script. Bash and PowerShell scripts may call it, but must not reimplement
  SemVer parsing, derived-file mutation, or drift detection.
- Add root-level npm scripts as the canonical user entrypoints:
  - `npm run version:sync`
  - `npm run version:check`
- The sync script must update all derived version fields:
  - `[workspace.package].version` in `Cargo.toml`
  - `version` in `apps/desktop/package.json`
  - `version` in `apps/desktop/src-tauri/tauri.conf.json`
  - any release metadata files introduced by updater support
- The sync script must be idempotent.
- The sync script must preserve existing formatting as much as practical.
- Normal developer commands must run sync automatically before doing versioned
  work:
  - desktop `npm run dev`
  - desktop `npm run build`
  - desktop `npm run build:pkg`
  - desktop `npm run check`
  - macOS PKG build script
  - Windows installer build script
  - CI release jobs
- Developers may still run the sync script directly for debugging, but manual
  execution must not be required for correctness.

### Release Version Bumping

- Add a cross-platform one-command release entrypoint implemented as a Node
  script, for example `scripts/release.mjs`.
- Add root-level npm scripts as the canonical release user entrypoints:
  - `npm run release -- patch`
  - `npm run release -- minor`
  - `npm run release -- major`
  - `npm run release -- republish`
  - `npm run release:dry -- patch`
  - `npm run release:dry -- minor`
  - `npm run release:dry -- major`
  - `npm run release:dry -- republish`
- Bash and PowerShell release wrappers are allowed only as thin wrappers around
  the Node release script. They must not reimplement release flow, SemVer bump,
  tag validation, Git operations, or resume/no-bump behavior.
- The release entrypoint must accept exactly one bump level:
  - `patch`
  - `minor`
  - `major`
  - `republish`
- `patch` is the default daily release mode and must increment only the SemVer
  patch component, for example `1.4.27 -> 1.4.28`.
- `minor` is for large feature releases and must increment the SemVer minor
  component while resetting patch to zero, for example `1.4.27 -> 1.5.0`.
- `major` is for platform-level rewrites or breaking compatibility changes and
  must increment the SemVer major component while resetting minor and patch to
  zero, for example `1.4.27 -> 2.0.0`.
- The release script must not try to infer `minor` or `major` automatically from
  commits, changed files, or labels. A human must choose `minor` or `major`
  explicitly.
- Only the release entrypoint may bump versions. Normal dev/build/check/package
  commands must sync or validate existing versions, but must not increment any
  version component.
- `republish` must not bump the version. It must read the current
  `release.config.json` version, delete or replace the matching GitHub Release
  and tag, recreate `vX.Y.Z` at current `HEAD`, and push the tag to trigger the
  release workflow again.
- `republish` must require a clean worktree, current branch `main`, local
  `HEAD == origin/main`, and passing version check before it deletes or replaces
  the release/tag.
- Re-running a failed release must not accidentally bump twice. The release
  script must detect an existing matching release commit/tag or provide an
  explicit resume/no-bump mode.
- The release entrypoint must perform the production sequence:
  1. Require a clean worktree, except for explicitly allowed generated version
     files during the controlled bump.
  2. Read the current version from `release.config.json`.
  3. Compute the next version from `patch`, `minor`, or `major`.
  4. Write the new canonical version to `release.config.json`.
  5. Run version synchronization.
  6. Run required checks.
  7. Commit the version bump.
  8. Create Git tag `vX.Y.Z`.
  9. Push the commit and tag so release CI builds and publishes artifacts.

### Drift Detection

- Add a validation mode such as `node scripts/sync-version.mjs --check`.
- `--check` must fail if any derived version field differs from
  `release.config.json`.
- CI must run the check before tests and before packaging.
- Release scripts must run sync first and then check that the worktree has no
  unexpected version drift.
- A mismatch between Git tag and release config version must fail release CI.
  For example tag `v1.2.3` must match `release.config.json` version `1.2.3`.

### README and Documentation

- README must not hardcode stale current-version text unless that text is
  generated from the release config.
- README must explain:
  - where the canonical version lives
  - which files are generated or synchronized
  - that regular dev/build/package commands sync automatically
  - that `patch`, `minor`, and `major` bumps happen only through the release
    entrypoint
  - that `patch` is automatic daily release increment, while `minor` and
    `major` require explicit release selection
  - how CI detects drift
  - how to bump a version safely
- README download examples should either use placeholders such as `<version>` or
  be generated from the release config.

### Release Naming

- macOS PKG, Windows NSIS, MSI, updater manifests, and GitHub Release tags must
  use the same normalized version string.
- Build scripts must not independently parse unrelated package files when they
  need the release version; they must read the canonical release config or a
  generated value that is checked against it.
- Artifact names must be stable and documented.

## Out of Scope

- Implementing online update download/install behavior.
- Changing the `.aimd` document format.
- Replacing the existing packaging scripts unless needed to wire version sync.
- Supporting multiple simultaneous product versions in one checkout.
- Publishing a real release to GitHub.

## Required Architecture

The production sync flow must be:

1. Developer changes `release.config.json`.
2. Any normal dev/build/check/package command automatically runs version sync.
3. Derived files are updated deterministically.
4. CI runs `sync-version --check`.
5. Release CI verifies Git tag, config version, package versions, Tauri config,
   README/version docs, and artifact names all agree.
6. Packaging and updater metadata generation consume the same version source.

No production command may rely on a human remembering a separate "sync version"
step.

The production release flow must be:

1. Release owner chooses `patch`, `minor`, or `major`.
2. Release entrypoint computes the next version:
   - `patch`: `X.Y.Z -> X.Y.(Z+1)`
   - `minor`: `X.Y.Z -> X.(Y+1).0`
   - `major`: `X.Y.Z -> (X+1).0.0`
3. Release entrypoint updates `release.config.json`.
4. Release entrypoint syncs derived version fields.
5. Release entrypoint validates drift, tests, and release tag consistency.
6. Release entrypoint creates the version bump commit and `vX.Y.Z` tag.
7. GitHub Actions builds and publishes the release from that tag.

## Acceptance Criteria

- `release.config.json` is the only hand-edited app version source.
- Root `npm run version:sync` synchronizes derived version files on macOS,
  Windows, and Linux.
- Root `npm run version:check` detects drift on macOS, Windows, and Linux.
- Running `npm --prefix apps/desktop run dev` automatically syncs version fields
  before Tauri starts.
- Running `npm --prefix apps/desktop run build` automatically syncs version
  fields before packaging assets are built.
- Running `npm --prefix apps/desktop run check` verifies version sync and fails
  on drift.
- Running `./scripts/build-macos-pkg.sh` automatically syncs version fields
  before reading package metadata or naming artifacts.
- Running `./scripts/build-windows-installer.cmd` / `.ps1` automatically syncs
  version fields before naming artifacts.
- Running `npm run release -- patch` changes `1.4.27` to `1.4.28`.
- Running `npm run release -- minor` changes `1.4.27` to `1.5.0`.
- Running `npm run release -- major` changes `1.4.27` to `2.0.0`.
- Running `npm run release -- republish` keeps `1.4.27` as `1.4.27` and
  replaces `v1.4.27` tag / GitHub Release.
- Running `npm run release:dry -- patch`, `minor`, and `major` computes the
  correct next version without changing the worktree.
- Running `npm run release:dry -- republish` reports the current tag that would
  be replaced without changing the worktree.
- The same npm release commands work on macOS, Windows, and Linux.
- Normal `dev`, `build`, `check`, macOS package, and Windows package commands
  do not bump the version.
- Release entrypoint refuses ambiguous bump levels and refuses to infer bump
  level automatically.
- Re-running or resuming a failed release cannot create an unintended second
  patch/minor/major bump.
- `node scripts/sync-version.mjs --check` exits non-zero when any derived file
  has a stale version.
- CI blocks a release when Git tag `vX.Y.Z` does not match
  `release.config.json` version `X.Y.Z`.
- README documents the automated version flow and no longer presents stale
  hardcoded "current version" values.
- The final implementation passes:
  - `node scripts/sync-version.mjs --check`
  - `npm --prefix apps/desktop run check`
  - `cargo check --workspace`
  - `git diff --check`

## Suggested Test Matrix

- `release.config.json` version equals all derived versions.
- `release.config.json` bumped from `1.0.0` to `1.0.1` updates all derived
  files.
- Release bump `patch` maps `1.0.0 -> 1.0.1`.
- Release bump `minor` maps `1.0.7 -> 1.1.0`.
- Release bump `major` maps `1.9.7 -> 2.0.0`.
- `npm run release:dry -- patch` maps `1.0.0 -> 1.0.1` without file changes.
- `npm run release:dry -- minor` maps `1.0.7 -> 1.1.0` without file changes.
- `npm run release:dry -- major` maps `1.9.7 -> 2.0.0` without file changes.
- `npm run release:dry -- republish` maps `1.0.7 -> v1.0.7` without file
  changes or version bump.
- The npm release and release dry-run commands pass on macOS, Windows, and
  Linux CI.
- Release bump rejects missing bump level unless an explicit documented default
  is chosen.
- Release bump rejects unknown bump levels such as `feature` or `c`.
- Normal sync commands never mutate `release.config.json` by incrementing the
  version.
- Release resume/no-bump mode does not increment an already bumped version.
- Running sync twice produces no diff on the second run.
- `--check` passes on synchronized files.
- `--check` fails when `Cargo.toml` is stale.
- `--check` fails when `apps/desktop/package.json` is stale.
- `--check` fails when `tauri.conf.json` is stale.
- Release-tag validation accepts `v1.2.3` with config `1.2.3`.
- Release-tag validation rejects `v1.2.4` with config `1.2.3`.
- Pre-release versions follow channel policy.

## Manual Verification Checklist

1. Change `release.config.json` from `1.0.0` to a test version.
2. Run `npm --prefix apps/desktop run check`.
3. Confirm `Cargo.toml`, `apps/desktop/package.json`, and
   `apps/desktop/src-tauri/tauri.conf.json` now contain the test version.
4. Run `node scripts/sync-version.mjs --check` and confirm it passes.
5. Deliberately edit one derived version to an old value.
6. Run `node scripts/sync-version.mjs --check` and confirm it fails with the
   exact stale file and expected/current values.
7. Restore sync and confirm `git diff --check` passes.
8. Run `npm run release:dry -- patch` and confirm it would
   compute `1.0.0 -> 1.0.1`.
9. Run `npm run release:dry -- minor` and confirm it would
   compute `1.0.0 -> 1.1.0`.
10. Run `npm run release:dry -- major` and confirm it would
    compute `1.0.0 -> 2.0.0`.
11. Run `npm run release:dry -- republish` and confirm it would republish
    `v1.0.0` without bumping.
12. Confirm the dry-run release path does not change the worktree.

## Delivery Requirements

This goal is complete only when the automated version flow is production-ready:

- Version source is singular and documented.
- Core sync, check, and release logic is implemented in cross-platform Node
  scripts with root npm commands as the canonical user entrypoints.
- Sync is automatic in every normal dev/build/package/release path.
- Release bumping supports explicit `patch`, `minor`, and `major` modes with
  SemVer reset rules.
- Release republishing supports explicit `republish` mode that replaces the
  current config version tag/release without bumping.
- Only the release entrypoint increments versions; normal sync/check/build
  commands never increment versions.
- Failed release retries cannot accidentally bump the version twice.
- Drift detection is enforced in CI.
- Release tag matching is enforced.
- Build scripts and README cannot silently drift from the app version.
- Tests prove idempotence, drift detection, and tag/config matching.
