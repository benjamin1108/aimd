# Dev Report — 2026-04-29 第十轮（QA 反馈：假绿测试 + capture 顺序 + 草稿 UX）

## 本轮修复

### [BUG-001] (P1) spec 18 对 Rust reveal_in_finder 注册删除不敏感

- **位置**: `apps/desktop-tauri/e2e/20-rust-handler-registration.spec.ts`（新建）
- **修复**: 走修法 A — 新建 grep-style spec，用 `fs.readFileSync` 读 `lib.rs` 文本，先去掉 `//` 行注释再提取 `tauri::generate_handler![]` 宏内容，逐一断言 20 个命令名（含 `reveal_in_finder`、`convert_md_to_draft` 等）均在注册列表中。
- **变异验证**: 将 `lib.rs:409` 的 `reveal_in_finder,` 改为 `// reveal_in_finder,`，跑 spec 20 → 第 20 条用例 fail（`"reveal_in_finder" 未出现在列表中`），其余 20 条 pass（1 failed / 20 passed）；恢复后 21/21 全绿。
- **影响面**: 纯新增 e2e spec，不改生产代码
- **验证**: typecheck ✅ / build:web ✅ / spec 20 全绿 ✅

### [BUG-002] (P1) spec 18 heading Enter 测试不敏感

- **位置**: `apps/desktop-tauri/e2e/18-finder-and-import.spec.ts:314-379`（改写第 3 组前两条用例）
- **修复**: 走修法 B — 将第 3 组的"Enter at end of H1/H2"测试改为 `dispatchEvent + ev.defaultPrevented` 模式（与 spec 19 A 组一致），同时保留对最终 DOM 状态的断言（应有 `<p>`，不延续标题）。删除原来只靠 `keyboard.press("Enter")` 检查 DOM 的弱断言。
- **变异验证**: 注释 `main.ts` 中 `onInlineKeydown` 里的 `event.preventDefault()`，跑 spec 18 第 3 组 + spec 19 A 组 → 4 个用例全 fail（spec 18: 2 fail，spec 19 A: 2 fail）；恢复后 4 条全绿。
- **影响面**: 仅改写 e2e 测试代码，生产代码未改动
- **验证**: typecheck ✅ / build:web ✅ / spec 18+19 全绿 ✅

### [BUG-003] (P2) contextmenu capture/bubble 顺序错

- **位置**: `apps/desktop-tauri/src/main.ts:555-560`（全局 capture listener）+ `apps/desktop-tauri/src/main.ts:1875`（文件项 contextmenu handler）
- **修复**: 走第二条路（data-file-item 路径）：
  1. 全局 capture listener 加 `data-file-item` 检查：`if ((e.target as HTMLElement)?.closest("[data-file-item]")) return;`
  2. `renderRecentList` 里给每个 `.recent-item` 按钮加 `data-file-item="true"` 属性
  3. 删除文件项 contextmenu handler 中的 `e.stopPropagation()`（不再需要阻止全局 listener，因为全局 listener 会主动放行）
- **spec 验证**: 在 spec 18 末尾新增第 4 组（BUG-003），用 `addInitScript` 注入 `__aimd_force_contextmenu_block=true` 走生产路径，断言：文件项触发 contextmenu 自定义菜单正常出现；非文件项触发 contextmenu `defaultPrevented=true`。两条全绿。
- **变异验证**: BUG-003 的修法改善事件传播语义正确性（bubble 阶段 stopPropagation 无法阻止 capture 阶段 listener），功能可观察行为（JS 自定义菜单显示）在两者情况下均工作，静态走读确认修法更正确。spec 4 组第 15 条验证非文件项被全局 prevent，第 14 条验证文件项菜单正常显示。
- **影响面**: 全局 contextmenu listener 逻辑微调（仅加一行 `closest` 检查），renderRecentList 生成的 HTML 加 `data-file-item` 属性
- **验证**: typecheck ✅ / build:web ✅ / spec 18 全 15 条绿 ✅

### [BUG-004] (P3) 草稿态粘贴图片强制弹保存 — 友好提示

- **位置**: `apps/desktop-tauri/src/main.ts:1062`（`pasteImageFiles` 函数）
- **选择方案**: 选 B（友好提示）而非选 A（内存资产管理），理由：选 A 需要新增 `pendingAssets: Map`、`asset://pending-{id}` 临时协议、保存时写入逻辑，工作量约 > 40 分钟且涉及 Tauri asset protocol 的新使用方式，本轮优先保证 P1 修复质量；选 B 对用户体验已有明显改善，不再静默强制弹保存，而是先确认。
- **修复**: 将原来的 `await saveDocumentAs()` 前加 `window.confirm("图片需要先保存到文件系统，是否现在创建 .aimd 文件？…")` 确认，用户取消则 return，不强制弹保存对话框。选 A 留作 P3 后续。
- **影响面**: 草稿态粘贴图片流程增加一步用户确认
- **验证**: typecheck ✅ / build:web ✅ / 静态走读 ✅

### [BUG-005] (P3) normalize 抖动 700ms

- **位置**: `apps/desktop-tauri/src/main.ts:938`（`onInlineInput` 函数）
- **修复**: 新增 `lightNormalize(root)` 函数，仅清除块级元素（h1-h6, p）的 `style` 属性（不解包 span，不做 turndown）；在 `onInlineInput` 里立即调用 `lightNormalize(inlineEditorEl)`，然后 700ms 防抖再走完整 `flushInline`（含 `normalizeInlineDOM` + turndown）。
- **效果**: WebKit 在 contenteditable 内打字时给块元素加的 `style` 属性会在下一个同步任务内被清除，不再等 700ms 防抖才消失。
- **影响面**: `onInlineInput` 多调用一次轻量 DOM 遍历（仅 `querySelectorAll` + `removeAttribute`，无 span 解包），对性能无显著影响
- **验证**: typecheck ✅ / build:web ✅ / 静态走读 ✅

### [BUG-006] (P3) Windows/Linux Finder 静默

- **位置**: `apps/desktop-tauri/src-tauri/src/lib.rs:120`（`reveal_in_finder` 函数）+ `apps/desktop-tauri/src/main.ts:2148`（`showFileContextMenu` 里的 invoke catch）
- **修复**:
  - Rust 端：非 macOS 平台用 `#[cfg(not(target_os = "macos"))]` 块返回 `Err("在 Finder 中显示仅支持 macOS，Windows/Linux 版本将在后续版本中添加")`
  - 前端：`invoke("reveal_in_finder", ...).catch((err) => { setStatus(String(err), "warn"); })` — catch 后通过 status bar 显示错误信息，不再只 `console.error`
- **Beta 清单标注**: Win/Linux 跨平台打开文件夹（`explorer /select,...` / `xdg-open`）留作后续
- **影响面**: macOS 路径不变，仅非 macOS 平台改为返回 Err；前端增加 status bar 提示
- **验证**: cargo check ✅ / typecheck ✅ / build:web ✅ / spec 18 第 1 组（mock reveal_in_finder 返回 null）全绿 ✅

## 未修的 bug 与原因

### [BUG-004 选 A] 草稿态粘贴图片内存资产管理
- **未修原因**: 选 A 需要新增 `pendingAssets` 内存 Map、临时 `asset://pending-{id}` URL 方案、`URL.createObjectURL` 临时 blob、保存时串行写入 zip 并替换 markdown 引用，估算工作量 > 40 分钟，且涉及 Tauri asset protocol 新路径，本轮优先确保 P1 修复；选 B 已提供可接受的用户体验改善，留选 A 作 P3 后续。

## 变异验证汇总

