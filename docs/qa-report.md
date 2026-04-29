# QA 报告 — 第 5 轮 (2026-04-29)

> 本轮触发原因：用户报告四个新 bug（行内代码按钮嵌套+光标飞出、链接按钮无反应回归、H1/H2/H3 Enter 不分割文本、工具栏无 hover 提示）。
> 沿用 BUG 编号从 BUG-012 起。

---

## 摘要

- e2e: **172 passed / 4 failed**（新增 spec 27/28/29，其中 4 个用例稳定复现 bug）
- typecheck: PASS
- build:web: PASS（60.97 kB JS / 23.16 kB CSS）
- go vet: PASS
- go build: PASS
- **P0 阻塞: 0 | P1 严重: 3 | P2 一般: 1 | P3 优化: 0**

---

## P1（严重——影响核心编辑流程）

### [BUG-012] 行内代码按钮 toggle 逻辑错误，重复点击产生多层嵌套 `<code>`

- **位置**: `apps/desktop-tauri/src/main.ts:1430–1451`（`wrapSelectionInTag` 函数）
- **发现方式**: e2e spec `e2e/27-inline-code-toggle.spec.ts`，2 个用例稳定失败
- **严重度**: P1（行内代码是常用格式，嵌套导致字体渐变缩小，视觉异常明显）
- **现象**:
  - 第 1 次点击 `<>` 按钮：选中文字被包裹为 `<code>`，正常
  - 第 2 次点击（预期 unwrap）：产生 `<code><code>...</code></code>` 双层嵌套，字体进一步缩小
  - 连续点击 5 次后：存在多层嵌套，e2e 断言 `code code count = 1`（期望 `0`），失败
  - 完整往返测试（wrap -> unwrap）：unwrap 后 `code` 数量为 `2`（期望 `0`），失败
  - 截图路径：
    - `test-results/27-inline-code-toggle-Bug--66c26-按钮-5-次：不出现-code-嵌套，光标始终在编辑区-chromium/test-failed-1.png`
    - `test-results/27-inline-code-toggle-Bug--26ebc-ap、第-2-次-unwrap，最终无-code-残留-chromium/test-failed-1.png`
- **复现步骤**:
  1. 打开文档，进入编辑模式
  2. 选中一段文字
  3. 点击工具栏 `<>` 按钮（行内代码）→ 文字变为 `<code>` 格式
  4. 再次选中 code 内文字，再点 `<>` 按钮
  5. 观察：文字没有 unwrap，反而多了一层 `<code>`，字体变得更小
  6. 连续重复步骤 4-5，字体持续缩小
- **根因（精确代码位置）**:

  ```typescript
  // apps/desktop-tauri/src/main.ts:1430-1451
  function wrapSelectionInTag(tag: string) {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    // unwrap 检测：只检查 range.commonAncestorContainer.parentElement
    const parent = range.commonAncestorContainer.parentElement;
    if (parent && parent.tagName.toLowerCase() === tag) {
      // ← 这个检测在以下情况下失效：
      //   当用户重新选中整个 <code> 元素内的内容时，
      //   range.commonAncestorContainer 可能是 <code> 元素本身（而非其文字子节点），
      //   此时 .parentElement 是 <code> 的父节点（如 <p>），
      //   tagName 检测失败 → 进入 wrap 分支 → 再套一层 <code>
      const text = parent.textContent || "";
      parent.replaceWith(document.createTextNode(text));
      return;
    }
    const wrapper = document.createElement(tag);
    try {
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* ignore selection errors */   // ← 光标飞出后静默忽略，不恢复焦点
    }
  }
  ```

  具体问题：
  1. **unwrap 检测逻辑不健壮**：`range.commonAncestorContainer` 在用户全选 `<code>` 内容时，会是 `<code>` 元素本身（类型 `ELEMENT_NODE`），导致 `.parentElement` 拿到的是 `<p>` 而非 `<code>`，`tagName` 不匹配，直接进 wrap 路径，再套一层。
  2. **catch 块静默吞错误**：`extractContents` 或 `insertNode` 失败时，光标可能飞出编辑区，`catch { /* ignore */ }` 不做 `inlineEditorEl.focus()` 兜底。
