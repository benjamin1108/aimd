# /goal: 渲染区归一化重构生产目标

## 背景

AIMD Desktop 现在存在多个渲染区域：阅读区、预览区、可视化编辑区，以及围绕它们的 Git 对比、Markdown 图片、链接、任务勾选、代码复制、图片放大、状态栏提示等交互。当前渲染 HTML 的来源大体一致，但 DOM 写入、后处理和交互绑定散落在不同模块与不同调用点中，导致同一份 Markdown 在不同渲染区出现行为不一致：

- 有的区域点击图片会放大，有的不会。
- 有的区域链接提示和打开规则一致，有的会走浏览器默认行为或局部事件逻辑。
- 图片本身是链接时，普通点击和 `Cmd/Ctrl+点击` 的职责容易互相抢占。
- 渲染后处理的执行顺序不明确，功能之间存在隐式依赖。
- 后续修复容易只改一个区域，从而再次引入行为分叉。

这类问题不是单点 bug，而是架构边界不清晰造成的持续风险。本目标要求完成生产级归一化重构：所有渲染区域必须通过同一套渲染表面管线完成 DOM 写入、后处理、交互绑定和状态更新，任何差异只能由显式、类型化的渲染表面配置表达。

## 目标

建立统一的 Rendered Surface 架构，使阅读区、预览区、可视化编辑区、Git 对比等所有展示 Markdown 渲染结果的区域都共享同一个渲染处理流程，并保证现有功能不丢失、体验不回退、测试能够覆盖关键行为。

完成后应满足：

- 同一份 Markdown 输入在同一渲染表面配置下生成确定性的 DOM 和交互行为。
- 所有渲染区的 HTML 写入、资源处理、链接处理、图片处理、任务项处理、代码块增强、状态栏提示都进入同一个管线。
- 各区域差异必须是显式配置项，例如是否可编辑、是否显示代码复制按钮、是否允许任务勾选、是否需要源码标注、是否隐藏 frontmatter。
- 不允许任何渲染区绕过统一管线自行绑定核心交互。
- 不允许以删功能、弱化行为、跳过门禁或降低测试覆盖来完成重构。

## 非协商要求

### 单一代码源

所有渲染区必须使用同一个公开入口，例如：

```ts
paintRenderedSurface(surface, renderedHtml, context)
```

或等价的统一 API。调用方可以选择渲染表面配置，但不能自行复制以下逻辑：

- HTML 写入。
- Markdown 图片资源改写与补充标记。
- 本地资源 hydrate。
- frontmatter UI 处理。
- heading/id/outline 相关同步。
- 任务 checkbox 绑定。
- 代码块复制按钮绑定。
- 链接点击与 hover 状态栏提示。
- 图片 lightbox 绑定。
- 渲染版本与 stale state 更新。

如果某个区域确实需要差异行为，必须在表面配置中表达，并有测试说明该差异是产品行为而不是实现分叉。

### 行为一致性

所有 Markdown 渲染表面必须遵守同一套交互规则：

- 文本链接普通点击不打开链接，只在状态栏提示需要 `Ctrl/⌘ 点击打开链接`。
- 文本链接 `Cmd/Ctrl+点击` 打开链接。
- 鼠标 hover 到任何链接上时，状态栏立即显示打开提示。
- 鼠标离开链接时，状态栏提示必须立即消失，不允许等待 timeout。
- 图片普通点击打开 lightbox。
- 图片位于链接内部时，普通点击仍只打开图片 lightbox，不跳转链接。
- 图片位于链接内部时，`Cmd/Ctrl+点击` 只打开链接，不同时打开 lightbox。
- 不允许浏览器/WebView 默认导航绕过应用自己的打开逻辑。
- 对比区、阅读区、预览区、可视化编辑区的上述行为必须一致，除非产品配置明确禁止某项能力。

### 功能不能回退

重构必须保留以下能力：

