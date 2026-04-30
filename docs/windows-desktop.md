# Windows Desktop

AIMD Desktop is a pure Rust + Tauri application. No Go toolchain is required.

## Prerequisites

- Windows 10 / 11
- Node.js 20 or newer
- Rust stable MSVC toolchain (`rustup` with `x86_64-pc-windows-msvc` target)
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools with the C++ workload

The root-level `build-windows.bat` script checks for Node.js, Cargo, and WebView2 via `winget`.

## One-Command Build

From the repository root:

```bat
build-windows.bat
```

The script verifies prerequisites, runs the Tauri release build, and copies Windows artifacts into root-level `dist`.

## Development

From `apps/desktop`:

```powershell
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and the Tauri dev window. No sidecar compilation step is needed.

## Release Build

From `apps/desktop`:

```powershell
npm run build
```

The expected release artifacts are under:

```text
apps/desktop/src-tauri/target/release/bundle/
  msi/    AIMD Desktop_0.1.0_x64_en-US.msi
  nsis/   AIMD Desktop_0.1.0_x64-setup.exe
```

## Windows-Specific Behaviors To Verify

- App launches and opens `.aimd`, `.md`, `.markdown`, and `.mdx` files.
- Double-click / file association opens the file in AIMD Desktop after installation.
- "Reveal in Explorer" opens Windows Explorer with the current file selected.
- Creating, saving, saving as, importing Markdown, adding images, and pasted images round-trip correctly.
- Single-instance enforcement: opening a second file from Explorer focuses the existing window.

## Troubleshooting

- If `cargo` is not recognized, install Rust with the MSVC toolchain via `rustup` and reopen the terminal.
- If `npm` is not recognized, install Node.js and reopen the terminal.
- If WebView startup fails on a clean Windows machine, install the Microsoft Edge WebView2 Runtime.
- If `tsc` is not recognized, run `npm install` in `apps/desktop`.
