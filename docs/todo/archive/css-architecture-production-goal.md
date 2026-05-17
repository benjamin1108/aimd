# /goal: AIMD Desktop CSS 架构极致重构生产目标

## 背景

AIMD Desktop 当前 CSS 已经从单文件演进为多个模块，整体不是不可维护状态，但它仍主要依赖 `styles.css` 的 `@import` 顺序来组织级联。随着三栏布局、RenderedSurface、Git Diff、Settings、WebClip 注入面板、调试面板、updater、lightbox、tree overflow portal 等功能持续增加，CSS 已经出现几个明确的架构风险：

- 样式模块有拆分，但没有可执行的 cascade layer、入口隔离、overlay 层级注册表和主题合同。
- token 使用量已经较高，但主题仍是单一 `:root`，缺少 `data-theme`、`prefers-color-scheme`、`forced-colors` 和 `color-scheme` 级别的生产契约。
- 主应用、Settings 和 WebClip 注入 UI 共享或复制样式边界不清晰，Settings 仍会加载整套主应用 CSS，WebClip 注入 CSS 更像第二套独立 UI 系统。
- 多个运行时模块通过 inline style 或直接 `style.*` 写布局属性，导致响应式、主题切换、调试定位和未来样式开关难以统一治理。
- `!important` 目前还没有泛滥到不可控，但已经缺少白名单制度；WebClip、隐藏态、resize cursor、Settings padding 等场景混在一起。
- overlay 和 z-index 没有集中治理，局部组件可以越过 debug、lightbox 等全局层级。
- CSS 溢出风险主要集中在 inspector/rail、tab strip、tree portal、WebClip、Settings 小高度、移动断点死区和 animated width/height。
- 现有测试更偏行为和视觉回归，缺少 CSS 架构门禁：硬编码颜色、裸 z-index、未定义 CSS var、`!important` 白名单、入口依赖、主题矩阵、reduced-motion、forced-colors、WebClip hostile host CSS。

本目标来自主线程诊断与三个独立 subagent 完整诊断的超集。它不是一次视觉翻新，也不是局部 CSS 清洁任务，而是把 AIMD Desktop 的样式系统升级为可长期演进、可审计、可一键切换主题的生产级 CSS 架构。

## 启动基线

以下数字是本轮诊断时的静态基线，用于说明问题规模。实际实施前应重新跑扫描脚本并以最新结果为准：

- `apps/desktop/src/styles.css` 当前串联约 23 个样式模块。
- 应用侧 CSS 文件约 24 个，约 5100 行。
- CSS custom property 定义约 97 个，`var(--...)` 使用约 714 处。
- 应用 CSS 中硬编码颜色引用约 266 处，WebClip injector 样式中约 85 处。
- 应用侧 `!important` 约 27 处，WebClip injector 约 10 处。
- TypeScript 模板中 `style="..."` 属性很少，但运行时 `style.*` 写入较多。
- `data-theme`、`prefers-color-scheme`、`color-scheme` 等主题 hook 当前为 0。

这说明当前系统已经具备 token 化基础，但还没有形成闭环。它可以支撑当前默认主题，却不能可靠支撑未来一键切换样式主题。

## 目标

完成后，AIMD Desktop 必须具备一套清晰、可测试、可演进的 CSS 平台：

- CSS 级联顺序由显式 `@layer` 和入口文件表达，不再依赖隐式 import 偶然顺序。
- Desktop、Settings、WebClip 拥有各自入口，互相复用 token 与基础组件合同，但不互相加载整套无关样式。
- 所有颜色、空间、层级、动效、圆角、阴影、焦点、选择态、危险态、信息态都进入 token 或语义 token 体系。
- 支持 `light`、`dark`、`high-contrast` 和 `forced-colors` 的主题切换合同，并允许后续通过一个入口状态切换主题。
- overlay、popover、modal、lightbox、debug、tree portal、context menu、action menu 等层级由统一 registry 管理。
- inline style 只用于真正的运行时数值，并优先写 CSS custom property，不直接散落写布局属性。
- `!important` 只允许出现在明确白名单中。
- CSS 文件职责收敛，单文件行数继续满足项目 code-size gate。
- WebClip 注入 UI 不再作为不可治理的第二套 UI 系统存在。
- 不牺牲现有布局、编辑、保存、Git、导出、PDF、RenderedSurface、Tab 生命周期和快捷键语义。

## 非协商要求

### 不改变产品语义

本重构不能改变以下行为：

- Markdown、AIMD 文档、资源、保存语义。
- source-preserving editor 的保存模型。
- RenderedSurface 的 `reader`、`preview`、`visual-editor`、`git-diff` 行为边界。
- Git workspace、Git Diff、右侧 inspector、asset、outline、health、debug 面板语义。
- `Cmd+W`、tab ownership、dirty document confirmation。
- PDF、export、WebClip 提取、LLM adapter、settings 存储和发布流程。

如果实现时发现某个视觉问题必须通过行为调整才能彻底解决，必须先把行为合同写清楚，再改测试和代码。不能在 CSS 重构中夹带静默产品语义变化。

### 不能靠删功能完成

不允许通过以下方式让重构“看起来通过”：

