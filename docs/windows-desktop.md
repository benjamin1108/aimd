# Windows Desktop Adaptation

This project ships the desktop UI through Tauri and uses the Go `aimd` CLI as a bundled sidecar.

## Prerequisites

- Windows 10/11
- Node.js 20 or newer
- Go 1.22 or newer, with `go` available in `PATH`
- Rust stable MSVC toolchain, with `cargo` available in `PATH`
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools with the C++ workload

The root-level `build-windows.bat` script installs or verifies these prerequisites through `winget`.

## One-Command Build

From the repository root:

```bat
build-windows.bat
```

The script prepares the environment, runs the Tauri build, and copies Windows artifacts into root-level `dist`.

## Development

From `apps/desktop-tauri`:

```powershell
npm install
npm run dev
```

`npm run dev` first runs `npm run build:sidecar`, which builds:

- `bin/aimd.exe` for Windows execution
- `bin/aimd` as a compatibility resource name for the shared Tauri config

## Release Build

From `apps/desktop-tauri`:

```powershell
npm run build
```

The Tauri config uses platform-aware bundle targets. On Windows, the expected release artifact is a Windows installer under:

```text
apps/desktop-tauri/src-tauri/target/release/bundle/
```

## Windows-Specific Behaviors To Verify

- App launches without `AIMD_CLI` set and finds the bundled `aimd.exe`.
- Opening `.aimd`, `.md`, `.markdown`, and `.mdx` files works from the app.
- Double-click/file association opens the file in AIMD Desktop after installation.
- "Reveal in Finder" equivalent opens Windows Explorer with the current file selected.
- Creating, saving, saving as, importing Markdown, adding images, and pasted images round-trip correctly.

## Troubleshooting

- If `go` is not recognized, install Go and reopen the terminal so `PATH` is refreshed.
- If `cargo` is not recognized, install Rust with the MSVC toolchain through `rustup`.
- If `tsc` is not recognized, run `npm install` in `apps/desktop-tauri`.
- If WebView startup fails on a clean Windows machine, install the Microsoft Edge WebView2 Runtime.
