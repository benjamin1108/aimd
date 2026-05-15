# /goal: AIMD Desktop three-column layout and production-grade CSS precision

## Background

The workflow-tabs architecture is now correct, but the current UI is visually
too cramped. The project tree and document inspector share the same left rail,
which makes the product feel squeezed even when the information hierarchy is
right. Several controls in narrow spaces also rely on small text, compressed
labels, or fragile flex wrapping. That is not acceptable for a production
desktop editor.

The earlier HTML design prototype already communicated the intended spatial
model:

```text
Project rail -> Document workspace -> Current document inspector
```

This is not a future direction. The production app must ship a real three-column
desktop layout now. Review mode is a future extension; the current work must
leave space for it architecturally but must not block on implementing a visible
review mode.

## Objective

Ship a production-grade visual/layout pass for AIMD Desktop:

- Desktop layout is a true three-column app:
  - left project rail
  - center document workspace
  - right current-document inspector
- The UI no longer feels crowded in ordinary desktop widths.
- Text, icons, badges, tabs, menus, and toolbar controls never deform, overlap,
  or become visually crushed.
- CSS reaches a high-precision production standard: consistent tokens,
  predictable dimensions, deliberate responsive behavior, and clean visual
  rhythm.
- The implementation is verified with automated and visual tests across real
  viewport widths and representative document states.

## Non-Negotiable Requirements

### Three-column layout is mandatory

At desktop widths, the app must use three independent columns:

```text
┌──────────────┬──────────────────────────────┬─────────────────┐
│ Project      │ Document workspace            │ Inspector       │
│ files/actions│ header, tabs, editor, status   │ outline/assets/ │
│              │                               │ Git/health      │
└──────────────┴──────────────────────────────┴─────────────────┘
```

Requirements:

- Project rail and inspector rail must not share a single cramped column.
- The document workspace must remain the dominant center surface.
- Project rail and inspector rail each need their own scroll context.
- Resizing behavior must clamp to sane min/max widths and never push the
  document below a usable width.
- Closing the project must clear only the project rail; it must not collapse or
  confuse the current document inspector.
- Hiding/collapsing the inspector is allowed, but the default desktop state must
  be three columns when a document is open.

Recommended starting dimensions, to refine during implementation:

- project rail: `clamp(220px, 18vw, 300px)`
- inspector rail: `clamp(260px, 20vw, 360px)`
- document workspace: `minmax(560px, 1fr)`

These numbers are not final design tokens. The final implementation must be
validated visually, not just copied from this note.

### Responsive behavior must be explicit

Define clear breakpoints instead of letting flex/grid compression decide:

- Wide desktop: project + document + inspector visible.
- Medium desktop: keep three columns if the document remains usable; otherwise
  collapse inspector behind a stable toggle before text starts squeezing.
- Narrow desktop/tablet: project rail may collapse first, inspector may become
  a drawer/panel, and document remains usable.
- Mobile-width smoke: no horizontal overflow, no hidden primary command, no
  overlapping header/tab/toolbars.

The implementation must not use viewport-scaled font sizes to make text fit.
If text does not fit, change layout, wrapping, grouping, or icon treatment.

### Typography and control precision

Audit all desktop app CSS and fix fragile patterns:

- No negative letter spacing in compact UI controls, badges, tabs, sidebar rows,
  menus, or status bars.
- No button or badge text squeezed by narrow flex tracks.
- No toolbar labels that depend on tiny font sizes to survive.
- No clipped text unless the component deliberately uses ellipsis with a
  visible title/accessible label.
- No icon/text button when an icon-only control with a tooltip is the better
  tool action.
- Text inside buttons, tabs, badges, and menu items must align optically and
  remain readable at all tested widths.
- Minimum target sizes must be consistent; icon buttons should not drift between
  unrelated dimensions without a reason.

### Header, tabs, and stable status

The document header and tab strip must be especially disciplined:

- Header height must be stable and must not balloon when badges wrap.
- Title, path, badges, Save, and More must have deterministic allocation.
- If badges overflow, use a designed second line or overflow treatment; do not
  squeeze the Save button or More button.
- Tabs must have fixed height, stable close button hit areas, visible dirty
  state, and horizontal overflow behavior that does not resize the document
  surface.
- Long document titles must not push other controls off-screen.

### Project rail

The left rail owns project navigation only:

- Persistent section label is `项目`.
- Project path/root name can be shown as secondary information, not as the
  section label replacement.
- Project actions must remain clear: open directory, refresh project, new
  document, new folder, close project.
- Tree rows must have stable height, icons, indentation, hover/active states,
  and ellipsis behavior.
- Project rail must remain understandable when no project is open, project is
  loading, project errors, or a project is closed while tabs remain open.

### Inspector rail

The right rail owns current-document inspection:

- Inspector label must identify the active document.
- Tabs are `大纲`, `资源`, `Git`, `健康`.
- Git remains project-scoped but is visually housed in the inspector.
- Health and asset results must remain target-tab safe.
- Empty states must be compact and task-oriented.
- Inspector collapse/expand must not shift document content unpredictably.

