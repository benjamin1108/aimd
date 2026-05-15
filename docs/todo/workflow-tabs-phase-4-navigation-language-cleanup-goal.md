# /goal: Phase 4 - Product language, navigation coherence, and final workflow hardening

## Background

Phases 1-3 establish the working architecture:

```text
Project directory -> Open Documents -> Active Document -> Document View -> Inspector
```

Phase 4 makes that architecture visible, consistent, and hard to regress. This
is not a cosmetic copy pass. Naming, command placement, status placement, empty
states, and accessibility labels are part of the product architecture. Users
must know what object they are acting on before they click: project, open tab,
active document, view, inspector, Git review, or app-level command.

## Objective

Ship the final workflow cleanup:

- User-facing language consistently distinguishes project, open documents,
  active document, document view, inspector, Git review, and app-level actions.
- Stable document identity and save state are visible near the active tab/header.
- Project commands and document commands no longer compete for the same visual
  hierarchy.
- View mode labels match non-programmer Markdown user expectations.
- Tests assert ownership and labels so future regressions are caught.
- Documentation/demo artifacts match the implemented product.

## Dependency Gate

Do not start this phase until Phases 1-3 are complete and archived.

Required assumptions:

- Multi-file tabs are production-safe.
- Per-tab session state and restore are production-safe.
- Inspector/review ownership is production-safe.
- Async target-tab guards exist for document-affecting operations.

If any assumption is missing, stop and finish the earlier phase. Do not use copy
changes to hide architecture gaps.

## Non-Negotiable Production Requirements

- A user can tell what will be affected before choosing close, save, open,
  export, inspect, health, package, or Git review.
- Dirty, draft, format, conflict, and `requiresAimdSave` states are visible near
  the active tab/document header.
- Bottom status remains for transient feedback, not the only stable document
  state display.
- Empty states are task-oriented and compact; no generic marketing copy.
- Accessibility labels match visible language and object scope.
- Narrow viewport behavior remains coherent.
- Existing tests may be updated, but must not be weakened to accept ambiguous
  ownership.
- Internal renames are allowed only when they remove real ambiguity without
  causing broad unrelated churn.

Test updates must preserve intent. If selectors or labels change, update tests
to assert the new scoped language and accessible names; do not replace precise
ownership assertions with broad regular expressions that would also pass the
old ambiguous UI.

## In Scope

### User-facing terminology

Required direction:

- `目录` as a persistent section label becomes `项目`.
- `打开目录` remains acceptable for the action that chooses a folder.
- `关闭当前目录` becomes `关闭项目` or `关闭当前项目`, depending on final UI.
- `阅读` becomes `预览`.
- `编辑` becomes `可视编辑`.
- `源码` becomes `Markdown` or `Markdown 对照`.
- `关闭文档` becomes `关闭当前标签页` or `关闭当前文档`, but the chosen label must
  match the actual action precisely.
- Git diff surfaces must say `Git review` / `Git 差异` / `项目变更` rather than
  presenting themselves as the current document.
- App-level commands such as About and Updates must not be grouped as document
  commands if that causes scope confusion.

### Header, tab, and stable status model

The active document header/tab area must expose:

- active document title
- path or draft label
- format: Markdown / AIMD / Draft
- dirty state
- conflict state
- `requiresAimdSave` state when applicable
- whether the document is inside the current project when relevant

The tab dirty indicator must be visible enough to prevent accidental close, but
not visually noisy.

### Command hierarchy

Separate command scopes:

- Project commands: open project, close project, refresh project, new file in
  project, new folder.
- Tab/document commands: save active document, save as, export, close tab,
  format, health, asset package.
- Inspector commands: switch inspector section, run health, inspect assets,
  review Git.
- App commands: about, update, settings, new window.

Menus and buttons must not place unrelated scopes together without separators or
clear grouping.

### Empty and edge states

Cover:

- no project, no tabs
- project open, no tabs
- tabs open, no project
- active dirty draft
- active Markdown requiring AIMD save
- active document with Git conflicts
- Git project unavailable
- inspector hidden/collapsed
- narrow viewport

Each state must say what the user can do next without long explanations.

### Internal naming cleanup

Clean naming where it reduces real ambiguity:

- New code must not use `workspace` for the main document surface.
- Directory context must use `project`, `workspaceRoot`, or another explicit
  directory-context name.
