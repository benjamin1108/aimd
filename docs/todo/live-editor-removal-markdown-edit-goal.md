# /goal: 移除 Live Editor，收敛为阅读/编辑双面板的生产重构目标

## 背景

AIMD Desktop 当前存在三类文档表面：

- 阅读表面：渲染 Markdown，用于阅读、检查、任务勾选、图片查看和链接打开。
- Markdown 源码表面：textarea 编辑 Markdown，并在右侧显示同步预览。
- Live Editor / 可视化编辑表面：`contentEditable` 渲染 HTML，通过 `source-preserve` 映射回 Markdown 源码区间。

Live Editor 最初用于降低用户编辑 Markdown 的门槛，并通过 source-preserving patch 避免 DOM 转 Markdown 导致整篇源码风格漂移。但当前事实是：它把复杂度集中在 DOM、selection、source range、异步 render、图片 hydrate、结构编辑阻断、tab/version 同步和保存语义之间，已经持续产生语义不明、卡顿、无法编辑、编辑失效和测试负担。

AIMD 的长期核心价值不是通用 WYSIWYG Markdown 编辑器，而是 Git-friendly 的 Markdown/AIMD authoring tool：

- Markdown 源码是唯一可写权威。
- Git diff 必须干净、可解释、可回滚。
- 资源插入、图片粘贴、格式辅助和预览校对必须降低 Markdown 使用门槛。
- 不再让 `contentEditable DOM` 承担内容编辑和保存语义。

本目标要求一次性完成架构收敛：删除 Live Editor，保留阅读面板，重命名并强化 Markdown 编辑面板，清理遗留代码和测试，使仓库不再携带半成品可视化编辑引擎。

## 目标

完成后，AIMD Desktop 只有两个面板：

1. **阅读**
   - 对应原预览/阅读能力。
   - 只展示当前 Markdown 的渲染结果。
   - 不提供自由文本编辑。

2. **编辑**
   - 对应原 Markdown 源码面板。
   - 左右或上下显示 Markdown 源码区与渲染预览。
   - Markdown 源码区是唯一主编辑面。
   - 工具栏在源码区插入 Markdown 语法，而不是操作 DOM。
   - 支持源码区与预览区快速对调，适配宽屏、窄屏和用户校对流程。

最终代码中不得再存在“第三个可视化编辑模式”。允许内部保留明确命名的 Markdown source 概念，但产品模式和状态机必须收敛为 `read` / `edit` 两种语义，不能继续用旧 Live Editor 承担任何写入路径。

## 非协商要求

### 删除 Live Editor 写入路径

必须删除或彻底停用以下能力和代码路径：

- `contentEditable` 的 `#inline-editor` 文档编辑区。
- `source-preserve.ts` 及其源码块/表格单元映射模型。
- `sourceDirtyRefs`、`sourceStructuralDirty`、`inlineDirty` 等 Live Editor 专用状态。
- `flushInline()`、`onInlineInput()`、`onInlineBeforeInput()`、`onInlineKeydown()` 等可视化编辑同步逻辑。
- `visual-editor` rendered surface profile。
- Live Editor 专用 image delete、link popover、image alt popover、format toolbar DOM 命令。
- 任何 `DOM innerHTML -> Markdown` 的普通保存路径。
- 任何“可视化编辑失败，请切到 Markdown 模式”的阻断提示和状态机。

如果某些工具函数仍有价值，必须改名并重构为 Markdown 源码编辑工具，不允许保留误导性 `inline`、`visual`、`contenteditable` 命名。

### Markdown 源码是唯一可写权威

所有内容变更必须进入统一 Markdown mutation API，例如当前的 `commitMarkdownChange()` 或等价入口：

- textarea 输入。
- 工具栏插入 Markdown 标记。
- 图片粘贴/拖拽/选择插入。
- 任务 checkbox 勾选。
- 一键格式化应用。
- 保存/另存返回 canonical Markdown。
- workspace rename 或其他文档内容更新。

不得直接散写：