### Review mode is future-only

Do not implement a visible `审阅` mode in this goal.

This goal must keep the architecture ready for a future review mode by keeping
Git/health/assets cleanly separated and making the inspector a first-class rail,
but the visible shipped view modes remain:

- `预览`
- `可视编辑`
- `Markdown`

### No generic redesign churn

This is a precision production pass, not a decorative redesign.

Do not:

- Add marketing hero sections.
- Add gradient blobs, decorative orbs, or gratuitous animation.
- Replace the editor experience with a concept mockup.
- Change document save semantics.
- Change Git algorithms.
- Implement review mode.
- Hide crowding by making fonts smaller.

Do:

- Use stronger layout architecture.
- Reduce cramped control groups.
- Normalize CSS tokens and dimensions.
- Fix the root cause of squeeze/overlap.
- Keep the product quiet, high-end, and editor-focused.

## Required Audit Before Implementation

Before changing layout, produce a concrete audit from the current app:

1. Capture representative screenshots at:
   - 1728x1117
   - 1440x900
   - 1280x800
   - 1180x760
   - 1024x720
   - 760x700
   - 600x700
2. Include states:
   - no project / no tabs
   - project open / no tabs
   - project open / three tabs
   - dirty Markdown tab requiring AIMD save
   - AIMD tab with Git conflict
   - Git inspector open
   - health inspector open
   - source/Markdown mode
3. Scan CSS for fragile patterns:
   - negative `letter-spacing`
   - viewport-scaled typography
   - `white-space: nowrap` without max-width/ellipsis
   - controls below target size
   - arbitrary one-off widths/heights on repeated controls
   - layout based on accidental flex shrink
4. Identify exact cramped components before fixing them.

Do not skip the audit and jump directly to CSS tweaks.

## Implementation Scope

Expected files likely include:

- `apps/desktop/src/ui/template.ts`
- `apps/desktop/src/core/dom.ts`
- `apps/desktop/src/ui/doc-panel.ts`
- `apps/desktop/src/ui/workspace.ts`
- `apps/desktop/src/ui/resizers.ts`
- `apps/desktop/src/styles/frame.css`
- `apps/desktop/src/styles/sidebar.css`
- `apps/desktop/src/styles/sidebar-layout.css`
- `apps/desktop/src/styles/sidebar-git.css`
- `apps/desktop/src/styles/workspace.css`
- `apps/desktop/src/styles/tabs.css`
- `apps/desktop/src/styles/toolbar.css`
- `apps/desktop/src/styles/responsive.css`
- targeted Playwright specs under `apps/desktop/e2e/`

This list is not exhaustive. Keep edits scoped to layout, visual quality, and
tests unless a small state/DOM change is required to support the three-column
structure cleanly.

## Required Tests

Add or update Playwright coverage for:

- Desktop default renders project rail, document workspace, and inspector rail
  as three separate columns.
- Project rail and inspector rail have independent widths and scroll contexts.
- Closing project keeps open tabs and inspector understandable.
- Inspector collapse/expand does not overlap tabs, header, editor, or status.
- Header badges do not squeeze Save/More controls at tested desktop widths.
- Tabs retain fixed height and close-button hit area with long titles and dirty
  state.
- Project tree long names ellipsize without resizing the rail.
- Git inspector and health inspector remain usable in the right rail.
- Narrow viewport fallback has no horizontal overflow and no hidden primary
  command.
- Accessibility names still match visible scope.

The tests must assert geometry where appropriate, not only text labels:

- no overlapping bounding boxes for header controls
- document workspace width above the accepted minimum on desktop
- stable tab/header heights
- no document body occlusion by rails or overlays
- `document.documentElement.scrollWidth <= clientWidth + 1` at narrow widths

## Visual QA Requirements

Generate and review screenshots for all required viewports and states.

The final implementation is not acceptable unless visual review confirms:

- no overlapped text
- no clipped primary commands
- no distorted or squeezed buttons
- no compressed tab close affordances
- no rail content fighting the editor surface
- no unexpected horizontal page scroll
- no confusing object ownership between project, active document, inspector,
  and Git review

Store screenshots under a temporary review directory such as
`/private/tmp/aimd-three-column-css-review/` during validation. They do not need
to be committed unless a test snapshot strategy is deliberately added.

## Required Validation

Run before completion:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- New three-column/CSS precision Playwright specs.
- Regression specs:
  - `apps/desktop/e2e/07-narrow-viewport.spec.ts`
  - `apps/desktop/e2e/38-design-polish.spec.ts`
  - `apps/desktop/e2e/44-workspace-directory-management.spec.ts`
  - `apps/desktop/e2e/45-asset-panel-settings.spec.ts`
  - `apps/desktop/e2e/46-git-workspace-panel.spec.ts`
  - `apps/desktop/e2e/49-selection-boundary.spec.ts`
  - `apps/desktop/e2e/52-open-documents-tabs.spec.ts`
  - `apps/desktop/e2e/53-tab-session-state.spec.ts`
  - `apps/desktop/e2e/54-document-inspector.spec.ts`
  - `apps/desktop/e2e/55-navigation-language.spec.ts`

