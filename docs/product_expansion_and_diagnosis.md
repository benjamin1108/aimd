# AIMD 产品扩展与现有功能诊断

更新时间：2026-04-29

## 1. 结论

AIMD 当前已经具备一个清晰但仍偏早期的产品内核：

```text
Markdown + assets -> 单文件 .aimd
.aimd -> 可检查、可解包、可预览、可编辑、可导出 HTML
```

下一阶段不应把 AIMD 做成“又一个 Markdown 编辑器”。更有增长潜力的定位是：

```text
AIMD 是 AI 时代的可编辑文档包：
把 AI 生成的内容、图片、来源和交付格式封装成一个不会坏、可追溯、可再编辑的文件。
```

爆款入口应该围绕“AI 生成内容交付”展开，而不是围绕传统写作软件展开。用户的高频痛点不是缺一个编辑器，而是 AI 输出后的内容经常散、乱、丢图、难分享、难归档、难验证。

## 2. 当前产品资产

### 2.1 已经成立的核心能力

- `.aimd` ZIP 容器，包含 `manifest.json`、`main.md`、`assets/`。
- CLI 能完成 `pack`、`unpack`、`inspect`、`preview`、`seal`、`export html`。
- Desktop 已有 Tauri 应用骨架，可打开 `.aimd`，支持阅读、编辑、源码、保存、另存为。
- Desktop 支持 Markdown 文件导入为草稿，支持 `.md` / `.markdown` / `.mdx` 路由。
- 支持图片选择、粘贴、压缩、资源入包和 `asset://` 引用。
- 已有大纲、资源面板、近期文档、基础状态反馈。
- 已有较完整 e2e 覆盖，最近 Dev Report 记录全量 e2e 到 `194 passed / 0 failed`。

### 2.2 已经形成的差异化

- 单文件便携，比普通 Markdown + assets 更可靠。
- 保留 Markdown 可编辑性，比 PDF 更适合 AI 工作流。
- 可解包、可检查，比平台文档更开放。
- CLI-first，适合 Agent、CI、自动化脚本。
- Desktop-first，普通用户可以双击、打开、编辑、保存。

## 3. 爆款功能方向

### 3.1 AI 粘贴即打包

用户从 ChatGPT、Claude、Gemini、Cursor、Perplexity 等工具复制内容后，AIMD 应提供一个明确入口：

```text
Paste AI Output -> 自动整理 -> Save as .aimd
```

建议能力：

- 自动识别 Markdown、HTML、表格、代码块、引用块。
- 图片自动入包，不落入 `data:` / `base64` 长文本。
- 自动生成标题、摘要、大纲。
- 自动清洗 AI 输出里的冗余前后缀。
- 自动压缩大图。
- 保存时自动生成 `.aimd` 文件。

产品价值：

- 首次体验强，不需要理解 AIMD 格式。
- 非开发者也能直接感知“不会丢图”的价值。
- 适合作为官网演示、短视频演示和产品首屏主路径。

优先级：`P0`

### 3.2 AI 文档体检

AIMD 应在用户分享前提供“交付前检查”：

- 图片是否缺失。
- 资源是否未引用。
- 链接是否失效。
- 标题层级是否混乱。
- 表格是否过宽。
- 文档是否过大。
- 是否有 `data:` 图片残留。
- 是否缺少来源和生成信息。
- 是否适合导出为 HTML / PDF。

产品价值：

- 从“格式工具”升级为“交付质量工具”。
- 非常适合 AI 文档，因为 AI 输出的常见问题就是结构、来源、链接和资源不可控。
- 企业和专业用户会把它理解为可信交付能力。

优先级：`P0`

### 3.3 Provenance / 来源追踪

README 和 MRD 已经把 v0.2 指向 AI metadata。建议不要只做隐藏字段，而要产品化为“来源面板”。

建议记录：

- 生成模型、服务商、生成时间。
- prompt 摘要或完整 prompt。
- 文档由哪些来源构成：网页、PDF、截图、CSV、人工输入、AI 生成图片。
- 图片来源：上传、截图、剪贴板、AI 生成、网页抓取。
- 段落级或章节级来源引用。
- 人工修改与 AI 生成的边界。
- 审核状态：草稿、待审、已审、已发布。

产品价值：

- AI 文档最大的长期问题不是“能不能生成”，而是“能不能信”。
- AIMD 可以成为可追溯 AI 文档的默认容器。
- 这是和普通 Markdown 编辑器、PDF 导出器拉开差距的关键。