- 删除小屏、窄屏、高对比、reduced-motion 或 WebClip 状态。
- 删除现有 overlay、popover、tooltip、debug、health、updater、lightbox 功能。
- 将复杂状态隐藏掉但不提供替代交互。
- 用更多 `!important` 覆盖级联问题。
- 用全局 reset 粗暴压制组件样式。
- 把硬编码颜色搬到另一个普通 CSS 文件而不进入 token 合同。
- 放宽或跳过真实 check 门禁、code-size gate、typecheck 或 Playwright 验收。

### 门禁不能放松

代码长度门禁是完成条件之一。当前 `apps/desktop/scripts/check-code-size.mjs` 对 CSS 文件有行数上限要求，任何新建或修改的 CSS 文件都必须满足该门禁。

如果拆分后仍有 CSS 文件超长，必须继续按职责拆分，不能用忽略规则掩盖。重构完成的最低判定是一个真实可执行的 check 门禁通过；当前根目录没有 `check` script，实施时必须先补齐 root check 或明确使用现有真实命令。

## 目标架构

### 样式目录结构

最终结构应收敛为类似以下布局。具体文件名可按现有代码习惯微调，但职责边界必须等价清晰：

```text
apps/desktop/src/styles/
  entries/
    desktop.css
    settings.css
    webclip.css
  base/
    reset.css
    selection.css
    accessibility.css
    scrollbars.css
  tokens/
    primitives.css
    semantic.css
    themes.css
    motion.css
    layers.css
  layout/
    app-shell.css
    workspace.css
    rails.css
    responsive.css
  surfaces/
    rendered-surface.css
    reader.css
    preview.css
    visual-editor.css
    git-diff.css
    markdown-content.css
  components/
    buttons.css
    command-strip.css
    tabs.css
    forms.css
    menus.css
    toolbars.css
    document-tree.css
    assets.css
    status.css
  overlays/
    overlay-root.css
    popover.css
    modal.css
    lightbox.css
    context-menu.css
    action-menu.css
    updater.css
    debug.css
    tree-overflow-portal.css
  utilities/
    state.css
    print.css
```

`apps/desktop/src/styles.css` 可以作为兼容入口存在，但最终只能是一个薄入口，导入 `entries/desktop.css`。它不能继续承载架构决策。

### Cascade layer 合同

所有 CSS 必须进入显式 layer：

```css
@layer reset, tokens, base, layout, surfaces, components, overlays, utilities, responsive;
```

约束：

- token 文件只进入 `tokens` layer。
- reset、selection、focus、scrollbar 等基础规则进入 `base` 或 `reset` layer。
- 页面框架、三栏、workspace、rail、responsive frame 进入 `layout` layer。
- Markdown 渲染内容和 RenderedSurface profile 进入 `surfaces` layer。
- buttons、tabs、forms、menus、toolbars、tree、assets、status 等进入 `components` layer。
- modal、popover、lightbox、context menu、updater、debug、tree portal 进入 `overlays` layer。
- 临时状态工具类和极少数通用 helper 进入 `utilities` layer。
- breakpoint 规则集中进入 `responsive` layer。

不允许依赖“后 import 的同 specificity 选择器赢”作为核心架构手段。若两个模块存在同等选择器竞争，必须通过 layer、作用域或组件边界解决。

任何入口覆盖范围内的 selector/rule 都必须进入 layer。未分层规则会天然压过已分层规则，因此 scanner 必须失败以下情况：

- Desktop、Settings、WebClip 源样式中出现未包进 `@layer` 的普通规则。
- HTML preboot style 中出现未登记的未分层规则。
- 兼容入口为了“临时覆盖”绕过 layer。

仅允许 `@layer` 顺序声明、`@import`、注释和极少数 platform bootstrap 例外；例外必须写入 allowlist。

### 全局选择器合同

裸全局选择器是 CSS 腐化的高风险来源，必须有白名单：

- 只允许 `reset.css`、`base.css`、`accessibility.css`、`selection.css` 等基础入口使用裸 `html`、`body`、`*`、`button`、`input`、`select`、`textarea`、`svg`、`pre`、`code`、`img`、`a`、`table` 等选择器。
- 每条裸全局规则必须有职责边界：reset、box sizing、selection、focus、form baseline、scrollbar baseline 或 accessibility。
- layout、surface、component、overlay 模块不得新增裸全局选择器，必须挂在 `.app-frame`、`.settings-shell`、`.rendered-surface`、`.aimd-clip-shell` 或更窄组件根下。
- `.panel`、`.field`、`.reader`、`.asset`、`.workspace`、`.sidebar`、`.inspector`、`.preview`、`.empty-state` 等短 class 名必须逐步收敛到明确作用域，避免 Settings、Desktop、WebClip 或未来页面互相污染。

scanner 必须输出所有裸全局选择器和短 class 跨入口复用点，并阻止新增未登记项。

### 入口隔离合同

必须形成三个明确入口：

```text
entries/desktop.css
entries/settings.css
entries/webclip.css
```

#### Desktop

Desktop 入口加载完整主应用 shell、surfaces、components、overlays 和 responsive 样式。

#### Settings

Settings 入口只能加载：

- tokens。
- reset/base/accessibility。
- forms、buttons、tabs、settings 自己的布局组件。
- Settings 需要的 overlay 或 tooltip 子集。

