# /goal: Windows Git driver production readiness

## Background

AIMD already has `.aimd` Git diff/textconv and merge driver support, plus desktop settings and CLI commands for installing Git config. On Windows, the integration was still not production-ready: enabling the driver could write commands that Git cannot resolve later, especially when `aimd.exe` is installed but not visible in the Git process PATH, or when the install path contains spaces.

This goal tracks the work needed to make AIMD Git driver support on Windows safe to ship.

## Objective

Make AIMD Git integration on Windows reliable, diagnosable, and release-ready:

- Git driver config must point to a command that Git for Windows can actually execute.
- Desktop and CLI installation paths must behave consistently.
- Failures must be visible to users and diagnosable from logs.
- Tests must cover Windows path, executable suffix, quoting, config round-trip, and failure cases.

## In Scope

- Resolve `aimd.exe` on Windows using PATH with `PATHEXT` support.
- Prefer the packaged stable CLI at `<install-dir>\bin\aimd.exe` when desktop settings write Git driver config.
- Quote and normalize Windows paths before writing `diff.aimd.textconv` and `merge.aimd.driver`.
- Ensure CLI `aimd git-install --global/--repo` writes a usable absolute executable path on Windows.
- Keep `git config --unset-all` idempotent when keys are already missing.
- Ensure Git command execution captures stdout, stderr, exit code, timeout, and request id.
- Store development logs in a Windows-writable temp directory.
- Add Windows-specific Rust tests for path quoting, forward-slash normalization, and stable driver command generation.
- Verify repo-local config round-trips without touching global user Git config.

## Out of Scope

- Redesigning the `.aimd` file format.
- Replacing the existing textconv or three-way merge algorithms.
- Supporting remote Git hosting UIs that cannot run local textconv or merge drivers.
- Silently modifying user Git config without explicit user action.

## Acceptance Criteria

- On Windows, enabling Git driver from the desktop app does not require `aimd.exe` to already be in the app process PATH if the packaged CLI exists.
- If the packaged CLI path contains spaces, Git config stores a quoted command such as `"C:/Program Files/AIMD Desktop/bin/aimd.exe" git-merge %O %A %B %P`.
- `find_in_path("aimd")` can locate `aimd.exe` through Windows `PATHEXT`.
- `aimd git-install --repo` writes the current `aimd.exe` path into local Git config and can be verified with `git config --local --get`.
- Development Git integration logs no longer try to write to `/tmp` on Windows.
- `cargo test -p aimd-cli` passes on Windows.
- `cargo test -p aimd-desktop git_integration` passes on Windows.
- `git diff --check` passes for the touched files.

## Manual Release Checklist

1. Install the Windows NSIS build into the default current-user install directory.
2. Open AIMD settings and enable global Git integration.
3. Confirm `git config --global --get diff.aimd.textconv` points to the installed `bin/aimd.exe`.
4. Confirm `git config --global --get merge.aimd.driver` points to the installed `bin/aimd.exe` and includes `%O %A %B %P`.
5. Create a repo with a `.aimd` file and `.gitattributes` containing `*.aimd diff=aimd merge=aimd`.
6. Run `git diff` and confirm textconv output is produced.
7. Create a merge scenario and confirm the merge driver is invoked.
8. Disable global Git integration and confirm the four AIMD Git config keys are removed.

## Verification Evidence

Validated on Windows on 2026-05-15:

- `cargo test -p aimd-desktop git_integration -- --nocapture` passed with Windows path quoting, `PATHEXT`, config round-trip, and idempotent unset coverage.
- `cargo test -p aimd-cli -- --nocapture` passed with CLI Git command path normalization coverage.
- `npm --prefix apps/desktop run check` passed.
- `npm --prefix apps/desktop run test:e2e:vite -- e2e/48-git-native-integration.spec.ts --reporter=line` passed 4/4 using the explicit Vite runner that exits cleanly on Windows.
- `git diff --check` passed for the touched files.
- `.\scripts\build-windows-installer.cmd -SkipEnv -SkipNpmInstall -SkipChecks` built `dist\AIMD-Desktop_1.0.0_windows_x64-setup.exe`.
- Silent install of that NSIS build produced `%LOCALAPPDATA%\AIMD Desktop\bin\aimd.exe`.
- Installed `aimd.exe` was used in a temporary Git repo to install repo-local AIMD Git config.
- `git diff` against a changed `.aimd` file produced textconv output beginning with `--- AIMD main.md ---`.
- A temporary `.aimd` merge scenario completed with `MERGE_EXIT=0`.