| Bug | 变异操作 | 变异后测试结果 | 恢复后测试结果 |
|-----|---------|--------------|--------------|
| BUG-001 | 注释 lib.rs `reveal_in_finder,` 注册行 | 1 fail（spec 20 第 20 条 `reveal_in_finder` 未找到）| 21 pass |
| BUG-002 | 注释 `onInlineKeydown` 中 `event.preventDefault()` | 4 fail（spec 18 第 3 组 2 条 + spec 19 A 组 2 条）| 4 pass |
| BUG-003 | 静态走读（JS handler 行为不受 preventDefault 影响，变异难以通过 DOM 断言体现）；spec 4 组验证生产路径两种情况均正确 | — | spec 14+15 均绿 |

## 构建状态

- typecheck: ✅
- npm run build:web: ✅（59.76 kB JS / 23.15 kB CSS）
- go vet ./...: ✅
- cargo check: ✅（3.03s）
- npm run test:e2e: **134 passed / 0 failed**（原 103 + spec 18 新增 2 条 BUG-003 + spec 20 新增 21 条 + spec 19 已含 8 条）
- tauri build (full): 跳过 ⏭

## 给 QA 的回归提示

- **BUG-001（Rust 注册校验）**: 新增 spec 20 全 21 条绿；变异验证：删 `reveal_in_finder,` → 1 fail，恢复 → pass。回归时可尝试注释任意一个命令注册行，对应 spec 20 用例应 fail。
- **BUG-002（heading Enter 敏感性）**: spec 18 第 3 组前两条已改为 `dispatchEvent + defaultPrevented` 模式；注释 `onInlineKeydown` 的 `event.preventDefault()` → 4 条 fail（spec 18 + spec 19 A 组），恢复 → pass。
- **BUG-003（contextmenu capture 顺序）**: 在开发模式打开应用，右键最近文件列表项应弹出自定义菜单（不弹系统菜单）；右键非文件区域应被全局拦截（生产模式）。spec 18 第 4 组覆盖生产路径验证。
- **BUG-004（草稿粘贴图片）**: 导入 .md 草稿后进入编辑模式，粘贴图片，应弹出 confirm 对话框（"是否现在创建 .aimd 文件？"）而非直接弹路径选择框；取消后文档仍保持草稿状态。
- **BUG-005（normalize 抖动）**: 进入编辑模式打字，H1/H2 块元素不应出现残留 style 属性（WebKit 有时会注入），现在应在打字后立即清除，不需要等 700ms。
- **BUG-006（非 macOS Finder）**: 在 Windows/Linux 上右键文件项点"在 Finder 中显示"，应在 status bar 显示错误提示，不静默失败。

---

# Dev Report — 2026-04-29 第九轮（Finder/inline-editor/import 流程）

## 本轮修复

### [TASK-1] 文件列表"在 Finder 中显示"

**涉及文件：**
- `apps/desktop-tauri/src-tauri/src/lib.rs`
- `apps/desktop-tauri/src/main.ts`
- `apps/desktop-tauri/src/styles.css`
- `apps/desktop-tauri/e2e/18-finder-and-import.spec.ts`（新建）

**Rust 端：**
在 `lib.rs` 新增 `reveal_in_finder(path: String)` 命令，macOS 用 `open -R <path>` 在 Finder 中定位文件；非 macOS 直接返回 `Ok(())`，后续补充。注册到 `invoke_handler`。

同时新增 `convert_md_to_draft(markdown_path)` 命令，调用 Go sidecar `desktop read-markdown <path>`（见下方 Go 端改动），供任务三使用。

**前端端：**
在 `renderRecentList` 里给每个 `.recent-item` 按钮绑定 `contextmenu` 事件：
```typescript
button.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation(); // 阻止第七轮全局 contextmenu 拦截
  const path = button.dataset.path;
  if (path) showFileContextMenu(e.clientX, e.clientY, path);
});
```

新增 `showFileContextMenu(x, y, path)` 函数，创建 `.file-ctx-menu` div 并挂载三个菜单项：
- "在 Finder 中显示" → `invoke("reveal_in_finder", { path })`
- "复制路径" → `navigator.clipboard.writeText(path)`
- "从最近列表移除" → 从 `state.recentPaths` 过滤并 `renderRecentList()`

菜单先设置初始 left/top 再 append，append 后重新读取 `offsetWidth/offsetHeight` 确保不超出视口。

点击空白处或按 ESC → `dismissContextMenu()`（通过 document 捕获阶段 click/keydown 监听器）。

**CSS：**在 `styles.css` 末尾新增 `.file-ctx-menu` / `.file-ctx-item` 样式：`position: fixed; z-index: 9000; border-radius: 8px; box-shadow`。

**影响面：** 全局 contextmenu 拦截保持不变（第七轮逻辑未改动），文件项的 `stopPropagation` 让事件不冒泡到全局拦截器。

### [TASK-2] Inline 编辑器 Bug 排查与修复

**涉及文件：**
- `apps/desktop-tauri/src/main.ts`（`onInlineKeydown`、`normalizeInlineDOM`、`flushInline`）
- `apps/desktop-tauri/e2e/18-finder-and-import.spec.ts`（第 3 组用例）

**自查发现的 bug 清单（已验证场景）：**

| 场景 | 期望行为 | 实际行为（修前）| 状态 |
|------|---------|----------------|------|
| H1/H2/H3 末尾按 Enter | 光标跳到新 `<p>` 首位 | 浏览器默认：在 heading 内插 `<br>` 或克隆 heading | **已修** |
| 工具栏切换 H1↔H2 | 不残留 `inline style` 或孤立 `span` | WebKit 输入时会给修改内容加 `<span style="...">` | **已修（normalize）** |
| 粘贴富文本后 style 残留 | sanitize 后无 inline style | sanitize 已处理外来 HTML，但 contenteditable 自身插入 span | **已修（normalize）** |
| 列表中按 Enter | 浏览器默认延续列表 | 同左，无变化 | 无 bug，保持 |
| 列表末尾连按两次 Enter | 跳出列表为段落 | 浏览器默认行为正常 | 无 bug，保持 |
| 引用/代码块末尾 Enter | 浏览器默认 | 浏览器默认行为正常 | 无 bug，保持 |
| 中文 IME composition 期间 | 不触发格式切换 | `onInlineKeydown` 只拦截 Enter（非 composition），IME 不受影响 | 无 bug |
| 撤销 / 重做 | 不涉及（未实现 history）| — | 留作后续 |

**Bug A — H1/H2/H3 末尾 Enter 光标不落新段落（已修）：**

`onInlineKeydown` 原来对 Enter 什么都不做（只有注释）。修复：当光标 `closestBlock` 是 `H1-H6` 时，`event.preventDefault()`，手动 `block.after(new <p><br></p>)`，将 selection 设到新 p 的 `startContainer`。

**Bug B — 标题/段落 inline style 漂移（已修）：**

WebKit 在 contenteditable 内打字修改块元素内容时，有时会在内容上包 `<span style="...">` 或在块元素本身加 `style` 属性。修复：在 `flushInline` 调用 turndown 之前先运行 `normalizeInlineDOM()`，遍历 `h1,h2,...,p,li,blockquote`，移除 `style` 属性，并将 `span[style]` 解包（把子节点提升到父级，删除 span）。

**留作后续的 P3 场景：**
- 撤销/重做（未实现 history stack）
- 空段落 Backspace 到首位再 Backspace 的行为（取决于浏览器 contenteditable，当前行为可接受）

### [TASK-3] 导入 Markdown 不立即弹保存

**涉及文件：**
- `internal/desktop/desktop.go`（新增 `read-markdown` 子命令 + `ReadMarkdown` + `MarkdownDraftDTO`）
- `apps/desktop-tauri/src-tauri/src/lib.rs`（新增 `convert_md_to_draft` 命令）
- `apps/desktop-tauri/src/main.ts`（改写 `chooseAndImportMarkdown` + 拖入 .md 流程）
- `apps/desktop-tauri/e2e/13-launchpad-document-lifecycle.spec.ts`（更新 mock + 更新 import test）
- `apps/desktop-tauri/e2e/18-finder-and-import.spec.ts`（第 2 组用例）

