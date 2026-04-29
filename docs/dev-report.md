# Dev Report — .md 按需升级方案 v2 (2026-04-29 16:30)

## 本轮改动：.md 按需升级（从草稿语义切换到正式文档语义）

### 改动文件清单

| 文件 | 说明 |
|------|------|
| `apps/desktop-tauri/src-tauri/src/lib.rs` | 新增 `save_markdown` 和 `confirm_upgrade_to_aimd` 两条 Tauri 命令，加入 `generate_handler!` |
| `apps/desktop-tauri/src/main.ts` | 核心逻辑全面改造（见下方详述） |
| `apps/desktop-tauri/e2e/31-md-open-association.spec.ts` | 完全重写，覆盖新的按需升级语义（6 个用例全绿） |
| `apps/desktop-tauri/e2e/20-rust-handler-registration.spec.ts` | `expectedCommands` 追加 `save_markdown`、`confirm_upgrade_to_aimd` |
| `apps/desktop-tauri/e2e/01-empty-state.spec.ts` | 按钮文案断言更新：「导入 Markdown」→「打开 Markdown」 |
| `apps/desktop-tauri/e2e/13-launchpad-document-lifecycle.spec.ts` | mock 加入新命令；「草稿」语义断言更新为正式文档 |
| `apps/desktop-tauri/e2e/18-finder-and-import.spec.ts` | mock 加入新命令；「Import Markdown as draft」section 更新为新语义 |
| `apps/desktop-tauri/e2e/19-inline-editor-mutation-qa.spec.ts` | mock 加入新命令；C/D section 断言从「未保存草稿」改为 `.md` 路径 |

---

## 新增 Rust 命令

1. **`save_markdown(path, markdown) -> Result<(), String>`**
   - 先写 `.<filename>.tmp`，再原子 `rename` 覆盖原文件
   - 失败时清掉临时文件并返回错误字符串
   - 不走 sidecar，纯 `std::fs` 操作

2. **`confirm_upgrade_to_aimd(message) -> bool`**
   - 封装 `rfd::MessageDialog::new().set_buttons(YesNo).show()`
   - 返回 true 表示用户点了「是」

---

## 核心数据模型变更

### `AimdDocument` 新增字段
```
format: "aimd" | "markdown"
```

### `SessionSnapshot` 同步新增 `format` 字段

### `inferFormat(doc)` 工具函数
- 若 doc 已带 `format` 直接返回
- 无 path → `"aimd"`
- path 以 `.md/.markdown/.mdx` 结尾 → `"markdown"`
- 其余 → `"aimd"`

### `applyDocument` 归一化
入参 doc 先经 `inferFormat` 补全 `format`，再 `normalizeDocument`

---

## 前端打开路径

1. 删除 `openMarkdownAsDraft`，新增 **`openMarkdownDocument(path, opts?)`**：
   - `ensureCanDiscardChanges`（skipConfirm 时跳过）
   - 调 `convert_md_to_draft` 拿 `{markdown, title, html}`
   - 构造 `AimdDocument`：`path = 原 .md 路径`、`isDraft = false`、`format = "markdown"`
   - `applyDocument + rememberOpenedPath + setStatus("已打开（Markdown）","success")`

2. `routeOpenedPath`：`.md/.markdown/.mdx` → `openMarkdownDocument`（原为 `openMarkdownAsDraft`）

3. `chooseAndImportMarkdown` → 改调 `openMarkdownDocument`；按钮文案「导入 Markdown」→「打开 Markdown」

4. `onWindowDrop` 的 md 分支 → 改调 `openMarkdownDocument`

---

## 保存路径

### `saveDocument` 按 format 分流

```
format === "markdown" && assets.length === 0
  → invoke("save_markdown", { path, markdown })
  → state.doc.dirty = false; setStatus("已保存（Markdown）")

format === "markdown" && assets.length > 0
  → upgradeMarkdownToAimd()（兜底，理论上不到达）

format === "aimd"
  → 原有 save_aimd 流程（不变）
```

### `saveDocumentAs` 对 markdown doc 特殊处理

- suggestedName 用 `<stem>.aimd`（而非 `<stem>.aimd` 重复逻辑）
- 保存成功后 `state.doc.format = "aimd"`，`setStatus("已转换为 .aimd")`

---

## 升级流程（`upgradeMarkdownToAimd`）

