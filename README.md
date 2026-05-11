# AIMD

AI 时代基于 Markdown 的独立文档格式。保留 Markdown 的可读写与 AI 友好，同时把图片和资源封装进一个文件。

[下载](#下载) · [解决什么问题](#解决什么问题) · [AIMD Desktop](#aimd-desktop) · [文件格式](#文件格式) · [从源码构建](#从源码构建)

![AIMD Desktop](docs/assets/readme/hero-desktop.png)

---

## 解决什么问题

Markdown 很适合写内容，也很适合给 AI 和程序处理。问题是图片通常不在 Markdown 文件里，而是在在线 URL 或本地资源目录里。

一旦文件被移动、重命名、单独发送、跨设备同步或长期归档，图片引用就可能失效。

AIMD 做的事情很简单：把 Markdown 正文、图片资源和资源清单打包成一个 `.aimd` 文件。这个文件可以直接保存、发送、打开和继续编辑。

| 方案 | 适合 | 问题 |
|---|---|---|
| Markdown + images | 源码仓库、网站内容 | 不是单文件，分享和归档容易丢图 |
| PDF | 最终分发、打印 | 不适合继续编辑，也不适合 AI 结构化修改 |
| AIMD | 图文 Markdown 工作文件 | 保持可编辑，同时图文在一个文件里 |

纯文字文档继续用 `.md`。当 Markdown 里有图片，并且你希望它能稳定保存、发送和归档时，再使用 `.aimd`。

---

## AIMD Desktop

AIMD Desktop 是用于打开、阅读和编辑 `.aimd` 文件的桌面应用。

| 能力 | 说明 |
|---|---|
| 阅读 / 编辑 / 源码 | 三种模式切换：干净阅读、所见即所得编辑、Markdown 源文编辑 |
| 图片内嵌 | 粘贴截图或图片后，资源写入 `.aimd` 文件内部 |
| Markdown 兼容 | 普通 `.md` 原样打开和保存；插入图片后，保存时另存为 `.aimd` |
| 资源管理 | 图片去重、大图压缩、保存时清理未使用资源 |
| 文件体验 | 双击打开、拖拽打开、多窗口、最近打开、文件关联 |
| 阅读辅助 | 自动大纲、资源面板、图片灯箱预览、常用快捷键 |

---

## 下载

当前版本：`v0.1.0`

请到 GitHub Releases 下载最新安装包：

https://github.com/benjamin1108/aimd/releases

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon | `AIMD.Desktop_0.1.0_aarch64.dmg` |
| Windows x64 | `AIMD.Desktop_0.1.0_x64-setup.exe` |
| Windows x64 MSI | `AIMD.Desktop_0.1.0_x64_en-US.msi` |

macOS 版本当前尚未完成 Apple 公证。首次打开如被系统拦截，请到：

```text
系统设置 → 隐私与安全 → 仍要打开
```

---

## 文件格式

`.aimd` 是一个开放的 ZIP 容器：

```text
report.aimd
├── manifest.json     文档元信息、资源清单、SHA-256
├── main.md           Markdown 正文
└── assets/           图片和其他资源
    ├── cover.png
    └── chart-001.png
```

正文中的图片使用稳定资源引用：

```md
![chart](asset://chart-001)
```

只要 `.aimd` 文件还在，正文和图片就始终在一起。文件内部仍然是 Markdown、JSON 和普通资源文件，不是黑盒格式。

---

## 从源码构建

AIMD Desktop 基于 Tauri 2、Rust 和 TypeScript。

需要：

- Node.js 18+
- Rust / Cargo
- macOS：Xcode Command Line Tools
- Windows：MSVC + WebView2

```bash
git clone https://github.com/benjamin1108/aimd.git
cd aimd/apps/desktop
npm install
npm run dev
```

类型检查和测试：

```bash
npm run typecheck
npm run test:e2e
```

打包：

```bash
# macOS
./build-dmg.sh

# Windows
build-windows.bat
```

---

## 仓库结构

```text
aimd/
├── apps/desktop/        Tauri 桌面应用
├── crates/
│   ├── aimd-core/       .aimd 容器读写
│   ├── aimd-mdx/        Markdown 解析与资源引用改写
│   └── aimd-render/     渲染管线
├── docs/                文档与图片资源
├── examples/            示例文档
├── scripts/             构建与辅助脚本
└── skill/               AI Agent 读写 .aimd 的 skill
```

示例文档：

```text
examples/ai-daily-2026-04-30.aimd
```

---

## 路线图

已完成：`.aimd` 单文件容器、Markdown 正文和图片资源封装、macOS / Windows 桌面应用、阅读 / 编辑 / 源码模式、图片粘贴与资源管理、普通 `.md` 按需另存为 `.aimd`。

计划中：AI 来源和溯源信息、文档健康检查、HTML / PDF 导出、浏览器查看器、文件格式规范、SDK。

---

## License

TBD.