Settings 不允许再导入完整 `../styles.css` 或完整 desktop entry。Settings preboot 样式必须 token 化，使用 `100dvh` 或等价动态视口单位，不能继续依赖硬编码 `100vh` 导致小窗口和 macOS chrome 高度问题。

`apps/desktop/settings.html` 的内联 preboot `<style>` 也属于 Settings 入口的一部分，必须被 scanner 覆盖。它不能作为绕过 token、layer、viewport unit 和硬编码颜色门禁的例外入口。

#### WebClip

WebClip 入口必须从 TypeScript 字符串中解耦为可审计样式源。可接受方案：

- Shadow DOM 加 adopted stylesheet。
- 独立 CSS 文件经构建转换为注入字符串。
- 等价的可 lint、可扫描、可 token 化 pipeline。

WebClip 不允许继续作为无法被 CSS scanner 覆盖的大段手写 TS 字符串。若短期仍需生成字符串，源文件也必须能被静态门禁扫描。

### Token v2 合同

Token 分三层：

```text
primitives.css  原始色板、尺度、圆角、阴影、字体、z-index 数值
semantic.css    UI 语义变量，例如 surface、text、border、accent、danger、warning
themes.css      theme selector 对 primitives 和 semantic 的映射
```

必须覆盖：

- 文本：primary、secondary、muted、inverse、disabled。
- 背景：app、surface、surface-raised、surface-sunken、workspace、editor、overlay。
- 边框：subtle、strong、focus、danger、warning、success、info。
- 语义色：accent、danger、warning、success、info、git-added、git-removed、git-modified。
- Markdown：heading、code、blockquote、table、link、frontmatter、selection、search highlight。
- WebClip：accent、panel、scrim、progress、warning、result、host-safe focus。
- Settings：field、tab、error、help、preboot。
- Motion：duration、easing、spring-ish curves、reduced-motion override。
- Layer：z-shell、z-rail、z-sticky、z-menu、z-popover、z-modal、z-lightbox、z-debug、z-toast、z-devtools。

必须修复并统一：

- `--text-muted` 未定义却被引用的问题。
- `--danger`、`--tone-danger`、局部 danger fallback 混用问题。
- `--accent-*`、Git 颜色、reader syntax color、debug color、lightbox color、WebClip AI accent 的来源。

### CSS var registry 合同

必须建立 CSS custom property registry，至少区分四类变量：

```text
token-defined              由 primitives/semantic/themes/motion/layers 定义
component-private-defined  组件模块内部定义并消费
runtime-defined            TypeScript 或测量逻辑运行时写入
test-only                  测试 fixture 专用，不能进入生产入口
```

要求：

- scanner 对所有 `var(--x)` 和 `var(--x, fallback)` 都要检查来源。
- 禁止在非 token 层通过 `var(--missing, #fff)` 或 `var(--danger, #a33)` 掩盖缺失 token。
- runtime-defined 变量必须登记 owner、写入点、默认值或 fallback、清理策略和测试。
- component-private-defined 变量必须在同一组件作用域内定义，不能变成跨模块隐式 API。
- extension hook 可以有 fallback，但必须写入 registry，不能用 fallback 逃过 undefined-var 检查。
- 当前类似 `--update-progress-scale`、`--workspace-row-overflow-*` 这类运行时或组件变量必须被归类，不能混在 token 缺失问题里。

### Theme 合同

必须支持：

```css
:root,
[data-theme="light"] {
  color-scheme: light;
}

[data-theme="dark"] {
  color-scheme: dark;
}

[data-theme="high-contrast"] {
  color-scheme: light dark;
}

@media (forced-colors: active) {
}

@media (prefers-reduced-motion: reduce) {
}
```

主题切换目标：

- 切换入口只需要改一个 root attribute 或等价状态。
- Desktop、Settings、WebClip 都能复用同一套主题语义。
- 所有主题下焦点环、选区、错误、危险、Git diff、search highlight、popover、modal、button disabled、input error 都可读。
- WebClip 在 host page 的深色、浅色、高对比、强 CSS reset 页面中仍可读。
- 主题切换不能依赖重新构建应用。

### Theme state 合同

主题不是纯 CSS selector 改造，必须有应用状态合同：

- 新增统一 Theme State：`system | light | dark | high-contrast` 或等价枚举。
- Theme State 必须进入 Settings schema、默认值、迁移、持久化和读取路径。
- Desktop 与 Settings 首屏渲染前必须同步设置 `document.documentElement.dataset.theme` 和 `color-scheme`，避免启动闪烁。
- `system` 必须显式解析 `prefers-color-scheme`，用户显式选择优先级高于系统偏好。
- Settings 修改主题后，主窗口必须通过现有 settings event 或等价机制即时切换，无需重启、刷新或重新构建。
- WebClip 注入 UI 必须能读取同一语义主题，或在 host page 中独立解析并保持视觉一致。

### 硬编码颜色政策

除以下情况外，CSS 中不允许裸 `#hex`、`rgb()`、`rgba()`、`hsl()`、`oklch()`：

- `tokens/primitives.css` 中的原始色板。
- 明确注释并纳入 allowlist 的透明 mask、canvas fallback、platform forced-colors 适配。
- 第三方不可控代码片段的极小兼容补丁，且必须有注释说明。

所有其它颜色必须通过 semantic token 使用。

### `!important` 白名单

允许场景只有：