- **建议修复方向**:
  - unwrap 检测应同时考虑 `commonAncestorContainer` 本身是否是目标 tag：
    ```typescript
    const container = range.commonAncestorContainer;
    const parent = container.nodeType === Node.ELEMENT_NODE
      ? container as HTMLElement
      : (container as Node).parentElement;
    if (parent && parent.tagName.toLowerCase() === tag) { /* unwrap */ }
    ```
  - catch 块改为 `catch { inlineEditorEl.focus(); }` 确保焦点回到编辑区
- **关联 e2e**: `e2e/27-inline-code-toggle.spec.ts`（2/3 用例失败）

---

### [BUG-013] 链接按钮在 Tauri/WKWebView 下完全无响应（`window.prompt` 被静默吞掉）

- **位置**: `apps/desktop-tauri/src/main.ts:1296`（`runFormatCommand` link case）
- **发现方式**: 用户实测 + 静态代码走查（与同文件第 1705-1706 行注释的已知问题一致）
- **严重度**: P1（链接功能在真实 Tauri 应用里完全不工作）
- **现象**:
  - 在 Tauri macOS 应用（WKWebView）内，点击工具栏链接按钮（`<>`旁的链条图标），**完全没有任何视觉反馈**——既不弹 prompt，也不创建链接
  - Playwright Chromium e2e（`e2e/28-link-button-regression.spec.ts`）4/4 用例全部通过，说明在 Chromium 里按钮逻辑正确，但 Tauri WebView 环境下行为不同
  - 对比：同一个文件第 1705 行已有注释："Tauri 2 webview 默认吞掉 `window.confirm()`（无 UI、悄悄返回 false）"，链接按钮使用的 `window.prompt()` 同样受此影响
- **根因（精确代码位置）**:

  ```typescript
  // apps/desktop-tauri/src/main.ts:1296
  const url = window.prompt("链接地址（http/https）", "https://");
  ```

  Tauri 2 的 WKWebView（macOS）和 WebView2（Windows）默认屏蔽了 `window.alert()`、`window.confirm()`、`window.prompt()` 等浏览器原生对话框。调用 `window.prompt()` 时：
  - 不弹出任何 UI
  - 立即同步返回 `null`
  - `if (url && url.trim())` 判断为 `false`，整个链接创建逻辑被跳过
  - 用户看到"点击没有任何反应"

  代码中 `ensureCanDiscardChanges` 函数（第 1708 行）已经意识到这个问题并用 `invoke("confirm_discard_changes")` 走 Rust 原生对话框来绕过。链接按钮是遗漏的同类问题。
- **复现步骤**（需真实 Tauri 应用）:
  1. 启动 AIMD Desktop（macOS Tauri 版本）
  2. 打开任意文档，进入编辑模式
  3. 选中一段文字
  4. 点击工具栏"链接"按钮
  5. 观察：**无任何反应**（无 prompt，无链接，无错误）
- **建议修复方向**:
  - 方案 A（快速）：用自定义内联输入浮层替代 `window.prompt()`，避免依赖被 WebView 屏蔽的原生对话框。参照 launchpad 已有的模态 UI 模式实现一个轻量链接输入框。
  - 方案 B（与 `confirm_discard_changes` 对齐）：在 Rust 侧新增 `prompt_link_url` 命令，通过 Tauri 的 dialog 插件弹出原生输入框，JS 端通过 `invoke` 调用。
  - 方案 C（应急）：如果 Tauri 配置允许，在 `tauri.conf.json` 的 `security.capabilities` 里重新启用 `window.prompt`（Tauri 2 某些版本可通过配置恢复）
- **关联 e2e**:
  - `e2e/24-link-button-bug.spec.ts`（Chromium 下 4/4 通过）
  - `e2e/28-link-button-regression.spec.ts`（Chromium 下 4/4 通过；Tauri WebView 无法用 Chromium e2e 覆盖）

