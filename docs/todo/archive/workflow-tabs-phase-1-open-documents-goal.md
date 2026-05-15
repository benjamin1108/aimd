# /goal: Phase 1 - Open Documents core and production-safe multi-file tabs

## Background

AIMD Desktop has grown from a single-document editor into a local workspace
editor with project directory browsing, Markdown/AIMD save semantics,
source-preserving visual editing, asset management, and Git review. The missing
architecture layer is `Open Documents`: the set of documents currently open in
one window.

Without this layer, the current directory and current document are coupled too
tightly. Directory selection feels like it replaces the whole editor state.
Closing a directory can be mistaken for closing a document. Dirty state and save
state only have one visible owner.

This phase introduces the production-safe Open Documents core. It must be safe
to ship by itself: multiple documents can be open, switching documents cannot
lose data, and closing the window cannot discard dirty inactive tabs.

## Objective

Implement the first production version of multi-file tabs:

- A window can hold multiple open documents.
- A compact tab bar represents the open document set.
- Exactly one tab is active.
- Existing document commands operate on the active tab.
- Opening an already-open path activates the existing tab.
- Dirty indicators and close behavior are correct per tab.
- Closing a project directory does not close document tabs.
- Multi-window path registration continues to prevent conflicting edits without
  breaking same-window tabs.

## Product Model

The user model must become:

```text
Project directory
  -> Open Documents
    -> Active Document
      -> Document View
```

Definitions:

- `Project directory`: optional local folder context. It helps users find files.
- `Open Documents`: the current window's working set, shown as tabs.
- `Active Document`: the selected tab; document commands target this object.
- `Document View`: preview / visual edit / Markdown view for the active document.

The directory tree is not the open-document session. A file can be open without
being selected in the project tree, and a project can be closed while tabs stay
open.

## Non-Negotiable Production Requirements

- No dirty document may be lost when switching tabs, closing tabs, opening
  another document, closing the project, or closing the window.
- Ordinary `.md` save semantics must remain conservative: `save_markdown` is
  used unless `requiresAimdSave` is true.
- Source-preserving visual edits must stay per-document. Untouched Markdown in
  one tab must not be rewritten because another tab is edited or switched.
- `.aimd` Git textconv behavior must not regress.
- Failed open/import operations must not mutate the active tab.
- Every asynchronous operation that writes document state must target a specific
  tab or prove it still applies before committing state.
- Code-size checks are part of the production gate. Do not solve this by growing
  large modules past the configured limit.

## In Scope

### Open document state

Introduce an explicit open-document state model. The exact type may vary, but it
must encode these concepts:

```ts
type OpenDocumentId = string;

type OpenDocumentTab = {
  id: OpenDocumentId;
  pathKey: string | null;
  title: string;
  doc: AimdDocument;
  sourceModel: MarkdownSourceModel | null;
  sourceDirtyRefs: Set<string>;
  sourceStructuralDirty: boolean;
  inlineDirty: boolean;
  htmlVersion: number;
  paintedVersion: Record<Mode, number>;
  operationVersion: number;
};

type OpenDocumentsState = {
  tabs: OpenDocumentTab[];
  activeTabId: OpenDocumentId | null;
};
```

Requirements:

- `state.doc` may remain temporarily as the active-document facade, but it must
  be derived from and synchronized with the active tab.
- Mutable editor fields that are currently global (`sourceModel`,
  `sourceDirtyRefs`, `sourceStructuralDirty`, `inlineDirty`, `htmlVersion`,
  `paintedVersion`) must not leak between tabs.
- Path-backed tabs use normalized path keys. Unsaved drafts use generated stable
  ids.
- The model must support two drafts with the same title.

### Legacy active-document facade compatibility

Before this phase is complete, every existing single-document entry point must
have an explicit tab-aware owner. Do not leave scattered writes to the old
global active document state.

Audit and update at least these paths:

- open routing: file picker, directory tree, recent files, drag/drop, import,
  and new document creation
- document binding: any `applyDocument`/load-result path that replaces the
  current document
- save paths: save, save as, Markdown save, AIMD package save, and export
- close/discard paths: close tab, close window, discard prompt, and cancel
  behavior
- view paths: mode switching, preview render, visual edit binding, Markdown
  textarea binding, and source-preserving patch application
- side data paths: outline, asset state, health state, Git/conflict side
  effects, and status messages
- persistence paths: recent files, session snapshot, and draft snapshot

