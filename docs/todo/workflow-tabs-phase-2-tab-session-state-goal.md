# /goal: Phase 2 - Per-tab working state, session restore, and performance hardening

## Background

Phase 1 establishes the Open Documents core: tabs, active tab switching,
per-tab dirty/source state, safe close behavior, async ownership guards, and
multi-window path registration.

Phase 2 makes each tab feel like a durable working context. Users should be able
to switch files, restart the app, and resume work without losing where they
were. This phase is about continuity, persistence, and performance under a real
multi-document workload.

## Objective

Ship production-grade per-tab working state:

- Each tab preserves its own view mode.
- Each tab preserves relevant scroll positions and source cursor state.
- Session restore can reopen a safe set of previous tabs.
- Dirty draft recovery works with multiple open documents.
- Dirty path-backed working copies have an explicit recovery policy and cannot
  be overwritten by restore.
- Restore and persistence are schema-versioned and idempotent.
- Tab switching remains fast and does not re-render or hydrate inactive tabs
  unnecessarily.

## Dependency Gate

Do not start this phase until Phase 1 is complete and archived.

Required Phase 1 assumptions:

- There is an explicit Open Documents model.
- Active tab switching is a transaction.
- Core editor/source state is per-tab.
- Window close cannot lose dirty inactive tabs.
- Async document mutations target a tab or operation token.
- Multi-window path registration supports multiple paths per window.

If any assumption is missing, stop and complete Phase 1 first. Do not re-scope
Phase 2 to compensate for an incomplete Phase 1.

## Non-Negotiable Production Requirements

- Session restore must never overwrite newer unsaved content.
- Restoring missing/inaccessible files must not block launch with modal noise.
- Restore must be idempotent: running it twice cannot duplicate tabs.
- Scroll restoration must happen after the target view has rendered, not before.
- Switching tabs must not call whole-document Turndown or rewrite Markdown.
- Inactive tabs must not continuously render, hydrate images, run health checks,
  or update previews.
- Persisted session data must be versioned and validated before use.
- Old single-document session snapshots must migrate safely or be ignored safely.

## In Scope

### Per-tab view state

Each tab must preserve:

- document view mode
- rendered document scroll position
- visual editor scroll position
- source editor scroll position
- source editor cursor/selection
- find bar query and visibility when the find UI is available in the active
  build
- active inspector section only if Phase 3 has already landed in the branch;
  otherwise do not invent inspector state in this phase

Mode, scroll, and source cursor restoration are required. If find-state restore
is intentionally deferred because the current build has no durable find UI, the
completion note must state that boundary and tests must prove no document data
or dirty state is affected.

### Session persistence schema

Introduce a versioned multi-tab session schema.

Suggested shape:

```ts
type PersistedOpenTabV2 =
  | {
      kind: "path";
      id: string;
      path: string;
      title: string;
      format: "aimd" | "markdown";
      mode: Mode;
      scroll: {
        read?: number;
        edit?: number;
        source?: number;
      };
      dirtyWorkingCopy?: {
        markdown: string;
        baseFileMtime?: number;
        baseFileSize?: number;
        requiresAimdSave?: boolean;
        hasExternalImageReferences?: boolean;
      };
    }
  | {
      kind: "draft";
      id: string;
      draftId: string;
      title: string;
      format: "aimd" | "markdown";
      mode: Mode;
      scroll: {
        read?: number;
        edit?: number;
        source?: number;
      };
    };

type PersistedOpenDocumentsSessionV2 = {
  schemaVersion: 2;
  activeTabId: string | null;
  tabs: PersistedOpenTabV2[];
  drafts: Array<{
    id: string;
    title: string;
    markdown: string;
    format: "aimd" | "markdown";
    draftSourcePath?: string;
    requiresAimdSave?: boolean;
    hasExternalImageReferences?: boolean;
  }>;
};
```

Rules:

- Persist path-backed documents by path and lightweight view state.
- Do not persist large rendered HTML for clean path-backed documents.
- Dirty path-backed documents must not be reduced to path-only restore. Either
  persist a versioned working copy with a base file fingerprint or require a
  save/discard decision before normal close. Crash/session recovery must never
  auto-save that working copy over disk.
- Persist dirty drafts through the existing safe draft/session path or an
  equivalent versioned mechanism.
- Draft tabs and path-backed tabs both live in `tabs`, so `activeTabId` is
  always resolvable without consulting a separate array first.
