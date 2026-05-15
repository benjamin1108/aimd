# /goal: 一键格式化、YAML 元信息化、保存格式选择

## 背景

AIMD Desktop 已支持打开/编辑 `.aimd` 和 Markdown，也有网页导入中的智能排版能力。现在需要把“从别处复制来的文档”也能一键整理成标准、清晰、美观的 Markdown 文档。

这不是简单的 prettier。目标是把杂乱 Markdown / 粘贴内容整理为适合人阅读、适合 AI 处理、结构稳定的文档：

- 标题层级规范。
- 正文完整保留。
- 语言可按设置输出。
- 摘要、核心观点等结构化信息不要塞进正文块引用，而应放入 YAML frontmatter。
- 阅读和编辑模式下 YAML meta 不应被普通正文编辑误改；源码模式允许高级用户直接修改。
- 保存时用户可以明确选择保存为 `.md` 还是 `.aimd`，而不是被当前保存路径和内嵌资源状态隐式带走。

本 goal 包含三个相互关联的项目级能力：

1. 一键格式化：用模型整理当前文档内容。
2. YAML meta 化：摘要、核心观点等结构化信息进入 frontmatter，并在阅读/编辑模式下保护。
3. 保存格式选择：保存/另存时可选择 Markdown 或 AIMD。

## 产品目标

完成一个可上线的一键格式化能力：

- 主文档界面提供“一键格式化”入口。
- 该能力针对当前打开/编辑中的文档运行。
- 输入可以是用户从别处复制来的 Markdown 或粘贴后生成的正文。
- 输出是结构化、规范、美观的 Markdown。
- 格式要求参考网页导入的智能排版要求，但适配“本地当前文档”场景。
- 摘要、核心观点、关键词、语言、格式化模型等元信息进入 YAML frontmatter。
- 正文保留完整内容，不把正文压缩成摘要。
- 支持多语言输出。
- 一键格式化有独立模型设置。
- 保存时可以选择保存为 `.md` 或 `.aimd`。

## 非目标

- 不做全自动后台格式化；必须由用户主动点击。
- 不在用户没有确认时覆盖当前文档内容。
- 不删除正文段落。
- 不要求模型生成事实外的新内容。
- 不把 `.aimd` 格式改成非 Markdown 容器。
- 不要求第一版支持批量格式化多个文件。
- 不要求第一版实现复杂模板市场或可编辑 prompt 系统。

## 用户体验要求

### 一键格式化入口

建议入口：

- 文档更多菜单 `⋯` 中新增：`一键格式化`
- 可选：编辑工具栏增加图标按钮，但不要让主界面变吵。

入口启用条件：

- 当前有文档。
- 当前文档非空。
- 没有正在保存/导入/格式化的任务。

点击后：

1. 如果当前处于编辑模式，先 `flushInline()`。
2. 显示简短状态：`正在格式化文档...`
3. 调用模型格式化当前 Markdown。
4. 返回后不要直接静默覆盖。需要一个轻量确认流程：
   - 至少展示“应用 / 取消”。
   - 最好提供 diff 预览，第一版可以接受 Markdown 文本预览，但不能无提示覆盖。
5. 用户点击“应用”后：
   - 替换当前文档 Markdown。
   - 重新渲染 HTML。
   - 设置 dirty。
   - 保持当前文件路径和格式不变。

### 语言设置

一键格式化需要独立语言设置：

- `zh-CN`
- `en`
- 后续可扩展更多语言。

语言语义：

- 如果输出语言与原文不同，模型应忠实翻译完整正文。
- 不允许只翻译标题和摘要而正文仍混杂。
- 链接、代码、命令、产品名、模型名、数字、表格语义必须保留。

### 模型设置

一键格式化需要独立模型设置：

- provider
- model
- outputLanguage

API Key / API Base 复用 `AI / 模型` 中对应 provider 的全局凭证。

设置位置建议：

- 设置页新增一个分类：`格式化`
- 或在 `AI / 模型` 后增加分区，但建议独立分类，避免网页导入和普通模型配置继续膨胀。

设置项建议：

- `启用模型格式化` 或不需要开关，入口即代表启用。
- `Provider`
- `格式化模型`
- `输出语言`
- 提示：`API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。`

模型选择控件应复用已有 `MODEL_OPTIONS` 和自定义模型逻辑。

## 格式化输出规范

一键格式化应参考网页导入要求，但输出结构改为 frontmatter + 正文。

### YAML frontmatter

模型输出必须包含 YAML frontmatter。建议字段：