- `state.doc.markdown = ...`
- `tab.doc.markdown = ...`
- `markdownEl().value = ...` 后不走 mutation API

例外只能是 UI 同步层把 mutation 结果写回 textarea，且必须由统一入口控制。

### 阅读面板

“阅读”面板必须满足：

- UI 文案显示为“阅读”，不再显示“预览”作为模式名。
- 使用统一 rendered surface 管线渲染当前 Markdown。
- 保留图片 lightbox。
- 保留链接 `Ctrl/⌘ + 点击` 打开逻辑。
- 保留代码块复制。
- 保留任务 checkbox 受控更新 Markdown 的能力，或明确将任务 checkbox 设为只读；如果保留可点击，必须通过统一 mutation API 修改 Markdown。
- 不暴露 `contentEditable`。
- 不允许在阅读面板中进行自由文本编辑。

### 编辑面板

“编辑”面板必须满足：

- UI 文案显示为“编辑”，不再显示“MD”作为模式名。
- Markdown textarea 是唯一编辑入口。
- 同一面板内包含源码区和渲染预览区。
- 预览区只展示当前 textarea 对应的 render 结果，不参与自由编辑。
- 源码输入后异步 render 必须绑定 tab、markdownVersion、markdown snapshot、path、format 和 draft 状态。
- 编辑面板切换、tab 切换、保存、关闭、恢复 session 时，不允许显示旧 HTML 为最新预览。
- 源码区必须保留 selection、scroll、find/replace、粘贴图片、拖入图片和恢复焦点能力。

### 编辑面板工具栏

必须保留完整 Markdown 编辑工具栏，但工具栏必须从 DOM 命令重构为源码命令：

- 粗体：包裹或插入 `**text**`。
- 斜体：包裹或插入 `*text*`。
- 删除线：包裹或插入 `~~text~~`。
- H1 / H2 / H3：修改当前行或插入对应 heading。
- 正文：移除当前行 heading/list/quote 的块前缀，或插入普通段落。
- 无序列表：修改当前行或多行前缀为 `- `。
- 有序列表：修改当前行或多行为 `1. `、`2. ` 等。
- 引用：修改当前行或多行前缀为 `> `。
- 行内代码：包裹或插入 `` `code` ``。
- 代码块：包裹选区或插入 fenced code block。
- 表格：插入标准 Markdown 表格模板。
- 任务列表：插入或切换 `- [ ] ` / `- [x] `。
- 链接：包裹选区或插入 `[text](url)`。
- 图片：选择/粘贴/拖入图片后插入 `![alt](asset://...)` 或 Markdown 文件相对路径。
- 图片 alt：只对当前 Markdown 图片语法进行源码级修改，不再操作 DOM 中的 `<img>`。

工具栏操作必须保持：

- selection 范围合理更新。
- textarea 焦点不丢失。
- undo/redo 必须优先保留浏览器 textarea 原生栈；命令式修改必须使用 `setRangeText()` 或等价方式，不能用整段重赋值破坏用户撤销路径。
- 多行选区命令不产生不可解释的格式漂移。
- 命令执行后走统一 mutation API 并安排预览更新。

### 源码区与预览区快速对调

编辑面板必须提供明确 UI 交互，允许用户快速对调源码区与预览区位置。

要求：

- 宽屏默认：源码区在左，预览区在右。
- 用户可一键切换为：预览区在左，源码区在右。
- 窄屏默认：源码区在上，预览区在下。
- 用户可一键切换为：预览区在上，源码区在下。
- 对调状态必须是当前窗口/session 可恢复的 UI 状态，不能影响文档内容。
- 对调按钮使用清晰图标和 tooltip，不使用解释性长文案占据工具栏空间。
- 对调必须通过结构化 class/data attribute 或 CSS custom property 表达，不允许通过大量 inline style 写布局。

### UI 设计合同

本重构的 UI 必须按专业桌面工具设计，不做营销式或装饰性界面：