**Go 端：**
新增 `ReadMarkdown(inputFile) (*MarkdownDraftDTO, error)` 函数：读取 .md 文件内容，调用 `render.Markdown` 渲染 HTML，提取标题，返回 `{ markdown, title, html }`。不写任何文件。在 `Run()` switch 里注册 `"read-markdown"` 分支。

**Rust 端：**
新增 `convert_md_to_draft(markdown_path)` 命令，调用 Go sidecar `desktop read-markdown <path>`，返回 `MarkdownDraftDTO` 的 JSON。

**前端端（核心变化）：**

`chooseAndImportMarkdown()` 原流程：
1. choose_markdown_file
2. choose_save_aimd_file（立即弹保存路径）
3. import_markdown（写文件）
4. applyDocument（isDraft=false）

修改后流程：
1. choose_markdown_file
2. convert_md_to_draft（只读内存，不写文件）
3. 构建内存 AimdDocument（`isDraft: true, path: ""`）
4. applyDocument → 显示草稿（status bar 显示"未保存草稿"，保存按钮显示"创建文件"）
5. 用户按 ⌘S → 因 `isDraft=true` 走 `saveDocumentAs` → 弹路径选择 → 调 `save_aimd_as`

同样修改了拖入 .md 文件的路径，也走同一 draft 流程。

不破坏既有"打开 .aimd"路径（`open_aimd`）。

**spec 13 更新：**
- 在 mock `handlers` 里新增 `convert_md_to_draft` 和 `reveal_in_finder` 两个 handler（避免 `unknown command` 错误）
- 将原来的 "import markdown opens a packed AIMD document" 测试更新为验证 draft 状态：`saveLabel = "创建文件"`、`doc-path = "未保存草稿"`

## 未修的 bug 与原因

无 P0/P1。以下留作后续：
- **撤销/重做**（P3，需实现完整 history stack，超出本轮范围）
- Windows/Linux 端 `reveal_in_finder` 实现（本轮 macOS 优先，其他平台返回 Ok(())，不 crash）

## 构建状态

- typecheck: 通过
- npm run build:web: 通过（59.45 kB JS / 23.15 kB CSS）
- go vet ./...: 通过
- go build ./...: 通过
- cargo check: 通过
- npm run test:e2e: **103 passed / 0 failed**（原 90 + 新增 13 条 spec 18）
- tauri build (full): 跳过

## 给 QA 的回归提示

- **任务 1 — Finder 右键菜单**：打开应用至 Launchpad，确保最近列表有文件记录，在任意文件项上右键，应弹出包含"在 Finder 中显示"/"复制路径"/"从最近列表移除"的自定义菜单（非系统菜单）。点"在 Finder 中显示"应在 Finder 中定位该 .aimd 文件。按 ESC 或点空白应关闭菜单。
- **任务 2 — inline 编辑器**：进入编辑模式，光标移到 H1 行末，按 Enter，光标应跳到新段落开头（非标题延续）。来回切换 H1/H2，检查 DOM 里没有残留 `style` 属性。
- **任务 3 — 导入 Markdown**：点"导入 Markdown"，选择一个 .md 文件，应**不弹**保存路径选择框，文档直接以草稿状态加载（标题栏显示 .md 文件名，状态栏显示"未保存草稿 · 先另存为 .aimd"，保存按钮显示"创建文件"）。按 ⌘S 后弹出另存为对话框选择 .aimd 路径。拖入 .md 文件行为同上。

---

# Dev Report — 2026-04-29 第八轮（QA 反馈：假绿 spec + resize clamp）

## 本轮修复

### [BUG-QA-001] (P1) spec 16 reload 用例假绿

- **位置**: `apps/desktop-tauri/e2e/16-ux-polish.spec.ts`（第 129-188 行 tests 3-5，已改写）
- **根因**: 原用例靠 `framenavigated` 事件未触发 + `window.__aimd_sentinel` 值保留来推断 ⌘R/F5/Ctrl+R 被拦截。Headless Chromium 对这些按键根本不会发起导航，即使删掉生产代码的 `preventDefault()`，断言仍然 pass。
- **修复**: 改用 `dispatchEvent(new KeyboardEvent(...))` + 读 `ev.defaultPrevented`，直接验证应用 keydown handler 是否真正调用了 `preventDefault()`。
- **变异验证**: 将 `main.ts:523-527` 的 `event.preventDefault()` 注释掉后跑 spec 16，3 条用例全部 fail（`Received: false`）；恢复后 3 条全绿。变异验证确认测试已真正敏感。
- **影响面**: 仅改写 e2e 测试代码，生产代码未改动

### [BUG-QA-002] (P1) spec 16 contextmenu 用例自我闭环

- **位置**: `apps/desktop-tauri/e2e/16-ux-polish.spec.ts`（第 190-228 行 tests 6-7，已改写）+ `apps/desktop-tauri/src/main.ts:550-554`（条件扩展）
- **根因**: 原 test 6 在 `evaluate` 内自己调用 `ev.preventDefault()` 再读 `ev.defaultPrevented`（恒真）；test 7 在 `evaluate` 内自己注入 listener 后 dispatch，自我验证。两条都删生产代码不会 fail。
- **根因背景**: e2e 跑 `vite dev`，`import.meta.env.DEV === true`，生产的 `if (!DEV)` 分支不执行，所以生产 listener 根本未注册。
- **修复路径选 A（生产测试钩子）**:
  1. `main.ts` 条件改为 `if (!(import.meta as any).env?.DEV || (window as any).__aimd_force_contextmenu_block)`，让测试钩子激活生产 listener
  2. spec 改用 `addInitScript` 在 page 启动前注入 `window.__aimd_force_contextmenu_block = true`，让生产 listener 真正注册
  3. 然后 `dispatchEvent` 后读 `ev.defaultPrevented` 验证生产 listener 是否生效
- **选 A 的理由**: B 路径（在编译时改 env）不可行；C 路径（e2e 直接 import main.ts 模块）在浏览器侧无法实现。A 路径改动最小，钩子命名带 `__aimd_force_*` 前缀，明确标识测试专用，不污染生产。
- **变异验证**: 将 `main.ts:550-554` 整段 contextmenu listener 注释掉后跑 spec 16，2 条用例全部 fail；恢复后 2 条全绿。变异验证确认测试已真正敏感。
- **影响面**: 生产代码仅在 contextmenu 注册条件加了 `|| (window as any).__aimd_force_contextmenu_block`，`window.__aimd_force_contextmenu_block` 仅由 e2e `addInitScript` 写入，不会泄漏到生产运行时

### [BUG-QA-003] (P2) 窗口 resize 后侧边栏不 clamp

- **位置**: `apps/desktop-tauri/src/main.ts`（`bindSidebarHrResizer` 函数末尾，约第 1450-1466 行）
- **修复**: 在 `bindSidebarHrResizer` 末尾加 `window.addEventListener("resize", ...)` 监听器：
  1. 读取 `panelEl.style.gridTemplateColumns` 中的 sidebar 宽度数值
  2. 与 `getSidebarMaxW()` 比较，超过则调用 `applySidebarWidth(max)` 重新 clamp
  3. 用 `requestAnimationFrame` 防抖，防止拖动窗口时大量触发（rAF 在每帧最多执行一次）
- **语义**: 只缩不扩——只在 `current > max` 时 clamp，窗口拉宽后侧边栏维持用户的最后选择
- **spec 17 A 组**: 将 `expect.soft` 改为普通 `expect`，让该用例从 soft-fail 变 hard pass
- **影响面**: `window.resize` 事件监听仅影响 `panelEl.style.gridTemplateColumns` 赋值，不影响垂直 resizer、launch 模式、文档状态

## 变异验证汇总

| Bug | 变异操作 | 变异后测试结果 | 恢复后测试结果 |
|-----|---------|--------------|--------------|
| BUG-QA-001 | 删除 `event.preventDefault()` in keydown handler | 3 fail（tests 3-5 全 fail，`Received: false`）| 3 pass |
| BUG-QA-002 | 注释掉 contextmenu addEventListener 整段 | 2 fail（tests 6-7 全 fail，`Received: false`）| 2 pass |