- `[hidden]` 或等价语义隐藏工具。
- WebClip 对 host page hostile CSS 的最小隔离保护。
- 临时全局 resize cursor 和 text-selection lock。
- 浏览器/平台 forced-colors 修复中经证明确实需要的规则。

任何新增 `!important` 必须满足：

- 所属文件在 allowlist。
- 精确到选择器和属性的 allowlist，而不是整个文件放行。
- 有短注释说明为什么不能通过 layer、specificity、作用域解决。
- 有测试或 scanner 记录。

### Inline style 政策

运行时样式写入必须收敛为三类：

#### 允许

- 动态 CSS custom property，例如 `--workspace-indent`、`--popover-x`、`--popover-y`。
- canvas、测量结果、用户拖拽尺寸等不可静态表达的数值。
- 临时 transition disable 标记，但必须有清理。

#### 需要迁移

- 直接写 `left/top/width/height/display/position/zIndex/overflow` 的组件布局状态。
- overlay 坐标直接写 DOM style，而不是通过 overlay manager 或 CSS var。
- tree portal、debug console、resizer、context menu 等散落写法。

#### 禁止

- inline 写颜色、字体、阴影、圆角、背景、焦点、状态色。
- inline 写主题差异。
- TypeScript 模板中复制 CSS 组件样式。

必须新增 runtime-style allowlist registry。除集中 helper、overlay manager、resizer owner、测量探针、canvas 和明确登记的 CSS custom property 写入外，业务模块禁止直接写：

```text
element.style.left
element.style.top
element.style.width
element.style.height
element.style.flex
element.style.transform
element.style.position
element.style.display
element.style.overflow
element.style.zIndex
element.style.gridTemplateColumns
element.style.cssText
```

scanner 必须枚举 `style.*`、`style.setProperty()`、`style.removeProperty()`、`style="..."` 和 style 字符串拼接。每个允许项必须记录 owner、原因、清理路径和测试；动态值优先写已登记的 CSS custom property。

### Dimension 与数学函数合同

空间、尺寸、断点和数学函数也必须 token 化，不能只治理颜色：

- `calc()`、`clamp()`、`min()`、`max()` 中的布局数值必须来自 spacing、sizing、breakpoint token 或 runtime var registry。
- 裸 `4px`、`8px`、`12px`、`16px`、`20px`、`24px`、`760px`、`900px`、`1100px`、`1180px` 等布局数值必须进入 spacing/sizing/breakpoint registry，或写入 selector+property allowlist。
- `100vh`、`90vh`、`100vw` 等不稳定 viewport unit 不得用于 overlay、modal、lightbox、Settings、WebClip 的高度或最大高度；优先使用 `dvh`、`svh`、`lvh` 或 token 化 viewport 变量。
- 例外必须说明平台原因，并进入 scanner allowlist。

### Overlay 与 z-index 合同

必须建立统一 overlay registry：

```text
shell
sticky
menu
popover
modal
lightbox
debug
toast
devtools
```

受管对象至少包括：

- context menu。
- action menu。
- link popover。
- image/link inline popover。
- format preview panel。
- save format panel。
- updater。
- debug console。
- lightbox。
- tree overflow portal。
- WebClip panel 和 scrim。

不允许局部组件使用 `calc(var(--z-debug) + 1)`、`calc(var(--z-drawer) + 1)` 或任何 `calc(var(--z-*` 方式越级。tree overflow portal 不能高于 debug 和 lightbox，除非产品语义明确要求，并写入 registry。

overlay manager 必须集中拥有：

- open、close、dismiss。
- z-index slot。
- position CSS vars。
- outside click、Escape、window blur 和 route/tab cleanup。
- document/window listener lifecycle。
- focus return。
- body scroll lock 或 pointer lock 的保存与恢复。

新增 overlay 不允许在组件内直接注册长期 document/window listener 后只移除 DOM。程序化 dismiss、重复打开、窗口失焦、tab 关闭和异常路径都必须清理 listener 和 DOM。

### Motion 合同

CSS 动效必须遵守：

- 动画优先使用 `transform` 和 `opacity`。
- 不允许动画 `width`、`height`、`top`、`left`、`right`、`bottom`，除非是不可交互的极小尺寸过渡并有注释说明。
- layout resize、rail collapse、tree portal 展开必须避免引发布局抖动。
- `prefers-reduced-motion: reduce` 下必须禁用或显著降级所有非必要动画。

必须覆盖 reduced-motion 的对象：

- workspace fade。
- updater indeterminate progress。
- debug pulse。
- lightbox transition。
- WebClip aura、shimmer、loading、progress。
- tree portal expand/collapse。
- inspector/rail transition。

scanner 必须机械检查 `@keyframes`、`animation`、`transition-property` 和 `transition` 中的属性。新增动画必须证明 reduced-motion 下有关闭或降级路径。

### Responsive 合同

断点必须有单一来源。可以是 CSS custom properties、共享 TS 常量或等价机制，但 CSS 与 TS 不能各自硬编码相互冲突的断点。

必须解决：

- `responsive.css`、Settings、updater、injector、resizers TS 中断点分散。
- Tauri 主窗口最小宽度与 CSS 中 760/600 规则之间的死区。如果这些规则只服务 web/e2e，需要明确注释和测试；如果产品需要支持，必须提供 drawer 或可访问替代布局。
- inspector、sidebar、document tabs、command strip、status bar、Git panel、asset panel 在窄宽度下不能只隐藏关键功能而没有入口。
- 水平 overflow 不能依赖浏览器可见横向滚动条作为主要交互。

