# AIMD Desktop QA Report

## Current Result

- TypeScript typecheck passes.
- Rust unit and integration tests pass.
- Markdown raw HTML rendering is covered by a regression test.
- Tauri command registration coverage now includes settings, Web Clip, LLM, asset, window, and draft commands.

## Fixed In This Pass

- Removed Docu-Tour menu and sidebar remnants.
- Plain Markdown no longer prompts for `.aimd` upgrade when an image is inserted.
- Markdown with inserted images saves through `.aimd` Save As using an internal draft package as the asset source.
- Web Clip drafts are now stored in app-local data instead of OS temp.
- Web Clip listener cleanup runs on accept and extractor-window close.
- Web Clip preview retry restores the loading panel instead of leaving a broken failure DOM.
- Save/settings flows no longer require API Key merely to persist non-secret settings.
- Auto image optimization refreshes the open document after disk assets change.
- The document action menu's “open in new window” action now passes the current saved path and is disabled for unsaved documents.

## Residual Risk

- Full Tauri/browser E2E should still be run before release because many Playwright tests use mocked Tauri commands.
- Keychain/secure-secret storage remains future work.
- Existing legacy metadata keys are still hidden during frontmatter rendering so old documents do not expose internal payloads.