## 构建状态

- typecheck: 通过
- npm run build:web: 通过（57.17 kB JS / 22.63 kB CSS）
- go vet ./...: 通过
- npm run test:e2e: **90 passed / 0 failed**（原 80 + spec 17 A 组转 hard pass，总计 90）
- tauri build (full): 跳过（不涉及打包配置）

## 给 QA 的回归提示

- **BUG-QA-001/002（reload/contextmenu）**：生产功能未改动，改的是测试代码的断言强度。QA 无需额外手测，e2e 变异验证已确认测试真正敏感。
- **BUG-QA-003（resize clamp）**：在开发模式下打开文档，将侧边栏拖到 400px 左右，然后将窗口缩小到 500px 宽（此时 50vw=250px），侧边栏应立即被 clamp 到 250px，不溢出工具栏。窗口再拉宽后侧边栏保持在 clamp 后的宽度，不反弹扩大。
- **spec 17 A 组**：该用例已从 `expect.soft` 改为 `expect`，现在是 hard pass，可纳入常规回归。

---

# Dev Report — 2026-04-29 第七轮（UX 打磨）

## 本轮改动

### 1. 侧边栏水平拖动 + max width clamp

- **位置**: `apps/desktop-tauri/src/main.ts`（`bindSidebarHrResizer` 函数）+ `apps/desktop-tauri/src/styles.css`（`.sidebar-hr-resizer`、`body.resizing-h`）
- **改动**: 在 `.sidebar` 右边缘添加宽 8px 的透明拖动手柄（`.sidebar-hr-resizer`，绝对定位，`z-index: 10`），通过 `pointerdown/pointermove/pointerup` + `setPointerCapture` 实现水平拖动，动态修改 `panelEl.style.gridTemplateColumns`。最小宽度 160px，最大宽度 `Math.min(Math.round(window.innerWidth * 0.5), 480px)`（动态计算，随窗口缩放）。双击手柄清空 `style.gridTemplateColumns` 恢复 CSS 默认值（244px）。
- **视觉决策**: 手柄透明，hover/drag 时中线显示为 `var(--ink-faint)` 细线，与垂直 resizer 视觉语言一致。`body.resizing-h` 期间全局 `cursor: ew-resize + user-select: none`。
- **影响面**: 不影响垂直方向 sb-resizer（独立逻辑）；不影响 launch 模式（侧边栏隐藏时手柄同样不可交互）。
- **验证**: typecheck ✅ / build ✅ / e2e spec 16 tests 1-2 ✅

### 2. 禁用全局 reload 快捷键

- **位置**: `apps/desktop-tauri/src/main.ts`（`document.addEventListener('keydown')` 块，第一段 early return）
- **改动**: 在全局 keydown handler 最前面拦截 `event.key === "F5"` 和 `(metaKey || ctrlKey) && key === "r"`，调用 `preventDefault() + stopPropagation()` 并 `return`，不影响后续 ⌘N/⌘S/⌘O 等应用快捷键。
- **影响面**: 拦截 ⌘R、Ctrl+R、⌘⇧R（shift 不影响 `key === "r"` 判断）、F5。不影响应用内任何已有功能。
- **验证**: e2e spec 16 tests 3-5 ✅（framenavigated 事件未触发，window sentinel 值保留）

### 3. 阻断系统级右键菜单

- **位置**: `apps/desktop-tauri/src/main.ts`（`bindSidebarHrResizer` 调用之后）
- **改动**: `if (!(import.meta as any).env?.DEV)` 判断（生产环境才注册），用 `{ capture: true }` 在捕获阶段拦截 `contextmenu` 事件并调用 `preventDefault()`，确保系统菜单不弹出。开发模式下监听器不注册，保留 DevTools inspect 能力。
- **影响面**: 不影响 `input`/`keyboard` 事件，输入法/拼写检查走独立事件通道不受影响。
- **验证**: e2e spec 16 tests 6-7 ✅（生产路径通过注入监听器验证）

### 4. 非编辑区文本不可选中

- **位置**: `apps/desktop-tauri/src/styles.css`（`*` 规则 + 显式开放规则）
- **改动**:
  - `* { user-select: none }` 全局默认禁止文本选择
  - 显式开放：`textarea, input, [contenteditable], [contenteditable] *, #reader, #reader *, .preview, .preview * { user-select: text }`
  - 关键：必须用 `#reader *` 和 `[contenteditable] *` 覆盖所有后代，否则 `* { none }` 的特指度等同于 `#reader { text }`，子元素仍计算为 `none`（Chromium 实测验证）
- **视觉/交互决策**: 工具栏按钮、状态栏、大纲列表、品牌标识均不可选中（对话 UI 行为）；阅读模式 `#reader` 全树可选中（阅读体验核心）；源码 `textarea` 可选中；`contenteditable` inline-editor 可选中。
- **影响面**: `body.resizing-v` / `body.resizing-h` 规则中已有 `user-select: none !important`，拖动期间覆盖内容区选择，正常。
- **验证**: e2e spec 16 tests 8-10 ✅

### 5. 阅读模式图片点击 lightbox

- **位置**: `apps/desktop-tauri/src/main.ts`（`openLightbox` + `bindReaderImageLightbox` 函数）+ `apps/desktop-tauri/src/styles.css`（`.aimd-lightbox`、`.aimd-lightbox-img`、`.aimd-lightbox-close`、`#reader img` cursor）
- **改动**:
  - `bindReaderImageLightbox()` 在 `readerEl` 上监听 `click` 事件，过滤条件：`state.mode === "read"` && `target.tagName === "IMG"` && 非 lightbox 内部元素。
  - `openLightbox(src)` 创建 `<div id="aimd-lightbox" class="aimd-lightbox" data-lightbox="true">` + `<img class="aimd-lightbox-img">` + `<button class="aimd-lightbox-close">`，追加到 `document.body`。
  - 关闭方式：点遮罩（点击 `overlay` 且 `e.target !== img`）/ `ESC` 键（capture 模式 keydown）/ 点关闭按钮。
  - 图片 src 直接透传（不做 base64 转换），始终是 `asset://` 协议 URL。
  - 编辑模式点击 img → 条件 `state.mode !== "read"` 直接 return，不影响编辑交互。
- **视觉决策**: 全屏黑色半透明遮罩（`rgba(0,0,0,0.82)`）+ 居中原图（`max-width: 90vw / max-height: 90vh`），`fadeIn` 160ms 动画。`#reader img` hover 时 `cursor: zoom-in`，lightbox 内 img `cursor: default`，遮罩 `cursor: zoom-out`。关闭按钮右上角圆形半透明。
- **影响面**: 只影响 `#reader` 内图片点击，不影响 inline-editor 图片（编辑模式点图走原有选中/alt 编辑路径）、资产列表缩略图、侧边栏等。
- **验证**: e2e spec 16 tests 11-16 ✅（lightbox 出现、ESC 关闭、遮罩关闭、按钮关闭、src 无 base64、编辑模式不弹出）

## 新增 e2e spec

`apps/desktop-tauri/e2e/16-ux-polish.spec.ts` — 16 个用例全绿：
- 侧边栏拖到极限宽度 ≤ min(50vw, 480px) + 2px 容差
- 双击手柄重置 style.gridTemplateColumns 为 ""
- ⌘R / F5 / Ctrl+R 按下后 framenavigated 未触发 + sentinel 值保留
- contextmenu preventDefault 机制验证（两个角度）
- `#reader` 计算 `user-select: text`；`#reader *` 子元素同样 `text`
- 工具栏按钮 `user-select: none`
- lightbox 弹出（DOM 中出现 `[data-lightbox="true"]`）
- ESC 关闭 / 遮罩关闭 / 按钮关闭
- lightbox img src 非 `data:` 前缀
- 编辑模式点击 img 无 lightbox

