# /goal: AIMD document command strip consolidation

## Background

AIMD Desktop's document workspace currently spends too much vertical space
before the user reaches the editable or readable document surface.

The duplicated chrome is the document header:

- the global topbar already identifies the active project, document title, and
  path;
- the active tab already identifies the current document;
- the document header repeats title/path/state, then adds save and menu
  controls;
- the tab bar then appears below it;
- the preview/edit/Markdown mode switch and find command appear below the tab
  bar;
- the document surface starts after all of that.

The accepted product direction is to remove the separate document title/header
row, keep open tabs on their own layer, and consolidate current-document
controls into one compact document toolbar directly below the tabs.

The accepted layout contract is:

```text
top global bar
├─ project rail
├─ document workspace
│  ├─ document tab strip:
│  │  [open tabs...]
│  ├─ document toolbar strip:
│  │  [预览 | 可视编辑 | Markdown] [查找] [状态] [保存] [文档 ▾]
│  └─ document surface
└─ inspector rail
```

There is no separate document title/path/save header between the global topbar
and the editor surface.

## Source Design Contract

The visual source is:

- `docs/product/design/aimd-compact-document-chrome-midfi.html`

That mid-fidelity artifact defines the accepted visual language:

- warm neutral shell and rail surfaces;
- topbar `新建`, `打开`, `应用` button treatment;
- `保存` primary button treatment;
- `文档` secondary/subtle button treatment;
- tab geometry, active tab surface, close affordance, and format tags;
- inspector `当前文档` rail styling;
- inspector tabs `大纲`, `Git`, `资源`;
- active outline row background and accent color;
- menu surface, menu row icon column, divider, and right-side hint styling.

The accepted layout refinement after that artifact is:

- Open tabs must not share a row with mode switching, find, save, or document
  menu controls.
- `预览 / 可视编辑 / Markdown`, `查找`, `保存`, and `文档` sit together in one
  document toolbar row directly below the tab strip on desktop.
- If the prototype artifact is updated during implementation, its recommended,
  menu-open, and source-mode scenes must use the tab strip plus one toolbar row.

The implementation must preserve the mid-fidelity styling while applying the
two-layer tab/toolbar information architecture.

## Objective

Ship a production refactor of AIMD Desktop's document chrome so the document
surface starts immediately below a compact tab strip plus one document toolbar.

Required outcome:

- Remove the separate document header row from normal document states.
- Move current-document operations into the document toolbar under the tabs.
- Move mode switching and find into that same toolbar row.
- Keep document identity in the global topbar scope and active tabs.
- Preserve project rail behavior and inspector behavior.
- Preserve save, export, format, image packaging, close-tab, dirty, draft,
  Markdown/AIMD save, Git diff, and source-preserving editor behavior.

## Ownership Model

### Global Topbar

The global topbar owns app and workspace scope:

```text
AIMD | 项目 / <active document title> / <path or state> | [新建] [打开] [应用 ▾]
```

Rules:

- The topbar is the only persistent place for active document path identity.
- `新建`, `打开`, and `应用` keep the mid-fidelity button styling.
- `应用` remains a labeled app menu, not a gear-only button.
- The topbar does not contain save/export/format/close-current-tab operations.

### Project Rail

The project rail owns project file operations:

```text
项目
├─ 打开目录
├─ 刷新项目
├─ 新建项目文件
└─ 关闭项目
```

Rules:

- Project rail command style, icon size, row height, and active row treatment
  remain compatible with the current entry/menu refactor.
- Project creation remains project-scoped and does not replace global
  `空白 AIMD 草稿`.

### Document Tab Strip And Toolbar

The document tab strip owns open-document switching. The document toolbar owns
current-document commands:

```text
[tabs...]
[预览 | 可视编辑 | Markdown] [查找] [compact state] [保存] [文档 ▾]
```

Rules:

- These two layers replace the separate document header and old separate mode
  toolbar. There is no title/path/save header between topbar and tabs.
- Open tabs stay in their own row and keep the accepted tab geometry:
  - height: `34px`
  - minimum width: `132px`
  - maximum width: `230px`
  - tab gap: `4px`
  - horizontal padding: `0 9px 0 12px`
  - radius: `10px 10px 0 0`
  - active tab surface matches the document desk
  - inactive tab surface remains warm translucent
  - title text ellipsizes in one line
  - format tag remains in the tab row
  - close affordance does not expand row height
- Mode switch copy and order are fixed:
  `预览`, `可视编辑`, `Markdown`.
- `查找` stays next to the mode switch in the toolbar, not in the document menu.
- The search UI opens as a small popover below the find button. It does not
  expand the toolbar horizontally; source-mode replace controls appear as a
  second row inside that popover.