优先级：`P0`

### 3.4 一键分享矩阵

当前已有 `.aimd`、`seal`、`export html`，但产品表达还不够用户化。建议 Desktop 里做成一个“分享/导出”面板：

- 发给 AIMD 用户：`.aimd`
- 发给普通用户：自渲染 `.html`
- 发给正式场景：PDF
- 发给办公用户：DOCX
- 发给开发者：Markdown + assets
- 发给网页：HTML

产品原则：

```text
用户选择“发给谁”，系统决定“导出什么格式”。
```

优先级：`P1`

### 3.5 局部 AI 改写

不要把 AI 做成一个泛聊天框。AIMD 更适合做“选中文档内容后的动作菜单”：

- 改写这一段。
- 压缩为摘要。
- 扩写为方案。
- 转为表格。
- 生成标题。
- 生成摘要。
- 统一语气。
- 翻译并保持 Markdown 结构。
- 检查事实与来源。

产品价值：

- 与编辑器上下文强绑定。
- 比聊天框更符合文档生产流程。
- 可以自然写入 provenance。

优先级：`P1`

### 3.6 模板与工作流

AIMD 适合承载模板化 AI 交付物：

- 周报。
- 调研报告。
- 竞品分析。
- 产品需求文档。
- 技术方案。
- 会议纪要。
- 课程讲义。
- 投资分析。
- 复盘报告。

模板不应只是 Markdown 模板，而应包含：

- 文档结构。
- 默认封面或样式。
- 资源规则。
- 导出规则。
- AI prompt。
- 体检规则。
- metadata schema。

优先级：`P1`

### 3.7 Agent 输出标准格式

AIMD 非常适合作为 Agent 的交付物格式。建议增强 CLI / SDK：

- `aimd create`
- `aimd add-asset`
- `aimd set-metadata`
- `aimd validate`
- `aimd export pdf`
- `aimd export docx`
- `aimd server --stdio`
- `aimd server --http`

产品价值：

- 进入 AI Agent 和自动化报告场景。
- 开发者可以把 AIMD 当作“最终报告容器”。
- 形成生态，不只依赖 Desktop。

优先级：`P1`

### 3.8 VS Code / Cursor 插件

开发者入口建议先做命令型插件，不急着做完整编辑器：

- `AIMD: Inspect`
- `AIMD: Pack Markdown`
- `AIMD: Unpack AIMD`
- `AIMD: Preview`
- `AIMD: Validate`
- `AIMD: Export HTML/PDF`

产品价值：

- 进入已有 Markdown 工作流。
- 方便 Agent 和代码仓库文档自动化。
- 降低 AIMD 成为格式标准的阻力。

优先级：`P2`

## 4. 现有功能不完善诊断

### 4.1 产品定位层

#### 问题 1：当前产品更像“格式工具 + 编辑器”，AI-native 心智还没打出来

现状：

- README 和 MRD 已经写清楚 AI 时代文档容器的定位。
- 但 Desktop 首屏和功能路径仍偏“打开/新建/编辑/保存”。
- 用户第一次打开时，不一定知道为什么要用 AIMD，而不是 Typora、Obsidian、VS Code 或 Notion。

建议：

- 首屏增加“粘贴 AI 输出生成 AIMD”的主路径。
- 新建不只是空文档，还应支持“从剪贴板创建”“从 Markdown 创建”“从网页/文件创建”。
- 产品文案围绕“不会丢图、可追溯、可分享”而不是“Markdown 编辑”。

优先级：`P0`

#### 问题 2：核心成功场景还没有产品化闭环

理想闭环：

```text
AI 输出 -> 粘贴/导入 -> 自动整理 -> 图片入包 -> 体检 -> 分享/导出 -> 接收方打开
```

当前闭环：

```text
打开/新建 -> 编辑 -> 保存 -> inspect/export 主要靠 CLI
```

建议：

- Desktop 中补齐导入、体检、分享三个高价值动作。
- CLI 能力已经有一部分，应在 UI 中显性化。

优先级：`P0`

### 4.2 文件格式与规范层

#### 问题 3：文件格式 SPEC 和 manifest schema 仍未固化

现状：

- MRD 中描述了建议结构。
- `docs/current_stage.md` 明确下一步要补 `aimd_file_format_spec.md` 和 `aimd_manifest_schema.md`。
- 当前实现已经有 manifest，但生态开发者还缺稳定协议。