1. 调 `confirm_upgrade_to_aimd`（invoke 失败时退化到 `window.confirm`）
2. 用户拒绝 → `setStatus("升级取消","info")` + 返回 false
3. 用户同意 → `choose_save_aimd_file(stem + ".aimd")`
4. `create_aimd` 创建 .aimd 文件
5. `applyDocument({ ...doc, format: "aimd" })` + `rememberOpenedPath`
6. `setStatus("已升级为 .aimd","success")` + 返回 true

`insertImage` / `pasteImageFiles` 调用 `add_image_bytes` 之前，若 `format === "markdown"` 先走升级流程；升级失败/取消则中止插入。

---

## 其他联动修改

- `renderPreview`：`format !== "markdown"` 才走 `render_markdown`（aimd 路径），否则 `render_markdown_standalone`
- `renderSnapshotHTML`：同上
- `restoreSnapshot`：`format === "markdown"` 时不尝试 `open_aimd` 重走硬盘
- `openDocument`、`newDocument`、`restoreSession` 等均补全 `format: "aimd"`

---

## e2e 用例编号与通过状态

| spec | 用例数 | 状态 |
|------|--------|------|
| `01-empty-state.spec.ts` | 3 | ✅ |
| `13-launchpad-document-lifecycle.spec.ts` | 更新草稿断言 | ✅ |
| `18-finder-and-import.spec.ts` | 「Import」section 改名+更新断言 | ✅ |
| `19-inline-editor-mutation-qa.spec.ts` | C/D section 断言更新 | ✅ |
| `20-rust-handler-registration.spec.ts` | 27 | ✅ |
| `31-md-open-association.spec.ts` | 6（全新）| ✅ |
| 全量 197 用例 | — | ✅ 197 passed / 0 failed |

---

## 构建状态

| 项目 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 零错误 |
| `npm run build:web` | ✅ 65.13 kB JS / 24.61 kB CSS |
| `cargo check` | ✅ Finished dev profile 无警告 |
| `npm run test:e2e`（全量） | ✅ **197 passed / 0 failed** (3.2 min) |
| tauri build (full) | ⏭ 跳过（无打包需求） |

---

## 已知边界

(a) **外部修改覆盖**：同名 .md 被外部编辑器修改时，AIMD Desktop 直接写回原文件会覆盖外部修改（无冲突检测）。

(b) **升级对话框被吞**：`confirm_upgrade_to_aimd` invoke 失败时退化到 `window.confirm`；在 Tauri WKWebView 实跑中 `window.confirm` 同样会被吞（返回 false），效果等于用户拒绝升级，图片插入中止，状态提示「升级取消」。影响可接受。

(c) **非 macOS 平台**：`register_default_handlers` 内 `LSSetDefaultRoleHandlerForContentType` 仅 macOS 编译，Windows/Linux 由 tauri.conf.json `fileAssociations` 在打包时生成注册表项，本轮不额外处理。

---

## 给 QA 的回归提示

- **重点回归**：双击 .md 文件拉起 AIMD Desktop，`#doc-path` 应显示实际 .md 路径（不再是「未保存草稿」）；直接 ⌘S 应写回 .md，不弹另存为对话框。
- **升级路径**：在 .md 文档里粘贴图片，应弹出原生 YES/NO 对话框询问是否升级为 .aimd，同意后走文件选择器，最终路径切换到 .aimd。
- **取消升级**：拒绝升级对话框，图片插入中止，状态条显示「升级取消」，文档仍是 .md。
- **.aimd 双击行为**：不受本次改动影响，请回归确认正常。
- **拖拽 .md 进窗口**：验证走新的 openMarkdownDocument 路径，不再弹「请按 ⌘S 保存」提示。

---

## 重构 (2026-04-29) — main.ts 模块化拆分

### 行数对比

| | 旧 | 新 |
|---|---|---|
| `src/main.ts` | 2570 行（单文件全部职责） | 182 行（仅入口 + 顶层 wiring） |
| 新增模块文件总数 | — | 28 个 |
| 模块化后总行数（含 main） | — | 2693 行（增加 4.8%，主要是 import 声明 + 区段标头） |

### 新增模块清单与各自行数

