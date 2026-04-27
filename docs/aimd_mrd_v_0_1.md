# AIMD：AI Markdown Document MRD v0.1

## 1. 文档信息

**产品代号**：AIMD  
**全称**：AI Markdown Document  
**文档类型**：MRD，Market Requirements Document  
**版本**：v0.1（草案 → 已落地）  
**状态**：v0.1 MVP 已实现，并提前交付了部分 v0.4 / v2.0 能力  
**目标阶段**：概念验证 / MVP 定义  
**配套实现**：本仓库根目录的 `cmd/aimd/`、`internal/`、`scripts/install-mac.sh`  
**后续可扩展文档**：PRD / RPD / SPEC  

---

## 2. 一句话定义

AIMD 是一种面向 AI 生成内容时代的单文件 Markdown 文档格式，用于将 Markdown 正文、图片、图表、元数据和渲染提示封装在一个开放、可解包、可编辑、可预览的文件中，解决 Markdown 文档在分享、归档和迁移过程中图片丢失、路径断裂和上下文缺失的问题。

---

## 3. 背景与问题

Markdown 已经成为 AI 生成内容的事实输出格式之一。无论是 ChatGPT、Claude、Gemini、Copilot、Cursor、Perplexity，还是各类 Agent、Notebook、知识库系统，最终输出的大量内容都天然倾向于 Markdown：结构清晰、易读、易复制、易编辑、适合版本管理。

但 Markdown 诞生时主要面向轻量文本写作，并没有把“图片和其他资源作为文档本体的一部分”来处理。它通过外部路径引用图片：

```markdown
![示意图](./images/diagram.png)
```

这在传统人工写作场景里可以接受，因为作者通常维护一个固定文件夹结构。但在 AI 生成时代，这种机制暴露出明显缺陷：

1. AI 生成的文档越来越多是图文混排，而不是纯文本。
2. 图片、图表、流程图、架构图往往是文档语义的一部分，而不是可选附件。
3. 文档被复制、移动、上传、分享、重命名或同步后，图片链接很容易断裂。
4. 普通用户很难理解 Markdown 文件和资源文件夹之间的依赖关系。
5. 企业知识库、AI Agent 和自动化工作流需要更稳定的文档封装格式。
6. Markdown 缺少统一的文档级元数据、资源清单、生成来源和渲染提示。

因此，Markdown 作为“文本格式”足够优秀，但作为“完整文档格式”并不完整。

AIMD 要解决的核心问题是：

> 让 AI 生成的 Markdown 文档像 PDF 一样便携，但仍然保留 Markdown 的可编辑性、开放性和结构化优势。

---

## 4. 市场机会

### 4.1 AI 生成内容正在从纯文本走向图文文档

早期 AI 内容主要是回答、摘要、代码和短文本。现在 AI 输出正在变成完整文档：报告、方案、教程、白皮书、产品文档、设计说明、会议纪要、研究分析、学习材料、技术架构说明等。

这些内容往往包含：

- Markdown 正文
- Mermaid / PlantUML / Graphviz 等图表源码
- 生成式图片
- 截图
- 数据图表
- 表格
- 封面图
- 附件或引用材料
- 生成模型、提示词、来源、版本等元信息

普通 Markdown 难以稳定承载这种复合内容。

### 4.2 Markdown 是 AI 输出的通用中间层

相比 PDF、DOCX、HTML，Markdown 更适合作为 AI 的中间表达格式：

- 对大模型友好
- 对人类可读
- 易于 diff
- 易于解析
- 易于转换
- 易于嵌入开发者工具链

但 Markdown 缺少“文档容器”能力。AIMD 的机会不是替代 Markdown，而是补足 Markdown 的文档化封装层。

### 4.3 现有替代方案各有缺口

| 方案 | 优点 | 缺口 |
|---|---|---|
| 普通 Markdown + assets 文件夹 | 简单、开放、开发者熟悉 | 图片易丢失，路径易断，分享体验差 |
| PDF | 便携、展示稳定 | 不易编辑，不适合作为 AI 工作流中间格式 |
| DOCX | 办公场景成熟 | 格式复杂，不适合开发者和 AI 管道 |
| HTML 单文件 | 可自渲染，浏览器可打开 | 写作体验不如 Markdown，语义层容易丢失 |
| EPUB | 可打包资源 | 面向出版，结构相对重 |
| ZIP 打包 Markdown | 可容纳资源 | 缺少统一规范、预览体验和生态识别 |
| Notion / 飞书 / 语雀等平台文档 | 协作强 | 平台锁定，离线与迁移能力弱 |