- 阅读区渲染 Markdown。
- 预览区渲染 Markdown。
- 可视化编辑区渲染 Markdown 并支持现有编辑能力。
- Git 对比渲染区保持与普通渲染区一致的图片、链接和基础交互行为。
- 本地 Markdown 图片继续可见，并保持 AIMD 资源路径解析能力。
- 远程图片、普通 URL 图片、AIMD 内嵌资源图片的显示行为保持正确。
- 任务列表 checkbox 在允许编辑的表面继续更新源 Markdown。
- 代码块复制按钮在应出现的表面继续可用。
- outline、heading id、滚动定位、选区边界、搜索高亮不因统一管线失效。
- frontmatter 在可视化编辑中的 UI 处理继续符合现有产品语义。
- source-preserving editor 保存语义不被破坏。
- 普通 `.md` 保存语义不被破坏。
- `Cmd+W`、tab 生命周期、脏文档保存确认不受本重构影响。

### 门禁不能放松

代码长度门禁是重构完成条件之一。任何新增或修改文件都必须通过项目现有 code-size gate，不允许用忽略规则掩盖超长文件。

如果重构造成某个文件超长，必须继续拆分职责，直到 `npm run check` 通过。不能把“功能已完成但门禁没过”视为重构完成。

## 目标架构

### 模块边界

新增或整理为一个清晰的渲染表面模块，例如：

```text
apps/desktop/src/rendered-surface/
  pipeline.ts
  profiles.ts
  interactions.ts
  assets.ts
  source-annotations.ts
  types.ts
```

具体文件名可以按现有代码风格调整，但职责边界必须清晰：

- `pipeline` 负责唯一的渲染处理顺序。
- `profiles` 定义所有表面配置。
- `interactions` 负责链接、图片、任务项、代码复制等共享交互。
- `assets` 负责 Markdown 图片、AIMD 资源、本地资源 URL 的统一处理。
- `source-annotations` 负责可视化编辑需要的源码定位标记。
- 现有 `outline.ts`、`interactive.ts`、`lightbox.ts` 可以保留，但必须收敛为统一管线的内部实现或薄调用层。

### 表面配置

渲染表面差异必须由类型化 profile 表达，例如：

```ts
type RenderedSurfaceKind =
  | "reader"
  | "preview"
  | "visual-editor"
  | "git-diff";

type RenderedSurfaceProfile = {
  kind: RenderedSurfaceKind;
  root: HTMLElement;
  contentEditable: boolean;
  stripFrontmatter: boolean;
  sourceAnnotations: boolean;
  hydrateMarkdownImages: boolean;
  taskToggle: boolean;
  codeCopy: boolean;
  linkOpen: "modifier";
  imageLightbox: boolean;
  syncOutlineIds: boolean;
};
```

不要求完全使用以上字段名，但最终代码必须能清楚表达：差异来自配置，而不是来自多处手写分支。

### 三个文档渲染区的能力配置

`readOnly` 在本目标中只表示该 surface 不是 `contentEditable`。它不等于“绝对不允许改变文档”。例如阅读区和预览区当前允许通过任务 checkbox 更新 Markdown，这属于显式的 `taskToggle` 能力，必须由 profile 表达清楚。

| 能力 | 阅读区 `reader` | Markdown 预览区 `preview` | 可视化编辑区 `visual-editor` |
| --- | --- | --- | --- |
| DOM root | `readerEl()` | `previewEl()` | `inlineEditorEl()` |
| 对应 mode | `read` | `source` 的预览面板 | `edit` |
| 是否 `contentEditable` | 否 | 否 | 是 |
| 是否可滚动并保存位置 | 是，`scroll.read` | 是，`scroll.source` | 是，`scroll.edit` |
| 是否写入 canonical rendered HTML | 是 | 是 | 是，但需先应用编辑区 profile |
| 是否显示 frontmatter | 显示为不可编辑的 `.aimd-frontmatter` 元信息区 | 显示为不可编辑的 `.aimd-frontmatter` 元信息区 | 不直接显示 `.aimd-frontmatter`，由 Markdown/source 源码保留 |
| 是否需要 source annotation | 否 | 否 | 是，供 source-preserving patch 定位 |
| 是否允许代码复制 | 是 | 是 | 否，避免在 contentEditable 内插入额外可编辑控件 |
| 是否允许任务 checkbox | 是 | 是 | 是 |
| 是否允许图片 lightbox | 是 | 是 | 是 |
| 是否允许链接 hover 提示 | 是 | 是 | 是 |
| 是否允许普通点击文本链接打开 | 否 | 否 | 否 |
| 是否允许 `Cmd/Ctrl+点击` 打开链接 | 是 | 是 | 是 |
| 是否 hydrate 本地 Markdown 图片 | Markdown 文件且有路径时是 | Markdown 文件且有路径时是 | Markdown 文件且有路径时是 |
| 是否参与 heading id 同步 | 是 | 是 | 是 |
| 是否参与 outline 滚动定位 | 当前 mode 为 `read` 时是 | 当前 mode 为 `source` 时是 | 当前 mode 为 `edit` 时是 |
| paint version key | `read` | `source` | `edit` |