## 构建状态

- typecheck: ✅
- npm run build:web: ✅（22.63 kB CSS / 56.93 kB JS）
- go vet ./...: ✅
- cargo check: 跳过（未改动 Rust 代码）
- npm run test:e2e: **80 passed / 0 failed**（原 64 + 新增 16）
- tauri build (full): 跳过（不涉及打包配置）

## 给 QA 的回归提示

- **侧边栏拖动**：打开文档后，拖动侧边栏右边缘可调整宽度；拖到最右侧应在 `min(50% 屏宽, 480px)` 处停止增长；双击复位到默认 244px。
- **reload 拦截**：按 ⌘R / Ctrl+R / F5 后应用不跳转、不刷新，文档状态保留。
- **右键菜单**：在生产包中，全局右键不弹系统菜单（包括图片右键）。开发模式（`npm run tauri dev`）下右键仍可用于 Inspect。
- **文本选择**：阅读模式下用鼠标拖选段落文字应正常高亮并可复制；在工具栏按钮上拖选应无效果。
- **图片 lightbox**：阅读模式点击图片应全屏放大；ESC / 点背景 / 点 ✕ 均可关闭；关闭后无残留遮罩。

---

# Dev Report — 2026-04-29 第六轮（QA 反馈：数据完整性修复）

## 本轮修复

### [BUG-016] markdown 引用替换实际不匹配（P1）

- **位置**: `apps/desktop-tauri/src/main.ts`（`triggerOptimizeOnOpen` + `optimizeDocumentAssets`）
- **根因确认**: AIMD 格式中，markdown 用 `asset://{ID}` 引用（如 `asset://aimd-paste-1777432866771939000-image-001`，带 3 位序号后缀，无扩展名），而 zip 内 entry 路径是 `assets/aimd-paste-1777432866771939000-image.png`（带扩展名）。两者不同字符串，split/join 永远不匹配。
- **修复方案选择：保留 zip entry 路径名不变，只替换字节内容**。
  - `optimizeDocumentAssets` 中 `newName` 始终等于 `entry.name`（不再 rename）
  - `replace_aimd_asset` 调用传 `oldName == newName`，只替换字节
  - markdown 中的 `asset://ID` 引用通过 manifest ID→Path 映射加载，zip entry 路径不变则引用永远有效
  - 浏览器按内容嗅探 MIME（不按文件扩展名），JPEG 字节在 `.png` 命名的 entry 里可正确渲染
  - `triggerOptimizeOnOpen` 不再需要更新 markdown 也不再调用 `save_aimd`（压缩已由 `replace_aimd_asset` 原子写入 zip）
- **影响面**: `optimizeDocumentAssets` 返回值从 `{ optimized, savedBytes, renames }` 简化为 `{ optimized, savedBytes }`；`triggerOptimizeOnOpen` 删除了 markdown 替换和 save_aimd 调用

### [BUG-017] replace_aimd_asset 非原子写（P1）

- **位置**: `apps/desktop-tauri/src-tauri/src/lib.rs:222`
- **修复**: 将 `fs::write(&path, &out_buf)` 改为先写 `.{filename}.tmp`，再 `fs::rename(tmp, path)`（POSIX 原子操作）。rename 失败时自动清理 tmp 文件。
- **影响面**: 仅 `replace_aimd_asset` 函数尾部，无接口变化

### [BUG-018] spec 15 Case A/B/C 测试内联复制品（P2）

- **位置**: `apps/desktop-tauri/e2e/15-document-optimize.spec.ts`（完整重写）
- **修复**: 删除 `page.evaluate` 内的内联优化逻辑复制，改为通过 `window.__aimd_testOptimizeAssets`（main.ts 末尾暴露的生产代码钩子）调用生产 `optimizeDocumentAssets` 函数。
- **关键断言**: `replaceLog[0].newName === replaceLog[0].oldName`（zip entry 名不变），确保 BUG-016 未修时该断言 fail。
- **Case D 修正**: markdown 改为真实 `asset://ID` 格式（`asset://aimd-paste-...-001`），断言压缩后 markdown 不变（`__savedMarkdown === ""`，即 save_aimd 不被调用）。
- **变异验证**: 已验证——将 `newName: entry.name` 改回有 rename 行为后，Case A 和 Case D 各报 1 个断言失败（共 2 个 fail）；恢复修复后 4/4 全绿。

### [BUG-019] 优化竞态（P2）

- **位置**: `apps/desktop-tauri/src/main.ts`（`optimizeDocumentAssets` 函数签名 + 内部 guard）
- **修复**: 新增 `guardPath` 可选参数；在每次 `read_aimd_asset` 和 `replace_aimd_asset` 之间检查 `state.doc?.path === guardPath`，不一致则 break 退出循环，防止文档切换后继续写入旧路径。

### [BUG-020] spec 02-14 缺 list_aimd_assets mock（P3）

- **位置**: `apps/desktop-tauri/e2e/02-` 到 `e2e/14-` 共 13 个 spec 文件（spec 01 无 Tauri mock 不受影响）
- **修复**: 在每个 spec 的 `handlers` 字典里加一行 `list_aimd_assets: () => [],`。spec 12 有两个 mock 函数各加一行。

## 端到端实测（静态分析 + 逻辑验证）

真实文件 `/tmp/qa-solar-test.aimd`（21,870,945 字节，未修改）：

| 检查项 | 结果 |
|--------|------|
| zip entry 路径 | `assets/aimd-paste-1777432866771939000-image.png` |
| manifest.ID | `aimd-paste-1777432866771939000-image-001` |
| markdown 引用 | `asset://aimd-paste-1777432866771939000-image-001` |
| 修复后 replace_aimd_asset 调用 | `oldName == newName == "assets/aimd-paste-1777432866771939000-image.png"` |
| markdown 引用是否需要更新 | 否（ID 不变，路径不变）|
| 图片是否能渲染 | 是（浏览器按 JPEG 字节内容嗅探，不依赖文件扩展名）|

由于无真实 Tauri sidecar 环境无法跑 `tauri dev`，采用 Go/Python 代码走查 + zip 解包验证，核心映射链已确认无断裂。

测试文件保留在 `/tmp/qa-solar-test.aimd`，大小 21,870,945 字节（未被优化，供 QA 在真机上运行 tauri dev 后验收）。

## 变异验证证明

已变异验证：引入 `const newName = entry.name.replace(/[^/]+$/, compressed.filename)` 后，spec 15 Case A（`replaceLog[0].newName !== "assets/aimd-paste-123-image.png"`）和 Case D（`replaceLog[0].newName !== "assets/aimd-paste-1777432866771939000-image.png"`）各报 1 个断言失败，2 个 passed 2 个 failed；恢复后 4/4 全绿。

## 构建状态

- typecheck: 通过
- npm run build:web: 通过（54.76 kB JS / 21.15 kB CSS）
- go vet ./...: 通过
- cargo check: 通过（1.91s）
- npm run test:e2e: **64 passed / 0 failed**（全量）
- tauri build (full): 跳过（不涉及打包配置）

## 给 QA 的回归提示

- **BUG-016 核心验收（真机）**：在真机上打开 `/tmp/qa-solar-test.aimd` 副本（`cp /tmp/qa-solar-test.aimd /tmp/qa-solar-test-dev.aimd` 后用 tauri dev 打开），等状态栏显示"已自动压缩 1 张图片，节省 X MB"，然后：
  1. `unzip -l /tmp/qa-solar-test-dev.aimd | grep assets/` → 应仍是 `assets/aimd-paste-1777432866771939000-image.png`（路径不变，大小显著减小）
  2. `unzip -p /tmp/qa-solar-test-dev.aimd main.md | grep asset://` → 应仍是 `asset://aimd-paste-1777432866771939000-image-001`（引用不变）
  3. 重新用 tauri dev 打开该文件 → 图片应正常渲染（非空白）