AIMD 的机会点在于：

> 保留 Markdown 的简单和开放，同时补上图片资源、元数据、预览和封装能力。

---

## 5. 目标用户

### 5.1 一级目标用户

#### AI 内容创作者

包括使用 AI 写报告、教程、方案、文章、图文材料的个人用户或专业用户。

主要痛点：

- AI 生成 Markdown 后，图片和正文分离。
- 分享给别人时图片丢失。
- 多轮生成后的资源难以管理。
- 希望文档既能编辑，又能像 PDF 一样整体保存。

#### 开发者与技术写作者

包括写 README、架构文档、设计文档、API 文档、技术方案的用户。

主要痛点：

- Markdown 项目依赖 assets 文件夹。
- 文档迁移、发布、归档时路径容易失效。
- 希望文档可版本管理、可解包、可自动化处理。
- 需要 CLI、SDK、CI 集成。

#### AI Agent / 自动化工作流开发者

包括构建自动生成报告、自动整理会议纪要、自动生成技术文档、自动输出研究报告的团队。

主要痛点：

- Agent 输出的图文内容缺少稳定载体。
- 普通 Markdown 不适合作为长期归档对象。
- 需要统一封装文本、图片、图表、来源和生成元数据。

### 5.2 二级目标用户

#### 企业知识库团队

需要将 AI 生成内容归档、审核、发布和迁移。

#### 教育与培训内容制作者

需要将课程讲义、图解、示意图、练习材料打包为可分发文档。

#### 研究人员与分析师

需要把 Markdown 报告、图表、数据截图、引用来源封装成可复现文档。

---

## 6. 核心用户场景

### 场景 1：AI 生成图文报告后分享

用户通过 AI 生成一份市场分析报告，报告包含 Markdown 正文、若干图表和一张封面图。用户希望将它作为一个文件发送给同事，而不是发送一个 `.md` 文件加一个 `images` 文件夹。

AIMD 应支持：

- 将 Markdown 和图片打包为单个 `.aimd` 文件。
- 接收方可以预览。
- 解包后仍能得到原始 Markdown 和图片。

### 场景 2：技术文档归档

开发者写了一份架构设计文档，里面包含流程图、截图和 Mermaid 图。项目迁移到另一个仓库后，图片路径容易失效。

AIMD 应支持：

- 自动收集 Markdown 引用的本地资源。
- 保留原始相对路径或映射关系。
- 提供资源完整性校验。

### 场景 3：AI Agent 自动生成交付物

企业内部 Agent 每周自动生成项目周报，包含文字总结、趋势图和关键截图。团队希望每周归档一个完整文件。

AIMD 应支持：

- 程序化创建文件。
- 写入生成模型、生成时间、数据来源等元信息。
- 可批量预览、导出 HTML/PDF。

### 场景 4：从普通 Markdown 平滑升级

用户已有大量 Markdown 文档，希望无痛转换为 AIMD。

AIMD 应支持：

```bash
aimd pack report.md -o report.aimd
```

并能反向导出：

```bash
aimd unpack report.aimd -o report/
```

### 场景 5：跨平台分发和长期保存

用户希望几年后仍然能打开文档，并且不依赖特定 SaaS 平台。

AIMD 应支持：

- 开放格式。
- 可解包。
- 可验证。
- 基础内容不依赖网络。

---

## 7. 产品定位

AIMD 不是 Markdown 的替代品，而是 Markdown 的单文件文档封装格式。

它的定位可以描述为：

```text
Markdown is the content layer.
AIMD is the document container.
```

中文表达：

```text
Markdown 负责写内容，AIMD 负责让内容成为完整文档。
```

### 7.1 AIMD 应该是什么