```
core/types.ts          55   类型定义（AimdAsset / AimdDocument / Mode / SessionSnapshot ...）
core/state.ts          64   state 单例、ICONS、STORAGE_* 常量、inlineDirty/isBootstrappingSession 合并入 state
core/dom.ts            47   全部 DOM 引用，改为 lazy getter（首次调用才查询并缓存）

util/escape.ts         15   escapeHTML / escapeAttr
util/path.ts           18   fileStem / suggestAimdFilename / extractHeadingTitle

markdown/turndown.ts   29   TurndownService 单例 + gfm + aimdImage / strikethrough 规则

document/assets.ts     52   rewriteAssetURLs / resolveLocalAssetPath / sanitizeDisplayURL / looksLikeLocalPath / filePathToAssetURL / assetIDFromURL
document/apply.ts      46   normalizeDocument / normalizeAssets / inferFormat / applyDocument
document/optimize.ts   72   triggerOptimizeOnOpen / optimizeDocumentAssets / formatBytes
document/persist.ts   132   saveDocument / saveDocumentAs / upgradeMarkdownToAimd
document/lifecycle.ts 154   chooseAndOpen / openDocument / openMarkdownDocument / routeOpenedPath / chooseAndImportMarkdown / newDocument / closeDocument / ensureCanDiscardChanges

editor/markdown.ts      8   htmlToMarkdown 包装层
editor/inline.ts      100   lightNormalize / onInlineInput / normalizeInlineDOM / flushInline / sanitizePastedHTML / insertAtCursor
editor/format-toolbar.ts 221  bindFormatToolbar / runFormatCommand / closestBlock / closestAncestor / replaceBlockTag / applyBlockFormat / toggleBlockquote / wrapSelectionInTag / BLOCK_TAGS
editor/link-popover.ts 106   showLinkPopover + _linkPopoverResolve（保留模块状态）
editor/images.ts      151   IMG_COMPRESS_* 常量 / compressImageBytes / normalizeAddedAsset / buildAssetImage / insertImageInline / insertImage
editor/paste.ts       158   collectClipboardImages / guessImageExt / pasteImageFiles / onInlinePaste / onInlineKeydown

ui/template.ts        229   APP_HTML 字符串常量（依赖 ICONS）
ui/chrome.ts          130   updateChrome / displayDocTitle / formatPathHint / setStatus / 私有 assetItem
ui/recents.ts          66   loadRecentPaths / saveRecentPaths / rememberOpenedPath / clearRecentDocuments / renderRecentList
ui/context-menu.ts     96   dismissContextMenu / showFileContextMenu / 模块内 activeContextMenu 状态
ui/lightbox.ts         59   bindImageLightbox / openLightbox
ui/resizers.ts        117   bindSidebarResizers / bindSidebarHrResizer / SIDEBAR_MIN_W / SIDEBAR_DEFAULT_W / applySidebarWidth / getSidebarMaxW
ui/mode.ts             36   setMode
ui/outline.ts         152   scheduleRender / renderPreview / applyHTML / tagAssetImages / extractOutlineFromHTML / syncHeadingIds / renderOutline / currentScrollPane / paintPaneIfStale

session/snapshot.ts   169   loadSessionSnapshot / loadLastSessionPath / clearSessionSnapshot / clearLastSessionPath / persistSessionSnapshot / restoreSession / restoreSnapshot / renderSnapshotHTML

drag/window-drop.ts    29   onWindowDragOver / onWindowDragLeave / onWindowDrop
```

### 关键决策

1. **DOM lazy getter**：`core/dom.ts` 每个导出都是 `lazyEl(sel)` 返回的 getter 函数（如 `titleEl()`），首次调用 querySelector 并缓存。这样 ES 模块加载顺序无关——其它模块顶层 import dom.ts 不会触发 DOM 查询；只有 `main.ts` 顶层 body 在写完 `#app.innerHTML = APP_HTML` 之后调用 `bindFormatToolbar()` / `markdownEl().addEventListener(...)` 等才真正触发查询。所有调用点统一从 `titleEl` 改为 `titleEl()`。

2. **state 单例策略**：`core/state.ts` 用 `export const state = { ... }` 导出可变对象；其它模块直接 `import { state }` 后读写它的属性（不解构，避免丢 live binding）。**原本顶层的 `let inlineDirty` / `let isBootstrappingSession` 合并进 `state.inlineDirty` / `state.isBootstrappingSession`**——`export let` 不能跨模块写入，合并入 state 比单独导出 runtime 容器对象更统一。