- 使用 `design-taste-frontend` skill 的工程原则，但按 AIMD 当前技术栈实现，不引入 React/Tailwind/Framer 等新栈。
- 视觉密度保持中等，优先服务长文档编辑、扫描和校对。
- 阅读/编辑模式切换必须清晰、稳定，不使用三态遗留布局。
- 工具栏必须保留完整能力，但按功能分组，不挤压查找、模式切换和文档菜单。
- 源码区与预览区对调控件必须是工具属性，不是页面说明文字。
- 不使用紫蓝渐变、发光、装饰卡片、嵌套卡片或大面积营销 hero。
- 使用现有 CSS token、cascade layer、semantic color、radius、shadow、motion 合同。
- CSS 修改必须落在 `apps/desktop/src/styles/` 中负责的模块，不用 inline style 修视觉。
- 所有新增按钮、切换控件、菜单项必须有 hover、active、focus-visible、disabled 状态。
- 1280x800、1440x900、窄屏断点下，工具栏、模式切换、查找、源码区、预览区不能重叠或文字溢出。

如实现需要设计稿，必须把可浏览的 HTML 设计原型或设计说明放入 `docs/product/design/`，不能依赖 `tmp/` 中的临时文件作为长期合同。

### CSS 架构硬约束

本重构必须基于 AIMD 当前 CSS 架构规范实施。`docs/todo/css-architecture-production-goal.md` 与 `apps/desktop/scripts/check-css-architecture.mjs` 是本目标的样式架构前置合同；如果该规范文件在实施时已被归档、重命名或拆分，实施者必须先定位当前有效版本，再继续重构。

不得为了移除 Live Editor 或改造编辑面板破坏以下 CSS 架构边界：

- 不新增硬编码颜色、raw color token、裸 `z-index`、未注册 CSS 变量、未审查 `!important` 或 unscoped global selector。
- 新增样式必须放在 `apps/desktop/src/styles/` 下的负责模块中，并处于既有 cascade layer / entry isolation / token 合同内。
- 主题相关值必须使用语义 token，例如 `--ink-*`、`--surface-*`、`--hairline-*`、`--radius-*`、`--shadow-*`、motion token 或当前规范登记的等价 token。
- 编辑面板、阅读面板、工具栏、split pane、对调按钮、状态提示和预览 surface 不得形成一套绕过 token 的临时视觉系统。
- 对源码区与预览区的布局调整必须通过 grid/flex 结构、data attribute、CSS custom property 或 container/breakpoint 合同表达，不用 magic offset、硬编码空白、运行时 `style.*` 写固定布局。
- runtime style 写入只能用于真正的运行时数值；可表达为 CSS class、data attribute 或 registered CSS custom property 的状态必须交给 CSS。
- 新增 overlay、popover、tooltip、menu 或 split control 必须遵守 overlay lifecycle、z-index registry、focus-visible、reduced-motion 和 forced-colors 合同。
- 任何新的颜色、边框、阴影、圆角、间距、动效、选中态、hover、active、disabled、focus 样式都必须考虑未来 `light`、`dark`、`high-contrast` 或其它主题扩展。
- 不允许用复制 reader/editor 旧样式的方式制造新的 visual island；同级控件必须共享 selector group 或组件 token 合同。
- CSS 文件行数、架构扫描、typecheck 和 Playwright 视觉断言是完成条件，不得通过 broaden ignore、删除 scanner case 或放宽门禁来完成重构。

本目标中的 UI 细节如果与 CSS 架构规范冲突，以 CSS 架构规范为准，但不能借此保留 Live Editor 或削弱“Markdown 源码是唯一可写权威”的产品合同。正确做法是调整 UI 细节表达，使其同时满足本目标和 CSS 架构规范。

## 代码清理范围

本目标完成时，以下遗留物必须被删除或改造成新职责：

### 必须删除

- Live Editor 专用源文件：
  - `apps/desktop/src/editor/source-preserve.ts`
  - `apps/desktop/src/editor/inline.ts`
  - Live Editor 专用的 `format-toolbar.ts` DOM command 实现
  - Live Editor 专用 `image-delete.ts`
  - Live Editor 专用 `link-popover.ts`