- 一个开放的单文件文档格式
- 一个 Markdown + 图片资源的封装容器
- 一个适合 AI 生成内容的归档与交换格式
- 一个可被 CLI、SDK、编辑器和知识库系统支持的基础格式
- 一个可以逐步扩展到自渲染、自校验、自描述的文档载体

### 7.2 AIMD 不应该是什么

- 不应该一开始就替代 PDF
- 不应该重新发明 Markdown 语法
- 不应该绑定某个 AI 模型或平台
- 不应该强制使用某个编辑器
- 不应该成为复杂的办公文档格式
- 不应该在 v0.1 就追求完整自运行虚拟机

---

## 8. 产品原则

### 8.1 Markdown First

正文必须优先保持 Markdown 形态。AIMD 不应破坏 Markdown 的可读性、可编辑性和可转换性。

### 8.2 Single File by Default

文档在分享、归档和传输时应表现为一个文件。图片、图表和必要资源默认内嵌。

### 8.3 Open and Inspectable

格式必须开放，可解包，可通过通用工具检查。即使没有专用应用，也不应导致内容不可恢复。

### 8.4 AI-Native, Not AI-Locked

AIMD 应支持记录 AI 生成元数据，但不能绑定某个 AI 服务商。

### 8.5 Progressive Enhancement

基础内容永远可读。高级能力如自渲染、签名、交互、主题和导出应作为渐进增强。

### 8.6 Toolchain Friendly

必须优先支持 CLI、SDK、编辑器插件和自动化流水线。

---

## 9. 核心价值主张

### 对个人用户

“把 AI 生成的 Markdown 图文内容保存成一个不会丢图的文件。”

### 对开发者

“用开放格式打包 Markdown、图片和元数据，并能通过 CLI/SDK 自动化处理。”

### 对企业

“为 AI 生成文档提供可归档、可审计、可迁移的标准载体。”

### 对生态开发者

“提供一个简单、开放、可扩展的 AI 文档容器协议。”

---

## 10. MVP 范围

### 10.1 v0.1 必须支持

#### 格式层

- ✅ `.aimd` 单文件格式（ZIP 容器）
- ✅ 内部包含 `manifest.json`
- ✅ 内部包含 `main.md`
- ✅ 内部包含 `assets/` 目录
- ✅ 支持 PNG、JPEG、WebP、SVG（实现：`internal/manifest/mime.go`）
- ✅ 支持资源哈希校验（SHA-256，`aimd inspect` 输出 ok / MISMATCH）
- ✅ 支持基础元数据：标题、作者、创建时间、生成来源、版本

#### 工具层

- ✅ `aimd pack`：将 Markdown 和资源打包成 `.aimd`
- ✅ `aimd unpack`：将 `.aimd` 解包为普通目录
- ✅ `aimd inspect`：查看 manifest 和资源列表
- ✅ `aimd preview`：本地 HTTP 预览（流式输出资源）
- ✅ `aimd export html`：导出为 HTML（图片 base64 内嵌）

#### Markdown 兼容层

- 保留原始 Markdown
- 支持常见图片语法
- 支持将相对图片路径映射到内部 assets
- 支持 asset URI，例如：

```markdown
![架构图](asset://diagram-001)
```

或兼容路径：

```markdown
![架构图](assets/diagram-001.png)
```

### 10.2 v0.1 暂不支持

- 实时协作
- 权限管理
- 复杂交互组件
- 任意脚本执行
- 富文本编辑器
- 完整办公排版
- 内置 AI 推理能力
- 强制自运行二进制

### 10.3 实现期超出 v0.1 范围已交付的能力

实现过程中发现以下能力对核心体验影响过大，不能等到后续版本，已提前落地：

- ✅ **`aimd seal`**：把 `.aimd` 封进单文件自渲染 HTML（嵌入 `marked` + `fflate`，运行时解 ZIP 渲染）。原计划 v0.4 「Self-contained Preview Export」。
- ✅ **`aimd view`**：macOS 原生 WKWebView 窗口，关窗即清理 server，零临时文件。提前实现 v2.0「Self-Rendering AIMD」的部分用户体验。
- ✅ **macOS 双击关联**（`scripts/install-mac.sh`）：用 `osacompile` + Launch Services 把 `.aimd` 注册给一个 AppleScript .app，转发到 `aimd view`。原计划 v0.3 「Editor Integration」中的"文件图标与 MIME 类型"。