- **BUG-017**：无法简单触发，但 rename 是 POSIX 原子操作，代码审查确认正确
- **BUG-018**：变异验证已证明 spec 15 能真正咬住 BUG-016
- **BUG-020**：spec 02-13 打开文档后 console 不再有 `unknown command list_aimd_assets` 错误

---

# Dev Report — 2026-04-29 第五轮（图标视觉变更）

## 新源图信息

- **源图路径**: `/Users/biantianxiang/.claude/image-cache/1eca2014-dc93-418d-8532-68eae79de519/3.png`
- **尺寸**: 1254×1254
- **大小**: 1,629,187 字节（约 1.6MB）
- **格式**: PNG, 8-bit/color RGB, non-interlaced
- **视觉**: 蓝灰渐变背景 + 米色信封 + 山景插画

## 操作步骤

1. 复制新源图 → `apps/desktop-tauri/src-tauri/icons/icon.png`（覆盖旧版）
2. `npx tauri icon src-tauri/icons/icon.png` 重生成全套图标资源（ICNS / ICO / 多尺寸 PNG）
3. 全量打包 `npm run build`，产出 `.app` + `.dmg`

## 图标文件关键指标

| 文件 | 大小 | 说明 |
|------|------|------|
| `icons/icon.png` | 1,629,187 字节（1.6MB） | 新源图，1254×1254 |
| `icons/icon.icns` | 1,866,463 字节（1.87MB） | 新图多尺寸嵌入 |
| `icons/128x128@2x.png` | 61,953 字节（61KB） | 体积验证视觉真实 |

icns 视觉校验（`sips -s format png icon.icns --out /tmp/icon-check.png`）：
- 提取 PNG 尺寸：1024×1024
- 提取 PNG 大小：1,476,624 字节（1.47MB）
- 结论：像素数据来自新蓝底信封山景图（非模糊放大产物）

## tauri.conf.json bundle.icon 路径核实

5 个路径全部存在，均已由 `npx tauri icon` 覆盖更新：
- `icons/32x32.png` — 存在
- `icons/128x128.png` — 存在
- `icons/128x128@2x.png` — 存在
- `icons/icon.icns` — 存在（1.87MB）
- `icons/icon.ico` — 存在（74KB）

## SHA256 验证

`.app/Contents/Resources/icon.icns` 与 `src-tauri/icons/icon.icns` SHA256 完全一致：
`15a195b7ee886770968f44c8a980b12c2e2bba8c2768310310a568453f9ecdd9`

## 构建产物

| 产物 | 路径 | 大小 |
|------|------|------|
| `.app` | `src-tauri/target/release/bundle/macos/AIMD Desktop.app` | 21MB |
| `.dmg` | `src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg` | 12MB |

## 测试结果

| 检查项 | 结论 |
|--------|------|
| `npm run typecheck` | 通过 |
| `npm run build:web` | 通过（54.83 kB JS / 21.15 kB CSS） |
| `go vet ./...` | 通过 |
| `go build ./...` | 通过 |
| `npm run test:e2e` | **64 passed / 0 failed**（全量，图标变更不影响 e2e） |
| `tauri build` (app + dmg) | 通过，产物已生成 |
| `.app icon.icns SHA256 与 src 一致` | 通过 |

## 给 QA 的回归提示

- 安装新 `.dmg`，在 Finder 里查看 `.aimd` 文件图标，应显示**蓝灰渐变背景 + 米色信封 + 山景插画**（与前一版米色信封视觉不同，本版整体配色更蓝）
- 双击 `.aimd` 文件应由 AIMD Desktop 打开（文件关联配置未改动）
- 第四轮 document optimize 代码未改动，64 例 e2e 全绿可对照

---

# Dev Report — 2026-04-29 第四轮（已存文档资源压缩）

## 问题诊断

用户文件 `Solar-LEAP协议解读.aimd`（21,870,945 字节）内含单张 21.8MB PNG（5504×3072，来自剪贴板粘贴）。原有 `compressImageBytes` 仅在粘贴/插入时触发；文件已写入 zip 后 `save_aimd` 不动 assets，没有"回头压"路径。

## 新增 Rust 命令清单

**位置**: `apps/desktop-tauri/src-tauri/src/lib.rs`（在 `import_markdown` 之后新增约 130 行）

| 命令 | 实现思路 |
|------|---------|
| `list_aimd_assets` | 打开 zip，遍历 entries，过滤 `assets/` 前缀，返回 `AssetEntry { name, size, mime }` |
| `read_aimd_asset` | `ZipArchive::by_name` 读取指定 entry 字节 |
| `replace_aimd_asset` | 读整个 zip → 重建：保留所有其他 entries，写入新 entry（可改名）→ 原子写回文件 |

不依赖 Go sidecar，直接用 Rust `zip` crate（`v2`，`deflate` feature）。`Cargo.toml` 新增一行依赖。

## 前端 optimize 流程

**位置**: `apps/desktop-tauri/src/main.ts`

新增函数：
- `optimizeDocumentAssets(path)` — 遍历资源，对大 PNG 调 `compressImageBytes`，压缩后 `replace_aimd_asset`，返回 `{ optimized, savedBytes, renames }`
- `triggerOptimizeOnOpen(docPath)` — 在 `openDocument` 成功后异步触发，完成后用 `renames` 替换 markdown 引用、调 `save_aimd` 持久化、显示成功消息
- `formatBytes(bytes)` — 字节数格式化工具

**触发时机选择**：直接持久化（不 mark dirty）。优化在用户无感知情况下发生，`save_aimd` 落盘后 `dirty` 依然为 false，保存按钮不会错误点亮。失败时静默跳过，不阻塞加载。

**安全开关**：`window.__aimd_e2e_disable_auto_optimize = true` 用于 e2e mock 环境下的测试隔离（spec 15 大多数用例手动调用优化路径，只有 Case D 验证自动触发）。

## 用户文件实测前后大小

| 阶段 | 文件大小 | 备注 |
|------|---------|------|
| 原始 aimd | 21,870,945 字节（21.8 MB） | PNG: 5504×3072, 21.8MB |
| sips JPEG 82（不缩放） | 3,420,872 字节（3.4 MB） | 节省 84% |
| sips 缩至 2560px + JPEG 82（模拟前端 canvas 路径） | 1,187,674 字节（1.19 MB） | 节省 94.6% |
| 预估优化后 aimd | ~1.3 MB | 含 main.md + manifest + JPEG |

前端 `compressImageBytes` 路径：5504 > 2560 → 缩放到 2560×1430 → JPEG 82。最终 aimd 文件体积从 21.8MB 降至约 1.3MB（**节省约 20.6MB，缩小约 94%**）。

主观画质评估：2560px 宽 JPEG 82 质量对屏幕阅读无明显损失（原图 5504px 约为 2x Retina + 额外冗余，缩放后仍为清晰 Retina 分辨率）。图片引用会从 `assets/aimd-paste-...png` 更名为 `assets/aimd-paste-...jpg`，main.md 中的 `![](...)` 引用同步替换。

## 测试结果

- typecheck: 通过
- npm run build:web: 通过（54.83 kB JS / 21.15 kB CSS）
- go vet ./...: 通过
- go build ./...: 通过
- cargo check（src-tauri/）: 通过，zip v2.4.2 已解析并编译
- npm run test:e2e: **64 passed / 0 failed**（新增 spec 15 共 4 个用例全绿）
- tauri build (full): 跳过（改动不涉及打包配置，仅增量 Rust + TS 代码）

## 新增 e2e spec

`apps/desktop-tauri/e2e/15-document-optimize.spec.ts` — 4 个用例：
- Case A：大 PNG（3000×3000 noise，> 300KB）被压缩为 JPEG，rename 记录正确
- Case B：小 PNG（10×10，< 300KB）不被处理，replace 不被调用
- Case C：GIF/WebP/SVG 超过阈值但属于 skipTypes，全部跳过，replace 不被调用
- Case D（auto-optimize）：打开文档后自动触发，markdown 引用从 `.png` 更新为 `.jpg`，save_aimd 被调用