---

### [BUG-014] H1/H2/H3 中间按 Enter 不分割文本，光标后内容留在 heading 内

- **位置**: `apps/desktop-tauri/src/main.ts:1161–1177`（`onInlineKeydown` 函数的 Enter 处理）
- **发现方式**: e2e spec `e2e/29-heading-enter-split.spec.ts`，2 个用例稳定失败
- **严重度**: P1（基础编辑操作，用户在 heading 中间按 Enter 期望分段，但内容没有分割）
- **现象**:
  - 在 H1 "Hello World" 中，把光标放在 "World" 之前，按 Enter
  - **期望**：H1 = "Hello "，新段落 `<p>` = "World"
  - **实际（bug）**：H1 仍然 = "Hello World"，新段落是空的（只有 `<br>`），"World" 留在 H1 内
  - e2e 失败错误：`H1 不应包含 "World"，当前 H1 文本："Hello World"`
  - H2/H3 同样受影响（测试确认）
  - 截图路径：`test-results/29-heading-enter-split-Bug-67ba2-Enter：光标前内容留在-H1，光标后内容移到新-p-chromium/test-failed-1.png`（截图可见：H1 完整，下方是空段落，光标在空段落里）
- **复现步骤**:
  1. 打开文档，进入编辑模式
  2. 确保编辑区有一个 H1 标题，如 "Hello World"
  3. 把光标放到 "World" 之前（即 H1 文字中间）
  4. 按 Enter
  5. 观察：H1 仍然是 "Hello World"，其后新增了一个空段落，而 "World" 没有被移到新段落
- **根因（精确代码位置）**:

  ```typescript
  // apps/desktop-tauri/src/main.ts:1161-1177
  function onInlineKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const block = closestBlock(range.startContainer);
        if (block && /^H[1-6]$/.test(block.tagName)) {
          event.preventDefault();
          const p = document.createElement("p");
          p.appendChild(document.createElement("br")); // ← 新段落直接是空的
          block.after(p);                              // ← 插到 heading 后面
          // ↑↑↑ 完全没有提取 range 后面的内容！
          // 光标在 heading 中间时，range 后的文字（"World"）仍留在 heading 内。
          // 正确做法：
          //   1. range.extractContents() 提取光标到 heading 末尾的内容
          //   2. 将提取的内容放入新的 <p>
          const r = document.createRange();
          r.setStart(p, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          inlineEditorEl.dispatchEvent(new Event("input"));
        }
      }
    }
  ```

  关键缺失：代码在 `event.preventDefault()` 之后直接创建空 `<p>`，没有用 `range.setEnd(block, block.childNodes.length)` 扩展 range 到 heading 末尾，然后 `range.extractContents()` 把光标后的内容移入新段落。
- **建议修复方向**:

  ```typescript
  // 伪代码——提取光标到 heading 末尾的内容
  event.preventDefault();
  // 1. 扩展 range 到 heading 末尾，提取光标后的内容
  const afterRange = range.cloneRange();
  afterRange.setEnd(block, block.childNodes.length);
  const fragment = afterRange.extractContents();
  // 2. 创建新段落，把提取到的内容放进去
  const p = document.createElement("p");
  if (fragment.textContent) {
    p.appendChild(fragment);
  } else {
    p.appendChild(document.createElement("br")); // 末尾 Enter 时 fragment 为空
  }
  block.after(p);
  // 3. 光标移到新段落开头
  const r = document.createRange();
  r.setStart(p, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  inlineEditorEl.dispatchEvent(new Event("input"));
  ```
- **关联 e2e**: `e2e/29-heading-enter-split.spec.ts`（4 个用例中 2 个失败：H1 中间和 H2 中间；末尾和开头行为合理通过）

---

## P2（一般——影响体验但不阻断流程）

### [BUG-015] 工具栏按钮的 `title` tooltip 在 Tauri WebView 下不显示