提前交付的核心理由：v0.1 若仅有 `pack/unpack/preview`，普通用户的"双击查看"心智无法满足，会被视为"还需要会命令行才能用"，妨碍传播。

---

## 11. 建议文件结构

AIMD v0.1 可以采用 ZIP 容器，以降低实现成本并提高可检查性。

```text
document.aimd
├── manifest.json
├── main.md
├── assets/
│   ├── cover.png
│   ├── diagram-001.svg
│   └── chart-002.webp
├── styles/
│   └── default.css
└── metadata/
    └── generation.json
```

### 11.1 manifest.json 示例

```json
{
  "format": "aimd",
  "version": "0.1",
  "title": "AI 生成市场分析报告",
  "entry": "main.md",
  "createdAt": "2026-04-28T10:00:00Z",
  "updatedAt": "2026-04-28T10:00:00Z",
  "authors": [
    {
      "name": "Unknown User",
      "type": "human"
    }
  ],
  "generatedBy": {
    "type": "ai",
    "model": "unknown",
    "provider": "unknown"
  },
  "assets": [
    {
      "id": "diagram-001",
      "path": "assets/diagram-001.svg",
      "mime": "image/svg+xml",
      "sha256": "...",
      "role": "content-image"
    }
  ],
  "rendering": {
    "theme": "default",
    "style": "styles/default.css"
  }
}
```

### 11.2 Markdown 示例

```markdown
# AI 生成市场分析报告

这是一份由 AI 辅助生成的图文报告。

![市场结构图](asset://diagram-001)

## 结论

AIMD 适合用于封装 AI 生成的 Markdown 图文内容。
```

---

## 12. 关键产品需求

### 12.1 打包能力

用户可以将普通 Markdown 文件转换为 AIMD 文件。

输入：

```text
report.md
images/chart.png
images/diagram.svg
```

输出：

```text
report.aimd
```

系统需要：

- 扫描 Markdown 中的图片引用
- 识别本地图片路径
- 将图片复制到 AIMD 内部 assets
- 更新引用关系
- 写入 manifest
- 计算哈希

### 12.2 解包能力

用户可以将 AIMD 文件恢复为普通 Markdown 项目。

输出结构：

```text
report/
├── main.md
├── assets/
└── manifest.json
```

### 12.3 预览能力

用户可以本地预览 AIMD 文件。

预览方式可以是：

- CLI 启动本地预览服务
- 桌面查看器
- VS Code 插件
- 浏览器查看页面

v0.1 建议优先实现 CLI + 浏览器预览。

### 12.4 导出能力

v0.1 至少支持导出 HTML：

```bash
aimd export html report.aimd -o report.html
```

后续支持：

- PDF
- DOCX
- EPUB
- 普通 Markdown 文件夹
- 单文件自渲染 HTML

### 12.5 元数据能力

AIMD 应支持记录文档生成上下文：

- 生成时间
- 生成工具
- AI 模型
- 提示词摘要
- 数据来源
- 人类作者
- 审核状态
- 版本

这些信息不应污染正文 Markdown，应独立存放在 metadata 中。

---

## 13. 成功指标

### 13.1 MVP 成功指标

- 用户可以在 1 分钟内将普通 Markdown 转成 AIMD。
- 打包后的 AIMD 文件移动到任意目录后仍能完整预览图片。
- AIMD 文件可以无损解包回 Markdown + assets。
- CLI 可以稳定处理常见图片格式。
- GitHub README 能在 30 秒内解释清楚 AIMD 的价值。

### 13.2 生态成功指标

- 出现 VS Code 插件或编辑器集成。
- 出现第三方库支持读取 AIMD。
- AI Agent 框架可将 AIMD 作为输出格式。
- 知识库或文档平台支持导入 AIMD。
- 用户开始把 AIMD 用作 AI 文档归档格式。

---

## 14. 竞品与参考方向

### 14.1 普通 Markdown

优势：简单、开放、普及。  
缺点：图片外置，资源易断。

### 14.2 PDF

优势：便携、展示稳定。  
缺点：编辑困难，不适合作为 AI 中间内容格式。

### 14.3 DOCX

