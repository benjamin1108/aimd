# QA Report — 第 2 轮 (2026-04-28 后续)

## 摘要

- e2e: **34 passed / 0 failed**（新增 8 例：07/08/09/10）
- typecheck: 干净
- build:web: 干净（dist 36.27 kB JS / 18.10 kB CSS, gzip 11.60 / 4.28）
- go vet ./...: 干净
- go build ./...: 干净
- **P0 阻塞**: 0
- **P1 严重**: 1（新增）
- **P2 一般**: 1（残留 BUG-003，dispatcher 已明确跳过）
- **P3 优化**: 2（残留 BUG-004 + 新增 1）

> 一句话结论：**核心阻塞已解，BUG-001/002/005 修复经回归验证稳健**。新发现 1 个 P1（turndown 表格静默压扁），但属"用户主动粘贴表格 HTML"的触发条件，不阻塞 beta，可作为 ship-prep 期间或下一迭代修复。建议进入 ship-prep（跑 tauri release）。

---

## 第 1 轮 bug 的回归验证

### [BUG-001] 模式互切丢失编辑内容 — **已修，已验证**

- 修复点 1：`apps/desktop-tauri/src/main.ts:749` `applyHTML` 末尾 `state.doc.html = previewEl.innerHTML`。
- 修复点 2：`apps/desktop-tauri/src/main.ts:587` `flushInline` 在 markdown 变化时 `state.doc.html = inlineEditorEl.innerHTML`。
- e2e 验证：
  - `e2e/03-mode-switch-preserves.spec.ts` 3/3 全绿（source→edit、edit→source→edit、dirty 跨模式保持）
  - `e2e/06-outline-and-resizer.spec.ts` 5/5 全绿（含 read/edit/source 三模式 heading id 检查）
- **稳健性审视（dev 没漏的写回路径）**：
  - `insertImageInline`（main.ts:429-446）：直接 DOM 修改后 `dispatchEvent(new Event("input"))` → 700ms debounce → flushInline 写回。**新增 spec `e2e/10-insert-image-mode-hop.spec.ts` 两例验证**：插入图片后立即切 source 或立即按 ⌘S，asset 都正确进 markdown，没有 700ms debounce 竞态丢失。
  - `runFormatCommand`（main.ts:614-636）：所有分支 switch 之后兜底 `dispatchEvent("input")` → 同上路径。`wrapSelectionInTag`（行内 code）虽然不自己 dispatch，但被 runFormatCommand 兜底。
  - 键盘快捷键 ⌘B/⌘I/⌘K（main.ts:560-565）：均走 `runFormatCommand` → 同上。
  - source 模式 textarea 输入：同步写 `state.doc.markdown`，不触发 applyHTML（debounced render 走 applyHTML 时再回写 html）。即使用户 220ms 内按 ⌘S，saveDocument 用最新 markdown 调后端，返回的 doc 重新覆盖 html，无丢失。
  - **结论**：闭环完整，无漏洞。

### [BUG-002] 大纲在编辑模式下无法定位 — **已修，已验证**

- e2e `e2e/06-outline-and-resizer.spec.ts:57` 三个 mode 子测试全绿。
- 与 BUG-001 共根因，BUG-001 修复同时绿掉。

### [BUG-005] paste sanitize 漏 iframe / object / embed — **已修，已验证**

- 修复点：`apps/desktop-tauri/src/main.ts:536-540`（remove iframe/object/embed/frame/frameset；strip `a[href^="javascript:"]` 的 href）。
- **新增 spec `e2e/08-paste-sanitize.spec.ts`** 用真实 ClipboardEvent 把恶意 payload 投进 inline editor，断言：
  - 5 个危险 tag 全部从 live DOM 中消失（iframe / object / embed / frame / frameset / script / style）
  - `<script>window.__pwned=true</script>` 没有执行
  - `a[href="javascript:..."]` 的 href 被剥掉
  - `https://example.com` 这种正常链接保留
  - 内联 style/class/onclick/data-* 被脱掉
- 第二例验证 plaintext-only 粘贴依然工作。

---

## P1（严重）

### [BUG-006] turndown 默认配置在 inline editor 中静默压扁表格、丢任务列表 checkbox

