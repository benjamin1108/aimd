# /goal: AIMD entry/menu information architecture refactor

## Background

AIMD Desktop currently exposes the same high-level actions in too many places.
`新建` and `打开` appear in the empty state, the document header, the sidebar
footer, the native File menu, and keyboard shortcuts. The current document
`...` menu also contains app-level commands such as new window, update, and
about. Project file creation, app-level creation, document save/export, and
import flows are all reachable, but their ownership is not visually clear.

The accepted mid-fidelity design is:

- `docs/product/design/aimd-entry-menu-midfi.html`
- screenshot: `docs/product/design/aimd-entry-menu-midfi.png`

That HTML prototype is the layout and information-architecture source for this
refactor. It is not a mood board. The production UI must reproduce its command
ownership, visible elements, menu grouping, launch layout, document layout, and
compact layout while using the real AIMD runtime and existing design system.

The user has explicitly accepted the prototype's details. Treat every visible
detail in the HTML as intentional:

- icon choices and icon placement
- button weight, grouping, and order
- Chinese copy and section labels
- menu titles, menu item labels, right-side hints, and dividers
- chip/tag wording and visual hierarchy
- launch-page content order
- project rail row structure
- iconfont/icon glyph usage, visual boxes, stroke/weight, and alignment
- open-tab/tab-page geometry, spacing, active state, format tags, and close
  affordance layout
- document header composition
- compact-state command placement
- sidebar explanation panel structure in the prototype, where relevant as a
  product/design review aid

Do not reinterpret the accepted design as a loose direction. If a detail cannot
be reproduced because the real app has a runtime constraint, document the
constraint, keep the closest equivalent, and preserve the same information
architecture and visual weight.

## Objective

Ship a production refactor of AIMD Desktop's opening, creation, menu, and
command-entry surfaces.

Required outcome:

- Global `新建` and `打开` become the single top-level app entries.
- Current-document commands live only in the document action area and document
  menu.
- Project file commands live only in the project rail and project context menu.
- Import/create-source commands are grouped under global creation, not inside
  current-document actions.
- App-level commands are not mixed into the current-document menu.
- Empty/launch, normal document, and compact/narrow states match the accepted
  HTML prototype's layout hierarchy and visible information.
- Native menus and shortcuts dispatch to the same command model and use the same
  scoped language.

## Source Design Contract

The implementation must replicate the accepted HTML prototype's elements,
icons, copy, layout, and control hierarchy, adapted only where the real app
requires existing runtime data.

### Exact Detail Replication Contract

The following prototype details are part of the goal, not optional polish.

Global shell:

- The square `A` brand mark remains at the top left.
- `AIMD` appears beside the brand mark.
- The scope line keeps the same structure:
  `项目 / Quarterly Report.aimd / 入口按命令域分层` in the prototype, with real
  app data substituted at runtime.
- Top-level buttons remain in this order:
  `新建`, `打开`, app/settings icon.
- `新建` uses the plus icon.
- `打开` uses the folder icon.
- The app/settings affordance uses a gear-style icon and remains visually
  app-level.

Prototype side/design review panel:

- The review artifact keeps the accepted explanatory structure when this HTML
  is used as a design reference:
  - `AIMD IA PROTOTYPE`
  - `打开 / 新建 / 菜单重构中保真稿`
  - scene choices `文档态`, `启动态`, `窄屏态`
  - rule list under `重构规则`
- This panel is not part of the production app chrome, but it must remain
  accurate if the prototype/demo artifact is updated.

Launch state copy and grouping:

- Primary heading: `继续处理文档`
- Supporting copy is concrete product copy: `从最近打开的文档继续，或开始新的内容。`
- Section labels remain:
  - `最近打开`
  - `创建`
  - `打开`
- Recent examples in test/demo artifacts use the same shape:
  title, monospace path, format tag.
- Launch command cards use the accepted labels:
  - `空白 AIMD 草稿`
  - `从网页导入`
  - `打开 AIMD / Markdown`
  - `打开项目目录`
- Launch command card helper copy keeps the accepted semantics:
  - `从一页空白文档开始`
  - `提取网页内容为草稿`
  - `选择本地文档继续编辑`
  - `浏览并编辑项目文件`
- On desktop, the right-side `创建` group starts at the same visual height as
  the left-side `最近打开` panel. It must not align with the launch headline,
  because that makes the right column feel too high and visually heavier.

Document header:

- Header order remains title, path, chips, then right-aligned save and document
  menu.
- Example/demo title copy remains `Quarterly Report`.
- Demo path shape remains `~/reports/Quarterly Report.aimd`; production uses
  real paths with the same hierarchy.
- Chips keep the accepted wording and order pattern:
  - format chip such as `AIMD`
  - scope chip such as `项目内`
  - open/state chip such as `已打开`