breakpoint registry 必须同时覆盖：

- CSS `@media`。
- CSS `@container`。
- TS `window.innerWidth` 判断。
- TS `matchMedia()`。
- Playwright viewport 矩阵。
- Tauri 最小窗口配置。

scanner 必须输出所有未注册 breakpoint。禁止新增裸 `@media (max-width: Npx)`、`@container (max-width: Npx)`、`window.innerWidth <= N` 或 `matchMedia("(max-width: Npx)")`，除非来自同一 registry 或进入 allowlist。

Container query 只允许解决组件内部重排，不能替代 app shell breakpoint。所有 `@container` 必须绑定命名 container，scanner 要检查 `container-name` 和 `@container <name>` 的对应关系。

视口验收必须覆盖：

```text
1728x1117
1440x900
1280x832
1180x760
1024x720
900x680
760x720
600x760
440x900
```

### RenderedSurface CSS 合同

CSS 必须与 RenderedSurface 模型对齐：

```text
reader
preview
visual-editor
git-diff
```

要求：

- Markdown 渲染内容使用统一 `.rendered-surface` 或等价根。
- 各 surface 差异通过 `data-surface="reader|preview|visual-editor|git-diff"` 或等价 profile 表达。
- `.aimd` 不能继续作为过宽的 catch-all 样式入口。
- Git Diff 不能维护一套完全独立且颜色硬编码的 Markdown 视觉岛。
- reader、preview、visual-editor、git-diff 的 link、image、task、code、frontmatter、selection、search highlight 视觉状态要有一致的 token 来源。

### 文本截断合同

`white-space: nowrap`、`text-overflow: ellipsis`、`text-overflow: clip`、line-clamp 或等价截断只能用于可恢复信息的 UI：

- tabs、路径、Git 文件名、模型名、状态文本必须有 title、aria-label、popover、copy、overflow portal 或等价恢复路径。
- 错误信息、API 状态、保存状态、权限失败、路径冲突不能静默截断。
- 截断策略必须在组件合同里说明是“可丢视觉细节”还是“必须可恢复内容”。
- scanner 必须输出所有 nowrap/ellipsis/clip/line-clamp 组合，并要求对应恢复路径或 allowlist。

### Scrollbar 合同

所有可滚动区域必须声明滚动角色：

```text
content
chrome
code
tabs
overlay
settings
webclip
```

要求：

- 隐藏 scrollbar 只能用于已有等价键盘或按钮导航的区域，例如 tabs 有显式 tab nav。
- content/code/settings/webclip 滚动区域不能隐藏唯一滚动线索。
- scrollbar 样式必须在 `base/scrollbars.css` 或对应组件作用域内，禁止像 reader 模块跨写 sidebar 和 textarea scrollbar。
- scanner 必须禁止跨模块 scrollbar 选择器。

### Print CSS 合同

打印样式必须作为独立 utility 被治理，不能由组件随意添加：

- `@media print`、`@page`、`print-color-adjust` 只能由 `utilities/print.css` 或等价 print entry 拥有。
- 打印时只输出 rendered document surface；app chrome、sidebar、inspector、overlay、debug、Settings、WebClip 控件必须隐藏。
- 必须定义 page margin、代码块换页、table overflow、图片最大尺寸、frontmatter 呈现、链接 URL 展示和颜色降级。
- scanner 必须禁止组件 CSS 私自写 print 规则。

### Font 合同

字体必须来自 token：

- Desktop、Settings、WebClip 共享 semantic font tokens。
- WebClip 禁止注入远程字体，不能在 host page 中引入外部 font 资源。
- 若未来引入 `@font-face`，必须有 `font-display`、本地 fallback、离线测试、CJK fallback 和 layout shift 验收。
- `font` shorthand 只能引用 token 或组件已登记字体角色，不能在 WebClip/Settings 中复制一套独立 font stack。

### Root layout 合同

`html`、`body`、`#app`、`#settings-app` 的 height、overflow、overscroll、background、selection、color-scheme 只能在 entry/base 层定义：

- Desktop 与 Settings 不得共享 body 背景副作用。
- body/html 不得出现横向滚动。
- overlay 打开和关闭不能永久改变 body overflow、pointer-events 或 selection。
- root background、font、color 和 color-scheme 必须由主题入口设置。

### WebClip 注入 UI 合同

WebClip 是本重构最高风险区域之一，必须单独达成以下条件：

- CSS 源可 lint、可扫描、可 code-size 检查。
- 优先使用 Shadow DOM 隔离；若不使用，必须证明 root scoping 足以抵御 host page CSS。
- 不允许全局污染 host page 的字体、颜色、selection、scrollbar。
- body overflow lock 必须保存旧值并完整恢复，不能只写 `""`。
- z-index 必须来自 token 或 registry，不能裸用 `2147483647`。
- `!important` 只能用于 host isolation 白名单。
- 所有颜色、圆角、阴影、动效进入 token。
- 支持 light、dark、high-contrast、forced-colors、reduced-motion。
- 在 hostile host CSS 中仍可读、可点击、可键盘操作。
- 必须声明可访问交互模型：若覆盖整页，使用 dialog 语义、可见 label、初始 focus、Esc/cancel、关闭后恢复 focus；若声明为非 modal，必须证明宿主页键盘焦点不会误入不可见或被遮挡区域。
- 必须有安装/卸载生命周期 owner，统一管理 style、shell、scrim、listeners、body lock 和 focus。
- 关闭、失败、取消、重复注入和窗口销毁路径都必须清理 AIMD DOM 节点、style 标签和事件监听。
- 重复注入不得累计 style 标签、shell 节点或 document/window listener。

