# /goal: 全局选择边界与 Ctrl+A 行为发布级修复

## 背景

AIMD Desktop 当前在多个界面存在选择边界错误：用户按 `Ctrl+A` / `Cmd+A` 时，浏览器默认行为会把菜单、目录、工具栏、侧栏、图标、tab、按钮文案等非正文 UI 一起选中。用户实际反馈是：

```text
在很多界面我只要 ctrl+a 全选，把菜单，目录图条啥全部都选中了
```

这不是单个页面的小问题，而是桌面应用没有定义“可选择内容区域”和“不可选择 chrome 区域”的全局规则。发布态必须让选择行为符合原生桌面编辑器预期：

- 在正文编辑区按 `Ctrl+A` / `Cmd+A`：只选中当前编辑器内容。
- 在源码 textarea 按 `Ctrl+A` / `Cmd+A`：只选中源码内容。
- 在输入框、搜索框、设置表单按 `Ctrl+A` / `Cmd+A`：只选中该控件文本。
- 在阅读区按 `Ctrl+A` / `Cmd+A`：只选中文档正文，不选中工具栏、目录、菜单、workspace、Git 面板。
- 在菜单、工具栏、侧栏、目录、状态栏、弹窗按钮、图标区误触 `Ctrl+A` / `Cmd+A`：不能全页面选中 UI chrome。

## 产品目标

完成 AIMD 的选择边界发布级硬化：

1. 建立统一选择策略：文档正文和编辑控件可选，应用 chrome 默认不可选。
2. 建立统一 `Ctrl+A` / `Cmd+A` 键盘策略：根据当前焦点和当前模式选择正确区域。
3. 消除全页面 selection 泄漏，防止菜单、目录、工具栏、按钮、图标、tab、状态栏被选中。
4. 保留必要的文本复制能力：阅读正文、源码、debug 日志、Git diff、表单输入仍可复制。
5. 覆盖主窗口、设置页、Git 面板、workspace、outline、菜单、弹窗等核心界面。
6. 使用 E2E 回归测试证明 `Ctrl+A` 不会选中 UI chrome。

## 非目标

- 不禁止用户选择正文、源码、Git diff、debug 日志等真实内容。
- 不改变文档 Markdown 模型和 `.aimd` 文件格式。
- 不重做编辑器架构。
- 不用简单粗暴的 `body { user-select: none; }` 破坏正文复制。
- 不只修当前能复现的一个页面；必须定义可扩展规则。

## 选择语义

### 可选择区域

以下区域允许文本选择：

- `#reader` 和阅读模式中的文档正文。
- `#inline-editor` 和编辑模式中的 contenteditable 内容。
- `#markdown` 源码 textarea。
- Git diff 内容区。
- debug console 日志内容。
- 普通 `input`、`textarea`、`select` 内部文本。
- 明确标记为可复制的诊断详情、错误详情、路径、命令输出。

### 不可选择区域

以下区域默认不可选择：

- 顶部工具栏、格式工具栏、菜单按钮。
- workspace 文件树 chrome。
- outline / Git tab / sidebar tab。
- 文档标题栏、状态栏、模式切换按钮。
- 图标、按钮、pill、badge、toolbar label。
- 弹窗按钮、菜单项、上下文菜单、lightbox chrome。
- 设置页导航、section header、普通按钮、开关控件。

### Ctrl+A / Cmd+A 行为

规则必须显式实现，而不是依赖浏览器默认全页面选择：

- 焦点在 `input` / `textarea` / `select`：保留浏览器原生控件内全选。
- 焦点在 `#inline-editor` 或 selection 位于 inline editor 内：全选 inline editor 内容。
- 焦点在 `#markdown`：全选源码 textarea。
- 当前模式为阅读模式且焦点不在表单控件：全选 `#reader` 内文档正文。
- 当前模式为编辑模式且焦点不在表单控件：全选 `#inline-editor` 内容。
- 当前模式为源码模式且焦点不在表单控件：全选 `#markdown` 内容。
- 设置页中焦点不在输入控件时：不要全页面选中；可以无操作或按当前 panel 的主内容区域策略处理。
- Debug console / Git diff 这类内容视图中，若焦点在内容区，`Ctrl+A` 只选中该内容区。

## 实现要求

### 1. CSS 选择边界

建立应用级选择基线：

- 应用 chrome 默认 `user-select: none`。
- 内容区域显式 `user-select: text`。
- 编辑区、textarea、input 保持原生选择能力。
- 不能依靠大量零散补丁；需要一个集中定义，例如在 tokens/base/global CSS 中定义选择层级。
- 避免 `!important` 泛滥；只有与 WebKit/Tauri 默认行为冲突时才允许局部使用。

建议形态：

```css
.app-shell,
.toolbar,
.sidebar,
.workspace,
.doc-panel,
.settings-nav,
.menu,
button {
  user-select: none;
}

.reader,
.inline-editor,
.markdown-source,
.git-diff-content,
.debug-log,
input,
textarea {
  user-select: text;
}
```

实际选择器应以现有 DOM 为准。

### 2. 全局快捷键控制

在主窗口建立统一 `keydown` 捕获逻辑：