- Live Editor 专用 e2e：
  - IME/contenteditable 专测。
  - source-preserving editor 专测。
  - inline-editor cursor/focus/selection 专测。
  - flushInline、visual paste、visual insert image 等专测。

### 必须重构

- `core/types.ts`
  - `Mode` 收敛为阅读/编辑两种产品模式。
  - 删除 `MarkdownSourceModel`、`MarkdownSourceBlock`、`MarkdownSourceCell` 等 source-preserve 类型。
  - 删除 open tab 中 Live Editor 专用状态。

- `core/state.ts`
  - 删除 Live Editor dirty/source mapping 状态。
  - `paintedVersion`、scroll state、session state 与两种产品模式对齐。

- `ui/template.ts`
  - 删除 `#inline-editor`。
  - 删除旧 `#mode-edit`/`#mode-source` 三态歧义；最终 UI 只有“阅读”和“编辑”。
  - 将现有 source split 容器作为编辑面板。
  - 加入源码/预览对调控件。

- `ui/mode.ts`
  - 删除离开可视化编辑时的 flush/abandon 逻辑。
  - 只负责阅读/编辑切换、表面显示和状态恢复。

- `ui/outline.ts` / rendered surface
  - 删除 visual-editor profile。
  - 删除 source annotation。
  - 保留 reader 与 edit-preview 两种 rendered surface。

- `document/persist.ts`、`document/export.ts`、`document/format.ts`、`document/health.ts`、`document/apply.ts`、`ui/git-diff.ts`
  - 删除 `flushInline()` 前置检查。
  - 以 Markdown mutation / render version 合同为唯一保存前置。

- `editor/paste.ts`、`editor/images.ts`
  - 删除 `"edit" | "source"` 的旧 target 分叉。
  - 图片插入只插入 Markdown 源码。
  - 粘贴 HTML 时优先转换为 Markdown 文本并插入 textarea，不走 visual selection。

- `editor/format-toolbar.ts`
  - 重写为 Markdown textarea toolbar。
  - 不再使用 `document.execCommand()`。
  - 不再读取或修改 `contentEditable` selection。

### 必须保留

- Markdown 源码编辑。
- 源码区语法高亮 overlay。
- 源码区和预览区同步渲染。
- 图片粘贴/选择/拖入并写入 AIMD assets。
- 普通 `.md` 与 `.aimd` 保存语义。
- Git diff、Git workspace、tab 生命周期、session restore。
- 查找与替换。
- 一键格式化。
- 健康检查与资源打包。
- 导出 Markdown / HTML / PDF。
- WebClip 导入。

## 目标架构

### 模式模型

最终产品模式：

```ts
type Mode = "read" | "edit";
```

含义：

- `read`：阅读面板，渲染当前 Markdown。
- `edit`：编辑面板，Markdown source + preview split。

不得存在：

```ts
type Mode = "read" | "edit" | "source";
```

也不得用 `edit` 表示 Live Editor，再用 `source` 表示 Markdown。实施中的中间提交不能作为完成状态；最终交付必须完成语义收敛。

### 编辑面板布局状态

新增或等价表达：

```ts
type EditPaneOrder = "source-first" | "preview-first";
```

该状态属于 UI/session，不属于文档内容。它应与 open tab 或窗口 UI 设置清晰绑定，并通过 `data-edit-pane-order` 或等价属性驱动 CSS。

### Markdown 工具栏命令

工具栏应重构为独立 Markdown command 层，例如：

```text
apps/desktop/src/editor/
  markdown-commands.ts
  markdown-toolbar.ts
  paste.ts
  images.ts
  search.ts
  source-highlight.ts
```

命令层只接收 textarea selection、当前 markdown 和命令参数，返回：

```ts
type MarkdownCommandResult = {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
  status?: string;
};
```

命令层不得读取 `contentEditable` DOM。