- **位置**: `apps/desktop-tauri/src/main.ts:84-107`（`new TurndownService(...)` 没装 `turndown-plugin-gfm`）。
- **发现方式**: 静态走查 + 本地 node 复现：
  ```
  TABLE --> "A\n\nB\n\n1\n\n2"      // <table><tr><th>A</th><th>B</th>... 被拆成裸段落
  TASK  --> "-    task one\n-    task two"  // <input type="checkbox"> 被丢
  ```
  （我用项目内 `turndown@7.2.4` 跑了一份最小复现脚本，已删除。）
- **重现路径**:
  1. 用户从浏览器/Notion 复制一份带表格或任务列表的 HTML
  2. 粘贴进 inline editor（sanitize 不会移除 `<table>`/`<input type=checkbox>`，是合法白名单 tag）
  3. 切 source / 按 ⌘S → `flushInline` 调 turndown
  4. **表格被压成 4 个裸段落**；任务列表的 checkbox 被丢，只剩文本 list；保存后磁盘上是降级版本，Reopen 也不会恢复。
- **影响**:
  - Goldmark 渲染端启用了 `extension.GFM`（`internal/render/html.go:33`），所以从 markdown 出发的方向 OK；但 inline editor 是 HTML→markdown 方向，turndown 是单向劣化点。
  - 不是高频路径（toolbar 没有插表格按钮，只能粘贴触发），但一旦命中是**静默数据降级**，用户看不到警告。
- **建议根因 / 修法**:
  - 加依赖 `turndown-plugin-gfm`，`turndown.use(gfm)` 即可同时支持表格 + 任务列表 + 删除线（删除线现有手写规则可保留）。
  - 或者保守做法：在 `flushInline` 检测到 `inlineEditorEl.querySelector("table, input[type=checkbox]")` 时，弹一个 status warn "本编辑器暂不支持表格 / 任务列表的双向编辑，建议在源码模式编辑"，且**不回写 markdown** 避免覆盖。
- **e2e 缺口**: 本轮没补 spec，因为加 spec 等于先固化错误行为；建议 dev 修后再加。

---

## P2（一般）

### [BUG-003] Tauri 后端 `Save` 全量重写所有资源

- 状态：**残留**，dispatcher 第 1 轮明确跳过。
- 第 2 轮无新增证据。本轮 e2e 用小文档跑都 < 100ms，未触发卡顿；ship-prep 期建议手动用 10MB+ 嵌入资源的 .aimd 验证一次，必要时加 `aimd.Rewrite` 的 markdown-only 快路径。

---

## P3（优化 / 代码味道）

### [BUG-004] `applyHTML` 副作用过重 — **残留**

- dispatcher 第 1 轮明确跳过。本轮新增 8 例 e2e 没观察到任何 contenteditable 抖动，dev 第 1 轮回写 `state.doc.html` 已经把最大副作用收敛掉。继续观察。

### [BUG-007] 极小窗口（< 760px）侧栏隐藏后无入口打开新文件（新增）

- **位置**: `apps/desktop-tauri/src/styles.css:1167-1172`（`@media (max-width: 760px) { .sidebar { display: none } }`）+ `apps/desktop-tauri/src/main.ts` 顶栏没有"打开"按钮。
- **现象**: 已打开文档后把窗口缩到 < 760px，整个侧栏消失，**没有任何 UI 路径打开新文件**（empty-state 已被 `hidden`，⌘O 快捷键还能用但无视觉提示）。
- **支撑**: `e2e/07-narrow-viewport.spec.ts` 三例全绿，确认 sidebar 在 600px 下 `display: none`、panel grid 单列、preview pane 在 880px 下隐藏。layout 本身不破，但缺一个"打开"入口。
- **建议**: 顶栏 `head-actions` 里在 < 760px 显式添加一个 `${ICONS.folder}` icon-btn，点击触发 `chooseAndOpen`。
- **严重度**: P3，因为 ⌘O 仍可用，且桌面 .app 默认初始窗口宽度通常 ≥ 1000px。

---

## 静态走查（本轮新看的）

### `apps/desktop-tauri/src-tauri/src/lib.rs`（Rust 命令路由）