- `保存` remains visible as the active document's primary action.
- `文档 ▾` remains visible as the active document's command menu.
- No icon-only ellipsis trigger replaces `文档 ▾`.
- The toolbar controls align optically in one row on desktop.
- The tab strip and toolbar are not rendered when no document or Git diff tab is
  active.

### Current Document Menu

`文档 ▾` contains only active-document commands:

```text
文档
├─ 另存为...
├─ 一键格式化
├─ 嵌入本地图片 / 保存为 AIMD
├─ 导出 Markdown
├─ 导出 HTML
├─ 导出 PDF
└─ 关闭当前标签页
```

Rules:

- `设置`, `检查更新`, `关于 AIMD`, and `新建窗口` do not appear in this menu.
- `从网页导入` does not appear in this menu.
- `关闭当前标签页` continues to use the existing dirty-close confirmation.
- Disabled states reflect the active tab's format and capability.
- Menu style preserves the mid-fidelity row structure:
  icon column, label, optional right-side hint, dividers, compact popover
  surface, and warm shadow.

### Current Document Inspector

The right rail owns current-document secondary context. It is a fixed inspector,
not a settings-driven optional resource panel.

```text
当前文档
[ 大纲 ][ Git ][ 资源 ]
```

Rules:

- The inspector appears only when an active document or Git diff tab can expose
  current-document context.
- The inspector tab order is fixed: `大纲`, `Git`, `资源`.
- The `资源` tab is always rendered with the other tabs. Resource count, document
  format, and settings state do not remove that tab.
- The selected tab uses the mid-fidelity white/paper active surface. Unselected
  tabs use muted text on the warm segmented background.
- The `大纲` panel keeps compact rows and the accepted soft green active-row
  treatment.
- The `Git` panel keeps the accepted current-document Git styling and does not
  move workspace-level Git operations into the document command menu.
- The `资源` panel shows resource entries when present. With no resources, the
  panel body stays empty while the `资源` tab remains fixed.
- Settings no longer expose `showAssetPanel`, `显示资源`, or an equivalent
  resource-panel visibility toggle.

## State Display Contract

The removed document header must not cause state loss. State moves to compact
locations:

| State | Required display |
| --- | --- |
| AIMD document | `AIMD` tag inside the active tab |
| Markdown document | `MD` tag inside the active tab |
| Project scope | topbar scope/path and project rail selection |
| Dirty document | dirty dot in the active tab plus compact `未保存` text before `保存` |
| Draft | topbar scope uses draft wording; active tab remains identifiable |
| Save requires AIMD format choice | compact warning text such as `保存需选格式` before `保存` |
| Git conflict | compact warning text such as `Git 冲突` in the command strip |
| Git diff tab | read-only active tab; save hidden or disabled; close remains reachable |
| No document resources | fixed `资源` inspector tab remains visible; resource panel body stays empty |
| No document | command strip, document menu, save, and inspector are hidden |

The compact state text must not create a new full-width row.

## Visual Preservation Contract

These mid-fidelity styles are locked:

- `新建`, `打开`, and `应用` use the same bordered paper button style from the
  mid-fidelity artifact.
- `保存` uses the same green primary treatment:
  - accent family based on `#2f6f63`;
  - compact height in the command strip;
  - icon + text;
  - primary visual weight.
- `文档` uses the same subtle secondary command treatment:
  - document/page icon;
  - text label `文档`;
  - down chevron;
  - no bare `...`.
- `预览 / 可视编辑 / Markdown` uses the same segmented-control style.
- `查找` uses the same quiet ghost/secondary command style.
- Inspector rail styling is locked to the mid-fidelity artifact:
  - label `当前文档`;
  - fixed tabs in the exact order `大纲`, `Git`, `资源`;
  - all three tab buttons remain rendered whenever the inspector is visible;
  - tab container uses `grid-template-columns: repeat(3, 1fr)`;
  - tab container keeps `3px` padding, `4px` gap, `1px` hairline border,
    `10px` radius, and `rgba(36, 30, 20, 0.04)` background;
  - tab button keeps `26px` height, `7px` radius, muted text color, `12px`
    font size, and `650` font weight;
  - active tab uses the white/paper surface, ink text color, and the accepted
    control shadow;
  - no large decorative cards.
- Resource tab behavior is fixed:
  - `资源` remains visible even when the active document has no AIMD-managed
    resources.
  - Empty resource content leaves the resource panel body empty instead of hiding
    the tab.
  - The old settings control for whether to show resources is removed.
- Outline active row styling is preserved:
  - soft green background from the mid-fidelity artifact;
  - accent text using the `#2f6f63` family;
  - compact row height and rounded corner.
- The warm neutral palette, hairlines, control radii, and soft shadows remain
  consistent with the accepted mid-fidelity artifact.