优势：办公生态成熟。  
缺点：格式复杂，程序化处理门槛较高。

### 14.4 HTML 单文件

优势：可离线展示，浏览器可打开。  
缺点：不再是纯 Markdown 工作流，源内容和展示内容容易混杂。

### 14.5 ZIP-based Markdown Bundle

优势：实现简单，资源可打包。  
缺点：如果没有统一规范，生态难形成。

AIMD 的差异化是：

```text
面向 AI 生成内容的 Markdown 单文件文档规范，而不是单纯压缩包或导出格式。
```

---

## 15. 风险与挑战

### 15.1 命名风险

`.aimd` 中的 AI 可能使用户误以为该格式只能由 AI 使用。需要在品牌表达中强调：AI-native，但不 AI-only。

### 15.2 标准化风险

如果规范过早复杂化，开发者不愿采用。v0.1 必须足够小。

### 15.3 安全风险

如果未来支持自渲染或脚本，必须严格沙箱化。v0.1 不应执行任意脚本。

### 15.4 生态风险

单文件格式如果没有预览工具和编辑器插件，很难被普通用户接受。

### 15.5 兼容风险

Markdown 方言众多，AIMD 不应试图统一所有 Markdown 语法。v0.1 应尽量只处理资源封装和元数据。

---

## 16. 路线图

### v0.1：Portable Markdown Bundle ✅ 已发布

目标：解决图片不丢的问题。

能力：

- ✅ `.aimd` ZIP 容器
- ✅ pack / unpack / inspect
- ✅ Markdown + assets + manifest
- ✅ 基础预览
- ✅ HTML 导出
- ✅ （提前）`seal` 自渲染单文件 HTML
- ✅ （提前）`view` macOS 原生窗口
- ✅ （提前）macOS 双击关联

### v0.2：AI Metadata Layer ⏳ 下一步

目标：让 AIMD 更适合 AI 生成内容归档。

能力：

- generation metadata
- prompt summary
- source references
- model information
- review status
- provenance tracking

### v0.3：Editor Integration ⏳ 部分提前交付

目标：进入日常写作工具链。

能力：

- ⏳ VS Code 插件
- ⏳ 拖拽图片自动内嵌
- ⏳ 预览面板
- ⏳ 一键 pack / unpack
- ✅ 文件图标与 MIME 类型（macOS 已通过 `install-mac.sh` 注册 `.aimd` 文档类型；Linux/Windows 待补）

### v0.4：Self-contained Preview Export ✅ 已通过 `aimd seal` 实现

目标：支持无需 AIMD 工具也能查看。

能力：

- ✅ 导出单文件 HTML（`aimd seal`）
- ✅ 嵌入图片资源（整 ZIP 以 base64 内嵌，运行时解出为 blob URL）
- ✅ 嵌入样式（GitHub-style CSS，支持暗色模式）
- ✅ 嵌入轻量渲染器（`marked` + `fflate`，合计 ~67KB）

### v1.0：Open AIMD Specification

目标：形成稳定开放规范。

能力：

- 格式规范
- 测试样例
- 兼容性套件
- 多语言 SDK
- 安全模型
- 签名与校验机制

### v2.0：Self-Rendering AIMD ⏳ 体验层已部分实现

目标：探索真正自渲染文档。

能力：

- ✅ 内置渲染模块（已通过 `aimd view` + `aimd seal` 提供，前者用 macOS WKWebView，后者用嵌入 JS）
- ⏳ 沙箱运行协议（v0.x 不执行任意脚本，规则待 SPEC 化）
- ⏳ 可选 WASM renderer
- ⏳ 交互式文档能力
- ⏳ 离线运行环境约定

---

## 17. 与 PRD / RPD / SPEC 的衔接

本 MRD 主要回答：

- 为什么需要 AIMD
- 谁需要 AIMD
- AIMD 解决什么市场问题
- AIMD 的定位和机会是什么
- MVP 应该覆盖哪些能力

后续可以拆成以下文档：

### 17.1 PRD / RPD

用于定义产品功能、用户流程和交互。

建议包含：

- 用户故事
- 详细功能需求
- CLI 命令设计
- 预览器交互
- 错误处理
- 文件转换流程
- 插件需求
- 用户验收标准