- **位置**: `apps/desktop-tauri/src/main.ts:276–297`（工具栏按钮 HTML），`apps/desktop-tauri/src/styles.css:1300–1318`（`.ft-btn` 样式）
- **发现方式**: 静态代码走查 + 用户反馈
- **严重度**: P2（tooltip 缺失不阻断操作，但影响可发现性，对新用户尤其明显）
- **现象**:
  - 鼠标悬浮在工具栏按钮上：
    - **CSS hover 效果**：存在（`.ft-btn:hover:not(:disabled)` 定义了背景色 + 阴影，代码第 1314 行）
    - **原生 tooltip**：所有按钮都有 `title=""` 属性（如 `title="粗体 (⌘B)"`），但在 Tauri WebView（WKWebView/WebView2）里，浏览器不渲染 `title` attribute 产生的悬浮提示框
  - 用户看到 hover 时按钮背景变亮，但无文字说明（不知道按钮功能）
- **技术背景**:
  - 原生浏览器（Chrome/Firefox/Safari）会在元素有 `title` 属性时，悬停约 500ms 后显示浏览器内置 tooltip。Tauri 的 WebView 嵌入模式下，这个 tooltip 渲染由宿主 OS 控制，在 macOS WKWebView 里通常**不显示**。
  - 这不是代码 bug，而是 WebView 平台限制。
- **已有状态**:
  - 所有 11 个工具栏按钮均已有 `title` 属性（覆盖完整）
  - CSS hover 状态已定义（背景 + 阴影 + 颜色变化）
  - 缺少的是在 WebView 内可见的自定义 tooltip（CSS/JS 实现）
- **建议修复方向**:
  - 方案 A：用 CSS `::after` + `attr(title)` 实现纯 CSS tooltip，鼠标悬停延迟显示
  - 方案 B：用 JS 监听 `mouseenter`/`mouseleave`，动态创建 tooltip DOM 节点
  - 无需修改按钮 HTML（`title` 属性已齐全，可供 JS/CSS 读取）
- **关联 e2e**: 无（tooltip 显示为纯视觉，需手动验证或截图对比）

---

## Beta 清单更新

（在第 4 轮基础上更新）

| 状态 | 项目 |
|------|------|
| [ ] | 双击 `.aimd` 文件打开（macOS file association）— 手动 |
| [~] | 通过 `⌘O` 打开 |
| [x] | 通过侧栏底部"打开 AIMD 文件"按钮打开 |
| [x] | 阅读模式正确渲染 markdown |
| [x] | 粗体 / 斜体 / 删除线 |
| [x] | H1 / H2 / H3 / 正文（切换） |
| [x] | 无序列表 / 有序列表 / 引用 |
| [ ] | **行内代码 `<>` 按钮** — BUG-012 (P1)，重复点击产生嵌套 `<code>`，e2e 稳定失败 |
| [ ] | **链接按钮** — BUG-013 (P1)，WKWebView 下 `window.prompt` 被屏蔽，点击无任何反应 |
| [ ] | **H1/H2/H3 内按 Enter 分段** — BUG-014 (P1)，光标后内容不分割，e2e 稳定失败 |
| [x] | 源码模式 textarea + 实时预览同步 |
| [x] | 三种模式互相切换不丢数据 |
| [x] | `⌘S` 保存 |
| [~] | 保存后 dirty 标记复位 |
| [x] | 插入图片正确写入 `asset://` 引用 |
| [x] | 大纲自动从渲染态提取 |
| [x] | 大纲点击滚动到对应标题 |
| [~] | 资源段显示嵌入图片缩略图 |
| [x] | 文档↔大纲、大纲↔资源 之间的拖动手柄可用 |
| [x] | 状态指示器颜色正确 |
| [x] | dirty 状态同步显示 |
| [~] | 中文 IME 输入正常 |
| [~] | 路径含空格 / 中文 正常打开保存 |
| [ ] | 大文件（10MB+）打开不卡死 |
| [x] | 极小窗口（< 760px）布局不破 |
| [x] | 粘贴恶意 HTML 被 sanitize |
| [x] | typecheck 干净 |
| [x] | build:web 干净 |
| [x] | go vet 干净 |
| [x] | go build 干净 |
| [ ] | **工具栏按钮 tooltip 可见** — BUG-015 (P2)，WKWebView 不渲染 `title` 属性浮窗 |
| [ ] | **新建文档后编辑器自动获得焦点** — BUG-008 (P1)（上轮残留）|
| [ ] | .dmg 拖入 /Applications 后可冷启动 — 手动 |

