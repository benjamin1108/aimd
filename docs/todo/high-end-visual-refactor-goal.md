# /goal: AIMD Desktop high-end visual refactor and haptic UI precision

## Background

AIMD Desktop already has the correct product direction: a quiet desktop editor
for Markdown, `.aimd` packages, assets, Git visibility, document health, and
source-preserving editing. The current visual system is stable enough to use,
but it still reads as a careful utility UI rather than an exceptional, deeply
crafted desktop application.

The latest visual audit found that the foundation is sound:

- The document surface uses the intended three-column desktop structure.
- At `1440x900`, the document state measured roughly:
  - project rail: `259px`
  - workspace: `865px`
  - inspector: `288px`
- At `1280x800` in Markdown/source mode, the workspace measured roughly
  `762px`, which makes source/preview split mode feel cramped.
- At `760x700`, the side rails collapse and there is no obvious horizontal
  overflow.
- The CSS avoids negative letter spacing, viewport-scaled typography, and most
  generic motion mistakes.

The remaining problem is not basic usability. The problem is premium execution:
surfaces are too flat, controls feel small, source mode has avoidable pressure
at medium widths, status chips feel too technical, overlay layers are hard-coded,
and one progress animation uses a layout property. These issues keep the app
from feeling like a polished, high-end desktop editor.

This goal replaces the earlier production CSS precision pass with a stricter
visual-quality contract. It must include all current layout discipline, but it
must go further into material depth, component tactility, motion quality,
responsive pressure relief, and visual system governance.

## Objective

Ship a complete high-end visual refactor for AIMD Desktop.

The finished product must feel like a premium native desktop document tool:
quiet, dense enough for real work, precise, tactile, and visually intentional.
It must not become a marketing page, a concept mockup, or a decorative redesign.
It must remain an editor.

Required outcome:

- The whole app has a coherent material system instead of isolated flat panels.
- Primary shells, toolbars, popovers, settings, empty states, tabs, and rails
  use a refined nested-surface language where depth is deliberate.
- Control sizing, hit areas, icons, status chips, tabs, and rails feel
  physically precise rather than merely compact.
- Medium-width source editing no longer feels squeezed.
- Motion uses transform/opacity-first choreography and explicit cubic-bezier
  tokens.
- Overlay and layer ordering use named z-index tokens rather than arbitrary
  high numbers.
- The implementation is verified with screenshots, computed geometry, and
  Playwright regression coverage across real states and viewport widths.

## Non-Negotiable Requirements

### Keep The Product Surface Real

This is not a redesign into a landing page.

Do not:

- Add hero sections, marketing copy, decorative background orbs, bokeh, or
  purely atmospheric visuals.
- Replace the editor with a concept prototype.
- Hide information density by making everything huge.
- Change document save semantics, `.aimd` packaging semantics, Git algorithms,
  source-preserving save behavior, PDF/export behavior, updater logic, or model
  provider behavior.
- Introduce network-loaded fonts, icons, images, or remote CSS.
- Use a UI library just to get a different look.

Do:

- Keep AIMD focused on reading, editing, source editing, assets, outline, Git,
  health, export, updates, and settings.
- Preserve the existing desktop information architecture unless a small DOM
  adjustment is required to make the visual system correct.
- Keep the app calm and operational, but raise the finish quality.
- Treat visual quality as a production contract, not as a theme pass.

### Adopt A Premium Desktop Material System

The current system relies heavily on white panels, warm sidebars, hairlines, and
soft shadows. That is a good base, but not enough.

Implement a named surface system in `tokens.css` and consume it consistently:

- window background
- app shell
- primary panel
- recessed rail
- elevated toolbar
- nested control island
- popover/modal surface
- document canvas
- code/source surface
- status/chip surface
- danger/warn/info/success state surfaces

Major containers must not sit flat on the background. Use restrained
double-bezel/nested-surface treatment where it helps the product:

- The outer app frame should feel like a machined tray.
- The center workspace should feel like the active document desk.
- Toolbar groups should feel like shallow islands, not rows of loose buttons.
- Popovers and panels should have an outer shell plus an inner content surface.
- Empty/recent state should look like a refined launch surface, not a marketing
  hero and not a plain form.
- Settings should share the same material vocabulary as the main window.