- **错误处理**：`run_aimd` 在 sidecar 非零退出时返回 `format!("AIMD sidecar failed with status {} ...{stderr}")`，错误冒泡到 invoke → 前端 `await invoke<...>` 抛 JS 异常。**前端目前没有 try/catch**（main.ts:373 `state.doc = await invoke(...)`），sidecar 崩溃会让 UI 卡在 "正在打开" 状态。属低概率（sidecar 自身基本不会崩），但 ship-prep 前可加一行 try/catch + setStatus("打开失败", "error")。**记 P3 留观察**，本轮不单列。
- `aimd_binary`：先看 `AIMD_CLI` 环境变量 → resource_dir → 仓库 fallback → PATH。**多层兜底足够稳健**。
- `RunEvent::Opened` URL 处理：合法 file:// 才入队，扩展名校验是 `.aimd`。✅
- macos_file_association 模块：`LSRegisterURL` / `LSSetDefaultRoleHandlerForContentType` 的非零状态码会被打印到 stderr 但**不会向用户报错**——这是合理的（首次启动注册失败，下次启动重试）。
- `initial_open_path` 同时支持 `argv` 和 `PendingOpenPaths`，避免冷启动 vs 已运行实例的双路径竞态。✅

### turndown 配置（重看一遍）

- 新发现 BUG-006（见 P1）。其他规则：strikethrough 手写正则 OK；`aimdImage` 在 `data-asset-id` 存在时正确生成 `asset://` markdown。
- **小观察**：`htmlToMarkdown` 的 `replace(/\n{3,}/g, "\n\n")` 把 3+ 空行折叠到 2，但 GFM 表格/代码块用空行作为块边界，没有 GFM 插件的话 turndown 输出本身就乱了，这一行的副作用只在没有表格的场景生效。修 BUG-006 时一并 review。

### 中文文件名 / 路径含空格

- Go 端：`internal/desktop/desktop.go` 全部用 `filepath` 标准库（Abs/Base/Ext），Go 对 unicode/空格透明。`isImageFilename` 用 `strings.ToLower(filepath.Ext)`，安全。
- Rust 端：`path.to_string_lossy().to_string()` 在 macOS APFS（强制 UTF-8）下不会损失。
- 文件对话框 `rfd::FileDialog`：跨平台对 unicode 路径已知支持。
- **结论**：静态推断通过；e2e 不能驱真实 NSOpenPanel，留 ship-prep 手动验证一次（在 `~/Documents/含 空格 的目录/中文.aimd` 路径打开/保存一次）。

---

## Beta 清单

> `[x]` e2e 覆盖且通过；`[~]` 静态推断通过；`[ ]` 未通过/未覆盖。

### 核心功能

- [ ] 双击 `.aimd` 文件打开（macOS file association）— ship-prep 手动
- [~] 通过 `⌘O` 打开
- [x] 通过侧栏底部"打开 AIMD 文件"按钮打开
- [x] 阅读模式正确渲染 markdown
- [x] 编辑模式（inline WYSIWYG）所有工具栏按钮可用：
  - [x] 粗体 / 斜体 / 删除线
  - [x] H1 / H2 / H3 / 正文
  - [x] 无序列表 / 有序列表 / 引用
  - [x] 行内代码 / 链接
  - [~] 插入图片（toolbar 路径 `e2e/10-insert-image-mode-hop.spec.ts` 已覆盖；真实 file dialog 仍需手动）
- [x] 源码模式 textarea + 实时预览同步
- [x] **三种模式互相切换不丢数据**（BUG-001 修复）
- [x] `⌘S` 保存（`e2e/05-asset-roundtrip.spec.ts:106` 间接覆盖；`e2e/10-…:93` 直接验证 invoke 收到正确 markdown）
- [~] 保存后 dirty 标记复位
- [x] 插入图片正确写入 `asset://` 引用（`e2e/10-…:69`）
- [x] 保存后再打开，图片仍是 `asset://` 引用

### 侧栏

- [x] 大纲自动从渲染态提取
- [x] **大纲点击在阅读 / 编辑 / 源码模式下都能滚动到对应标题**（BUG-002 修复）
- [~] 资源段显示嵌入图片缩略图
- [x] 文档↔大纲、大纲↔资源 之间的拖动手柄可用
- [x] 双击拖动手柄复位

### 状态与反馈

- [x] 状态指示器在 idle / loading / success / warn / info 下颜色正确
- [x] dirty 状态在 doc-card 和 status pill 同步显示
- [~] 文档标题、路径、未保存指示器一致

### 健壮性