### Settings UI 合同

Settings 必须从“复用完整主应用 CSS”变为独立入口：

- 不再导入 desktop full CSS。
- 修复 `--text-muted` 等 undefined token。
- preboot/loading 样式 token 化，使用动态视口单位。
- tab 必须有完整 ARIA 合同：`id`、`aria-controls`、`aria-selected`、roving keyboard 或等价键盘导航。
- panel 必须有 `aria-labelledby` 对应真实 tab id。
- API key、连接、保存等错误必须有 `role="alert"` 或等价可读状态，并通过 `aria-describedby` 关联字段。
- 表单 label、helper、error、disabled、focus、dirty、saving 状态必须 token 化。
- 小高度窗口下不能出现主要按钮不可达。
- Settings E2E 必须断言每个 `role="tab"` 有真实 `id`，每个 panel 的 `aria-labelledby` 可解析，每个 tab 的 `aria-controls` 指向真实 panel。
- ArrowLeft、ArrowRight、Home、End 必须支持 roving tabindex 或等价键盘导航。

### Accessibility 合同

重构必须补齐样式与 DOM 协同的可访问性合同：

- menu/action menu/context menu 使用 menuitem 和键盘导航。
- modal/dialog/lightbox 具备 `aria-modal`、focus trap、Esc 关闭、return focus。
- tooltip 不能只有 hover，键盘 focus 也必须可见或有替代 accessible name。
- focus ring 不能被 overflow、clip-path、transform、z-index 遮住。
- forced-colors 下所有主要控件仍有边界、焦点和选中态。
- disabled 控件视觉与语义同步。
- scanner 禁止新增 `outline: none` 或 `outline: 0`，除非同选择器附近存在可计算的 `:focus-visible` 替代。
- `pointer-events: none` 只能用于装饰层、测量层、穿透 mask 或显式禁用态；必须配套可点击子层、`aria-hidden` 或禁用语义。
- 若引入 axe 或其它 a11y 依赖，必须先声明依赖并纳入 package；若不引入，则用 Playwright DOM 与 computed style 断言覆盖 critical violations。

## 已知问题清单

以下问题必须纳入重构范围，不能只处理抽象架构：

- `apps/desktop/src/settings/template.ts` 中引用了未定义的 `--text-muted`。
- `--danger`、`--tone-danger`、局部 danger fallback 在 Git、overlay、forms 中混用。
- `apps/desktop/src/settings/main.ts` 仍加载完整主应用样式入口。
- `apps/desktop/settings.html` 存在内联 preboot CSS、硬编码颜色、独立 font stack 和 `100vh`，必须纳入 scanner 与入口治理。
- `apps/desktop/src/webview/injector-style.ts` 是大段 TS 字符串样式，硬编码颜色、z-index、动画和 `!important` 较多。
- `apps/dist/injector.js` 是 release 实际注入产物，必须证明由可扫描源生成，不能作为绕过门禁的构建产物。
- `apps/desktop/src/webview/injector.ts` 中 WebClip body overflow lock 需要保存并恢复旧状态。
- WebClip 关闭、失败、取消、重复注入路径缺少完整 DOM/style/listener/focus cleanup 合同。
- WebClip 目前缺少明确 dialog/focus/Esc/return-focus 可访问性交互模型。
- WebClip 当前裸用接近最大 z-index 的层级策略。
- tree overflow portal 当前有越过 debug/lightbox 的层级风险。
- tree overflow portal 展开/收起存在 width animation 风险。
- `app-topbar.css` 中存在 `calc(var(--z-drawer) + 1)` 这类 z-index 算术越级模式，必须收敛到 registry。
- `tokens.css` 与 `selection.css` 在 selection/user-select/focus 基础职责上边界不够清楚。
- `tokens.css` 同时承担 token、reset、body layout、button reset、selection 等职责，必须拆到 base/reset/selection/root layout。
- `selection.css` 里裸全局选择器和 `tokens.css` 的 user-select 规则重叠，必须以全局选择器 allowlist 治理。
- `overlays.css` 已混入 context menu、WebClip panel、health panel、format preview、save format 等多类职责。
- `reader.css` 混合 reader frame、editor split、Markdown typography、scrollbar、frontmatter 等职责。
- `reader.css` 跨模块写 sidebar、reader、textarea scrollbar，必须迁移到 scrollbar 合同或各自组件作用域。
- `toolbar.css`、`sidebar.css`、`overlays.css`、`reader.css` 接近 CSS 文件行数门禁，必须按职责拆分。
- Git Diff、debug console、lightbox、reader syntax highlight、WebClip 中存在大量硬编码颜色。
- `var(--danger, #a33)`、`var(--ink, #1d1a14)` 这类 fallback 色在非 token 层逃逸，必须通过 scanner 失败。
- `data-shell`、`data-mode`、`data-main-view`、`data-source-pressure` 等状态选择器需要收敛命名和作用域。
- `resizers.ts`、debug console、context menu、tree portal 等运行时 style 写入需要审计并转为 CSS var 或 overlay manager。
- context menu、debug console、tree overflow portal 当前直接写 `left/top/width/height/flex` 等 layout style，必须进入 runtime-style registry 或迁移。
- context menu 等 overlay 存在 document listener 生命周期分散风险，必须由 overlay manager 统一清理。
- CSS media query、container query、TS `window.innerWidth` 和 Tauri 最小窗口之间存在断点重复表达，必须由 breakpoint registry 统一。
- `launch.css` 已使用 container query 但缺少命名 container 与责任边界。
- `100vh`、`90vh`、`calc(100vh - ...)` 等 viewport unit 分散在 Settings preboot、overlay、lightbox 等位置，必须按 viewport unit 合同治理。
- tabs、Git、sidebar、toolbar 中存在大量 nowrap/ellipsis/clip，必须补可恢复信息路径。
- tab strip 隐藏 scrollbar，必须证明已有显式导航和键盘替代。
- 目前没有 print CSS 合同，打印入口和 app chrome 隐藏规则缺失。
- Desktop、Settings、WebClip font stack 分散，必须统一到 font token。
- `outline: none`、`:focus`、`pointer-events: none` 必须进入 accessibility scanner 白名单。
- mobile 规则隐藏 sidebar/inspector 后缺少完整替代入口的风险需要验证。
- Settings tab 的 ARIA id/control 关系、错误提示关联、键盘导航需要补齐。
- menus、dialogs、popovers、tooltips 的 keyboard/focus 合同需要补齐。
- E2E 目前缺少 CSS 架构 scanner、主题矩阵、forced-colors、reduced-motion、hostile WebClip 页面和 Settings 小高度矩阵。