Each path must either accept an explicit `targetTabId`/operation target or route
through a single active-tab transaction helper. There must not be multiple
ad-hoc places that assign `state.doc` and related editor globals directly.

### Active tab switch transaction

Implement tab switching as a transaction, not as direct assignment:

1. If the current tab is in visual edit mode and has inline dirty DOM, flush it
   into that tab before deactivation.
2. Snapshot the current tab's document, source model, dirty refs, structural
   dirty flag, inline dirty flag, render versions, and textarea value.
3. Activate the target tab.
4. Bind the active-document facade (`state.doc` and related globals) from that
   tab.
5. Paint only the active tab's current view.
6. Update chrome, tab bar, directory highlight, outline, assets, and status from
   the new active tab.

If any flush/save-like step fails, the switch must stop and leave the old active
tab intact.

Rendered HTML, preview paint, and visual-editor DOM writes must be keyed by tab
and render version. A stale render result from tab A must not replace the active
DOM after the user has switched to tab B.

### Tab bar UI

Add a compact desktop tab bar:

- Show document title or file name.
- Show active state.
- Show dirty state.
- Show draft state.
- Show format where useful: Markdown, AIMD, Draft.
- Provide per-tab close affordance.
- Truncate long names predictably and expose full title/path via `title` or
  accessible label.
- Keep tab height stable.
- Hide the tab bar only when no tabs are open.

### Open/reuse routing

All user entry points that open documents must route through one shared
open-or-activate path:

- File picker open.
- Recent file click.
- Directory tree document click.
- Drag/drop file open.
- Markdown import result.
- New document creation.
- Restore from existing last-document path if still used.

Rules:

- If a normalized path is already open in this window, activate that tab.
- If the path is open in another window, focus that window unless product policy
  explicitly changes.
- If opening succeeds, create and activate a new tab.
- If opening fails or file type is unsupported, keep current active tab
  unchanged.
- Opening a draft always creates a new draft tab.

### Close behavior

- `关闭文档` becomes closing the active tab internally.
- Closing a dirty tab must invoke save/discard/cancel for that tab by title/path.
- Closing an inactive dirty tab must not silently activate and discard it; the
  prompt must identify the inactive tab being closed.
- Cancelling close leaves the tab and active tab unchanged.
- Closing the last tab returns to launch/empty state while keeping the project
  directory if it is open.
- Closing the project directory must clear the project tree and Git workspace
  state only; it must not close tabs.
- Closing the window must block or prompt if any open tab is dirty. Acceptable
  production behavior may prompt one dirty tab at a time, but it must identify
  each tab and must abort the close on cancel or save failure.

### Multi-window path registry

The existing Rust path registry is effectively one-path-per-window. That is not
valid after tabs. Update the registry model so one window can own multiple open
paths.

Required behavior:

- Registering a new tab path for a window does not unregister other paths in the
  same window.
- Closing one tab unregisters only that tab's path.
- Closing a window unregisters all paths for that window.
- Save As / rename / move updates the path mapping for the affected tab only.
- `focus_doc_window(path)` still focuses another window if that path is open
  elsewhere.
- If the path is already open in the current window, frontend tab activation
  handles it.

Command/API boundary:

- Add or update Rust/frontend commands so a single tab path can be unregistered
  or updated without clearing every path for the current window.
- Existing all-path cleanup behavior is valid only for full window close or
  equivalent teardown.
- The implementation must not reuse a current-window unregister-all command for
  ordinary single-tab close.

### Async state ownership

Any asynchronous operation that can mutate document state must capture
`targetTabId` and/or an operation version:

- open file
- save
- save as
- import Markdown
- render Markdown
- apply rendered HTML / preview paint
- source textarea synchronization
- format document
- insert/paste image
- asset packaging
- health check that writes document/assets
- optimization-on-open
- Git conflict or path update side effects

When the async result returns, it must write only if the target tab still exists
and the operation is still current for that tab. It must never write to whichever
tab happens to be active at completion time.

Status messages and error banners produced by async work must also preserve
ownership. A background tab operation may update that tab's state or show a
clearly scoped background result, but it must not make the active document look
dirty, failed, or saved.

## Out of Scope

- Session restore of multiple tabs after app restart. That is Phase 2.
- Per-tab scroll restoration. That is Phase 2.
- Inspector consolidation. That is Phase 3.
- Product-language cleanup and large UI renaming. That is Phase 4.
- Tab drag reorder, pinned tabs, split panes, or tab tear-out.

## Required Tests