- Open-document session must use `openDocuments`, `tabs`, `activeTab`, or an
  equally explicit name.
- Keep legacy names only where renaming would create broad churn without user or
  maintainability benefit.

### Demo and developer documentation

- `docs/product/aimd-tab-workflow-redesign-demo.html` must be updated or
  explicitly confirmed accurate after implementation.
- The demo is a product communication artifact, not the implementation source of
  truth. If implementation behavior differs, fix the demo or mark the mismatch
  explicitly before archiving this phase.
- Add a short developer note for the final state model.
- The developer note must explain:
  - project vs open documents
  - active tab facade, if still used
  - inspector ownership
  - session restore schema
  - path registry behavior

## Out of Scope

- New editor engine capabilities.
- New AIMD/Markdown save semantics.
- New Git algorithms.
- Plugin system or command palette.
- Major visual redesign unrelated to information architecture.
- Multi-pane split editing.

## Required Tests

At minimum:

- Label assertions for project section and project close action.
- Label assertions for tab close / document close action.
- Label assertions for view controls: preview, visual edit, Markdown.
- Header/tab status assertions for dirty, draft, format, conflict, and
  `requiresAimdSave`.
- Project close with tabs open: wording and resulting UI are correct.
- Active tab close with dirty document: prompt names the document/tab.
- Git review labels distinguish project/file review from active document.
- Empty state tests for:
  - no project/no tabs
  - project open/no tabs
  - tabs open/no project
- Narrow viewport smoke: tabs remain usable and inspector/project surfaces do
  not overlap document content.
- Accessibility smoke: key controls have meaningful accessible names.
- Visual smoke: capture representative desktop and narrow viewport screenshots
  and verify there is no overlapping text, hidden primary command, or unstable
  tab/header height.

## Regression Tests That Must Still Pass

- Phase 1 tab behavior specs.
- Phase 2 session/restore specs.
- Phase 3 inspector/review specs.
- Markdown save semantics:
  - `apps/desktop/e2e/31-md-open-association.spec.ts`
- Source-preserving editor:
  - `apps/desktop/e2e/50-source-preserving-editor.spec.ts`
- Selection boundary / narrow viewport specs if labels or layout move:
  - `apps/desktop/e2e/49-selection-boundary.spec.ts`
  - `apps/desktop/e2e/07-narrow-viewport.spec.ts`

## Required Validation

Run before completion:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- Targeted Playwright specs for Phase 4.
- Regression specs listed above.

Any skipped validation must be explained as an environment-only blocker. A
functional gap is not a valid skip reason.

## Final Product Review Checklist

Before archiving this goal, perform a product review against real workflows:

1. Open a project.
2. Open three documents, including at least one `.md` and one `.aimd`.
3. Edit one document in visual mode and one in Markdown mode.
4. Confirm dirty state is visible on the correct tabs.
5. Close the project and confirm open tabs remain understandable.
6. Reopen the project and confirm the directory is context, not the session.
7. Run health/asset review on one tab and switch tabs mid-operation.
8. Open Git review and confirm active document identity remains stable.
9. Save ordinary Markdown and confirm it remains `.md` unless
   `requiresAimdSave` is true.
10. Restart the app and confirm session restore language is understandable.

## Completion and Auto-Archive Protocol

This goal is complete only when implementation, tests, validation, product
review, documentation/demo alignment, and archive movement happen in the same
final change set.

Required completion actions:

1. Implement the phase.
2. Add/update tests.
3. Run required validation.
4. Complete the product review checklist.
5. Confirm or update `docs/product/aimd-tab-workflow-redesign-demo.html`.
6. Add/update the developer note.
7. Include a completion note summarizing:
   - final terminology
   - command scope hierarchy
   - stable status placement
   - accessibility/narrow viewport checks
   - demo/doc alignment
   - validation results
8. Move this file with `git mv`:
   - from `docs/todo/workflow-tabs-phase-4-navigation-language-cleanup-goal.md`
   - to `docs/todo/archive/workflow-tabs-phase-4-navigation-language-cleanup-goal.md`

Do not archive this file before the phase is truly complete. Do not make a
standalone commit that only moves this file to `archive/`. Do not report the
goal complete while the active copy still exists under `docs/todo/`.