This must be subtle. AIMD should not become glassmorphism-heavy. Do not apply
large backdrop blurs to scrolling surfaces. Do not create heavy shadow stacks.
Do not turn every repeated row into a card.

### Raise Control Tactility And Hit-Area Precision

The audit found visible controls below the desired premium target size:

- inspector collapse controls around `20x20`
- inspector tabs around `20px` tall
- open-tab close button around `26x26`
- code copy button around `24px` tall
- many primary/secondary buttons at `30px` high

The refactor must define component-size tokens and apply them consistently:

- icon buttons: target `30-32px` unless the component has a clear compact reason
- tab close buttons: minimum `28px`
- inspector tabs: visually compact but not below a comfortable hit target
- primary/secondary buttons: tune height, padding, and radius together
- popover action buttons: align with the same system
- section toggles and rail collapse controls: no tiny floating text glyph feel

Primary and secondary command buttons need tactile states:

- hover is not just a color change; it should include a subtle material or
  transform response.
- active state should feel like a press, using `transform`, not layout movement.
- disabled state should preserve shape and alignment without feeling muddy.
- icon and text alignment must be optically centered, not only mathematically
  centered.

Do not simply make every control large. This is a desktop editor, so density
still matters. The requirement is controlled tactility, not bloated UI.

### Improve Icons Without Breaking The Existing System

The current inline SVG icon set is thin enough to avoid the common thick-icon
problem, but it is manually maintained and inconsistent risk remains.

Audit and normalize:

- stroke width
- viewBox alignment
- optical size at `13px`, `14px`, `15px`, and toolbar sizes
- vertical centering inside buttons
- icon-only controls with tooltip/title/accessible label
- text labels that should become icon-only controls
- icon-only controls that still need text because the command is ambiguous

Do not replace the icon set with Lucide/FontAwesome/Material icons. If a new
icon source is used, it must be packaged locally, visually lighter than generic
icon libraries, and applied consistently.

### Solve Medium-Width Source Mode Pressure

At `1280x800`, the three-column layout leaves source mode with roughly `762px`
for the center workspace. A two-pane Markdown/source split then feels squeezed.

The refactor must include an explicit pressure-relief model:

- Keep wide desktop three-column editing comfortable.
- At medium widths, prefer collapsing the inspector, switching it to a drawer,
  or changing source mode layout before the source editor becomes cramped.
- Define a source-mode-specific breakpoint or container measurement if needed.
- Ensure Markdown/source text area and preview pane do not fall below a useful
  width.
- Do not hide the problem by reducing font size.
- Do not remove the source/preview workflow on genuinely wide screens.

Expected behavior:

- Wide desktop: source + preview can remain side by side.
- Medium desktop: source mode should gain width by collapsing/de-emphasizing
  the inspector or moving preview.
- Narrow/tablet: one primary source pane, no horizontal overflow, primary
  commands still visible.

### Refine Header, Status Chips, Tabs, And Stable State

The current header is functionally stable, but the visual system is still too
uniform.

Requirements:

- Header height must remain deterministic across long titles, long paths, dirty
  state, Markdown conversion state, Git conflicts, and disk-changed recovery.
- Title and path must preserve strong hierarchy.
- Status chips must be redesigned as a coherent state system:
  - readable at a glance
  - optically balanced
  - not tiny technical tags
  - no squeezed text
  - no accidental equal weight between severe and informational states
- Save and more actions must never be squeezed by badges.
- Long paths and titles must ellipsize deliberately with accessible titles.
- The bottom status pill and header badges must not duplicate meaning in a way
  that creates visual noise.

Tabs:

- fixed height
- stable close-button hit area
- clean dirty indicator
- long titles ellipsize without deforming adjacent controls
- horizontal overflow must not resize the editor surface
- active tab must feel selected through material and position, not only color

### Refine Project Rail And Inspector Rail

The rail architecture is correct and must stay first-class.

Project rail:

- Owns project navigation only.
- Keeps `项目` as the persistent section concept.
- Shows root/project name as secondary information if useful.
- Keeps open/refresh/new-doc/new-folder/close actions clear.
- Long project tree names ellipsize without changing rail width.
- Hover/active states must feel precise and quiet.
- Row height, indentation, icon size, and folder/file distinction must be
  consistent.