- The disabled clean-document save button still says `保存`.
- The current-document menu trigger remains a compact icon-only `...`/ellipsis
  affordance with document scope.

Tabs and toolbar:

- Open tabs keep title plus format tag.
- Open-tab/tab-page layout must be pixel-level replicated from the accepted
  HTML prototype:
  - tab bar padding: `6px 12px 0`
  - tab gap: `4px`
  - tab height: `34px`
  - tab minimum width: `132px`
  - tab maximum width: `230px`
  - tab horizontal padding: `0 9px 0 12px`
  - tab border: `1px solid` hairline with no bottom border
  - tab radius: `10px 10px 0 0`
  - active tab surface: same white document desk surface
  - inactive tabs: quieter warm translucent surface
  - title text ellipsizes in one line
  - format tag remains right of title, never below it
  - if a close affordance is present in production tabs, it must preserve the
    same row height and optical spacing rather than expanding the tab
- Mode switch copy and order are fixed:
  `预览`, `可视编辑`, `Markdown`.
- `查找` remains the right-side toolbar command.
- Toolbar grouping and visual weight follow the prototype: mode switch as a
  segmented control, find as a secondary command.

Iconfont and icon system:

- The accepted prototype's icon application is part of the pixel contract.
- If the production implementation uses an iconfont, it must be local/bundled,
  not loaded from a remote CDN.
- If production keeps inline SVG instead of iconfont, the result must still
  match the prototype's icon footprint, weight, and alignment.
- Each icon position must use the accepted visual box:
  - topbar command icon visual box: `15px x 15px`
  - project rail tool icon visual box: `15px x 15px`
  - menu row icon column: `18px`
  - card/launch icon container: `31px x 31px`
  - brand mark: `25px x 25px`, radius `8px`
- Icon glyph mapping must match the prototype:
  - `新建`: plus
  - `打开`: folder
  - app/settings: gear
  - `空白 AIMD 草稿` / AIMD document: document/page
  - Markdown: code/source chevrons
  - Web import: link
  - image/resource package: image
  - format: sparkle
  - export HTML/PDF/Markdown: document/source glyphs
  - close tab/project: close cross
  - refresh project: refresh arrows
- Icons must be vertically centered optically in their controls, not merely
  line-height centered.
- Do not substitute icon metaphors during implementation unless a runtime
  constraint makes the accepted glyph impossible; such substitutions must be
  documented in the implementation checklist.
- Icon weight must stay quiet and desktop-native. Do not use heavy filled icon
  sets, emoji, or mismatched stroke widths.

Project rail:

- Section label remains `项目`.
- Project root demo text remains uppercased as `~/REPORTS` in review/demo
  artifacts; production may use real project naming while preserving placement
  and weight.
- Project rail tool order remains:
  open directory, refresh, new project item, close project.
- Project rows keep the prototype structure:
  disclosure/file icon area, name, right-side format tag when relevant.
- Format tags keep short labels such as `MD` and `AIMD`.

Inspector:

- Inspector label remains `当前文档`.
- Inspector tab labels remain:
  `大纲`, `资源`, `Git`.
- Outline row styling follows the prototype: active row is visually selected,
  secondary rows are quiet.

Menus:

- Menu surfaces keep the accepted compact popover layout:
  section title, icon, label, optional right-side hint, separators.
- Do not remove icons from menu rows.
- Do not convert obvious icon buttons back to text-only controls.
- Do not introduce unrelated icons that change meaning.
- Menu row labels and hint text must match the accepted Chinese copy unless
  runtime state requires a scoped file/type value.

Visual density and material:

- Keep the prototype's calm desktop density. Do not make the production
  implementation larger, card-heavier, or more decorative.
- Preserve the warm neutral shell, project rail contrast, white document desk,
  soft popover material, and compact control heights.
- Preserve the visual hierarchy between primary save, secondary global buttons,
  ghost icon buttons, tags, and quiet metadata.

Any implementation PR for this goal must include a checklist proving that each
accepted visible prototype element is either reproduced in production or
explicitly mapped to a runtime equivalent.

### Global Top Bar

The app shell must have one persistent global command row:

```text
AIMD | scope/breadcrumb text | [新建] [打开] [应用/设置]
```

Rules:

- `新建` opens a grouped creation menu.
- `打开` opens a grouped open menu.
- The app/settings affordance is app-level, not document-level.
- The scope/breadcrumb text reflects the current state:
  - launch: startup/entry state
  - document: project and active document
  - Git review: project/file review rather than active document
- This bar is visible in launch, document, and compact states.

### Global New Menu

`新建` must contain these groups and items:

```text
新建
├─ 空白 AIMD 草稿
├─ 在项目中新建 AIMD
├─ 在项目中新建 Markdown
├─ 从网页导入
└─ 导入 Markdown 文件夹
```

