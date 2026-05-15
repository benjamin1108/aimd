# /goal: Phase 3 - Current-document inspector, review workflow, and async ownership

## Background

After Phases 1 and 2, AIMD has a stable open-document session and per-tab
working state. The next product risk is ownership of side information. Outline,
assets, Git diff, health checks, and save-format warnings all describe either
the active document, the project, or the app. Today these concepts can share the
same sidebar and main surface, which makes users unsure what object they are
reviewing.

This phase creates a production-grade current-document inspector and review
workflow. It must make ownership explicit: project navigation opens files, tabs
own the work session, and the inspector describes the active tab unless it is
explicitly labeled as project-level review.

## Objective

Ship a coherent inspector/review model:

- Outline reflects the active tab.
- Assets reflect the active tab.
- Health/save-format warnings reflect the active tab.
- Git review is clearly separated from active document identity.
- Long-running inspector actions cannot write results to the wrong tab.
- The main document surface remains stable while review tools are used.

## Dependency Gate

Do not start this phase until Phases 1 and 2 are complete and archived.

Required assumptions:

- Open Documents model exists.
- Active tab switch transaction exists.
- Per-tab source/editor state exists.
- Per-tab mode/scroll state exists.
- Async document mutations can target a tab or operation token.

If the async target-tab guard is incomplete from earlier phases, complete it
before moving inspector actions.

## Non-Negotiable Production Requirements

- Inspector content must never show stale data from a previously active tab.
- Inspector actions must target the tab that launched them, not whichever tab is
  active when the async result returns.
- Git diff must not make users think the active document has been closed.
- Project-level Git state and document-level state must be visually distinct.
- Resource and health actions must preserve Markdown/AIMD save semantics.
- `.aimd` Git textconv readability must not regress.
- Inspector collapse/hide behavior must work on narrow windows.
- Inactive tabs must not run inspector work automatically.

## Product Model

The UI must distinguish:

```text
Project panel
  - opens and organizes files
Open document tabs
  - define the active work session
Document inspector
  - describes the active tab
Project review / Git review
  - describes project-level changes and must be labeled as such
```

The inspector is not another file navigator.

## In Scope

### Inspector shell

Create a clearly separated inspector surface. It may be a right panel, a
dedicated lower/side panel, or a transitional sidebar section if layout
constraints require it. The surface must be labeled and owned by the active tab.

Minimum sections:

- `大纲`
- `资源`
- `Git`
- `健康`

The inspector must support collapse/hide. The center document surface must
remain usable without it.

### Inspector data ownership

Inspector data must have explicit scope:

- Document inspector state is keyed by tab id and operation version.
- Project Git status is keyed by project root, not by active document.
- File-level Git diff state is keyed by reviewed path and labeled as review
  state, not document edit state.
- Module-level caches such as "current outline", "current assets", or "current
  health result" are acceptable only if they are derived read-only views of the
  active tab's stored inspector state.
- Switching tabs must rebind inspector data from the target tab. It must not
  wait for a stale async refresh before clearing or replacing the previous tab's
  visible data.

### Outline ownership

- Outline renders from the active tab only.
- Switching tabs updates outline immediately after the active tab render state
  is bound.
- If a tab has no headings, show a compact empty state.
- If no document is active, hide or disable document-specific outline content.
- Long headings truncate without resizing the layout.

### Asset ownership

- Asset list renders from the active tab only.
- AIMD-managed assets and external Markdown image references must be
  distinguishable when the data is available.
- Asset actions must capture `targetTabId`.
- Packaging/embedding results must apply only if the target tab still exists and
  operation version still matches.
- If the user switches tabs during asset work, the result updates the original
  tab and does not overwrite the active tab.

### Health and save-format ownership

- Health checks capture `targetTabId` and operation version.
- Results are stored against the target tab or discarded if stale.
- Warnings must say whether they apply to active document, background tab,
  project, or app.
- `requiresAimdSave`, `hasExternalImageReferences`, dirty state, conflicts, and
  resource findings must remain tab-specific.
- Ordinary Markdown saves must continue to save `.md` unless `requiresAimdSave`
  is true.

### Git review

Git has two scopes and the UI must not blur them:

- Project-level Git status: changed files, staged/unstaged state, branch state.
- Document/file-level diff: review of a selected changed path.

Required behavior:

- Selecting a Git file for diff does not replace the active document identity.
- Choose one Git review placement before archiving this phase:
  - inspector/project-review surface
  - clearly labeled main-surface review mode
- In either placement, tab bar and active document identity must remain visible,
  and the review header must label the surface as `Git review` / `项目变更` /
  file diff rather than active document editing.
- The archived implementation must state which placement was chosen and include
  tests for that placement. Do not leave both paths half-supported with
  inconsistent labels.
- Returning from Git review restores the same active tab, mode, and scroll.
- `.aimd` diffs must still use textconv and show semantic Markdown output.

### Async action ledger

Introduce or reuse a consistent operation ledger for inspector/review actions:

```ts
type DocumentOperationTarget = {
  tabId: string;
  operationVersion: number;
  pathKey?: string | null;
};
```

Every action that can write document, asset, health, or Git review state must
validate its target before applying results.

Validation failure behavior must be deterministic: stale results are ignored or
stored as scoped background-tab results, but they must not update the active
inspector, active document status, or active tab dirty state.

## Out of Scope

- Full Git staging redesign unless required to prevent ownership confusion.
- Split-pane editing.
- Tab drag/drop or tab grouping.
- New document format semantics.
- Product-language cleanup outside inspector/review labels. Phase 4 owns the
  broad copy cleanup.

## Required Tests

At minimum:

- Two tabs with different headings; switch tabs and verify outline updates.
- Two tabs with different assets; switch tabs and verify assets update.
- Switch tabs while an outline refresh is in flight and verify stale headings
  from the previous tab are not shown.
- Start asset packaging on tab A, switch to B, complete operation; verify B is
  unchanged and A receives the result.
- Start health check on tab A, switch to B, complete operation; verify result
  belongs to A or is clearly stored for A.
- Open Git diff/review and verify active tab identity remains visible or return
  copy names the active tab.
- Return from Git review and verify active tab, mode, and scroll restore.
- Close project directory while a document tab is active; verify inspector still
  describes the active tab or cleanly disables project-level Git.
- `.aimd` changed file diff remains textconv-readable.
- Narrow viewport: inspector can collapse/hide without overlapping tabs or
  document content.

## Regression Tests That Must Still Pass

- Phase 1 tab behavior specs.
- Phase 2 session/scroll specs.
- Asset panel settings:
  - `apps/desktop/e2e/45-asset-panel-settings.spec.ts`
- Git workspace panel:
  - `apps/desktop/e2e/46-git-workspace-panel.spec.ts`
- Source-preserving editor:
  - `apps/desktop/e2e/50-source-preserving-editor.spec.ts`
- Markdown save semantics:
  - `apps/desktop/e2e/31-md-open-association.spec.ts`

## Required Validation

Run before completion:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- Targeted Playwright specs for inspector/review ownership.
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
   - inspector ownership model
   - target-tab/operation-version guard
   - Git review scope decision
   - Markdown/AIMD save semantic preservation
   - narrow viewport behavior
   - validation results
5. Move this file with `git mv`:
   - from `docs/todo/workflow-tabs-phase-3-document-inspector-goal.md`
   - to `docs/todo/archive/workflow-tabs-phase-3-document-inspector-goal.md`

Do not archive this file before the phase is truly complete. Do not make a
standalone commit that only moves this file to `archive/`. Do not report the
goal complete while the active copy still exists under `docs/todo/`.
