# macOS PKG Packaging

The system-level AIMD package installs:

```text
/Applications/AIMD.app
/usr/local/bin/aimd
```

Create the PKG:

```bash
./scripts/build-macos-pkg.sh
```

The script builds the desktop app, builds the release `aimd` CLI, stages the app bundle as `/Applications/AIMD.app`, and installs the real CLI binary as `/usr/local/bin/aimd` with executable permissions. Installing the package may require administrator authorization because it writes under `/Applications` and `/usr/local/bin`.

The final package is written to `dist/AIMD-<version>.pkg`. Cargo/Tauri caches stay under `target/` for faster rebuilds. After a successful package build, `.app`, `.dmg`, bundle, and staging products are removed so the repo only keeps the build cache and final PKG.

Force a fresh build by removing the build cache first:

```bash
./scripts/build-macos-pkg.sh --clean
```

The package intentionally does not write user Git config. Git integration is enabled explicitly from AIMD settings or via `aimd git-install`.