这张表是重构后的默认产品合同。若实现时发现某项现有行为与表格冲突，必须先确认产品语义，再更新 GOAL 和测试，不能在代码中静默保留第四种隐式行为。

### Frontmatter 体验合同

YAML frontmatter 的保护提示不能继续以 source textarea 顶部 banner 的方式存在。

原因：

- Source mode 本身就是 Markdown 源码编辑状态，frontmatter 在这里本来就可编辑，不需要提示“被保护”。
- 额外 banner 会占用 textarea 上方高度，导致 Markdown 源码标题栏和预览标题栏纵向无法对齐。
- 保护提示属于渲染态信息，不应污染源码编辑态的布局。

重构后的合同：

- 因 YAML frontmatter 存在而出现的 source banner 必须移除。
- Source mode 中，textarea 和右侧/旁侧 preview 的标题栏必须保持纵向对齐。
- 如果存在 Git 冲突、渲染失败、保存风险等真正异常提示，可以保留独立提示，但不能复用“frontmatter 保护说明”作为常驻布局块。
- 阅读区和 Markdown 预览区的 `.aimd-frontmatter` 必须明确呈现为不可编辑元信息区。
- `.aimd-frontmatter` 可以借鉴当前 source banner 的蓝色、金属质感、低饱和信息色，但样式应落在渲染卡片本身，而不是落在源码编辑栏上方。
- 该样式不能像错误警告，也不能抢正文标题的视觉层级；它应表达“这是受保护的元信息块，不是正文内容”。
- 可视化编辑区仍不得把 frontmatter 当作普通可编辑正文暴露给用户；frontmatter 的编辑入口是 Markdown/source 模式。

验收时必须截图或 e2e 检查：

- 有 frontmatter 的文档切到 source mode 后，不出现 frontmatter 保护 banner。
- Markdown 源码区和预览区标题栏顶部对齐。
- 阅读/预览渲染态的 `.aimd-frontmatter` 使用新的不可编辑元信息视觉样式。
- 切换 read/source/edit 不引入布局跳动。

### Surface 状态合同

统一管线必须把状态分为三类，不能混在一个函数里隐式读写。

#### 文档级 canonical 状态

这些状态属于当前文档，不属于某个 surface：

- `state.doc.markdown`：Markdown 源。
- `state.doc.html`：canonical rendered HTML。它应表示稳定的渲染结果，不应依赖当前可见 surface。
- `state.htmlVersion`：每次 canonical HTML 或由编辑导致的 HTML 版本变化时递增。
- `state.outline`：从 canonical HTML 提取，而不是从某个偶然可见的 surface 提取。
- `state.sourceModel`、`sourceDirtyRefs`、`sourceStructuralDirty`：只服务可视化编辑的 source-preserving 语义，但生命周期跟随文档。

#### Surface 级状态

这些状态按 surface 独立维护：

- `state.paintedVersion.read`、`state.paintedVersion.source`、`state.paintedVersion.edit`。
- `scroll.read`、`scroll.source`、`scroll.edit`。
- 当前 root 是否 hidden。
- surface 上一次绑定的交互 controller 版本或 cleanup handle。