### 17.2 SPEC

用于定义技术规范和实现细节。

建议包含：

- `.aimd` 文件结构
- manifest schema
- asset URI 规则
- Markdown 引用映射规则
- MIME 类型支持
- 哈希与签名机制
- 兼容性要求
- 安全模型
- 测试用例

---

## 18. MVP 用户故事草案

### 用户故事 1：打包 Markdown

作为 AI 内容创作者，我希望把 Markdown 和图片打包成一个 `.aimd` 文件，以便分享给别人时图片不会丢失。

验收标准：

- 给定 `report.md` 和本地图片，运行 `aimd pack report.md` 后生成 `report.aimd`。
- 将 `report.aimd` 移动到其他目录后，预览时图片仍能显示。

### 用户故事 2：解包 AIMD

作为开发者，我希望将 `.aimd` 解包为普通 Markdown 项目，以便继续编辑或放入 Git 仓库。

验收标准：

- 运行 `aimd unpack report.aimd` 后得到 `main.md` 和 `assets/`。
- 解包后的 Markdown 可以被普通 Markdown 编辑器打开。

### 用户故事 3：检查资源

作为技术写作者，我希望检查 AIMD 文件包含哪些图片和元数据，以便确认文档完整性。

验收标准：

- 运行 `aimd inspect report.aimd` 后显示标题、入口文件、资源数量、资源类型和哈希状态。

### 用户故事 4：导出 HTML

作为普通用户，我希望把 AIMD 导出为 HTML，以便发给没有安装 AIMD 工具的人查看。

验收标准：

- 运行 `aimd export html report.aimd` 后生成 `report.html`。
- HTML 文件可以离线打开并显示图片。

---

## 19. 初始命令设计

### 19.1 v0.1 已实现

```bash
aimd pack input.md -o output.aimd          # 打包
aimd unpack input.aimd -o output-dir/       # 解包
aimd inspect input.aimd                     # 查看清单 + 哈希校验
aimd preview input.aimd                     # 浏览器 HTTP 预览
aimd view input.aimd                        # macOS 原生窗口（WKWebView）
aimd seal input.aimd -o output.html         # 自渲染单文件 HTML
aimd export html input.aimd -o output.html  # 静态 HTML（base64 内嵌图片）
aimd version                                # 规范号 + 二进制版本
```

flag 可在位置参数前或后任意位置，CLI 自动 permute。

### 19.2 后续版本预留参数

```bash
aimd pack report.md --asset-mode copy --rewrite-links asset-uri
aimd pack report.md --include-remote-images
aimd export markdown report.aimd -o report-dir/
```

---

## 20. 开放问题

1. `.aimd` 是否应该基于 ZIP，还是自定义二进制容器？
2. 图片引用默认使用 `asset://id`，还是保持 `assets/path.png`？
3. 是否要在 v0.1 支持远程图片下载并内嵌？
4. AI 生成元数据是否应该作为必填字段？
5. 是否需要定义 `application/aimd` 或 `application/vnd.aimd+zip` MIME 类型？
6. 是否需要支持多 Markdown 文件？
7. 是否需要支持附件，而不仅是图片？
8. 是否需要内置默认主题？
9. 是否需要支持加密或签名？
10. 项目应该强调 “AI Markdown Document”，还是更中性的 “Portable Markdown Document”？

---

## 21. 建议结论

AIMD 的首要目标不应该是马上成为复杂的自运行文档系统，而应该先成为 AI 生成内容时代最简单、最可靠的 Markdown 图文封装格式。

第一阶段的成功标准非常清晰：

> 一个 `.aimd` 文件，解决普通 Markdown 分享时图片会丢的问题。

只要这一点做到足够好，AIMD 就有机会成为 AI Agent、技术写作、知识库归档和图文内容交换中的基础格式。

后续再逐步扩展为：

```text
AIMD v0.1 = Markdown + 图片单文件封装
AIMD v0.2 = AI 元数据与来源追踪
AIMD v0.3 = 编辑器与预览生态
AIMD v1.0 = 开放规范与多语言 SDK
AIMD v2.0 = 自渲染 / 自运行文档能力
```

最终愿景：

> AIMD 让 Markdown 从“轻量文本格式”