At minimum:

- Open two different project files and verify two tabs.
- Click the same project file twice and verify no duplicate tab.
- Edit tab A, switch to tab B, verify only A is dirty.
- Switch back to A and save; verify B remains unchanged.
- Close dirty active tab and cancel; verify tab remains.
- Close dirty inactive tab and cancel; verify active tab remains unchanged.
- Close project directory while tabs are open; verify tabs remain and project
  tree clears.
- Close the app/window with dirty inactive tabs; verify no data is lost.
- Trigger the native window close lifecycle with multiple dirty tabs and verify
  cancel/save failure aborts the close instead of closing the window.
- Rename or move an open project file; verify tab path, registry, recent path,
  and project highlight update for the affected tab only.
- Open same path in two windows; verify registry still focuses the existing
  owner and same-window tabs are not broken.
- Async guard: start a document-affecting operation on tab A, switch to tab B
  before completion, and verify the result does not write to B.

## Regression Tests That Must Still Pass

- Markdown open/save semantics:
  - `apps/desktop/e2e/31-md-open-association.spec.ts`
  - `apps/desktop/e2e/42-editor-core-capabilities.spec.ts`
- Source-preserving editor:
  - `apps/desktop/e2e/50-source-preserving-editor.spec.ts`
- Directory management:
  - `apps/desktop/e2e/44-workspace-directory-management.spec.ts`
- Git workspace behavior if path registry changes:
  - `apps/desktop/e2e/46-git-workspace-panel.spec.ts`

## Required Validation

Run before completion:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- Targeted Playwright specs for this phase.
- The regression specs listed above.

Any skipped validation must be explained as an environment-only blocker. A
functional gap is not a valid skip reason.

## Completion and Auto-Archive Protocol

This goal is complete only when implementation, tests, validation, and archive
movement happen in the same final change set.

Required completion actions:

1. Implement the phase.
2. Add/update tests.
3. Run required validation.
4. Include a completion note summarizing:
   - tab state model
   - active tab switch transaction
   - dirty close behavior
   - multi-window path registry changes
   - async target-tab guard
   - validation results
5. Move this file with `git mv`:
   - from `docs/todo/workflow-tabs-phase-1-open-documents-goal.md`
   - to `docs/todo/archive/workflow-tabs-phase-1-open-documents-goal.md`

Do not archive this file before the phase is truly complete. Do not make a
standalone commit that only moves this file to `archive/`. Do not report the
goal complete while the active copy still exists under `docs/todo/`.

## Completion Note - 2026-05-15

- Tab state model: added explicit `openDocuments.tabs` and `activeTabId`, with each tab owning its document, source model, source dirty refs, inline dirty flag, render versions, operation version, and current mode.
- Active tab switch transaction: switching flushes pending visual edits, snapshots the outgoing active facade into its tab, binds the target tab back into the legacy `state.doc` facade, repaints only the active document surface, and refreshes chrome/sidebar ownership.
- Dirty close behavior: close now targets a tab. Dirty active and inactive tabs prompt by document title, cancel leaves the active tab unchanged, and closing the last tab returns to the launch state while project context can remain independent.
- Multi-window path registry: Rust registration now allows multiple paths per window, adds single-path unregister, keeps all-path unregister for full window teardown, and Save As / workspace rename passes old/new path mapping for the affected tab.
- Async target-tab guard: markdown render, format, health/resource actions, image hydration, and save result application capture tab/operation ownership before writing back. Stale results are ignored instead of repainting the current tab.
- Regression hardening: structural toolbar inserts now append Markdown directly for table/code/task blocks, and image alt edits update the source Markdown without falling into whole-document structural flush.
- Validation results:
  - `npm --prefix apps/desktop run check`: passed.
  - `cargo check --workspace`: passed.
  - `git diff --check`: passed.
  - `npx playwright test e2e/52-open-documents-tabs.spec.ts`: 4 passed.
  - `npx playwright test e2e/23-discard-confirm-flow.spec.ts e2e/33-dedup-window.spec.ts e2e/44-workspace-directory-management.spec.ts`: passed after updating directory deletion expectations to the new tab semantics.
  - `npx playwright test e2e/31-md-open-association.spec.ts e2e/42-editor-core-capabilities.spec.ts e2e/50-source-preserving-editor.spec.ts`: 32 passed.
  - `npx playwright test e2e/20-rust-handler-registration.spec.ts e2e/46-git-workspace-panel.spec.ts`: 88 passed.