Any skipped validation must be explained as an environment-only blocker. A
visual or CSS quality gap is not a valid skip reason.

## Completion Criteria

This goal is complete only when:

1. The app ships a true three-column desktop layout.
2. Project and inspector are no longer competing inside one rail.
3. Narrow and medium viewport fallbacks are explicit and visually reviewed.
4. Control typography and sizing are audited and corrected across the app.
5. Geometry tests cover the highest-risk crowding and overlap cases.
6. Screenshots demonstrate production-quality spacing at required viewports.
7. Regression tests pass.
8. A completion note is added to this file summarizing:
   - final column architecture
   - responsive breakpoints
   - CSS precision rules enforced
   - visual QA screenshot locations
   - test and validation results
9. Move this file with `git mv` to:
   - `docs/todo/archive/three-column-css-polish-production-goal.md`

Do not archive this goal until the real implementation, tests, screenshots, and
validation are complete.

## Completion Note — 2026-05-15

### Final column architecture

- Desktop document shell is now a real three-column grid:
  - left `.sidebar` project rail
  - center `.workspace` document surface
  - right `#inspector.inspector` current-document inspector
- Project and inspector rails are independent DOM siblings of the workspace, no
  longer stacked inside one cramped left rail.
- Project rail and inspector rail have separate horizontal resize handles:
  `#sidebar-hr-resizer` and `#inspector-hr-resizer`.
- Project close clears only the project rail/workspace tree; open tabs and the
  active document inspector remain understandable.
- Resource, Git, and health content is target-tab scoped in the inspector; asset
  content no longer leaks into Git or health tabs.

### Responsive breakpoints

- Wide desktop: three visible columns with CSS-token widths:
  - project rail `clamp(220px, 18vw, 300px)`
  - workspace `minmax(560px, 1fr)`
  - inspector rail `clamp(260px, 20vw, 360px)`
- `<=1180px`: tighter rail tokens and a `500px` workspace minimum.
- `<=1100px`: inspector collapses to a stable `44px` affordance; expanding it
  opens a right overlay drawer instead of squeezing the document surface.
- `<=900px`: project rail collapses first; workspace keeps the inspector
  affordance.
- `<=760px`: single-column mobile smoke layout; project and inspector rails are
  hidden, primary document commands remain reachable, and no horizontal page
  overflow is allowed.

### CSS precision rules enforced

- Root/chrome negative `letter-spacing` was removed; the CSS audit now reports
  no negative letter-spacing or viewport-scaled typography in desktop styles.
- Header allocation is deterministic: title/path/badges occupy a minmax text
  track, Save/More remain fixed command controls, and badges use ellipsis
  instead of squeezing commands.
- Tabs keep fixed height and close-button hit areas; long titles ellipsize.
- Project rows keep fixed icon/name tracks, indentation, hover/active states,
  and ellipsis without resizing the rail.
- Inspector, outline, asset, Git, and health styles are split into
  `apps/desktop/src/styles/inspector.css` so `sidebar.css` stays under the code
  size gate.

### Visual QA screenshots

- Generated under `/private/tmp/aimd-three-column-css-review/`.
- Screenshot matrix contains 56 PNG files:
  - viewports: `1728x1117`, `1440x900`, `1280x800`, `1180x760`,
    `1024x720`, `760x700`, `600x700`
  - states: no project/no tabs, project/no tabs, project/three tabs, dirty
    Markdown requiring AIMD save, AIMD Git conflict, Git inspector, health
    inspector, Markdown source mode.
- Representative visual review confirmed no overlapped text, no clipped primary
  commands, no distorted tab close controls, no rail/editor ownership confusion,
  and no unexpected horizontal page scroll.

### Validation results

- `npm --prefix apps/desktop run check` passed.
- `cargo check --workspace` passed.
- `git diff --check` passed.
- `AIMD_THREE_COLUMN_SCREENSHOT_DIR=/private/tmp/aimd-three-column-css-review npm --prefix apps/desktop run test:e2e -- e2e/56-three-column-css-polish.spec.ts` passed and refreshed the visual matrix.
- Required regression specs passed together: `58 passed`.
  - `apps/desktop/e2e/07-narrow-viewport.spec.ts`
  - `apps/desktop/e2e/38-design-polish.spec.ts`
  - `apps/desktop/e2e/44-workspace-directory-management.spec.ts`
  - `apps/desktop/e2e/45-asset-panel-settings.spec.ts`
  - `apps/desktop/e2e/46-git-workspace-panel.spec.ts`
  - `apps/desktop/e2e/49-selection-boundary.spec.ts`
  - `apps/desktop/e2e/52-open-documents-tabs.spec.ts`
  - `apps/desktop/e2e/53-tab-session-state.spec.ts`
  - `apps/desktop/e2e/54-document-inspector.spec.ts`
  - `apps/desktop/e2e/55-navigation-language.spec.ts`
  - `apps/desktop/e2e/56-three-column-css-polish.spec.ts`