统一入口每次 paint 一个 surface 后，只能更新该 surface 对应的 `paintedVersion`。不能因为刷新 reader 顺手标记 preview/editor 已刷新，也不能因为 hydrate 某个 hidden surface 就污染当前可见状态。

#### Source mode 附加状态

Markdown `source` mode 实际包含两块 UI：textarea 和 preview surface。RenderedSurface 只负责 preview surface，不能接管 textarea 的职责：

- `markdownEl().value` 仍由 source 编辑逻辑维护。
- `sourceSelection` 仍属于 textarea，不属于 `previewEl()`。
- source banner 仍由 mode/source 逻辑维护。
- `previewEl()` 的滚动保存为 `scroll.source`，但 textarea selection 不能被 preview repaint 改写。

### 不可简单合并的地方和坑

不存在理论上不可实现的阻碍，但有几个点不能用“把三块 DOM 丢进同一个函数”来粗暴解决。

#### 可视化编辑区不是普通预览

`inlineEditorEl()` 是 `contentEditable`，它承担 source-preserving patch 的源定位。统一管线可以负责写入和后处理，但必须在 editor profile 中额外执行：

- 去除或保护 `.aimd-frontmatter`。
- `annotateSourceBlocks`。
- paint 后将 `inlineDirty` 置为 `false`，但只能在确实从 canonical HTML 重绘编辑区时执行。
- 不能插入会被用户编辑到 Markdown 里的代码复制按钮。
- 不能让 lightbox/link 事件破坏正常文本选择、输入、IME 和 toolbar 操作。

#### 任务 checkbox 的 index 映射有风险

当前任务切换逻辑按 DOM 中 checkbox 的顺序映射 Markdown 任务项。统一后必须确保：

- 每个 surface 的 checkbox 顺序与 Markdown 源顺序一致。
- 同一个点击只触发一次 `toggleTaskMarkdown`。
- hidden surface 的 checkbox 不会响应事件。
- 任务切换后重新 render 时不会出现旧 surface 继续提交旧 index。

如果后续 Markdown renderer 对任务列表输出顺序或嵌套结构有变化，必须补专门测试。

#### hydrate 不能污染 canonical HTML

本地 Markdown 图片 hydrate 是运行时增强，可能把图片 `src` 改成 `blob:`。这不应改变 Markdown 源，也不应把某个 surface 的临时 object URL 当作新的 canonical HTML 长期保存。

统一管线必须明确区分：

- canonical HTML：用于 session、repaint、outline、source model 对齐。
- hydrated DOM：用于当前 surface 展示。

如果为了性能需要缓存 hydrated HTML，必须带 tab id、htmlVersion、surface kind，不能写回错误文档或其他 surface。

#### heading id 与 outline 必须有唯一来源

heading id 不能由三个 surface 各自生成。必须从 canonical HTML 生成一次，再同步到各 surface。否则会出现：

- outline 点击滚动到不存在的 id。
- reader/preview/editor 的 heading id 不一致。
- source-preserving annotation 和 outline 定位互相干扰。

#### 事件顺序必须显式

图片链接的规则依赖事件顺序：

- 普通点击 linked image：lightbox 处理器先接管，阻止链接打开。
- `Cmd/Ctrl+点击` linked image：lightbox 放行，链接处理器打开外部 URL。

共享交互控制器必须把这条规则写成明确分支，并用 e2e 验证。不能依赖 listener 注册顺序的偶然结果。

#### 现有测试语义要统一

当前历史测试里可能存在对 lightbox 行为的旧描述，例如早期测试可能认为编辑模式图片不应打开 lightbox，而后续产品语义要求可视化编辑区图片也能打开 lightbox。重构时必须先以当前产品合同为准清理测试语义：

- 保留正确产品行为。
- 删除或改写过时断言。
- 不允许为了通过旧测试牺牲当前用户确认过的行为。

### 统一管线顺序

统一渲染入口必须保持稳定顺序。建议顺序如下：