风险：

- Tauri、CLI、VS Code、Agent SDK 容易各自理解一套语义。
- 第三方无法放心读写 `.aimd`。
- metadata/provenance 扩展时容易破坏兼容性。

建议：

- 立即产出文件格式 SPEC。
- 立即产出 manifest JSON Schema。
- 明确 `asset://id`、asset path、role、mime、sha256、metadata 的稳定规则。
- 定义向后兼容策略和 unknown field 保留策略。

优先级：`P0`

#### 问题 4：metadata/provenance 还停留在概念层

现状：

- MRD 和 README 提到 v0.2 AI metadata。
- 当前 Desktop DTO 主要围绕 markdown/html/assets。
- provenance 尚未成为用户可见能力。

建议：

- 增加 `metadata/generation.json` 或 manifest 扩展字段。
- Desktop 增加“来源”面板。
- CLI 增加 `inspect --json` 中的 metadata 完整输出。
- 支持创建时传入模型、prompt、source references。

优先级：`P0`

### 4.3 Desktop 编辑体验层

#### 问题 5：当前编辑器仍依赖 contenteditable + Turndown，长期复杂度偏高

现状：

- 当前实现已经修过多轮选区、链接、行内代码、标题 Enter、粘贴清洗问题。
- `docs/current_stage.md` 已明确当前 WebView MVP 不应继续堆长期生产级编辑能力。
- 当前 Tauri 前端仍有较多手写 DOM 操作、selection 恢复、HTML -> Markdown 转换逻辑。

风险：

- 表格编辑、复杂列表、嵌套格式、撤销重做、协作、多光标都会继续放大复杂度。
- Markdown round-trip 容易出现格式损失。

建议：

- 短期只修核心编辑 bug，不继续扩大 contenteditable 能力边界。
- 中期切换到 ProseMirror / TipTap / Milkdown 这一类成熟编辑器内核。
- 明确定义 AIMD 支持的 Markdown 子集和 round-trip 规则。

优先级：`P1`

#### 问题 6：表格编辑能力不足

现状：

- GFM tables 已有回归覆盖。
- 但用户侧的表格体验可能仍偏“能渲染、能 round-trip”，不是“好编辑”。

缺口：

- 插入表格。
- 增删行列。
- 调整列对齐。
- 宽表横向滚动和导出适配。
- 从 Excel/网页粘贴表格的结构保真。

建议：

- 不在当前 contenteditable 上重做复杂表格编辑。
- 先做“粘贴/导入表格保真 + 源码模式可编辑 + 体检提示表格过宽”。
- 成熟编辑器内核落地后再做完整表格工具栏。

优先级：`P2`

#### 问题 7：链接、tooltip、选区类问题需要真机回归

现状：

- 旧 QA 报告记录过链接按钮、tooltip、选区漂移等问题。
- 当前代码已有自定义链接浮层、selection 兜底、行内代码 unwrap 修复。
- Chromium e2e 不能完全代表 Tauri WKWebView / WebView2 行为。

建议：

- 建立真机 smoke checklist，不只依赖 Playwright Chromium。
- 对 WKWebView 特有能力建立最小人工验收脚本：链接、确认框、文件选择、粘贴图片、中文 IME。
- 关键 WebView 差异写入 `docs/beta-smoke-test.md`。

优先级：`P1`

### 4.4 图片与资源层

#### 问题 8：图片压缩已经有实现，但用户可控性不足

现状：

- 当前代码有最大边长、阈值、JPEG 质量、打开时自动优化。
- GIF / SVG / WebP 会跳过压缩。
- 插入和粘贴图片时会尝试压缩。

风险：

- 静默转 JPEG 可能丢透明通道。
- 文档型截图压缩后可能影响文字清晰度。
- 用户不知道压缩前后体积、格式变化和画质影响。

建议：

- 增加图片优化设置：自动 / 询问 / 不压缩。
- 对含透明通道 PNG 谨慎转 JPEG。
- 资源面板显示原始大小、压缩后大小、节省比例。
- 支持“替换原图”“保留原图”“重新压缩”。

优先级：`P1`

#### 问题 9：资源管理还不够像“文档资产库”

现状：

- 侧栏已有资源段和缩略图方向。
- CLI 有 inspect 和 sha256 校验。

缺口：

