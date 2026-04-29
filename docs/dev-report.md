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