1. 接收已经由 Markdown 渲染器生成的 HTML，或在上游只渲染一次后分发。
2. 根据文档上下文统一处理资源 URL 与 AIMD 资源映射。
3. 将 HTML 写入目标 root。
4. 按 profile 执行 frontmatter UI 处理。
5. 标记图片、链接、代码块、任务项等可交互节点。
6. 按 profile 执行源码定位标注。
7. hydrate 本地 Markdown 图片与 AIMD 资源图片。
8. 绑定共享交互控制器。
9. 同步 heading id、outline、滚动定位所需状态。
10. 记录渲染版本、surface state、stale state。

任何后续新增渲染能力都必须插入这个管线，而不是在某个调用点旁路补丁。

### 事件绑定原则

交互绑定必须满足：

- 同一个 root 多次渲染后不能累积重复 listener。
- listener 生命周期由统一管线管理。
- 图片 lightbox、链接打开、hover 状态提示必须共享事件委托逻辑。
- 修饰键点击必须在最早的共享逻辑中判定，避免 lightbox 和链接打开同时触发。
- 所有阻止默认行为的地方必须可解释，并由测试覆盖。

### 架构原则对照

本重构必须逐项满足以下架构原则，不能只完成其中一部分：

| 架构原则 | 验收标准 |
| --- | --- |
| 一个入口负责所有渲染面 | `reader`、`preview`、`inline-editor`、以及所有展示 Markdown HTML 的对比/预览表面，都只能通过统一 Rendered Surface 入口写入 DOM 和执行后处理。 |
| 一个共享交互控制器 | 链接 hover、`Cmd/Ctrl+点击`、图片 lightbox、任务 checkbox、代码复制必须由同一个交互模块按 profile 开关启用。 |
| profile 只表达职责差异 | `reader`、`preview`、`visual-editor` 的差异必须来自配置，例如 `readOnly`、`contentEditable`、`codeCopy`、`taskToggle`、`sourceAnnotations`。 |
| 渲染后处理顺序固定 | 所有 surface 必须执行同一顺序：render markdown -> rewrite assets -> write DOM -> tag nodes -> hydrate images -> bind interactions -> sync outline/session。 |

当前 `outline.ts` 中分别处理 `readerEl()`、`previewEl()`、`inlineEditorEl()` 的逻辑是本目标要消除的架构问题。`outline.ts` 最终只能描述“哪些 surface 需要刷新”和“当前文档状态是什么”，不能直接知道每个 surface 的 DOM 后处理细节。

## 缺陷排查清单

完成重构前必须逐项排查以下缺陷可能，并用代码结构或测试证明已经覆盖。

### 渲染入口与调用点

- 是否仍有调用点直接给 `readerEl()`、`previewEl()`、`inlineEditorEl()`、Markdown 对比/预览 surface 写 `innerHTML`。
- 是否仍有调用点在统一管线外调用 `tagAssetImages`、`hydrateMarkdownLocalImages`、`annotateSourceBlocks`、`enhanceRenderedDocument` 或等价后处理。
- stale repaint、模式切换 repaint、初次 render、文档切换 render 是否都走同一个入口。
- 异常路径、空文档、无标题文档、二进制/不可渲染内容是否不会留下旧 surface 内容。

### 资源与图片

- AIMD asset URL、远程图片 URL、普通相对路径图片、本地 Markdown 图片是否都在所有适用 surface 中显示一致。
- 异步本地图片 hydrate 是否有 tab id、render version 或等价防护，避免切换文档后把旧图片写回新文档。
- object URL 生命周期是否不会导致重复创建、错误复用或泄漏。
- 图片包在链接中时，普通点击和修饰键点击是否严格互斥。
- 隐藏 surface 上的点击事件是否不会打开 lightbox 或链接。

### 链接与状态栏

- 所有外部链接是否只允许应用批准的协议，例如 `http:`、`https:`、`mailto:`。
- 普通点击是否不会触发 WebView 默认导航。
- `Cmd/Ctrl+点击` 是否只调用应用外部打开命令一次。
- hover 状态栏提示是否由统一 action key 管理。
- mouseout、surface 被隐藏、文档切换、tab 切换时，链接提示是否立即清理，不残留旧提示。
- 链接内子元素移动时，mouseover/mouseout 是否不会闪烁或误清理。