```yaml
---
title: 文档标题
summary: 一段短摘要
keyPoints:
  - 关键观点 1
  - 关键观点 2
  - 关键观点 3
keywords:
  - 关键词
language: zh-CN
formattedBy:
  provider: dashscope
  model: qwen...
  at: 2026-05-14T00:00:00Z
---
```

字段要求：

- `title`：文档标题；正文内仍应保留一个 H1，或明确规定渲染时从 frontmatter title 生成 H1。第一版建议仍保留正文 H1，避免 Markdown 导出不可读。
- `summary`：摘要，不放正文块引用。
- `keyPoints`：核心观点，不放正文块引用。
- `keywords`：可选，但如果模型无法可靠提取，应输出空数组。
- `language`：输出语言。
- `formattedBy`：由代码侧写入更可靠，不应完全信任模型。

### 正文

正文要求：

- 只有一个 H1。
- H2/H3 层级清晰。
- 长文必须有具体 H2 分段。
- 不使用空洞标题，如“正文”“主要内容”“背景”。
- 保留原文完整信息。
- 保留 Markdown 链接 URL。
- 保留 `asset://` 图片引用。
- 保留表格、列表、代码块。
- 清理多余空行、混乱 heading、伪标题加粗行。
- 不把摘要和核心观点作为正文块引用输出。

### 模型输出契约

后端 prompt 应要求模型只输出完整 Markdown：

```markdown
---
title: ...
summary: ...
keyPoints:
  - ...
keywords:
  - ...
language: ...
---

# ...

正文...
```

代码侧必须校验：

- 存在合法 frontmatter。
- 有正文。
- 有且仅有一个 H1。
- 没有把 `> **摘要**` / `> **核心观点**` 继续塞回正文。
- `asset://` 引用数量不能少于输入。
- Markdown 链接 URL 不能丢失。

校验失败：

- 不覆盖当前文档。
- 显示业务提示：`格式化结果不完整，已保留原文`
- 详细原因进入调试日志。

## 项目级重构 1：YAML meta 化与保护

当前 frontmatter 已有阅读态 card 和源码 banner 基础：

- 阅读/预览会渲染 `.aimd-frontmatter`。
- 编辑模式会从 inline editor 中移除 `.aimd-frontmatter`。
- 源码模式显示 frontmatter banner。

这次需要把它提升为项目级约定：

- 摘要、核心观点等 meta 信息统一放 YAML frontmatter。
- 阅读模式可展示 meta card，但应与正文视觉区分。
- 编辑模式中 meta 不进入可编辑正文，避免用户在富文本编辑时误删/误改。
- 源码模式可以直接编辑 YAML。
- 从编辑模式 `flushInline()` 回写 Markdown 时，必须保留原 frontmatter。
- 如果用户在源码模式修改 YAML，重新渲染后阅读/编辑态同步。
- 一键格式化应用结果时，必须整体替换 frontmatter + body。

需要重点检查：

- `apps/desktop/src/ui/outline.ts`
  - 当前编辑态去掉 `.aimd-frontmatter`，但 flush 回写时是否保留原 YAML 需要确认。
- `apps/desktop/src/editor/inline.ts`
  - HTML -> Markdown 时需要把原 frontmatter 拼回去。
- `apps/desktop/src/ui/mode.ts`
  - source banner 文案和行为要匹配“源码可改，阅读/编辑保护”。
- `apps/desktop/src-tauri/src/documents.rs`
  - `render_markdown` / `render_markdown_standalone` 对 frontmatter 的渲染行为要稳定。

建议增加一个 Markdown/frontmatter 工具模块：

```ts
type FrontmatterParts = {
  frontmatter: string;
  body: string;
};

splitFrontmatter(markdown: string): FrontmatterParts
joinFrontmatter(frontmatter: string, body: string): string
```

不要用脆弱的正则到处散落处理。

## 项目级重构 2：保存格式选择

当前保存行为大致是：

- 已打开 `.md` 且不需要 AIMD 时，`Cmd+S` 保存回 `.md`。
- Markdown 中出现内嵌 `asset://` 或前端 assets 时，会要求保存为 AIMD。
- `saveDocumentAs()` 基本是选择 AIMD 文件。

现在需要明确支持保存为 `.md` 或 `.aimd`：

- 对草稿、格式化后的文档、从网页创建的草稿、普通 Markdown 文档，都应该有明确保存格式选择。
- 用户保存时可以选择：
  - 保存为 Markdown `.md`
  - 保存为 AIMD `.aimd`

### 保存为 Markdown

保存为 `.md` 时：