Rules:

- `空白 AIMD 草稿` creates an unsaved draft, preserving the current draft/save
  semantics.
- `在项目中新建 AIMD` and `在项目中新建 Markdown` are enabled only when a project
  is open; disabled/empty behavior must be explicit.
- Web import creates or opens the existing unsaved web-clip draft flow.
- Markdown-folder import remains an explicit packaging/import flow.
- These commands must not be duplicated in the current-document menu.

### Global Open Menu

`打开` must contain:

```text
打开
├─ 打开文档
├─ 打开项目目录
└─ 显示最近打开
```

Rules:

- `打开文档` opens AIMD or Markdown documents.
- `打开项目目录` opens the left project rail state.
- Recent documents are displayed in the launch surface and may be surfaced from
  this menu, but they must not become another duplicate button strip.

### Document State Layout

The normal desktop document layout must match the prototype:

```text
top global bar
├─ project rail
├─ document desk
│  ├─ document header: title, path, status chips, [保存], [document menu]
│  ├─ open tabs
│  ├─ mode toolbar: 预览 / 可视编辑 / Markdown, 查找
│  └─ document canvas
└─ inspector rail: 大纲 / 资源 / Git / 健康
bottom status bar
```

Rules:

- The document header owns only active-document identity and document actions.
- The primary save button remains disabled for clean non-draft documents and
  enabled for dirty/draft states according to existing save rules.
- Status chips remain near document identity and cover format, project scope,
  dirty/draft/conflict/recovery/`requiresAimdSave` states.
- The bottom status bar remains transient feedback, not the only stable state.
- Tabs remain separate from global creation/opening commands.
- Mode switching remains `预览 / 可视编辑 / Markdown`.

### Current Document Menu

The document menu must contain only current-document/tab commands:

```text
当前文档
├─ 另存为...
├─ 一键格式化
├─ 嵌入本地图片 / 保存为 AIMD
├─ 导出 Markdown
├─ 导出 HTML
├─ 导出 PDF
└─ 关闭当前标签页
```

Rules:

- Remove app-level commands from this menu:
  - `新建窗口`
  - `检查更新`
  - `关于 AIMD`
  - `设置`
- `从网页导入` must not live here; it belongs to global creation.
- `关闭当前标签页` must continue to trigger the existing dirty-document close
  confirmation and name the affected tab/document.
- Disabled states must reflect the active document's format and capability
  without hiding the item unless the feature is truly unavailable.

### Project Rail And Project Menu

The project rail must keep a compact project command area:

```text
项目
├─ 打开目录
├─ 刷新项目
├─ 新建项目文件
└─ 关闭项目
```

The project new menu/context menu must expose the same project-file creation
model:

```text
项目文件
├─ 新建 AIMD 文档
├─ 新建 Markdown 文档
└─ 新建文件夹
```

Rules:

- Project actions create files/folders inside the selected project location.
- Project creation does not replace global `空白 AIMD 草稿`.
- Project right-click and project toolbar must not diverge in command naming or
  behavior.
- Existing rename, move, delete, open, and open-in-new-window context actions
  remain available in the context menu, but creation ownership must match the
  new model.

### Launch State

Launch state must be task-oriented and match the prototype:

```text
top global bar
└─ launch surface
   ├─ 最近打开
   ├─ 创建
   │  ├─ 空白 AIMD 草稿
   │  └─ 从网页导入
   └─ 打开
      ├─ 打开 AIMD / Markdown
      └─ 打开项目目录
```

Rules:

- Recent work is the first content group.
- Creation and opening are grouped after recent work.
- On desktop, the `创建` group is vertically offset to align with the
  `最近打开` panel, not the top launch headline.
- Do not render a marketing hero.
- Do not duplicate the topbar `新建` and `打开` buttons as an unstructured
  button row.
- The launch surface must still support:
  - no project/no tabs
  - project open/no tabs
  - tabs open/no project
  - recent list empty

### Compact/Narrow State

Compact state must match the prototype's ownership model:

- Hide side rails before document commands become unusable.
- Keep the global topbar visible.
- Keep `[保存]` and the current-document menu reachable.
- Keep open tabs horizontally usable.
- Keep the mode switch full-width and stable.
- Keep the document menu within the viewport.
- No horizontal overflow.

## Non-Negotiable Requirements

- Do not change Markdown/AIMD save semantics.
- Do not change source-preserving editor behavior.
- Do not change web-clip extraction semantics.
- Do not change Git algorithms, PDF/export internals, updater internals, model
  providers, or window path registry semantics except where menu routing needs
  scoped labels.
- Do not introduce remote fonts, remote images, remote CSS, or a new UI library.
- Do not solve this by copy changes only; command ownership and layout must
  change.
- Do not leave duplicated `新建`/`打开` button strips in sidebar footer,
  document header starter actions, and launch actions.
