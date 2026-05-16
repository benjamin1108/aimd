# AIMD Agent Notes

Read this file before doing work in this repository. It captures project-specific memory that should not be rediscovered on every task.

## Collaboration Defaults

- Use Simplified Chinese for progress updates, clarifications, summaries, and final replies.
- Dirty worktrees are normal. Do not stash, revert, reset, or clean unrelated local changes without explicit permission.
- For debugging, inspect the real path first: code path, logs, request URL, adapter, workflow state, or artifact. Avoid speculative explanations and workaround-first answers when the user asks for root cause.
- When the user asks to implement, fix, publish, or submit code, execute end to end unless blocked. Do not stop at a proposal.
- If a task references `docs/todo/*`, treat that document as the behavioral source of truth and implement against it before guessing scope.
- Use project-local `tmp/` for temporary AIMD work unless a tool specifically requires a system temp path.

## Validation

- Desktop check command: `npm --prefix apps/desktop run check`.
- Root `npm run check` includes the code-size gate; do not report AIMD work done while that gate fails because a file is oversized.
- Common targeted validation:
  - `npm --prefix apps/desktop run typecheck`
  - `cargo check --workspace`
  - `git diff --check`
  - targeted Playwright specs under `apps/desktop/e2e`
- If a Vite server is already on `127.0.0.1:1420`, reuse it with:
  `AIMD_PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test <spec>`
  from `apps/desktop`.
- If a Playwright browser launch fails with macOS sandbox permission errors, rerun the same command with the required approval path rather than changing the test.

## Desktop Architecture

- Open document tabs live in `state.openDocuments.tabs`; the active surface is `state.openDocuments.activeTabId`.
- Do not assume all visible tabs are ordinary documents. Git Diff tabs share the active tab id but are stored and closed through the Git Diff path.
- `Cmd+W`/close behavior must route by tab ownership: ordinary document tabs use document lifecycle close paths; Git Diff tabs use Git Diff close paths.
- Rendered surfaces should follow the explicit `RenderedSurface` model:
  - `reader`: read-only rendered Markdown.
  - `preview`: rendered Markdown tied to source mode and textarea state.
  - `visual-editor`: `contentEditable` plus source-preserving patching.
  - `git-diff`: read-only diff surface.
- Async render and asset hydration must be guarded by tab/version identity. `hydrateMarkdownLocalImages()` can mutate the DOM after paint, so stale-tab guards such as `targetTabId` or `operationVersion` matter.
- Editor/save fixes should preserve the source-preserving model in `apps/desktop/src/editor/source-preserve.ts`; avoid serializer-only fixes when the problem is editor fidelity.

## UI Contracts

- The right document inspector is a real rail in the layout. At responsive desktop widths it must not overlay the document workspace; expanded/collapsed states should remain grid columns until mobile rules intentionally hide the rail.
- The inspector tab row should remain stable. Git, outline, and asset tabs should not jump vertically when Git content loads.
- The Git inspector tab must be clickable even when the current project is not a Git repository. In that state, keep the Git tab selected and render an empty/non-repo state instead of a blank panel.
- Multi-document tab overflow should not rely on a visible horizontal scrollbar. Keep the active tab visible and provide explicit tab navigation controls that activate neighboring tabs, not only scroll the strip.

## Release And Submission

- When the user says `发布`, `提交代码推送并发布v1.0`, or asks to overwrite an existing release, handle the full flow: version/tag/commit/push as needed, then verify the remote workflow and uploaded release assets.
- For AIMD Desktop releases, `v*` tags trigger the release workflow. Force-moving a tag can be valid only when followed by remote workflow completion and `gh release view` asset verification.
- The useful release verification pair is `gh run watch <run_id> --exit-status` followed by `gh release view <tag> --json tagName,name,url,assets,publishedAt,isDraft,isPrerelease`.

## AIMD Documents And Examples

- When editing existing `.aimd` examples or fixtures, preserve filenames unless the user explicitly asks for a rename; repo docs/tests may reference them.
- If content updates make an embedded image stale, refresh the asset too. A stable path for replacing an embedded image is `aimd assets remove <file> <asset_id>` then `aimd assets add <file> <local_path> --id <same_id> ...`.
- Generated image/assets used in package updates should be copied into the workspace before embedding so the package remains self-contained.

## PDF And Sidecars

- The production PDF path uses the bundled Chrome Headless Shell sidecar, not a WebKit/AppKit print fallback.
- Bundle the full headless-shell runtime directory, not only the executable; missing files such as `icudtl.dat` indicate an incomplete sidecar bundle.
- Before replacing a PDF output, validate the generated file header and size.