- 未引用资源识别。
- 资源重命名。
- 资源替换。
- 资源导出。
- 附件支持，如 PDF、CSV、原始数据文件。
- 图片 alt 文本管理。
- 资源来源记录。

建议：

- 资源面板升级为 Asset Manager。
- 增加“清理未引用资源”“替换图片”“导出资源”。
- asset role 扩展为 cover、content-image、attachment、source-file、generated-image。

优先级：`P1`

#### 问题 10：远程图片打包未实现

现状：

- CLI `pack` 已有 `--include-remote` flag，但代码提示 v0.1 未实现。

用户影响：

- AI / 网页复制内容经常包含远程图片。
- 如果不下载入包，分享后仍然依赖网络，违背“不丢图”的核心承诺。

建议：

- 实现 `--include-remote`。
- Desktop 粘贴 HTML 时识别远程图片并提示“下载入包”。
- 记录远程图片原始 URL 到 metadata。
- 增加安全限制：大小上限、超时、mime 校验。

优先级：`P0`

### 4.5 导出与分享层

#### 问题 11：导出格式不足

现状：

- CLI 已支持 `export html` 和 `seal`。
- PDF、DOCX、EPUB 尚未实现。

用户影响：

- 正式汇报和办公流转中，PDF/DOCX 需求强。
- 普通用户不会主动使用 CLI 导出 HTML。

建议：

- Desktop 增加导出面板。
- P1 支持 PDF。
- P1/P2 支持 DOCX。
- HTML 导出明确分为“普通 HTML”和“自渲染离线 HTML”。

优先级：`P1`

#### 问题 12：接收方体验还不够完整

现状：

- `.aimd` 需要安装应用或 CLI。
- `seal` 可以给没装 AIMD 的人看，但入口主要在 CLI。

建议：

- Desktop 分享时默认给两个选项：`.aimd` 和 `.html`。
- 自渲染 HTML 页面里显示“由 AIMD 生成，可解包/可追溯”的文档身份信息。
- 提供“下载原始 .aimd”的可选嵌入能力。

优先级：`P1`

### 4.6 性能与可靠性层

#### 问题 13：大文件和全量 rewrite 风险仍在

现状：

- Beta checklist 记录过大文件和 Save 全量 rewrite 风险。
- Rust 侧 `replace_aimd_asset` 会读取整个 zip 到内存并重写。
- Desktop 打开会 materialize assets 到临时目录。

风险：

- 10MB+ 或大量图片文档打开/保存可能卡顿。
- 超大资源可能造成内存峰值。
- 自动优化打开时运行，可能影响首屏就绪时间。

建议：

- 建立 10MB、50MB、100MB 样本文档基准。
- 保存和资源替换增加进度反馈。
- 大文件自动优化改为后台任务或用户确认。
- 长期做增量写入或更细粒度 rewrite。

优先级：`P1`

#### 问题 14：临时资产缓存需要生命周期策略

现状：

- Desktop 会把资源 materialize 到系统临时目录。
- 打开时会重置当前文档 cache dir。

风险：

- 多文档、多窗口、异常退出后可能残留缓存。
- 接收方看到本地路径 URL 时，调试成本高。

建议：

- 启动时清理过期 `aimd-desktop-assets`。
- 退出时尽量清理当前会话缓存。
- 文档内永远保持 `asset://`，UI 层不要暴露临时路径。

优先级：`P2`

### 4.7 安全层

#### 问题 15：安全模型还需要独立文档

现状：

- 粘贴 HTML 已做 sanitize。
- render 使用 Goldmark unsafe 渲染，历史上需要明确边界。
- `seal` 自渲染 HTML 嵌入 JS 解析器。

风险：

- HTML、SVG、远程图片、未来插件/脚本都会引入安全问题。
- 企业采用前会关注沙箱、脚本执行、外链、追踪像素、文件访问。

建议：

- 产出 `aimd_security_model.md`。
- 明确默认不执行任意脚本。
- 明确 SVG 是否允许脚本、是否清洗。
- 明确远程资源策略。
- 明确 seal HTML 的能力边界。

优先级：`P0`

### 4.8 跨平台与分发层

#### 问题 16：macOS 优先，Windows/Linux 完整度不足

现状：

- Tauri 具备跨平台潜力。
- 当前 Rust 中 Finder reveal、Launch Services 注册等明显 macOS 优先。
- Windows/Linux 默认打开方式依赖打包配置，仍需真实验证。

建议：