### 编辑与保存语义

- 可视化编辑区的 source annotation 是否仍能定位到正确 Markdown 源片段。
- frontmatter 在可视化编辑中的移除/保留规则是否与现有语义一致。
- 任务 checkbox 的 index 映射是否不因多 surface 共享而错位。
- 任务勾选后是否只更新当前活动文档，不影响隐藏 surface 或其他 tab。
- source-preserving patch 是否不因 DOM 标记变化产生无关 Markdown churn。
- 普通 `.md` 保存是否不被本重构意外转换为 `.aimd` 或打包资源。

### Outline、滚动、选区与会话

- heading id 是否从同一 canonical HTML 同步到所有 surface。
- outline 点击滚动是否仍定位到当前可见 surface。
- 阅读、编辑、source 预览的 scrollTop 是否继续独立保存和恢复。
- source textarea selection 是否不被 surface repaint 破坏。
- session snapshot 是否在 hydrate 完成和 render 完成后保持一致，不保存半成品 HTML。
- tab 切换、关闭、重开后，surface state 是否不会串到其他 tab。

### 事件生命周期

- 重复 render 后不会重复绑定 click、mouseover、mouseout、scroll、copy 等 listener。
- 新旧 root 内容替换后，旧节点上的一次性 handler 不会继续影响新内容。
- lightbox 打开、关闭、ESC、点击遮罩、点击图片本身的既有行为不回退。
- 代码复制按钮不会重复插入。
- 交互 controller 不能直接读写不属于它的业务状态，必须通过 context 回调。

## 功能保全矩阵

| 能力 | 阅读区 | 预览区 | 可视化编辑区 | Git 对比区 |
| --- | --- | --- | --- | --- |
| Markdown 渲染 | 必须 | 必须 | 必须 | 必须 |
| 本地/AIMD 图片显示 | 必须 | 必须 | 必须 | 必须 |
| 普通图片点击放大 | 必须 | 必须 | 必须 | 必须 |
| 链接图片普通点击放大 | 必须 | 必须 | 必须 | 必须 |
| 链接图片修饰键点击打开链接 | 必须 | 必须 | 必须 | 必须 |
| 文本链接普通点击不跳转 | 必须 | 必须 | 必须 | 必须 |
| 文本链接修饰键点击打开链接 | 必须 | 必须 | 必须 | 必须 |
| 链接 hover 状态栏提示 | 必须 | 必须 | 必须 | 必须 |
| hover 离开提示立即消失 | 必须 | 必须 | 必须 | 必须 |
| 代码块复制 | 必须 | 必须 | 按现有语义 | 按现有语义 |
| 任务 checkbox | 按现有语义 | 按现有语义 | 必须 | 按现有语义 |
| source annotation | 不需要 | 不需要 | 必须 | 不需要 |
| frontmatter UI 处理 | 按现有语义 | 按现有语义 | 必须 | 按现有语义 |

如果实现中某列确实不适用，必须在代码配置和测试说明中体现，而不是依赖缺省行为。

## 实施要求

### 代码迁移

完成重构时必须做到：

- 找出所有写入 `reader`、`preview`、`inline-editor`、Git diff 渲染 root 的调用点。
- 移除这些调用点中的重复后处理逻辑。
- 统一由 Rendered Surface 管线负责增强渲染结果。
- 保留调用点的业务职责，例如决定当前文档、渲染版本、模式切换、是否 stale。
- 不把业务状态塞进交互模块；交互模块通过 context 回调执行打开链接、更新任务、打开 lightbox、设置状态栏等动作。

### 测试迁移

不能删除现有覆盖行为的测试来让重构通过。可以调整 selector 或测试入口，但断言必须等价或更强。

重构必须新增一个集中回归测试，例如：

```text
apps/desktop/e2e/60-rendered-surface-unification.spec.ts
```

该测试应覆盖同一份 fixture 在多个渲染表面上的一致行为。

### 体验约束

重构后不允许出现以下体验回落：