3. **避免循环依赖**：依赖图最复杂的环路是 `ui/chrome ↔ ui/recents`、`ui/recents → document/lifecycle → document/persist → document/apply → ui/mode → editor/inline → ui/outline → session/snapshot → document/apply`。所有循环都只是**函数体内**的引用——ES module 静态 import 在拓扑上有环但执行顺序已展平：模块加载时只执行各模块顶层（顶层只有常量/导出函数定义，无副作用），运行时彼此调函数都已就绪。验证手段：tsc 通过 + 全量 e2e 通过 + 浏览器实际运行无 ReferenceError。

4. **HTML 模板抽离**：226 行的 `#app.innerHTML = `...`` 抽到 `ui/template.ts` 导出 `APP_HTML` 常量；模板里的 `${ICONS.xxx}` 插值通过 `import { ICONS } from "../core/state"` 解决。

5. **e2e 测试桩位置**：`window.__aimd_testInsertImageBytes` / `window.__aimd_testOptimizeAssets` / `window.__aimd_showFileContextMenu` 三个全局名仍在 `main.ts` 末尾挂载，行为完全一致。`window.__aimd_force_contextmenu_block`（e2e 自己 set）和 `window.__aimd_e2e_disable_auto_optimize` 也保持原读取点（main.ts 顶层 contextmenu 监听 / document/optimize.ts triggerOptimizeOnOpen）。

### 验证结果

| 指标 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误（首次编译即过） |
| `npm run build:web` | 153ms 成功，bundle 65.74 kB（gzip 20.37 kB），与改动前同档 |
| `npx playwright test` | **197 / 197 全绿**，约 2 分 54 秒（31 套 spec 一次性通过） |
| 跨前后端构建 | 未跑 `tauri build`（本轮纯前端拆分，未触碰 Rust 代码） |

### 未动的部分

- `apps/desktop-tauri/src/styles.css`（不动）
- `apps/desktop-tauri/index.html`（仍 `<script type="module" src="/src/main.ts">`）
- `apps/desktop-tauri/e2e/*`（31 套用例零修改）
- `apps/desktop-tauri/src-tauri/`（Rust 端零修改）
- `package.json`（未新增依赖）

### 待跟进 / 风险提示

- **main.ts 实际为 182 行**，超过提示中的 < 120 行预期。原因：保留了全部 23 个顶层事件 wiring（按钮 click / markdown input / 顶层 keydown / contextmenu / beforeunload / DOMContentLoaded）+ 3 个 e2e 测试桩。如果想进一步压低，可以把这些 wiring 抽到 `bootstrap.ts`，但行为零改动这条铁律下，新增 wrapper 函数无意义，目前结构最直观。
- **lazy getter 调用次数**：每次 `titleEl()` 都要走一次 `() => cached ??= ...` 函数调用 + 一次属性读，相比原本的常量直接读会有微小开销。在热路径（如 `paintPaneIfStale` 内每次 mode 切换调用 8+ 次 getter）实测 e2e 不退化；如未来发现性能问题可在 main.ts bootstrap 阶段一次性 prime 所有 getter（每个调用一次缓存，后续访问只是常量返回）。
- **`ui/chrome.ts` 内私有 `assetItem`** 保持模块私有未导出，与原文件中的本地函数语义一致；如果将来 `assetItem` 需要被其他模块复用，可以提级到 `ui/recents.ts` 或新建 `ui/assets.ts`。

### 给 QA 的回归提示

本次仅是前端文件结构搬迁，函数签名 / 行为 / 状态机 / 错误处理 / setStatus 文案 / await 顺序全部一字未改。197 项 e2e 全绿已覆盖：

- 文档生命周期（新建 / 打开 / 关闭 / 草稿升级 / 另存为）
- 模式切换（read ↔ edit ↔ source）的 paintPaneIfStale 节流
- inline 编辑器的 flushInline / inlineDirty 节流
- 格式工具栏（含 BUG-010/011/013 全部修复路径）
- 链接浮层（含编辑现有链接 / Cmd+K / Escape / 删除链接）
- 资源管线（粘贴 / 选择 / 压缩 / 优化）
- session 恢复（含与磁盘比对的双分支）
- recent 列表 / 文件右键菜单 / Finder 联动
- 拖拽打开 .aimd / .md
- Rust 命令注册检查

如发现任何运行时退化（黑屏 / DOM 引用为 null / 控制台 ReferenceError / 状态条文案错乱），请第一时间汇报——预计是 lazy getter 时序漏网点，能用一行 fix 修掉。