### Rendered Surface

Rendered surface profile 收敛为：

```ts
type RenderedSurfaceKind =
  | "reader"
  | "edit-preview"
  | "git-diff";
```

删除：

- `visual-editor`
- `contentEditable: true`
- `sourceAnnotations`

保留：

- image hydration。
- link behavior。
- task toggle。
- code copy。
- frontmatter display policy。
- outline id sync。

## 实施前校准与纠偏机制

本 goal 是生产合同，不是要求后续 agent 盲目执行每个猜测到的文件名。实施前必须先阅读当前代码，再形成一份短的实施校准记录，至少覆盖：

- 当前真实模式状态机：`Mode`、tab state、session restore、menu event、toolbar event 和 rendered surface profile。
- 当前真实编辑入口：textarea input、工具栏、图片粘贴/拖拽、任务 checkbox、格式化、保存返回 canonical Markdown。
- 当前真实 CSS 架构入口：`styles.css`、`styles/entries/*`、相关 component/surface/layout CSS 模块、CSS scanner 配置。
- 当前测试分布：哪些 e2e 是 Live Editor 专用，哪些是 Markdown/save/resource/tab 语义必须保留。
- 当前工作区是否已有用户未提交改动；不得为了执行本目标还原或清理无关改动。

如果阅读代码后发现本 goal 的某个细节不准确，实施者必须按以下规则处理：

- **核心目标不能改**：不能保留 Live Editor，不能恢复 DOM 转 Markdown 保存，不能绕开 Markdown mutation API，不能破坏 CSS 架构规范。
- **文件名可以校准**：如果文件已重命名、职责已拆分或代码已迁移，按真实职责处理，不按旧文件名机械操作。
- **交互细节可以修正**：如果某个工具栏命令、对调状态或测试路径在真实代码中有更好的生产表达，可以修正实现方式，但必须保持用户可见能力和验收语义。
- **发现遗漏必须补规格**：如果发现本 goal 没覆盖某条真实路径，例如 menu shortcut、workspace document creation、session restore、export path、web clip draft、settings event 或 packaged app 特有路径，必须先补充 goal 或实现说明，再改代码。
- **发现冲突必须显式解决**：如果本 goal 与 CSS 架构规范、现有保存语义、Git diff 语义或平台限制冲突，必须记录冲突、选择符合产品核心目标的方案，并补测试验证该选择。
- **不能用 silent deviation 完成**：任何偏离本 goal 的实现都必须在代码评审说明或更新后的 goal 中留下依据，不能只让代码悄悄不同。

后续 agent 应把本目标理解为“阅读代码后收敛架构”的任务。允许纠正目标中的不合理细节，但不允许用“目标可能不完整”为理由降低清理深度、跳过 CSS 门禁、保留旧 Live Editor 空壳或减少回归覆盖。

## 迁移步骤

本目标不是“最小实现”。实施时可以按提交组织，但最终交付必须一次性达到以下完整状态：

1. 建立新模式合同：阅读/编辑。
2. 删除 Live Editor DOM 与事件绑定。
3. 删除 source-preserve 状态和类型。
4. 将 Markdown 面板重命名为编辑面板。
5. 将原预览/阅读面板统一命名为阅读。
6. 重写工具栏为 Markdown textarea 命令。
7. 保留并强化图片插入到 Markdown 源码。
8. 增加源码/预览快速对调 UI 与状态持久化。
9. 更新 rendered surface profile。
10. 更新保存、导出、格式化、健康检查、Git diff、关闭文档路径，移除 flushInline 依赖。
11. 删除或重写所有 Live Editor 专用测试。
12. 添加新的阅读/编辑双面板回归测试。
13. 跑完整验证并清理死代码、死 CSS、死 DOM id、死文案。

## 验收标准

### 产品行为