- Store enough metadata to show a useful restoring/error tab if a file is
  missing.
- Validate every field before applying it.

### Restore behavior

Restore sequence:

1. Load persisted session.
2. Validate schema version.
3. Resolve path-backed tabs without blocking launch with modal dialogs.
4. Recover dirty path-backed working copies and dirty drafts safely.
5. Avoid duplicates with initial-open path and existing tab routing.
6. Select the previous active tab if it restored; otherwise select the first
   restored tab.
7. Restore mode and scroll after render.

Missing file behavior:

- If a restored path is missing or inaccessible, either skip it with a status
  message or create a non-active error tab. Pick one behavior and test it.
- Do not show repeated modal file errors during launch.
- Do not delete dirty draft data because a path-backed document failed restore.

Dirty path-backed recovery behavior:

- If the disk file fingerprint still matches the saved base fingerprint, restore
  the working copy as dirty for that path.
- If the disk file changed while the app was closed, restore into a clearly
  labeled recovery/conflict state. Do not silently overwrite either version.
- Dirty path-backed crash restore is required for this phase. Normal app/window
  close must still force save/discard/cancel before exit, but that does not
  replace crash/session recovery.

### Lifecycle persistence

Persist session after:

- opening or closing a tab
- changing active tab
- changing view mode
- successful save/save-as
- path rename/move/save-as
- dirty draft creation or update
- dirty path-backed working-copy changes, throttled enough for performance but
  flushed before close
- app/window close

Throttle persistence when needed, but do not lose state on close.

### Performance hardening

Required behavior:

- Opening 10 medium documents must not eagerly render all inactive tabs.
- Switching tabs must paint only the active tab.
- Image hydration must run only for the active visible document view.
- Health/resource checks must not run automatically for inactive tabs.
- Large source models must not be duplicated unnecessarily beyond per-tab
  correctness requirements.

If performance cannot be measured with exact timing in E2E, add structural tests
or instrumentation hooks that prove inactive tabs are not rendered/hydrated.

## Out of Scope

- Inspector consolidation unless Phase 3 is being implemented in the same
  branch after this goal is complete.
- Tab grouping, pinning, drag reorder, split panes, or tab tear-out.
- A full session manager UI.
- Cloud sync or cross-device restore.
- New document format semantics.

## Required Tests

At minimum:

- Open two tabs, set different modes, switch and verify each mode restores.
- Scroll a rendered document in tab A, switch to B and back, verify A scroll.
- Scroll source editor in tab A, switch to B and back, verify A scroll.
- Switch tabs repeatedly without edits and verify documents do not become dirty.
- Reload/restart with two clean path-backed tabs and verify restore.
- Restore with one missing file and verify launch is not blocked.
- Restore dirty draft and clean path-backed tab together; verify draft survives.
- Restore a dirty path-backed document after simulated crash; verify it remains
  dirty and does not overwrite disk.
- Restore a dirty path-backed document whose disk file changed while closed;
  verify a recovery/conflict state instead of silent overwrite.
- Save As or rename after restore updates persisted path for that tab.
- Restore is idempotent and does not duplicate tabs.
- Performance/structural test: inactive tabs are not rendered/hydrated on open.

## Regression Tests That Must Still Pass

- Phase 1 tab behavior specs.
- Source-preserving editor:
  - `apps/desktop/e2e/50-source-preserving-editor.spec.ts`
- Markdown save semantics:
  - `apps/desktop/e2e/31-md-open-association.spec.ts`
  - `apps/desktop/e2e/42-editor-core-capabilities.spec.ts`
- Session/draft behavior if existing specs cover it; otherwise add coverage.

## Required Validation

Run before completion:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- Targeted Playwright specs for Phase 1 and Phase 2.
- Source-preserving and Markdown save regression specs listed above.

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
   - session schema and migration behavior
   - restore error policy
   - per-tab mode/scroll persistence
   - dirty draft recovery behavior
   - dirty path-backed working-copy recovery policy
   - performance safeguards
   - validation results
5. Move this file with `git mv`:
   - from `docs/todo/workflow-tabs-phase-2-tab-session-state-goal.md`
   - to `docs/todo/archive/workflow-tabs-phase-2-tab-session-state-goal.md`

Do not archive this file before the phase is truly complete. Do not make a
standalone commit that only moves this file to `archive/`. Do not report the
goal complete while the active copy still exists under `docs/todo/`.