Do not replace these styles with a new visual system.

## Layout Requirements

Desktop document state:

```text
topbar
document tab strip
document toolbar strip
document surface
footer/status
```

Rules:

- The document surface starts directly below the document toolbar strip.
- There is no `.workspace-head` equivalent in document state.
- There is exactly one `.doc-toolbar` equivalent below tabs for mode switching,
  find, state, save, and document menu.
- The toolbar height stays compact and stable. It must not grow when the active
  tab is dirty, draft, Markdown, AIMD, or conflict-marked.
- Tabs use horizontal overflow or truncation before pushing the controls off the
  right edge; toolbar controls do not consume tab-row width.
- The right-side controls remain reachable at desktop widths where the full
  three-column layout is active.
- On narrow viewports, the toolbar may wrap into a compact control surface only
  after side rails are hidden; it must not reintroduce a title/path/save header.

Launch/no-document state:

- The launch page keeps the accepted recent/create/open layout.
- The project rail remains visible when a project is open and the active shell
  has enough width for the existing project rail behavior.
- The inspector rail does not occupy space.
- The document tab strip and toolbar are hidden.

Source mode:

- Source editor uses the same tab strip and toolbar.
- Dirty state is visible without adding a row.
- Source find/replace behavior remains intact.
- Existing source-preserving behavior is unchanged.

Visual edit mode:

- The tab strip and one toolbar row remain above the visual editor.
- The rich formatting toolbar is limited to visual-editing surfaces.
- The formatting toolbar must not carry document identity, save, document menu,
  mode switch, or find.

Git diff/read-only tabs:

- Git diff tabs remain selectable in the same tab strip.
- Read-only status is compact.
- Save/export controls reflect current read-only capabilities without creating
  a separate header row.

## Implementation Scope

Expected frontend surfaces:

- `apps/desktop/src/ui/template.ts`
- `apps/desktop/src/ui/chrome.ts`
- `apps/desktop/src/ui/tabs.ts`
- `apps/desktop/src/ui/doc-panel.ts`
- `apps/desktop/src/core/dom.ts`
- `apps/desktop/src/core/settings.ts`
- `apps/desktop/src/core/types.ts`
- `apps/desktop/src/settings/main.ts`
- `apps/desktop/src/settings/template.ts`
- `apps/desktop/src/styles/workspace.css`
- `apps/desktop/src/styles/tabs.css`
- `apps/desktop/src/styles/toolbar.css`
- `apps/desktop/src/styles/frame.css`
- `apps/desktop/src/styles/responsive.css`
- `apps/desktop/src/styles/app-topbar.css`

Expected design artifact surface:

- `docs/product/design/aimd-compact-document-chrome-midfi.html`

This artifact must show the accepted document tab strip plus one toolbar row in
recommended, menu-open, and source-mode scenes before it is used as an
implementation reference.

Expected test surfaces:

- `apps/desktop/e2e/55-navigation-language.spec.ts`
- `apps/desktop/e2e/56-three-column-css-polish.spec.ts`
- `apps/desktop/e2e/57-high-end-visual-refactor.spec.ts`
- `apps/desktop/e2e/42-editor-core-capabilities.spec.ts`
- `apps/desktop/e2e/52-open-documents-tabs.spec.ts`
- `apps/desktop/e2e/38-design-polish.spec.ts`
- `apps/desktop/e2e/07-narrow-viewport.spec.ts`
- `apps/desktop/e2e/31-md-open-association.spec.ts`
- `apps/desktop/e2e/54-document-inspector.spec.ts`
- `apps/desktop/e2e/45-asset-panel-settings.spec.ts`
- `apps/desktop/e2e/46-git-workspace-panel.spec.ts`
- `apps/desktop/e2e/06-outline-and-resizer.spec.ts`

## Required Tests

Add or update Playwright coverage for:

- Document state has no standalone document title/header row.
- Active document title/path are still visible through the topbar scope and
  active tab.
- Active tab strip is directly above the document toolbar on desktop.
- Mode switch, find, save, and document menu are in the same toolbar row on
  desktop.
- The document surface starts directly below the toolbar strip; there is no
  extra title/path/save row before the editor.
- `预览`, `可视编辑`, `Markdown` remain in the fixed order.
- `查找` remains reachable outside the document menu.
- `保存` remains visible for dirty/draft documents and disabled/hidden according
  to existing clean/read-only rules.
- `文档 ▾` opens the current-document menu and does not contain app-level or
  creation/import commands.
- Dirty, draft, conflict, Markdown requiring AIMD save, and Git diff/read-only
  states display compactly without adding a row.
- Launch/no-document state hides command strip, save, document menu, and
  inspector.