- 建立 Windows/Linux 发布 checklist。
- Windows 验证 file association、WebView2、路径中文、拖拽、粘贴图片。
- Linux 验证 AppImage/deb、MIME、xdg-open、文件选择器、WebKitGTK。

优先级：`P2`

#### 问题 17：自动更新、签名、公证、安装体验仍需产品化

现状：

- 已有 .dmg 产物记录。
- 真机安装、Gatekeeper、公证、自动更新仍属于发布工程问题。

建议：

- macOS：Developer ID 签名、公证、Tauri updater。
- Windows：签名、安装包、默认应用注册。
- Linux：AppImage/deb/rpm 策略。

优先级：`P1`

### 4.9 开发者生态层

#### 问题 18：缺 SDK / Server / 插件入口

现状：

- CLI 能力强，但第三方集成仍需要 shell 调命令。
- Tauri 通过 sidecar 调 CLI，说明有 server/API 化需求。

建议：

- Go SDK 暴露稳定 API。
- `aimd server --stdio` 服务 VS Code、Cursor、Agent。
- Node/Python 轻量 SDK 封装 CLI 或 stdio server。
- VS Code 插件先做命令型集成。

优先级：`P1`

## 5. 建议路线图

### Phase 0：Beta 稳定与基础可信

目标：保证当前产品“可用、不坏、能分享”。

- 图片压缩策略完善。
- `.aimd` 文件图标和关联验证。
- 真机 smoke checklist 固化。
- 大文件打开/保存基准测试。
- 安全模型初稿。
- 文件格式 SPEC 和 manifest schema 初稿。

### Phase 1：AI 交付入口

目标：让用户第一次用就理解 AIMD 的价值。

- AI 粘贴即打包。
- 远程图片下载入包。
- 自动标题/摘要/大纲。
- 文档体检。
- 分享/导出面板。
- provenance v0.1。

### Phase 2：专业桌面编辑器

目标：从 MVP 编辑器升级到可长期维护的生产级编辑器。

- 引入成熟编辑器内核。
- 明确 Markdown 子集和 round-trip 策略。
- 表格基础编辑。
- 资源管理器。
- 局部 AI 改写。
- PDF 导出。

### Phase 3：生态与标准化

目标：让 AIMD 成为 Agent 和开发者可采用的文档容器。

- VS Code / Cursor 插件。
- `aimd server --stdio`。
- SDK。
- CI validate。
- 模板系统。
- 知识库导入/导出。

## 6. 优先级总表

| 优先级 | 事项 | 原因 |
|---|---|---|
| P0 | 文件格式 SPEC / manifest schema | 没有稳定协议，后续生态和 metadata 都不稳 |
| P0 | 安全模型 | AI 文档会混入 HTML、SVG、远程资源，必须先定边界 |
| P0 | AI 粘贴即打包 | 最强新用户入口，直接打出 AI-native 心智 |
| P0 | 文档体检 | 把 AIMD 从格式工具升级为交付质量工具 |
| P0 | 远程图片入包 | 不实现会破坏“不丢图”的核心承诺 |
| P0 | Provenance v0.1 | AI 文档可信度的关键差异化 |
| P1 | 分享/导出面板 | 把已有 CLI 能力转成用户价值 |
| P1 | PDF/DOCX 导出 | 正式交付场景需要 |
| P1 | 大文件性能基准 | 文件越像文档包，越容易遇到大资源 |
| P1 | 资源管理器 | 强化单文件文档资产库心智 |
| P1 | 成熟编辑器内核 | 当前 contenteditable 长期维护风险高 |
| P1 | 签名/公证/自动更新 | Desktop 要真正发布必须补齐 |
| P2 | VS Code / Cursor 插件 | 拓展开发者入口 |
| P2 | Windows/Linux 完整发布 | 扩大覆盖面，但不应早于核心闭环 |
| P2 | 模板市场 | 有商业化潜力，但需要 AI 入口先成立 |

## 7. 判断新功能是否值得做

建议使用四个问题过滤需求：

1. 是否强化“AI 生成内容交付物”的定位？
2. 是否让 `.aimd` 比普通 Markdown + assets 更可靠？
3. 是否能沉淀到开放格式、metadata 或资源管理能力中？
4. 是否能被 CLI / Desktop / 插件 / Agent 复用？

如果一个功能只是让 AIMD 更像普通 Markdown 编辑器，但不强化上述四点，应谨慎推迟。