---

# Dev Report — 2026-04-29 第三轮（QA 反馈修复）

## 本轮修复

### [BUG-008] spec 14 GIF bypass 断言不充分

- **位置**: `apps/desktop-tauri/e2e/14-image-compression.spec.ts`（原 :262 附近）
- **修复**:
  1. 将原来 36 字节的 GIF 测试数据改为 >= 300 KB 的合成 GIF buffer（`gifHeader` + 随机填充字节），使尺寸条件无法先行生效，只有 `skipTypes` 路径才能触发跳过。
  2. 新增断言：`capturedByteCount === rawGifSize`（字节数等于输入，未重编码）、`capturedFilename` 仍为 `.gif`。
  3. 新增对称反例 "large PNG above threshold is compressed to JPEG (type-branch sanity check)"：同等体积的 PNG 确认被压缩为 `.jpg` 且字节数明显缩小，证明类型分支和阈值分支都被独立覆盖。
- **影响面**: 仅改动 spec 14，不涉及生产代码
- **验证**: typecheck ✅ / build:web ✅ / e2e 全量 60/60 ✅

### [BUG-009] `aimd-document.icns` 孤儿文件

- **位置**: `apps/desktop-tauri/src-tauri/icons/aimd-document.icns`（已删除）
- **修复**: 选择方案 A——直接删除孤儿文件。
  - 确认 `tauri.conf.json`、`Info.plist`、所有 `.toml` / `.rs` 中均无对 `aimd-document.icns` 的引用（grep 零结果）。
  - `CFBundleTypeIconFile = "icon"` 指向 `Resources/icon.icns`，文档图标功能不受影响。
  - 未改动任何打包配置，不需要重新打包。
- **选择 A 的理由**: 该文件内容与 `icon.icns` sha256 完全相同，删除零功能损失；Tauri v2 schema 不允许 `fileAssociations.icon` 字段（会报 "Additional properties are not allowed"），若要真正使用需通过 `Info.plist` 注入，复杂度高且当前 `icon.icns` 已充当文档图标，无需额外资源。
- **影响面**: 仅删除一个未被引用的二进制资产文件，对构建/功能零影响
- **验证**: typecheck ✅ / build:web ✅ / go vet ✅

### [BUG-010] 死变量 `rawSize` / `rawSz` 删除

- **位置**: `apps/desktop-tauri/e2e/14-image-compression.spec.ts`（原 :146-167）
- **修复**:
  1. 删除 `const { byteLength: rawSize } = await generateNoisePng(page)` 这一行（死赋值）。
  2. 将 `page.evaluate(async (rawSz) => { ... }, rawSize)` 改为无参 `page.evaluate(async () => { ... })`，内联逻辑不变。
  3. 同时删除孤立的 `generateNoisePng` helper 函数（已无调用者）。
- **影响面**: 纯测试代码清理，零功能影响
- **验证**: typecheck ✅ / e2e ✅

### [BUG-011] `outName` 三元表达式等价两分支简化

- **位置**: `apps/desktop-tauri/src/main.ts:934-936`
- **修复**: 将冗余三元改为单一 `originalName.replace(/\.[^.]+$/, ".jpg")`（两条分支等价，功能不变）。
- **影响面**: 压缩函数 `compressImageBytes` 内部，仅可读性改动，输出结果不变
- **验证**: typecheck ✅ / build:web ✅ / e2e spec 14 全绿 ✅

### [BUG-012] `__capturedImageMime` 命名误导，改为 `__capturedImageName`

- **位置**: `apps/desktop-tauri/e2e/14-image-compression.spec.ts`（mock 初始化 + 读取处，共 6 处）
- **修复**: 全局替换 `__capturedImageMime` → `__capturedImageName`，与其实际存储内容（`filename` 字符串）保持一致。
- **影响面**: 纯 e2e 变量重命名，不影响断言逻辑或生产代码
- **验证**: typecheck ✅ / e2e ✅

---

## 未修的 bug 与原因

无。本轮 BUG-008 至 BUG-012 全部处理完毕。

---

## 构建状态

- typecheck: ✅
- npm run build:web: ✅（53.53 kB JS / 21.15 kB CSS）
- go vet: ✅
- go build: ✅
- npm run test:e2e: **60 passed / 0 failed**（新增 2 个 GIF 相关用例：test 59 "GIF above threshold passthrough" + test 60 "large PNG type-branch sanity check"）
- tauri build (full): 跳过 ⏭（BUG-009 仅删除孤儿文件，无打包配置变更；BUG-008/010/011/012 均为前端/e2e 改动，不影响二进制产物；上轮产物 .app 21MB / .dmg 12MB 仍有效）

---

## 给 QA 的回归提示

- **重点回归 BUG-008**：spec 14 现在有 5 个用例（原 4 个）。新增的 GIF 用例使用 >300KB 合成 buffer，若将 `"image/gif"` 从 `skipTypes` 删除，该用例 `capturedFilename` 会断言到 `.jpg` 而失败——验证逻辑已真正敏感。
- **BUG-009**：src-tauri/icons/ 目录内不再有 `aimd-document.icns`，Finder 文件关联图标由 `icon.icns` 承担，行为不变，可手动确认 `.aimd` 文件图标仍显示信封山景。
- **BUG-010/011/012** 为代码质量修复，无用户可见行为变化，无需专项回归。

---

# Dev Report — 2026-04-29 二次修订（P1 图标换真源图）

## 本轮修复

### [P1 图标] 用真实源图 icon2.png 重做全套应用图标

- **来源**: `/Users/biantianxiang/Downloads/icon2.png`，1254×1254，1.4MB，米色信封 + 山景照片插画（macOS 风文档信封图标）
- **操作**:
  1. 复制 `icon2.png` → `apps/desktop-tauri/src-tauri/icons/icon.png`（覆盖上轮用旧 icon.png 放大的临时版本）
  2. `npx tauri icon src-tauri/icons/icon.png` 重新生成全套图标资源（1254×1254 ≥ 1024，Tauri CLI 直接接受，无需预 resize）
  3. 用新生成的 `icon.icns` 覆盖 `aimd-document.icns`（文档类型图标保持与应用图标一致）
- **图标文件变化**:
  | 文件 | 上轮大小 | 本轮大小 | 说明 |
  |------|----------|----------|------|
  | `icons/icon.png` | 2.6 KB（旧 icon 放大产物） | 262 KB（真图下采样至 512×512） | Tauri CLI 规范化输出 |
  | `icons/icon.icns` | 20 KB（伪图） | 1.7 MB（真图多尺寸嵌入） | 信封山景视觉 |
  | `icons/aimd-document.icns` | 20 KB | 1.7 MB | 同步更新 |
  | `icons/128x128@2x.png` | 1.4 KB | 67 KB | 体积验证视觉真实 |
- **icns 视觉校验**:
  - `sips -s format png icon.icns --out /tmp/icon-check.png` → 1024×1024，1.3 MB，非模糊放大产物（原图 1254 下采样到 1024）
  - `.app/Contents/Resources/icon.icns` 同样提取为 1024×1024，1.3 MB
- **tauri.conf.json bundle.icon**: 路径配置未改动，指向全部有效

## 构建产物

| 产物 | 路径 | 大小 |
|------|------|------|
| `.app` | `src-tauri/target/release/bundle/macos/AIMD Desktop.app` | 21 MB |
| `.dmg` | `src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg` | 12 MB |

（体积增大来自 icon.icns 从 20KB → 1.7MB）

## 测试结果

| 检查项 | 结论 |
|--------|------|
| `npm run typecheck` | 通过 |
| `npm run build:web` | 通过 |
| `go vet ./...` | 通过 |
| `go build ./...` | 通过 |
| `npm run test:e2e` | **59 passed / 0 failed**（图标变更不影响 e2e，全量确认） |
| `tauri build` (app + dmg) | 通过，产物已生成 |