- 打开 `.aimd` 或 `.md` 后默认进入阅读或编辑的现有产品偏好必须明确，不能落入不存在的旧模式。
- 模式切换只显示“阅读”和“编辑”。
- “阅读”面板不可自由编辑。
- “编辑”面板显示 Markdown source + preview。
- 编辑 Markdown 后预览更新。
- 保存写出的 Markdown 与 textarea 内容一致，不经过 DOM 转 Markdown。
- 粘贴图片会插入 Markdown 图片语法并更新资源表。
- 工具栏所有命令都作用于 Markdown textarea。
- 源码/预览对调后不影响文档内容、dirty 状态或保存结果。
- Tab 切换、session restore、dirty confirm、Cmd+W、Git diff tab 不因模式收敛回退。

### 代码清洁

- `rg "inline-editor|contentEditable|contenteditable|source-preserve|sourceDirtyRefs|sourceStructuralDirty|flushInline|visual-editor|onInlineInput|onInlineBeforeInput"` 在生产源码中不得再命中旧 Live Editor 代码。
- 如测试 fixture 或 archived docs 仍出现旧词，必须是历史说明，不得影响生产代码。
- 不存在 import 已删除模块的残留。
- 不存在隐藏但仍被绑定事件的旧 DOM。
- 不存在为了绕过类型错误保留的空壳函数。
- 不存在新增的 broad ignore 或放宽 scanner/code-size gate。

### UI/CSS

- 工具栏在 1280x800 不遮挡查找、模式切换和文档菜单。
- 编辑面板在宽屏和窄屏都能稳定显示源码和预览。
- 源码/预览对调没有重排抖动或滚动条异常。
- 阅读/编辑按钮在 hover、active、focus-visible、disabled、selected 状态下符合现有 token。
- 新 CSS 通过 `apps/desktop/scripts/check-css-architecture.mjs` 的合同，不新增硬编码颜色、裸 z-index、未注册变量或未审查 `!important`。

### 回归测试

必须新增或更新 targeted Playwright 覆盖：

- 两模式切换：阅读/编辑。
- 编辑面板源码输入后预览更新。
- 工具栏插入 heading、bold、list、task、link、table、code block。
- 图片粘贴/选择插入 Markdown 源码并显示预览。
- 源码/预览对调。
- 保存不经过 DOM 转 Markdown，保留未触碰 Markdown 样式。
- `.md` 与 `.aimd` 保存语义。
- 任务 checkbox 如果保留可点，必须验证通过 mutation API 修改 Markdown。
- Tab 切换和 session restore 不恢复旧三态模式。

旧 Live Editor 测试不能简单留着跳过。它们必须删除、归档或重写为新编辑模型测试。

## 验证命令

最终交付前至少运行：

```bash
npm --prefix apps/desktop run check
git diff --check
```

涉及 Rust/Tauri 命令、保存语义、Git diff 或后端资源路径时，还必须运行：

```bash
cargo check --workspace
```

涉及 UI/行为变更时，必须运行受影响 Playwright specs。默认从以下集合中选择并补齐新 spec：

```bash
cd apps/desktop
npx playwright test e2e/<new-reading-editing-spec>.spec.ts
npx playwright test e2e/31-md-open-association.spec.ts
npx playwright test e2e/42-editor-core-capabilities.spec.ts
```

如果普通 Playwright run 因已有服务器冲突，按项目约定使用：

```bash
AIMD_PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test <spec>
```

不得因为旧 Live Editor 测试失败而放松门禁；旧测试必须按新产品合同删除或重写。

## 完成定义

本目标完成时必须同时满足：

- 产品只剩“阅读”和“编辑”两个面板。
- 编辑面板是 Markdown source + preview split。
- Live Editor 生产代码完全移除。
- Markdown 工具栏完整且作用于源码区。
- 图片插入能力完整保留。
- 源码/预览可快速对调。
- 保存不再依赖 DOM 转 Markdown 或 source-preserving patch。
- Git diff 保持干净。
- 旧可视化编辑相关测试和代码没有遗留杂项。
- 类型检查、代码大小、CSS 架构、目标 Playwright 和 whitespace gate 通过。
