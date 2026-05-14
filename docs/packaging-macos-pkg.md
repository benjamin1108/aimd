# macOS PKG Packaging

The system-level AIMD package installs:

```text
/Applications/AIMD Desktop.app
/usr/local/bin/aimd
/usr/local/share/aimd/skill/aimd/
```

Create the PKG:

```bash
./scripts/build-macos-pkg.sh
```

The script builds the desktop app, builds the release `aimd` CLI, stages the app bundle as `/Applications/AIMD Desktop.app`, installs the real CLI binary as `/usr/local/bin/aimd`, and installs the AIMD Agent skill source under `/usr/local/share/aimd/skill/aimd/`. Installing the package may require administrator authorization because it writes under `/Applications` and `/usr/local`.

The package postinstall installs the AIMD skill by default into all supported user-level Agent skill directories for the active console user. It also refreshes `~/.local/bin/aimd` for that user so an older user-local AIMD binary cannot shadow `/usr/local/bin/aimd` on PATH.

The package preinstall quits a running AIMD Desktop before replacing `/Applications/AIMD Desktop.app`. It first asks the app to quit via bundle id `org.aimd.desktop`, waits briefly, and only then terminates the old `aimd-desktop` process if needed.

The final package is written to `dist/AIMD-<version>.pkg`. Cargo/Tauri caches stay under `target/` for faster rebuilds. After a successful package build, `.app`, `.dmg`, bundle, and staging products are removed so the repo only keeps the build cache and final PKG.

Force a fresh build by removing the build cache first:

```bash
./scripts/build-macos-pkg.sh --clean
```

The package intentionally does not write user Git config. Git integration is enabled explicitly from AIMD settings or via `aimd git-install`.

Agent skill installation can also be repeated manually:

```bash
aimd skill list-agents
aimd skill install --agent codex --scope user
aimd skill install --agent claude-code --scope project --project /path/to/repo
aimd skill doctor
```

The uninstall script removes `/Applications/AIMD Desktop.app`, `/Applications/AIMD.app` if left by older builds, `/usr/local/bin/aimd`, `/usr/local/share/aimd`, and the user-local `~/.local/bin/aimd` shim when it matches the installed CLI. It does not remove skills already copied into user or project agent directories; use `aimd skill uninstall` for those.