- [~] 中文 IME 输入正常（`e2e/09-ime-composition.spec.ts` 用合成 `compositionstart/update/end` 验证不丢字、最终文本写回 markdown；**真实拼音/五笔候选仍需 macOS 手动验证**，Playwright 不能模拟 IME 候选窗）
- [~] 路径含空格 / 中文 正常打开保存（静态推断通过；ship-prep 手动）
- [ ] 大文件（10MB+ 嵌入资源）打开不卡死（BUG-003 关注，ship-prep 手动）
- [x] **极小窗口（< 760px）布局不破**（`e2e/07-narrow-viewport.spec.ts` 3/3 绿，layout 本身合规；BUG-007 仅是缺打开入口，不属"破")
- [~] 极宽窗口（4K）阅读区域有合理 max-width（`.reader { max-width: 880px }` 静态通过）
- [x] **粘贴恶意 HTML 被 sanitize**（`e2e/08-paste-sanitize.spec.ts` 2/2 绿，BUG-005 修复验证）

### 构建与打包

- [x] `npm run typecheck` 干净
- [x] `npm run build:web` 干净
- [x] `go vet ./...` 干净
- [x] `go build ./...` 干净
- [x] **`npm run test:e2e` 全绿（34/34）**
- [ ] `npm run build`（tauri release）产出可启动的 .app 与 .dmg — ship-prep 阶段执行
- [ ] .dmg 拖入 /Applications 后可冷启动 — ship-prep 阶段执行

---

## 本轮新增 vs 上轮残留

- **新发现**:
  - BUG-006 (P1) — turndown 无 GFM 插件，表格/任务列表静默劣化
  - BUG-007 (P3) — < 760px 极小窗口缺打开入口
- **已修 + 通过新 e2e 验证**:
  - BUG-001 (P0) — 编辑/源码/阅读三模式互切数据保留 ✅（3 例）
  - BUG-002 (P1) — 编辑模式大纲跳转 ✅（5 例）
  - BUG-005 (P3) — 粘贴 sanitize iframe/javascript: ✅（2 例真实 ClipboardEvent）
- **仍残留（dispatcher 已知跳过，不重报）**:
  - BUG-003 (P2) — Save 全量 rewrite，ship-prep 手动验大文件
  - BUG-004 (P3) — applyHTML 副作用，无可观察症状继续观察
- **新增 e2e 覆盖**:
  - `e2e/07-narrow-viewport.spec.ts` (3 例) — 600px 侧栏隐藏 + 单列 + 880px preview pane 隐藏
  - `e2e/08-paste-sanitize.spec.ts` (2 例) — 真实 ClipboardEvent 投递恶意 payload + 纯文本 fallback
  - `e2e/09-ime-composition.spec.ts` (1 例) — 合成 IME compositionstart/update/end 序列
  - `e2e/10-insert-image-mode-hop.spec.ts` (2 例) — 插图后 700ms debounce 内立即切模式 / 立即 ⌘S 都不丢 asset

---

## 第 2 轮总结（给 dispatcher）

1. **BUG-001/002/005 三项修复经回归 + 新增 spec 验证稳健**：BUG-001 的写回闭环（applyHTML 末尾 + flushInline 中段）已经覆盖了所有可能改 inline editor DOM 的路径——格式工具栏、键盘快捷键、insertImageInline 都被 `dispatchEvent("input")` 串起来，`setMode`/`saveDocument` 离开 edit 时同步 flush 兜底。10-insert-image-mode-hop spec 直接打中"700ms debounce 内立即切模式"这个最尖锐的窗口，全绿。
2. **新发现 1 个 P1（turndown 表格/任务列表静默劣化）**：触发条件需要"用户从外部粘贴 HTML 表格"，不阻塞 beta 但属真实数据丢失风险，建议下一迭代加 `turndown-plugin-gfm`。1 个 P3（极小窗口缺打开入口），无关紧要。
3. **建议进入 ship-prep（跑 `npm run build` / tauri release）**：26→34 e2e 全绿，typecheck/build:web/go vet/go build 全部干净，残留的 P2/P3 都是 dispatcher 已知跳过项；剩下 5 项 ship-prep 必做（双击文件关联、⌘O 真实 dialog、含空格/中文路径、10MB+ 大文件、tauri 打包+冷启动）只能在签名/打包后手动验证。
