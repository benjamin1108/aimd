# AIMD Desktop Development Report

## Current Product Decisions

- Docu-Tour has been removed from the desktop UI and native menu surface.
- Plain Markdown files open as ordinary editable Markdown documents.
- Plain Markdown saves back to the original `.md` while it only contains text/normal Markdown edits.
- Once the user inserts or pastes an image into a Markdown document, AIMD creates an internal app-managed draft package and only asks for an `.aimd` path when the user saves.
- Web Clip drafts use app-local draft packages instead of OS temp files, so images can survive app restart until the draft is saved or discarded.

## Current Architecture Notes

- `apps/desktop/src-tauri/src/drafts.rs` owns cross-platform draft package storage under the app local data directory.
- `apps/desktop/src/document/drafts.ts` is the frontend helper for creating, cleaning, and reusing draft packages.
- `.aimd` reads and writes remain in `aimd-core`; the desktop layer only chooses when to create a managed draft versus a user-visible file.
- Markdown rendering disables raw HTML. The app CSP is no longer `null`.
- The Web Clip extractor still runs in a separate Tauri webview and sends accepted documents back to the main window.

## Verification

- `npm run typecheck`
- `cargo test --target-dir /private/tmp/aimd-fix-target`

## Remaining Engineering Notes

- API keys are still stored in the app settings JSON. A future security pass should move secrets into a platform keychain or equivalent secure store.
- Browser-level end-to-end tests still mock much of Tauri. Keep the handler-registration smoke test updated when commands are added or removed.
