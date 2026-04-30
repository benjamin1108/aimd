# AIMD — AI Markdown Document

[中文](#中文) | [English](#english)

## 中文

> 把 AI 生成的 Markdown 变成完整、可迁移、可编辑的文档。

AIMD 是面向 AI 生成时代的单文件文档格式。它把 Markdown、图片、资源和元数据打包进一个开放的 `.aimd` 文件中，让报告、教程、研究笔记、技术文档和 Agent 输出可以被移动、归档、编辑、检查和分享，而不会因为图片路径断裂而损坏。

```text
Markdown 是内容层。
AIMD 是文档容器。
```


### 为什么需要 AIMD

AI 工具正在让 Markdown 成为结构化内容的默认输出格式。ChatGPT、Claude、Gemini、Cursor、Perplexity、Agent、Notebook 和内部自动化流程都会生成类似 Markdown 的文档。

但 Markdown 本身不是完整文档：

- 图片通常存放在文件外部，文档移动后容易丢失或失效。
- 截图、图表、流程图和生成图片是内容语义的一部分，却经常以散落文件保存。
- AI 生成报告需要记录来源、模型、提示词和溯源信息。
- 给普通用户分享 `.md` 文件加 `images/` 目录很脆弱。
- PDF 便于分发，但不适合作为 AI 工作流里的可编辑中间格式。

AIMD 保留 Markdown 的简单性，同时补上文档容器能力。

### AIMD 能做什么

| 你想要... | AIMD 提供... |
|---|---|
| 保存 AI 生成的报告 | 一个同时包含 Markdown 和图片的 `.aimd` 文件 |
| 分享给别人 | 移动后也不会丢图的可迁移文档 |
| 发给未安装 AIMD 的人 | 一个自渲染的独立 `.html` 文件 |
| 保留开发者工作流 | 通过 CLI 打包、解包、检查、预览和导出 |
| 归档 Agent 输出 | 稳定保存 Markdown、资源、哈希和未来溯源信息的容器 |
| 恢复原始内容 | 随时解包回普通 Markdown + assets 目录 |

### 适合谁

#### AI 内容创作者

当 AI 工具生成了报告、教程、课程、方案或图文文档，而你希望把它保存成一个可编辑文件时，可以使用 AIMD。

#### 开发者和技术写作者

适合 README 类文档、架构笔记、API 指南、设计文档和包含图表、截图或生成图片的技术报告。

#### Agent 和自动化构建者

可以把 AIMD 作为周报、研究摘要、会议纪要、QA 报告、构建报告等生成型交付物的输出格式。

### 产品体验

从 Markdown 开始，把它打包成 `.aimd`，在 AIMD Desktop 中打开，并把文档作为一个文件保持可读、可编辑、可检查、可分享。

### 快速开始

#### macOS：安装并注册 `.aimd`

```bash
git clone https://github.com/aimd-org/aimd.git
cd aimd
./scripts/install-mac.sh
```

安装脚本会：

1. 将 `aimd` 二进制安装到 `~/.local/bin/aimd`。
2. 在 `~/Applications/` 安装用户级 macOS app wrapper。
3. 注册 `.aimd` 文件关联，让文件可以从 Finder 打开。

不需要 `sudo`，不写入 `/usr/local`，并且可逆。

#### 从源码构建（桌面应用）

需要 Node.js 20+ 和 Rust（stable）。

```bash
cd apps/desktop
npm install
npm run build
```

macOS 一键构建（含环境安装）：

```bash
./build-dmg.sh
```

Windows 一键构建：

```bat
build-windows.bat
```

### 文件格式

`.aimd` 文件是一个 ZIP 容器，结构小而可检查：

```text
report.aimd
├── manifest.json          文档元数据、资源、哈希
├── main.md                Markdown 内容
└── assets/                打包的图片和资源
    ├── cover.svg
    └── trend.png
```

Markdown 图片引用会被改写为稳定的资源 URI：

```markdown
![Cover](asset://cover-001)
```

解包时，AIMD 会把这些引用改写回普通相对路径，因此结果仍然可以被标准 Markdown 编辑器打开。

### AIMD 和其他格式的区别

| 格式 | 擅长 | 对 AI 生成文档的不足 |
|---|---|---|
| Markdown + assets 目录 | 简单、可读、Git 友好 | 移动或分享时图片容易断 |
| PDF | 适合最终分发 | 难编辑，不适合作为 AI 中间格式 |
| DOCX | Office 工作流 | 自动化和开发者工具链复杂 |
| 单 HTML | 浏览器友好 | 源内容和表现层混在一起 |
| AIMD | 可迁移的 Markdown 文档包 | 早期格式，生态还在发展 |

### 渲染和分享模式

| 模式 | 适合 | 资源交付方式 |
|---|---|---|
| `view` | 本地阅读/编辑 | 原生窗口 + 本地流式读取 |
| `preview` | 浏览器预览 | 本地 HTTP 流式读取 |
| `seal` | 分享给任何人 | 一个内嵌 ZIP 的独立 HTML |
| `export html` | 静态发布 | 资源内联进 HTML |

### 路线图

已实现：

- `.aimd` ZIP 容器，包含 `manifest.json`、`main.md` 和 `assets/`。
- `pack`、`unpack`、`inspect`、`preview`、`view`、`seal` 和 `export html`。
- macOS 打开流程和桌面编辑器 MVP。
- Desktop 中的 Markdown 打开、图片插入、图片粘贴和图片压缩。

下一步：

- AI 元数据和溯源：模型、提示词、来源引用、审阅状态。
- 文档健康检查：缺失资源、断链、过大文件、结构问题。
- 更好的分享/导出 UI：`.aimd`、sealed HTML、PDF、DOCX、Markdown 项目。
- VS Code / Cursor 集成，服务开发者工作流。
- 开放文件格式规范、manifest schema、SDK、签名和校验。

参考：

- [MRD](docs/aimd_mrd_v_0_1.md)
- [Product expansion and diagnosis](docs/product_expansion_and_diagnosis.md)
- [Desktop architecture spec](docs/aimd_desktop_tauri_spec.md)

### 开发

工具链：Node.js 20+ 和 Rust（stable）。不需要 Go。

```bash
cd apps/desktop
npm install
npm run typecheck
npm run build:web
npm run test:e2e
```

Rust workspace 单元测试：

```bash
cargo test --workspace
```

Windows 一键环境准备与构建：

```bat
build-windows.bat
```

macOS 一键环境准备与构建：

```bash
./build-dmg.sh
```

### License

TBD.

## English

> Turn AI-generated Markdown into a complete, portable, editable document.

AIMD is a single-file document format for the AI generation era. It packages Markdown, images, assets, and metadata into one open `.aimd` file, so reports, tutorials, research notes, technical docs, and agent outputs can be moved, archived, edited, inspected, and shared without broken image paths.

```text
Markdown is the content layer.
AIMD is the document container.
```

### Why AIMD

AI tools are making Markdown the default output format for structured content. ChatGPT, Claude, Gemini, Cursor, Perplexity, agents, notebooks, and internal automation all produce Markdown-like documents.

But Markdown alone is not a complete document:

- Images live outside the file and break when the document is moved.
- Screenshots, charts, diagrams, and generated images are part of the meaning, but are stored as loose files.
- AI-generated reports need source, model, prompt, and provenance metadata.
- Sharing a `.md` file plus an `images/` folder is fragile for normal users.
- PDF is portable, but it is not a good editable intermediate format for AI workflows.

AIMD keeps the simplicity of Markdown and adds the missing document container.

### What You Can Do

| You want to... | AIMD gives you... |
|---|---|
| Save an AI-generated report | One `.aimd` file with Markdown and images bundled together |
| Share with someone else | A portable document that will not lose images when moved |
| Send to someone without AIMD | A sealed self-rendering `.html` file |
| Keep developer workflows | Pack, unpack, inspect, preview, and export from CLI |
| Archive agent outputs | A stable container for Markdown, assets, hashes, and future provenance |
| Recover the original content | Unpack back to plain Markdown + assets at any time |

### Who It Is For

#### AI Content Creators

Use AIMD when an AI tool gives you a useful report, tutorial, lesson, proposal, or visual document and you want to keep it as one editable file.

#### Developers and Technical Writers

Use AIMD for README-like documents, architecture notes, API guides, design docs, and technical reports that contain diagrams, screenshots, or generated charts.

#### Agent and Automation Builders

Use AIMD as the output format for weekly reports, research digests, meeting summaries, QA reports, build reports, and other generated deliverables.

### Product Experience

Start from Markdown, package it as `.aimd`, open it in AIMD Desktop, and keep the document readable, editable, inspectable, and shareable as one file.

### Quick Start

#### macOS: Install and Register `.aimd`

```bash
git clone https://github.com/aimd-org/aimd.git
cd aimd
./scripts/install-mac.sh
```

The installer:

1. Builds the `aimd` binary into `~/.local/bin/aimd`.
2. Installs a user-level macOS app wrapper in `~/Applications/`.
3. Registers `.aimd` so files can be opened from Finder.

No `sudo`, no `/usr/local`, and fully reversible.

#### Build from Source

Requires Rust stable and Node.js 20 or newer.

```bash
cargo build --workspace --release
cd apps/desktop && npm install && npm run build
```

### CLI Examples

```bash
# Package Markdown and local images into one .aimd file
aimd pack report.md -o report.aimd

# Open in a native macOS window
aimd view report.aimd

# Preview in a browser through a local server
aimd preview report.aimd

# Inspect manifest, assets, and SHA-256 integrity
aimd inspect report.aimd
aimd inspect report.aimd --json

# Unpack back to a normal Markdown project
aimd unpack report.aimd -o report-out/

# Create a self-rendering HTML file for people without AIMD
aimd seal report.aimd -o report.html

# Export static HTML with images inlined
aimd export html report.aimd -o report-static.html
```

The repository includes a sample in [examples/report/](examples/report/). Run the full smoke flow:

```bash
./scripts/smoke.sh
```

### Commands

| Command | Purpose |
|---|---|
| `aimd pack <md> [-o out.aimd] [--title T]` | Bundle Markdown and local image references into one `.aimd` |
| `aimd unpack <aimd> [-o dir] [--keep-asset-uri]` | Recover plain Markdown and assets |
| `aimd inspect <aimd> [--json]` | Print manifest, assets, sizes, and hash status |
| `aimd view <aimd> [--width W --height H]` | Open a native macOS viewer/editor |
| `aimd preview <aimd> [--port N] [--no-open]` | Serve a local browser preview |
| `aimd seal <aimd> [-o out.html]` | Produce a self-rendering standalone HTML file |
| `aimd export html <aimd> [-o out.html]` | Export static HTML with base64-inlined assets |
| `aimd version` | Print binary and format version |

Flags may be placed before or after positional arguments.

### File Format

An `.aimd` file is a ZIP container with a small, inspectable structure:

```text
report.aimd
├── manifest.json          document metadata, assets, hashes
├── main.md                Markdown content
└── assets/                bundled images and resources
    ├── cover.svg
    └── trend.png
```

Markdown image references are rewritten into stable asset URIs:

```markdown
![Cover](asset://cover-001)
```

When unpacked, AIMD rewrites those references back into ordinary relative paths, so the result can still be opened by standard Markdown editors.

### How AIMD Is Different

| Format | Good at | Missing for AI-generated documents |
|---|---|---|
| Markdown + assets folder | Simple, readable, Git-friendly | Images break when moved or shared |
| PDF | Portable final output | Hard to edit, poor as an AI intermediate format |
| DOCX | Office workflows | Complex for automation and developer tooling |
| Single HTML | Browser-friendly | Source content and presentation are mixed |
| AIMD | Portable Markdown document package | Early format, ecosystem still growing |

### Rendering and Sharing Modes

| Mode | Best for | How assets are delivered |
|---|---|---|
| `view` | Local reading/editing | Native window + local streaming |
| `preview` | Browser preview | Local HTTP streaming |
| `seal` | Sharing with anyone | One standalone HTML file with embedded ZIP |
| `export html` | Static publishing | HTML with inlined assets |

### Roadmap

Implemented:

- `.aimd` ZIP container with `manifest.json`, `main.md`, and `assets/`.
- `pack`, `unpack`, `inspect`, `preview`, `view`, `seal`, and `export html`.
- macOS open flow and desktop editor MVP.
- Markdown import, image insertion, image paste, and image compression in Desktop.

Next:

- AI metadata and provenance: model, prompt, source references, review status.
- Document health check: missing assets, broken links, oversized files, structure issues.
- Better share/export UI: `.aimd`, sealed HTML, PDF, DOCX, Markdown project.
- VS Code / Cursor integration for developer workflows.
- Open file format spec, manifest schema, SDK, and signing/verification.

See:

- [MRD](docs/aimd_mrd_v_0_1.md)
- [Product expansion and diagnosis](docs/product_expansion_and_diagnosis.md)
- [Desktop architecture spec](docs/aimd_desktop_tauri_spec.md)

### Development

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
./scripts/smoke.sh
```

Desktop app:

```bash
cd apps/desktop
npm install
npm run typecheck
npm run build:web
npm run test:e2e
```

For Windows desktop build and smoke-test notes, see [`docs/windows-desktop.md`](docs/windows-desktop.md).

One-command Windows environment preparation and build:

```bat
build-windows.bat
```

One-command macOS environment preparation and build:

```bash
./build-dmg.sh
```

### License

TBD.