---

## 本轮新增 vs 上轮残留

- **新增**: BUG-012 (P1), BUG-013 (P1), BUG-014 (P1), BUG-015 (P2)
- **已修复**: 无（本轮为排查，未修 bug）
- **仍残留（上轮）**: BUG-008 (P1，新建文档焦点问题）
- **上轮 BUG-009 状态说明**: 用户本轮反馈链接按钮"点击没有任何反应"——比 BUG-009 描述的"selection 丢失"更严重。经查，根因是 `window.prompt` 在 WKWebView 下被完全屏蔽（静默返回 null），BUG-009 的 `cloneRange` 修复方案仍然正确但不够——即使恢复了 selection，prompt 根本不弹出，createLink 永远不执行。本轮登记为 BUG-013，建议同时处理。
- **新增 e2e 覆盖**:
  - `e2e/27-inline-code-toggle.spec.ts` — 行内代码嵌套 + toggle（2/3 用例失败，复现 BUG-012）
  - `e2e/28-link-button-regression.spec.ts` — 链接按钮 prompt 触发回归（Chromium 下 4/4 通过，确认 Chromium 无问题；Tauri 特定问题需真机验证）
  - `e2e/29-heading-enter-split.spec.ts` — H1/H2/H3 Enter 分割文本（2/4 用例失败，复现 BUG-014）

---

## e2e 结果汇总

```
172 passed / 4 failed（1 worker，约 2.8 分钟）

失败列表：

[FAIL] e2e/27-inline-code-toggle.spec.ts:124 — 连续点击 code 按钮 5 次：不出现 code 嵌套，光标始终在编辑区
       Error: expect(1).toBe(0)  — 第 2 次点击后出现 code code 嵌套

[FAIL] e2e/27-inline-code-toggle.spec.ts:163 — 第 1 次 wrap、第 2 次 unwrap，最终无 code 残留
       Error: expect(2).toBe(0)  — 点 2 次后仍有 2 个 code 标签（应为 0）

[FAIL] e2e/29-heading-enter-split.spec.ts:91 — H1 中间按 Enter：光标前内容留在 H1，光标后内容移到新 p
       Error: H1 不应包含 "World"，当前 H1 文本："Hello World"

[FAIL] e2e/29-heading-enter-split.spec.ts:175 — H2 中间按 Enter：文本被分割到新段落
       Error: H2 不应包含 "Heading"，当前："Second Heading"
```

---

## 静态检查结果

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | PASS |
| `npm run build:web` | PASS（vite 131ms，60.97 kB JS）|
| `go vet ./...` | PASS（无输出）|
| `go build ./...` | PASS（无输出）|

---

## Bug 根因速查表

| BUG | 文件:行 | 类型 | e2e 状态 |
|-----|---------|------|---------|
| BUG-012 | `main.ts:1435` `wrapSelectionInTag` | `commonAncestorContainer` 判断不含 ELEMENT_NODE 的自身检测 | 2 用例红 |
| BUG-013 | `main.ts:1296` `window.prompt(...)` | WKWebView 屏蔽原生 dialog，调用静默返回 null | Chromium 绿，Tauri 无法 e2e |
| BUG-014 | `main.ts:1168-1170` heading Enter handler | 没有 `range.extractContents()` 提取光标后内容，直接插空 `<p>` | 2 用例红 |
| BUG-015 | `main.ts:276-297` `title` 属性 | WKWebView 不渲染 `title` 浮窗，需自定义 CSS/JS tooltip | 纯视觉，无 e2e |