- 写出 Markdown 正文，包括 YAML frontmatter。
- 如果存在 `asset://` 内嵌资源，需要给用户明确处理策略：
  - 不允许直接写出不可解析的 `asset://`，除非用户明确接受。
  - 推荐第一版：导出为 Markdown + assets 目录，重写图片引用为相对路径。
  - 可复用现有 `export_markdown_assets` 逻辑或新增 `save_markdown_as_with_assets`。
- 如果文档没有内嵌资源，可直接保存 `.md`。

### 保存为 AIMD

保存为 `.aimd` 时：

- 保留 Markdown + YAML frontmatter。
- 保留/打包资源。
- 适合长期归档和分享。

### UI 建议

不要只靠文件扩展名暗示行为。建议：

- `保存`：
  - 对已有 `.md`：默认保存回 `.md`，除非出现内嵌资源需要用户选择。
  - 对已有 `.aimd`：默认保存回 `.aimd`。
  - 对草稿：弹出保存格式选择。
- `另存为...`：
  - 先弹出格式选择：`Markdown (.md)` / `AIMD (.aimd)`
  - 再打开对应文件 picker。

如果平台文件 picker 支持 filter，也可以通过一个 picker 提供两种扩展名；但 UI 上必须让用户明确知道结果。

### 后端建议命令

可能需要新增：

```ts
choose_save_doc_file(suggestedName, formats)
save_markdown_as(path, markdown)
save_markdown_with_assets_as(path, markdown, assets?)
```

或扩展现有命令，但要保持语义清晰，避免 `choose_save_aimd_file` 被继续滥用到 Markdown 保存。

## 数据结构建议

新增设置：

```ts
type FormatSettings = {
  provider: ModelProvider;
  model: string;
  outputLanguage: "zh-CN" | "en";
};

type AppSettings = {
  ai: AiSettings;
  webClip: WebClipSettings;
  format: FormatSettings;
  ui: UiSettings;
};
```

Rust 同步：

```rust
pub struct FormatSettings {
    pub provider: String,
    pub model: String,
    pub output_language: String,
}
```

兼容：

- 旧设置没有 `format` 时，默认使用 DashScope + 默认模型 + 中文。
- 如果后续已完成 `webClip.model`，格式化设置不应复用网页导入设置；这是独立能力。

## 后端能力建议

新增 command：

```rust
#[tauri::command]
pub async fn format_markdown(
    app: AppHandle,
    markdown: String,
    provider: String,
    model: String,
    output_language: Option<String>,
) -> Result<String, String>
```

行为：

- 从设置中取 provider 对应 API Key / API Base。
- 使用传入 model。
- 构造格式化 prompt。
- 调用现有 `generate_text`。
- 超时保护。
- 返回完整 Markdown。

建议把网页导入 `refine_markdown` 和一键格式化共享部分抽成公共 helper：

- 共同使用 LLM provider 调用。
- 但 prompt 不同：
  - 网页导入：网页去噪 + 文章整理。
  - 一键格式化：本地 Markdown 规范化 + frontmatter meta 化。

## 前端实现面

需要检查和修改：

- `apps/desktop/src/ui/template.ts`
  - 更多菜单新增 `一键格式化`。
  - 可能新增格式化确认/预览 panel。
- `apps/desktop/src/main.ts`
  - 绑定格式化入口。
  - 处理进行中状态，防重复点击。
- `apps/desktop/src/document/format.ts`（建议新增）
  - `formatCurrentDocument()`
  - flush inline
  - 调用后端
  - 校验
  - 预览/应用
- `apps/desktop/src/core/settings.ts`
  - 新增 `FormatSettings` 默认值和 coercion。
- `apps/desktop/src/core/types.ts`
  - 新增 `FormatSettings`。
- `apps/desktop/src/settings/main.ts`
  - 新增“格式化”设置分类。
  - provider/model/output language 控件。
  - 保存/加载/序列化。
- `apps/desktop/src-tauri/src/settings.rs`
  - 新增 Rust 设置结构。
- `apps/desktop/src-tauri/src/importer.rs` 或新增 `formatter.rs`
  - 新增 `format_markdown` command 和 prompt。
- `apps/desktop/src/document/persist.ts`
  - 重构保存/另存为格式选择。
- `apps/desktop/src-tauri/src/dialogs.rs`
  - 增加保存为 `.md` / `.aimd` 的选择或文件 picker。
- `apps/desktop/src-tauri/src/documents.rs`
  - 支持保存 Markdown as 文件、Markdown assets 输出策略。

## Prompt 要求

新增 prompt 文件建议：