- Do not leave app-level commands inside the current-document menu.
- Do not weaken existing dirty-close, save, open, restore, import, or export
  tests to make the refactor pass.

## Implementation Scope

Expected frontend surfaces:

- `apps/desktop/src/ui/template.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/ui/chrome.ts`
- `apps/desktop/src/ui/workspace.ts`
- `apps/desktop/src/ui/context-menu.ts`
- `apps/desktop/src/core/dom.ts`
- `apps/desktop/src/styles/*.css`

Expected native/menu surfaces:

- `apps/desktop/src-tauri/src/menu.rs`
- native menu event routing in `apps/desktop/src-tauri/src/lib.rs` if IDs or
  labels change.

Expected product/docs surfaces:

- This goal file.
- Any existing product demo or screenshot artifact that claims to document the
  final entry/menu IA.

## Required Behavior Mapping

All existing command handlers must be preserved and re-owned by the new layout:

- `newDocument` -> global `空白 AIMD 草稿`
- project `createDocument(..., "aimd")` -> project/global project-create entry
- project `createDocument(..., "markdown")` -> project/global project-create
  entry
- `chooseAndOpen` -> global `打开文档`
- `openWorkspacePicker` -> global `打开项目目录` and project rail open
- `importWebClip` -> global `从网页导入`
- `chooseAndImportMarkdownProject` -> global `导入 Markdown 文件夹`
- `saveDocument` -> document header primary save
- `saveDocumentAs` -> current-document menu
- `formatCurrentDocument` -> current-document menu
- `packageLocalImages` / health resource packaging -> current-document resource
  command and health panel
- `exportMarkdownAssets`, `exportHTML`, `exportPDF` -> current-document menu
- `closeCurrentTab` -> current-document menu and native close-tab command
- `open_in_new_window`, `checkForUpdates`, `showAboutAimd`,
  `open_settings_window` -> app/native menu or app-level gear menu, not
  current-document menu

## Required Tests

Add or update Playwright coverage for the new information architecture.

At minimum:

- Launch state renders the accepted groups:
  - recent work
  - creation
  - opening
- Global `新建` menu contains the required five creation/import items.
- Global `打开` menu contains document, project, and recent entries.
- Current-document menu contains only current-document commands.
- Current-document menu does not contain:
  - `新建窗口`
  - `检查更新`
  - `关于 AIMD`
  - `设置`
  - `从网页导入`
- Sidebar footer no longer duplicates global `新建` and `打开`.
- Document header starter actions no longer duplicate global `新建` and `打开`.
- Project rail creation menu and project context menu use the same labels for:
  - `新建 AIMD 文档`
  - `新建 Markdown 文档`
  - `新建文件夹`
- Project open/no tabs, tabs open/no project, and no project/no tabs remain
  clear and actionable.
- Dirty close via current-document menu still prompts with the current
  document/tab identity.
- `Cmd+N`, `Cmd+O`, `Cmd+W`, `Cmd+S`, and `Shift+Cmd+S` still route to the
  correct command ownership.
- Native menu labels match the scoped UI language.
- Compact viewport keeps global topbar, save, document menu, tabs, and mode
  switch reachable with no horizontal overflow.
- Visual screenshot coverage captures:
  - launch
  - normal document with project and inspector
  - open global new menu
  - open global open menu
  - open current-document menu
  - open project creation menu
  - compact document state

## Required Validation

Before completion, run:

- `npm --prefix apps/desktop run check`
- `cargo check --workspace`
- `git diff --check`
- targeted Playwright specs for the new entry/menu IA
- regression specs for:
  - `apps/desktop/e2e/31-md-open-association.spec.ts`
  - `apps/desktop/e2e/37-more-menu-close-action.spec.ts`
  - `apps/desktop/e2e/44-workspace-directory-management.spec.ts`
  - `apps/desktop/e2e/49-selection-boundary.spec.ts`
  - `apps/desktop/e2e/52-open-documents-tabs.spec.ts`
  - `apps/desktop/e2e/55-navigation-language.spec.ts`
  - `apps/desktop/e2e/57-high-end-visual-refactor.spec.ts`

Any skipped validation must be an environment-only blocker and must be stated
with the exact command and failure reason.

## Acceptance Criteria

This goal is complete only when the real AIMD Desktop UI matches the accepted
HTML prototype's information architecture and element layout:

- one global creation/opening command row
- launch surface organized as recent/create/open
- project rail owns project file actions
- document header owns document identity and save
- current-document menu owns document save/format/resource/export/close actions
- app-level commands are absent from the document menu
- compact state remains usable without side rails
- native menu, shortcuts, accessibility labels, and tests use the same scoped
  command model

The final product must feel like the HTML prototype turned into the real app,
not like the old app with a few labels moved.