- 捕获 `Ctrl+A` / `Cmd+A`。
- 先判断事件目标是否是原生表单控件；是则不拦截。
- 根据当前模式和焦点位置执行区域全选。
- 使用 `preventDefault()` 阻止浏览器全页面选择。
- 不破坏 `Ctrl+C`、`Ctrl+V`、`Ctrl+S`、`Ctrl+F`、IME、方向键等现有快捷键。

设置页也需要同类保护：

- 表单控件内保留原生全选。
- 非表单区域禁止全页面选择 UI chrome。
- 可复制诊断区域如果需要全选，应只选中诊断内容。

### 3. Selection 工具函数

新增或集中一个小工具模块，避免每个界面手写 selection：

```ts
function isEditableTarget(target: EventTarget | null): boolean
function selectElementContents(element: HTMLElement): void
function selectionInside(root: HTMLElement): boolean
function handleSelectAllShortcut(event: KeyboardEvent): boolean
```

要求：

- 能处理 contenteditable。
- 能处理 shadow-free 普通 DOM。
- 能安全处理 hidden / empty element。
- 不在无文档打开时抛错。

### 4. 读/编/源码模式差异

必须分别处理：

- 阅读模式：全选正文阅读区。
- 编辑模式：全选 inline editor。
- 源码模式：全选 textarea。
- 预览/格式化面板：面板打开时不能让底层页面被全选。
- Web clip / 导入 / 保存格式选择等 overlay：焦点在 input 时控件内全选，焦点在 overlay chrome 时不选中全页面。

### 5. 不允许的修法

- 不允许只加 `body { user-select: none }` 然后到处补回来。
- 不允许只给几个按钮加 `user-select: none`。
- 不允许只拦截 `Ctrl+A`，却保留鼠标拖拽能选中整个 UI chrome 的问题。
- 不允许破坏正文复制。
- 不允许让源码 textarea 的原生选择样式消失。

## 测试要求

### E2E 必须覆盖

新增或扩展 Playwright 测试，至少覆盖：

1. 阅读模式下，点击 toolbar 后按 `Ctrl+A` / `Meta+A`，selection 只包含 reader 文本，不包含 toolbar、菜单、目录、workspace。
2. 编辑模式下，按 `Ctrl+A` / `Meta+A` 只选中 inline editor 文本。
3. 源码模式下，按 `Ctrl+A` / `Meta+A` 只选中 textarea 内容。
4. 设置页非输入区域按 `Ctrl+A` / `Meta+A` 不选中导航和按钮文案。
5. 设置页输入框内按 `Ctrl+A` / `Meta+A` 仍选中该 input 的文本。
6. Workspace / outline / Git panel 区域按 `Ctrl+A` / `Meta+A` 不选中目录、文件名、按钮、tab chrome。
7. Git diff 内容区如果支持复制，按 `Ctrl+A` / `Meta+A` 只选中 diff 内容，不选中 Git 面板 chrome。
8. 打开上下文菜单 / more menu 后按 `Ctrl+A` / `Meta+A` 不选中菜单项和底层 UI。

测试断言建议：

```ts
const selected = await page.evaluate(() => window.getSelection()?.toString() || "");
expect(selected).toContain("正文里的独特文本");
expect(selected).not.toContain("打开目录");
expect(selected).not.toContain("大纲");
expect(selected).not.toContain("Git");
expect(selected).not.toContain("保存");
```

对 textarea/input 使用 `selectionStart` / `selectionEnd` 验证，不使用 `window.getSelection()`。

### 手工验收

在 macOS 和 Windows 快捷键分别验收：

- macOS：`Cmd+A`
- Windows/Linux：`Ctrl+A`

手工路径：

1. 打开一篇 `.aimd` 文档，阅读模式点击顶部工具栏，按全选，确认只选正文或无 chrome 选择。
2. 编辑模式点击正文，按全选，确认只选 inline editor。
3. 源码模式按全选，确认 textarea 全选。
4. 点击目录、workspace、Git tab、更多菜单后按全选，确认 UI 不被整页选中。
5. 设置页点击空白区域按全选，确认导航和按钮不被选中。
6. 设置页点击 API key 输入框按全选，确认输入框文本仍被选中。

## 验收标准

- `Ctrl+A` / `Cmd+A` 不再选中菜单、目录、工具栏、图标、按钮、tab、workspace chrome。
- 正文、源码、输入框、Git diff、debug 日志等真实内容仍可选择和复制。
- 鼠标拖拽也不能轻易选中 UI chrome。
- E2E 覆盖主窗口阅读/编辑/源码模式、设置页、侧栏、Git panel、菜单场景。
- `npm --prefix apps/desktop run typecheck` 通过。
- 相关 Playwright spec 通过。
- `git diff --check` 通过。

## 建议优先级

1. 先建立 CSS 选择边界：chrome 默认不可选，内容区域显式可选。
2. 再实现统一 `Ctrl+A` / `Cmd+A` 捕获和区域全选。
3. 再补设置页、debug console、Git diff 等特殊内容区域。
4. 最后补 E2E，防止以后新增 UI chrome 又被全选。
