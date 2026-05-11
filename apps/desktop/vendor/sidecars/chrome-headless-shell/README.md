# Chrome Headless Shell sidecar

This directory is generated at build time by:

```sh
npm run prepare:pdf-sidecar
```

The script downloads the current platform's Playwright `chromium-headless-shell`
build into the Playwright cache, then copies the platform-specific runtime files
here so Tauri can bundle them as app resources.

Expected executable names:

- macOS/Linux: `chrome-headless-shell`
- Windows: `chrome-headless-shell.exe`

The generated runtime files are intentionally ignored by git. The PDF exporter
resolves this directory from packaged app resources, and also checks this
development vendor path when running locally. For local development, you can set
`AIMD_CHROME_HEADLESS_SHELL` to an explicit `chrome-headless-shell` executable
path. Do not point it at Google Chrome.app or another system browser; the
exporter rejects those paths.