- No sidebar content may create hidden horizontal overflow.

Inspector rail:

- Owns current-document inspection: outline, assets, Git, health.
- Collapsed state must feel like a designed rail, not a leftover `44px` strip.
- Inspector tabs must be more tactile and legible than the current compact
  `20px` feel.
- Empty states must be compact and task-oriented.
- Git and health states must remain visually distinct but not noisy.
- Collapse/expand must not overlap header, tabs, editor, status, or popovers.

### Systematize Z-Index And Overlays

The audit found arbitrary layer values such as `8000`, `8900`, `9000`, and
`9500`. Replace this with named tokens.

Create and use a z-index layer system:

- `--z-rail-resizer`
- `--z-menu`
- `--z-popover`
- `--z-drawer`
- `--z-modal`
- `--z-toast`
- `--z-debug`
- `--z-lightbox`

Requirements:

- Menus, context menus, link popovers, web import panel, format preview panel,
  save format panel, updater panel, debug console, and lightbox must all use
  the layer system.
- No one-off `z-index: 8000+` values may remain unless documented with a
  concrete reason.
- Overlay shadows, borders, radius, padding, and inner surfaces must use the
  same material tokens as the rest of the app.
- Fixed overlays must stay inside the viewport at narrow widths.

### Motion Must Be Premium And GPU-Safe

The existing global cubic-bezier token is a good start, but motion needs a
clearer contract.

Requirements:

- No `ease-in-out` or `linear` for interactive transitions.
- No layout-property animation for interactive motion.
- Update progress fill must not transition `width`; use transform-based
  progress such as `scaleX()` with `transform-origin: left`.
- Hover, active, focus, drawer, popover, menu, tab, and panel transitions must
  use named motion tokens.
- Entry transitions should be subtle and should not reduce readability.
- `prefers-reduced-motion` must be respected.
- Do not use JavaScript scroll listeners for visual reveal effects.
- Do not apply blur filters or backdrop blur to large scrolling containers.

### Typography And Density Must Stay Professional

This is a Chinese/English desktop editor, so typography must be practical.

Requirements:

- Keep Chinese readability strong. Do not introduce a display font that weakens
  Chinese UI text.
- If premium Latin display typography is added, package it locally and use it
  only where it materially improves hierarchy.
- Do not load fonts over the network.
- Do not use viewport-scaled font sizes.
- No negative letter spacing.
- UI labels, table text, source editor, paths, status chips, and menus must
  remain readable at tested widths.
- Avoid using tiny font sizes as a workaround for cramped layout.
- Define clear type roles:
  - app title / document title
  - path and metadata
  - section labels
  - command labels
  - status chips
  - source/code
  - body/document prose

### Preserve Document Reading And Editing Quality

The document body is the core product surface.

Requirements:

- Reading mode must feel like a calm document surface, not a blank web page.
- Inline editing must preserve the same reading rhythm while making editability
  clear.
- Source mode must feel like a serious editor pane, not a raw textarea.
- Code blocks, tables, blockquotes, images, links, frontmatter cards, and copy
  buttons must share the refined surface system.
- Long unbreakable text, URLs, tables, and asset references must still behave
  correctly.
- No refactor may reintroduce large Markdown rewrite churn or source-preserving
  editor regressions.

### Settings, Updater, Debug, And Secondary Surfaces Are In Scope

The visual refactor must cover the whole app, not only the main editor.

Include:

- Settings window
- API key masking/reveal control
- model/provider forms
- Git integration settings
- updater panel and progress
- about/update state
- debug console
- file context menu
- link/image alt popovers
- web import panel
- format preview panel
- save format panel
- lightbox

These surfaces must feel like part of the same product. Do not leave secondary
windows behind with old flat form styling.

## Required Audit Before Implementation

Before editing visual code, produce a concrete baseline audit from the current
app.

Capture screenshots at:

- `1728x1117`
- `1440x900`
- `1280x800`
- `1180x760`
- `1024x720`
- `900x720`
- `760x700`
- `600x700`

Include these states:

- no project / no tabs
- project open / no tabs
- project open / one document
- project open / three tabs with long titles
- dirty Markdown tab requiring AIMD save
- AIMD tab with Git conflict
- Git inspector open
- health inspector open
- asset inspector with assets
- source/Markdown mode
- source mode at medium width
- format toolbar visible
- more menu open
- file context menu open
- link popover open
- web import panel open
- save format panel open
- update/about panel open
- settings general page
- settings model page with API key masked and revealed
- debug console visible
- lightbox visible

For each screenshot group, record:

- viewport size
- key panel widths
- header height
- toolbar height
- tab bar height
- workspace body size
- whether any horizontal overflow exists
- visible controls below target size
- overlapping bounding boxes
- text clipping that lacks a title or accessible label

Run CSS scans for:

- negative `letter-spacing`
- viewport-scaled typography
- `white-space: nowrap` without max width, overflow, and ellipsis
- controls below target dimensions
- arbitrary z-index values
- transition/animation of `top`, `left`, `width`, or `height`
- large blur/backdrop blur on scrolling surfaces
- one-off colors that should become tokens
- repeated dimensions that should become component tokens

Do not skip this audit and jump directly to CSS edits.

## Implementation Scope

Expected files include, but are not limited to:

- `apps/desktop/src/styles/tokens.css`
- `apps/desktop/src/styles/frame.css`
- `apps/desktop/src/styles/workspace.css`
- `apps/desktop/src/styles/sidebar.css`
- `apps/desktop/src/styles/sidebar-layout.css`
- `apps/desktop/src/styles/sidebar-git.css`
- `apps/desktop/src/styles/inspector.css`
- `apps/desktop/src/styles/git-diff.css`
- `apps/desktop/src/styles/tabs.css`
- `apps/desktop/src/styles/toolbar.css`
- `apps/desktop/src/styles/buttons.css`
- `apps/desktop/src/styles/reader.css`
- `apps/desktop/src/styles/editor.css`
- `apps/desktop/src/styles/overlays.css`
- `apps/desktop/src/styles/settings.css`
- `apps/desktop/src/styles/updater.css`
- `apps/desktop/src/styles/debug-console.css`
- `apps/desktop/src/styles/lightbox.css`
- `apps/desktop/src/styles/responsive.css`
- `apps/desktop/src/ui/template.ts`
- `apps/desktop/src/core/state.ts`
- `apps/desktop/src/core/dom.ts`
- `apps/desktop/src/ui/chrome.ts`
- `apps/desktop/src/ui/doc-panel.ts`
- `apps/desktop/src/ui/resizers.ts`
- `apps/desktop/src/ui/tabs.ts`
- `apps/desktop/src/ui/workspace.ts`
- `apps/desktop/src/ui/git.ts`
- `apps/desktop/src/ui/git-diff.ts`
- `apps/desktop/src/settings/template.ts`
- `apps/desktop/src/settings/main.ts`
- `apps/desktop/src/updater/view.ts`
- targeted Playwright specs under `apps/desktop/e2e/`

Keep edits scoped to visual structure, CSS system, small DOM affordances, and
tests. Do not refactor document persistence, rendering, Git integration, LLM
adapters, export engines, or packaging code unless a compile error directly
requires a narrow type/interface adjustment.

## Required Automated Tests

Add or update Playwright coverage for visual geometry and interaction quality.

Tests must cover:

- Desktop default renders project rail, workspace, and inspector as distinct
  surfaces.
- Main shell uses the new material tokens and does not regress to flat white
  blocks.
- Header controls do not overlap with long title, long path, dirty state,
  Markdown conversion state, Git conflict state, and disk-changed state.
- Status chips have stable size and do not squeeze Save/More.
- Tabs keep stable height, dirty indicator, close hit area, and horizontal
  overflow behavior.
- Project tree long names ellipsize without changing rail width.
- Inspector tabs and collapse control meet target hit areas.
- Source mode at medium widths receives pressure relief and avoids unusable
  split panes.
- Git inspector and health inspector remain usable in the right rail.
- Settings pages preserve two-column IA and API key masking behavior.
- Popovers/menus/panels stay inside viewport and use named z-index tokens.
- Update progress uses transform-based movement, not width animation.
- Narrow viewports have no horizontal overflow and no hidden primary command.
- `prefers-reduced-motion` disables nonessential animation.