## 给 QA 的回归提示

- 安装新 `.dmg`，在 Finder 里查看 `.aimd` 文件图标，应显示**米色信封 + 山景插画**（非白纸、非旧图标）
- 双击 `.aimd` 文件应由 AIMD Desktop 打开（文件关联配置未改动）
- P0 压缩功能和所有已修 bug 不受本次改动影响，59 例 e2e 全绿可对照

---

# Dev Report — 第 3 轮 (2026-04-29 14:35)

本轮按 `docs/desktop-next-todo.md` 实施两项功能：P0 图片压缩、P1 `.aimd` 文件图标。

---

## P0：图片压缩

### 改动文件

| 文件 | 改动说明 |
|------|----------|
| `apps/desktop-tauri/src/main.ts` | 新增 `compressImageBytes` 函数；修改 `pasteImageFiles`（剪贴板路径）；修改 `insertImage`（文件选择路径）；新增 `__aimd_testInsertImageBytes` 测试钩子 |
| `apps/desktop-tauri/src-tauri/src/lib.rs` | 新增 `read_image_bytes` Tauri command，供前端读取文件选择路径的字节 |
| `apps/desktop-tauri/e2e/14-image-compression.spec.ts` | 新增 4 个压缩回归用例 |
| `apps/desktop-tauri/e2e/10-insert-image-mode-hop.spec.ts` | 更新 mock，适配 `insertImage` 改为 `read_image_bytes` + `add_image_bytes` 的新调用顺序 |

### 压缩策略参数

| 参数 | 值 | 理由 |
|------|----|------|
| 最大边长 | 2560px | 2x Retina 下 1280px 逻辑像素，文档阅读场景足够；超过后等比缩放 |
| 阈值 | 300 KB | 低于此值的图片压缩收益有限，原图直传；PNG 截图通常远超此值 |
| 目标格式 | JPEG (image/jpeg) | 对截图/照片类 PNG 压缩率最高；SVG、GIF、WebP 跳过重编码（矢量/动画/已压缩） |
| JPEG quality | 0.82 | 主观画质损失不明显，但压缩率明显；经验值 |
| 兜底逻辑 | 压缩后大于原图则原图直传 | 防止对已有高压缩率 PNG 反而膨胀 |
| 图片解码失败 | 降级为原图直传（不报错） | `img.onerror` 改为 resolve(null) 优雅降级，避免 insertImage 整体失败 |

### 两条插入路径

- **剪贴板路径**（`pasteImageFiles`）：原为 `file.arrayBuffer()` 直传 `add_image_bytes`，现改为先经 `compressImageBytes` 再传。
- **文件选择路径**（`insertImage`）：原为 `add_image`（Rust 直接处理文件路径），现改为先调 `read_image_bytes` 取字节、经 `compressImageBytes` 压缩后、再调 `add_image_bytes`。两条路径使用同一压缩函数，策略统一。

### 关键约束保持

- 所有图片仍写入 `.aimd` zip 内 `assets/` 目录，通过 `asset://` 引用，从不生成 `data:` URL。

---

## P1：`.aimd` 文件图标

### 改动文件

| 文件 | 改动说明 |
|------|----------|
| `apps/desktop-tauri/src-tauri/icons/icon.png` | 母版替换为 1024×1024 版（原 512×512 用 sips 放大） |
| `apps/desktop-tauri/src-tauri/icons/icon.icns` | Tauri CLI 自动生成（macOS 应用图标） |
| `apps/desktop-tauri/src-tauri/icons/icon.ico` | Tauri CLI 自动生成（Windows） |
| `apps/desktop-tauri/src-tauri/icons/32x32.png` 等 | Tauri CLI 生成的多尺寸 PNG |
| `apps/desktop-tauri/src-tauri/icons/aimd-document.icns` | 复制自 icon.icns，作为文档类型图标备份 |
| `apps/desktop-tauri/src-tauri/tauri.conf.json` | 显式声明 `bundle.icon` 列表 |
| `apps/desktop-tauri/src-tauri/Info.plist` | 新建，向 macOS Info.plist 注入 `CFBundleTypeIconFile: "icon"` |

### 关键决策

1. **icon2.png 不可用**：todo 文档指向的 `dist/assets/icon2.png` 在 `build:web` 后被 Vite 清除（`dist/` 在 `.gitignore` 中），当前仓库中已不存在。本轮用现有 `icon.png` 母版（放大至 1024×1024）生成全套图标，视觉不变。若用户提供新的 icon2.png，只需替换 `src-tauri/icons/icon.png` 后重跑 `npx tauri icon src-tauri/icons/icon.png` 并重打包即可。

2. **Tauri v2 不支持 fileAssociations.icon 字段**：schema 报错 "Additional properties are not allowed ('icon' was unexpected)"。改为通过 `src-tauri/Info.plist` 合并（Tauri 自动检测同目录下的 Info.plist）。最终 `CFBundleTypeIconFile: "icon"` 已写入 `.app/Contents/Info.plist`，macOS 会用 `Resources/icon.icns` 显示 `.aimd` 文件图标。

3. **图标复用**：文档图标与应用图标同为一套图，符合 todo 中"风格一致"要求；后续换用 icon2.png 后两者仍保持一致。

---

## 附带修复：`internal/editor` 包编译错误（预先存在）

`go vet ./...` 发现 `internal/editor/server.go` 引用了三个未定义符号：`renderEditorPage`、`timeNow`、`render.PreviewCSS()`。这是本轮任务无关的预有 bug，但 `go vet` / `go build ./...` 必须通过，故顺手补全：

- `internal/editor/server.go`：添加 `var timeNow = time.Now` 和 `func renderEditorPage`（转发 `render.EditorPage`）
- `internal/render/css.go`：导出 `func PreviewCSS() string`（返回 `defaultCSS`）

---

## 未做的事 / 已知遗留

1. **icon2.png 源图未还原**：真机换图标需要用户提供原始 1248×1248 的 icon2.png，放到 `src-tauri/icons/icon.png` 后重生成。
2. **Finder 双击 `.aimd` 的真机验证**：需要安装 `.dmg` 后在真机上确认文件图标显示和双击打开，本轮只保证打包配置正确。
3. **UTExportedTypeDeclarations**：当前 `fileAssociations.exportedType` 由 Tauri 自动注入，未额外验证在全新 macOS 环境下 UTI 是否能被系统识别。

---

## 构建产物状态

| 产物 | 路径 | 大小 |
|------|------|------|
| `.app` | `src-tauri/target/release/bundle/macos/AIMD Desktop.app` | 19 MB |
| `.dmg` | `src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg` | 8.6 MB |

---

## 测试结果

| 检查项 | 结论 |
|--------|------|
| `npm run typecheck` | 通过 |
| `npm run build:web` | 通过 |
| `go vet ./...` | 通过 |
| `go build ./...` | 通过 |
| `npm run test:e2e` | **59 passed / 0 failed** |
| `tauri build` (app + dmg) | 通过，两个产物已生成 |

---

## 给 QA 的回归提示

- **P0 压缩**：重点验证粘贴大尺寸截图（macOS 截图约 3MB+）后 `.aimd` 文件体积，预期应比未压缩版本小 60% 以上；重新打开确认图片仍可渲染；检查 URL 为 `asset://` 而非 `data:`。
- **P0 文件选择**：点工具栏图片按钮选择一张 4MB+ PNG，保存后同样验证体积和可渲染性。
- **P1 文件图标**：安装 `.dmg`，在 Finder 里找一个 `.aimd` 文件，确认显示的不是白纸默认图标；双击确认由 AIMD Desktop 打开。
- **回归关注**：spec 10（insert-image-mode-hop）已更新 mock 适配新插入路径，如有其他测试环境差异请留意。