## 实施边界

### 应该修改

- CSS 入口、tokens、layers、module split、component CSS。
- Settings 样式入口和必要的 ARIA/DOM 属性。
- WebClip 样式 pipeline、作用域、body lock 清理。
- overlay registry 和受管组件的 z-index 来源。
- 运行时 inline style 写入方式。
- CSS scanner、runtime registry、Playwright 验收和文档。
- Settings schema、默认值、迁移和事件同步中与 Theme State 直接相关的字段。
- root `check` 脚本或验收命令自洽性修复。

### 不应该修改

- Markdown parser、AIMD container、PDF sidecar、LLM provider、Git backend。
- source-preserving save 算法，除非只是为了对齐 class/profile 名称。
- tab ownership、document lifecycle、Git Diff close path。
- 发布 workflow。
- 与 CSS 架构无关的 UI 文案和产品流程。

## 验收标准

### 静态门禁

必须新增 `apps/desktop/scripts/check-css-architecture.mjs` 或等价 CSS 架构 scanner，并接入 `npm --prefix apps/desktop run check`。该 scanner 不替代 code-size gate，而是专门阻止 CSS 架构回退。

scanner 输入范围必须包括：

- `apps/desktop/src/**/*.css`。
- `apps/desktop/src/**/*.ts` 和 `tsx` 中的 `style="..."`、`HTMLElement.style.*`、`setProperty/removeProperty`、CSS 字符串导出和 style 注入代码。
- `apps/desktop/*.html` 的内联 `<style>`。
- WebClip 可扫描源样式。
- `npm --prefix apps/desktop run build:injector` 后的 `apps/dist/injector.js` 产物一致性检查。

测试 fixture、Markdown sanitizer fixture 和第三方样例必须通过路径 allowlist 排除，不能靠 broad ignore 掩盖生产问题。

scanner 至少检查：

- 未定义 CSS custom property 引用。
- CSS var registry 分类：token-defined、component-private-defined、runtime-defined、test-only。
- `var(--x, #fff)`、`var(--danger, #a33)` 这类 fallback 色逃逸。
- 裸颜色引用只允许出现在 token allowlist。
- 裸 z-index 只允许出现在 layer token 或 registry。
- 禁止 `calc(var(--z-*` 形式的 z-index 算术越级。
- `!important` 只允许出现在白名单选择器和白名单属性。
- 裸全局选择器只允许出现在 reset/base/accessibility/selection 白名单。
- `calc()`、`clamp()`、`min()`、`max()` 中的布局数值必须来自 spacing/sizing/breakpoint token 或 runtime var。
- 裸 viewport unit 用于 overlay/modal/lightbox/Settings/WebClip 高度或最大高度必须失败，除非 allowlist。
- runtime style 写入必须进入 allowlist registry。
- `outline: none/0` 必须有 `:focus-visible` 替代。
- `pointer-events: none` 必须有可访问替代或装饰/测量用途说明。
- nowrap/ellipsis/clip/line-clamp 必须声明可恢复信息路径。
- 隐藏 scrollbar 只能用于有显式替代导航的区域。
- `@container` 必须绑定命名 container。
- `@media print`、`@page` 只能由 print utility 拥有。
- Settings 不导入完整 desktop CSS。
- WebClip 样式源可被扫描。
- CSS 文件行数满足 code-size gate。
- `@layer` 声明完整且入口导入顺序符合合同。
- 禁止入口覆盖范围内出现未分层普通规则。
- 禁止在 TypeScript 模板中新增非动态 inline 样式。