Geometry assertions must include:

- `document.documentElement.scrollWidth <= clientWidth + 1` at narrow widths.
- No overlapping bounding boxes for header title/path/badges/actions.
- Workspace width stays above accepted minimum in desktop reading mode.
- Source editor pane width stays above accepted minimum or preview collapses.
- Buttons/tabs/collapse controls meet explicit hit-area thresholds.
- Overlay bounding boxes remain inside viewport.
- Header, tab bar, toolbar, and status heights are stable.

Keep or update existing regression tests that already protect:

- three-column layout
- narrow viewport behavior
- settings IA
- source/editor behavior
- save state/status behavior
- Git/health inspector behavior

## Required Visual Verification

After implementation, run a visual verification pass with screenshots.

Required screenshots:

- `1728x1117`
- `1440x900`
- `1280x800`
- `1180x760`
- `1024x720`
- `900x720`
- `760x700`
- `600x700`

Required states:

- launch/empty state
- normal document reading mode
- inline visual editing mode
- Markdown/source mode at wide and medium widths
- dirty Markdown requiring AIMD save
- Git conflict document
- three tabs with long names
- Git inspector
- health inspector
- asset inspector
- settings model page
- API key reveal/masked states
- updater/about panel
- link popover
- web import panel
- more menu
- debug console
- lightbox

Every screenshot must be reviewed for:

- surface hierarchy
- cramped controls
- text clipping
- text overlap
- hidden primary commands
- accidental horizontal overflow
- inconsistent radii/shadows/borders
- excessive beige/monochrome sameness
- over-decoration
- motion artifacts if captured during transition

Do not mark the goal complete from tests alone. Visual review is required.

## Acceptance Criteria

The goal is complete only when all of the following are true:

- The app still behaves as a real AIMD desktop editor.
- The three-column desktop layout remains correct.
- Medium-width source mode no longer feels cramped.
- Main shell, rails, workspace, toolbar, tabs, settings, popovers, updater,
  debug console, and lightbox share a coherent high-end material system.
- Control hit areas and visual sizes are normalized.
- Header, tabs, status chips, and bottom status feel polished and stable.
- Arbitrary high z-index values are replaced by named layer tokens.
- Progress animation avoids `width` transitions.
- Motion uses named tokens and transform/opacity-first transitions.
- No network fonts/assets are introduced.
- No marketing/decorative redesign elements are introduced.
- No save, Git, render, export, or source-preserving behavior regresses.
- Playwright geometry tests pass.
- TypeScript check passes.
- Code-size gate still passes.
- Visual screenshots across the required states pass manual review.

## Suggested Validation Commands

Run at least:

```bash
cd apps/desktop
npm run check
npx playwright test e2e/56-three-column-css-polish.spec.ts
npx playwright test e2e/40-redesign-2026-05.spec.ts
npx playwright test e2e/38-design-polish.spec.ts
npx playwright test e2e/07-narrow-viewport.spec.ts
```

Add a new focused spec, for example:

```bash
npx playwright test e2e/57-high-end-visual-refactor.spec.ts
```

If implementation touches document rendering or editor surfaces, also run the
relevant editor/document specs:

```bash
npx playwright test e2e/42-editor-core-capabilities.spec.ts
npx playwright test e2e/50-source-preserving-editor.spec.ts
```

If Tauri-facing TypeScript or state wiring changes meaningfully, run the
broader local gate:

```bash
npm run check
cargo check --workspace
git diff --check
```

## Explicit Non-Goals

- No new review mode.
- No new AI feature.
- No new document format.
- No save semantics changes.
- No Git algorithm changes.
- No PDF/export engine changes.
- No updater release logic changes.
- No packaging/release flow changes.
- No broad module refactor unrelated to visual quality.
- No external design system dependency.
- No remote fonts or remote visual assets.

## Handoff Notes For The Implementing Agent

Start by reading this goal, then read the existing archived three-column goal
only for historical context. Do not treat the archived goal as the full scope.

The successful implementation should feel restrained, not flashy. The design
direction is closer to a premium native editor than to a web landing page:
machined surfaces, quiet depth, precise controls, clear hierarchy, and no visual
noise. When in doubt, preserve product clarity and improve the material system
instead of adding decoration.