- `apps/desktop/src-tauri/src/prompts/format_markdown_system.md`
- `apps/desktop/src-tauri/src/prompts/format_markdown_language_policy.md`

Prompt 必须强调：

- 不删除正文。
- 不编造事实。
- 摘要/核心观点进入 YAML。
- 正文不再出现 `> **摘要**` / `> **核心观点**`。
- 保留 `asset://`。
- 保留链接 URL。
- 保留代码块、表格、列表。
- 输出语言必须统一。

## 测试要求

至少覆盖：

### TypeScript / Rust

- `npm run typecheck`
- `cargo test -p aimd-desktop`
- `cargo fmt --check`
- `git diff --check`

### 设置测试

- 旧设置没有 `format` 时默认可加载。
- 设置页出现“格式化”分类。
- 格式化 provider/model/outputLanguage 可保存。
- 自定义格式化模型可保存。
- 格式化设置不覆盖 AI / 模型 和 网页导入设置。

### 一键格式化 E2E

- 文档更多菜单出现“一键格式化”。
- 点击后调用 `format_markdown`，传入当前 Markdown、provider、model、outputLanguage。
- 返回合法 Markdown 时，不立即覆盖；需要用户应用。
- 用户取消时原文档不变。
- 用户应用后 Markdown 替换、dirty=true、阅读/编辑/source 同步。
- 格式化失败或校验失败时原文档不变。
- `asset://` 图片引用不会丢。
- 原始链接 URL 不会丢。

### YAML meta 保护 E2E

- 格式化后阅读模式显示 meta card。
- 编辑模式正文不包含可编辑的 frontmatter/meta card。
- 编辑正文后保存/切换模式，frontmatter 仍保留。
- 源码模式可以修改 YAML；切回阅读模式后 meta card 更新。
- 从编辑模式 flush 回 Markdown 时不会删除 YAML。

### 保存格式 E2E

- 新草稿保存时可选择 `.md` 或 `.aimd`。
- 另存为时可选择 `.md` 或 `.aimd`。
- 选择 Markdown 且无内嵌资源：调用 Markdown 保存命令。
- 选择 AIMD：调用 AIMD 保存命令。
- 有 `asset://` 资源时保存为 Markdown 走 Markdown + assets 输出策略，不能悄悄写出坏引用。
- 已打开 `.md` 默认保存回 `.md` 的行为不回归。
- 已打开 `.aimd` 默认保存回 `.aimd` 的行为不回归。

### Web 导入回归

- 网页导入仍能生成结构化文档。
- 如果本次同时迁移网页导入摘要/核心观点到 YAML，则测试必须更新：
  - 不再期望正文中出现 `> **摘要**`
  - 期望 frontmatter 中出现 `summary` / `keyPoints`
- 如果网页导入暂不迁移，也要明确在交付说明中说明迁移边界；但长期目标是统一 meta 结构。

## 分阶段建议

建议拆成三个 PR/阶段，降低风险：

1. Frontmatter 工具与保护层
   - split/join frontmatter
   - 编辑模式 flush 保留 YAML
   - source 可编辑
   - 阅读 meta card 回归测试

2. 一键格式化与格式化设置
   - 设置页新增格式化分类
   - 后端 `format_markdown`
   - 格式化 prompt + 校验
   - 预览/应用流程

3. 保存格式选择
   - 保存/另存 UI
   - Markdown vs AIMD 命令拆清
   - asset:// 保存为 Markdown 的资源输出策略

如果一次性实现，也必须按这三个边界提交/验证，避免把保存语义、渲染保护和模型调用混在一起难以回滚。

## 验收标准

- 用户能一键把当前文档格式化成结构清晰的 Markdown。
- 摘要/核心观点等信息进入 YAML frontmatter，不污染正文。
- 阅读和编辑模式不能误改 YAML meta；源码模式可以修改。
- 格式化可以选择模型和输出语言。
- 格式化使用独立设置，不覆盖网页导入或全局模型设置。
- 保存/另存时用户可以明确选择 `.md` 或 `.aimd`。
- 保存为 Markdown 时不会产生不可用的 `asset://` 坏引用。
- 旧 `.md` / `.aimd` 保存路径行为不回归。
- 核心 E2E、TypeScript、Rust 测试通过。

## 交付说明

完成实现后请列出：

- 新增设置字段。
- 新增命令和 prompt 文件。
- 一键格式化入口和确认流程。
- YAML meta 字段和保护规则。
- 保存格式选择 UX。
- Markdown 保存资源处理策略。
- 已运行的验证命令和结果。
- 如果分阶段交付，明确当前阶段完成了哪些、剩余哪些。