- 切换阅读、预览、可视化编辑时出现明显闪烁或空白。
- 图片加载路径变慢或失败。
- 状态栏提示残留。
- 链接被普通点击误打开。
- 图片链接一次点击触发两个动作。
- 任务勾选更新错位。
- 保存后 Markdown 产生无关格式 churn。
- 对比视图丢失图片或交互。

## 必须新增或更新的测试

### 渲染表面一致性

新增 e2e fixture，包含：

- 普通文本链接。
- 图片。
- 图片包在链接中。
- 本地 Markdown 图片。
- AIMD 资源图片。
- 任务列表。
- 代码块。
- 多级 heading。
- frontmatter。

同一 fixture 必须在阅读区、预览区、可视化编辑区、Git 对比区验证核心一致行为。

### 链接与图片交互

必须断言：

- 文本链接普通点击不会调用外部打开。
- 文本链接 `Cmd/Ctrl+点击` 会调用外部打开。
- hover 文本链接会立即显示状态栏提示。
- mouseout 后提示立即消失。
- 普通图片点击打开 lightbox。
- 链接图片普通点击只打开 lightbox。
- 链接图片 `Cmd/Ctrl+点击` 只打开链接，不打开 lightbox。
- 对比区行为与普通阅读区一致。

### 回归覆盖

至少运行并保持通过：

- `apps/desktop/e2e/16-ux-polish.spec.ts`
- `apps/desktop/e2e/31-md-open-association.spec.ts`
- `apps/desktop/e2e/42-editor-core-capabilities.spec.ts`
- `apps/desktop/e2e/46-git-workspace-panel.spec.ts`
- `apps/desktop/e2e/49-selection-boundary.spec.ts`
- `apps/desktop/e2e/50-source-preserving-editor.spec.ts`
- `apps/desktop/e2e/52-open-documents-tabs.spec.ts`
- `apps/desktop/e2e/59-external-media-links.spec.ts`
- 新增的渲染表面归一化测试

## 验收门禁

完成本目标前必须通过：

```bash
npm run check
npx playwright test apps/desktop/e2e/16-ux-polish.spec.ts apps/desktop/e2e/31-md-open-association.spec.ts apps/desktop/e2e/42-editor-core-capabilities.spec.ts apps/desktop/e2e/46-git-workspace-panel.spec.ts apps/desktop/e2e/49-selection-boundary.spec.ts apps/desktop/e2e/50-source-preserving-editor.spec.ts apps/desktop/e2e/52-open-documents-tabs.spec.ts apps/desktop/e2e/59-external-media-links.spec.ts apps/desktop/e2e/60-rendered-surface-unification.spec.ts
git diff --check
```

如果本次改动触碰 Tauri/Rust 侧命令、资源路径、文件读写或外部打开命令，还必须通过：

```bash
cargo check --workspace
```

所有门禁必须真实运行并记录结果。不能以“仅文档变化”“只改前端”“测试太慢”为理由跳过与实际改动相关的门禁。

## 完成定义

只有同时满足以下条件，才算完成：

- 所有渲染区都通过统一 Rendered Surface 管线。
- 旧的分散后处理逻辑已经移除或收敛为统一管线内部实现。
- 行为差异全部来自显式 profile，而不是调用点私有分支。
- 功能保全矩阵中的能力均有代码路径和测试覆盖。
- 新增的归一化 e2e 测试覆盖阅读、预览、可视化编辑、Git 对比。
- `npm run check` 通过，代码长度门禁无豁免。
- 相关 Playwright 测试通过。
- `git diff --check` 通过。
- 没有引入保存语义、tab 生命周期、source-preserving editor、Markdown 图片资源处理的回归。

## 非目标

本目标不要求：

- 更换 Markdown 渲染器。
- 重写编辑器内核。
- 修改 `.aimd` 文件格式。
- 改变普通 `.md` 保存语义。
- 重新设计整体 UI 视觉风格。
- 改变外部链接安全策略以外的应用权限模型。

这些内容如果被发现需要调整，必须另写目标文档，不能混入本次渲染归一化重构。