scanner 输出必须稳定分组，至少包含：

```text
global-selectors
undefined-vars
runtime-vars
hard-colors
var-fallback-colors
naked-z-index
important-allowlist
runtime-style-writes
outline-none
pointer-events-none
nowrap-truncation
hidden-scrollbars
print-ownership
entry-imports
webclip-style-source
html-preboot-style
breakpoints
container-queries
```

### 自动化验证

验收命令必须先自洽。当前仓库根 `package.json` 不提供 `check` script，因此实施必须二选一：

- 新增 root `check` script，并让它覆盖 Desktop check、CSS 架构 scanner、必要 root 校验和 `cargo check --workspace`。
- 或者把本文所有 root `npm run check` 门禁替换为当前真实命令，并说明为什么 root check 不需要存在。

不得保留一个不存在或不会执行 CSS 架构 scanner 的完成门禁。

最终至少必须通过：

```bash
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run check
cargo check --workspace
git diff --check
```

如果新增 root `check` script，则还必须通过：

```bash
npm run check
```

必须新增或更新 targeted Playwright 覆盖，文件名可调整，但测试职责必须存在：

```text
apps/desktop/e2e/62-css-architecture-contract.spec.ts
apps/desktop/e2e/63-theme-contract.spec.ts
apps/desktop/e2e/64-webclip-css-isolation.spec.ts
apps/desktop/e2e/65-settings-css-accessibility.spec.ts
```

测试至少覆盖：

- light、dark、high-contrast 主题切换。
- `forced-colors: active`。
- `prefers-reduced-motion: reduce`。
- desktop 主视图三栏布局。
- reader、preview、visual-editor、git-diff 四类 surface。
- Settings 各 tab、错误态、saving、disabled、小高度窗口。
- WebClip 在 hostile host CSS 页面中打开、工作、预览、错误、关闭。
- WebClip 关闭、失败、取消、重复注入后的 DOM/style/listener/body overflow/focus 清理。
- overlay 层级：context menu、action menu、popover、lightbox、debug、tree portal 不互相错误覆盖。
- overlay open/close/dismiss、Escape、outside click、window blur、return focus 和 listener cleanup。
- tab overflow、sidebar/inspector collapse、rail resize 后无水平溢出。
- Settings tablist 的 id、aria-controls、aria-labelledby、ArrowLeft/Right/Home/End 和 roving tabindex。
- menu/dialog/popover/lightbox/WebClip 的 Tab、Shift+Tab、Esc、return focus。
- print CSS 只打印 rendered document surface，隐藏 app chrome 和 overlay。

### 视觉矩阵

至少在以下状态截图或像素检查：

- 无项目、无文档。
- 有项目、无打开文档。
- 多文档 tabs，含 dirty tab。
- Markdown source + preview。
- visual editor。
- reader。
- Git inspector：repo、non-repo、dirty、clean。
- Git Diff tab。
- asset panel。
- health/debug/updater/lightbox。
- Settings general/provider/model/key/error。
- WebClip idle/loading/result/error。
- print preview 或等价 print computed style。
- hostile host CSS 下的 WebClip focus、dialog、theme 和 reduced-motion 状态。

每个状态至少覆盖默认主题和一个非默认主题。关键布局状态必须覆盖窄宽度。

### 人工验收

人工检查必须确认：

- 主题切换没有闪烁、错色、局部旧主题残留。
- 焦点环在所有主要控件上清晰可见。
- overlay 层级符合产品语义。
- Settings 不再继承主应用无关样式。
- WebClip 不污染宿主页，也不被宿主页轻易破坏。
- 三栏、右侧 inspector、tab strip、command strip、status bar 无文本重叠和横向溢出。
- reduced-motion 下没有明显自动运动。
- 所有截断文本都有恢复路径，错误、路径、API 状态和保存状态没有静默丢失信息。
- body/html/root 在所有矩阵下无横向滚动，overlay 关闭后无 body overflow 残留。

## 完成定义

只有同时满足以下条件，才能认为本目标完成：

- 目标架构中的入口、layer、token、theme、overlay、motion、responsive、surface、WebClip、Settings 合同全部落地。
- Theme State 的 schema、持久化、启动同步和跨窗口即时切换合同落地。
- 已知问题清单逐项处理或以代码注释、测试、文档说明为什么不再适用。
- 新增 CSS 架构 scanner 并接入真实可执行的 check 门禁。
- scanner 覆盖 CSS、TS 样式写入、HTML preboot、WebClip 源样式和 injector 构建产物一致性。
- 所有自动化验证通过。
- Playwright 覆盖主题、reduced-motion、forced-colors、WebClip hostile host CSS、Settings accessibility、overlay 层级和关键视口。
- Playwright 覆盖 WebClip 生命周期清理、overlay listener cleanup、keyboard/focus、print、text truncation、hidden scrollbar 和 root overflow。
- 没有新增未解释的 `!important`、裸颜色、裸 z-index、undefined var、非动态 inline style、未登记 runtime style、未登记 breakpoint、未登记 container query 或未分层规则。
- 没有通过删除功能、隐藏状态、降低测试或放宽门禁完成重构。
- 未修改与 CSS 架构无关的用户本地脏改动。