- Narrow viewport remains usable with no horizontal page overflow.
- Inspector tabs are always rendered in the fixed order `大纲 / Git / 资源`
  whenever the inspector is visible.
- Inspector selected tab uses the accepted white/paper background, ink text, and
  control shadow from the mid-fidelity artifact.
- Inspector tab container and tab button dimensions match the mid-fidelity
  metrics: three equal columns, `3px` padding, `4px` gap, `26px` tab height,
  `10px` container radius, and `7px` selected tab radius.
- Empty document resources keep the `资源` tab visible and leave the resource
  panel body empty.
- Settings UI no longer contains the resource-panel visibility toggle, and legacy
  `showAssetPanel` settings do not affect inspector visibility or tab order.
- Active outline selected styling stays visually consistent with the
  mid-fidelity artifact.
- Topbar `新建`, `打开`, `应用`, command-strip `保存`, and `文档` button geometry
  matches the mid-fidelity artifact.

## Regression Requirements

The refactor must preserve:

- dirty close confirmation through `文档 ▾ -> 关闭当前标签页`;
- `Cmd+S`, `Shift+Cmd+S`, `Cmd+W`, `Cmd+N`, and `Cmd+O` routing;
- Markdown save semantics and AIMD save-format selection;
- source-preserving editor behavior;
- visual editor formatting toolbar behavior;
- find/replace behavior;
- export Markdown/HTML/PDF behavior;
- project rail file operations and project context menu behavior;
- Git workspace panel and Git diff tab behavior;
- current-document resource listing, resource health checks, and empty resource
  panel bodies;
- settings load/save compatibility with stored legacy `showAssetPanel` values,
  while the setting no longer appears or controls the inspector;
- session restore/open tabs behavior.

## Required Validation

Before completion, run:

- `npm --prefix apps/desktop run check`
- `git diff --check`
- `cargo check --workspace`
- From `apps/desktop`: `npx playwright test e2e/55-navigation-language.spec.ts`
- From `apps/desktop`: `npx playwright test e2e/56-three-column-css-polish.spec.ts e2e/57-high-end-visual-refactor.spec.ts`
- From `apps/desktop`: `npx playwright test e2e/42-editor-core-capabilities.spec.ts e2e/52-open-documents-tabs.spec.ts e2e/38-design-polish.spec.ts`
- From `apps/desktop`: `npx playwright test e2e/07-narrow-viewport.spec.ts e2e/31-md-open-association.spec.ts`
- From `apps/desktop`: `npx playwright test e2e/54-document-inspector.spec.ts e2e/45-asset-panel-settings.spec.ts e2e/46-git-workspace-panel.spec.ts e2e/06-outline-and-resizer.spec.ts`

Any skipped validation must state the exact command and the exact environment or
product failure.

## Non-Negotiable Requirements

- Do not reintroduce a separate document title/path/save header.
- Do not put mode switch/find/save/document menu in the tab row.
- Do not hide `保存` behind the document menu.
- Do not use a bare `...` trigger for current-document actions.
- Do not move app-level commands into `文档`.
- Do not move current-document commands into `应用`.
- Do not change Markdown/AIMD save semantics.
- Do not change source-preserving editor behavior.
- Do not reorder inspector tabs away from `大纲 / Git / 资源`.
- Do not hide the `资源` inspector tab based on resource count, document format,
  or settings.
- Do not retain `showAssetPanel`, `显示资源`, or an equivalent inspector resource
  visibility toggle in settings.
- Do not downgrade the inspector selected tab, active outline row, font weight,
  spacing, or color treatment from the mid-fidelity artifact.
- Do not redesign the inspector rail away from the accepted mid-fidelity style.
- Do not replace the accepted button styles for `新建`, `打开`, `应用`, `保存`,
  and `文档`.
- Do not make the command strip card-heavy or visually louder than the document
  surface.

## Acceptance Criteria

This goal is complete only when the real AIMD Desktop document state matches
the accepted tab-strip plus toolbar architecture:

- global topbar owns document identity and global commands;
- project rail owns project commands;
- document tab strip owns open tabs;
- document toolbar owns mode switching, find, save, compact state, and
  current-document menu;
- document surface starts immediately below that toolbar;
- current-document menu contains only current-document commands;
- launch/no-document state hides current-document controls and inspector;
- inspector tabs are fixed as `大纲 / Git / 资源`, with selected white/paper tab
  styling and unchanged outline selection styling;
- `资源` remains visible with an empty panel body when the active document has no
  resources;
- settings no longer expose or honor resource-panel visibility as a user-facing
  layout option;
- all required validations pass or have a documented environment-only blocker.

The final product must feel like the mid-fidelity design made denser and more
useful, not like the old document header squeezed into a smaller row.
