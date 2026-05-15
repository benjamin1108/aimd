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

请到 GitHub Releases 下载最新安装包：

https://github.com/benjamin1108/aimd/releases

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon | `AIMD-<version>.pkg` |
| Windows x64 | `AIMD-Desktop_<version>_windows_x64-setup.exe` |

macOS 版本当前尚未完成 Apple 公证。首次打开如被系统拦截，请到：

```text
系统设置 → 隐私与安全 → 仍要打开
```

卸载 macOS PKG 安装版：

```bash
./scripts/uninstall-macos-pkg.sh
```

这个脚本会移除 `/Applications/AIMD Desktop.app`、旧版残留的 `/Applications/AIMD.app`、`/usr/local/bin/aimd`、`/usr/local/share/aimd`、全局 AIMD Git driver 配置和 macOS PKG 收据；不会删除用户文档、AIMD 用户数据或已经复制到各 Agent 目录里的 skill。

macOS PKG 安装后会默认把 AIMD Agent skill 安装到当前登录用户的常见 Agent 用户级 skills 目录，并刷新 `~/.local/bin/aimd`，避免旧的用户级 `aimd` 命令盖住 `/usr/local/bin/aimd`。

重新安装或升级 PKG 时，如果上一版 AIMD Desktop 仍在运行，安装脚本会先尝试正常退出旧进程；短时间内未退出时会终止旧进程，然后再替换 `/Applications/AIMD Desktop.app`。

也可以手动重复安装或安装到项目级目录：

```bash
aimd skill list-agents
aimd skill install --agent codex --scope user
aimd skill install --agent claude-code --scope project --project /path/to/repo
aimd skill doctor
```

macOS PKG 会把 skill 源文件放在 `/usr/local/share/aimd/skill/aimd/`，所以用户不需要 clone 仓库也能执行 `aimd skill install`。

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

类型检查和测试（在仓库根目录运行）：

```bash
npm run version:check
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run test:e2e
```

### 版本管理

应用版本号的唯一手写来源是仓库根目录的 `release.config.json`。
`Cargo.toml`、`apps/desktop/package.json` 和
`apps/desktop/src-tauri/tauri.conf.json` 都由版本同步脚本更新或校验。

常用命令：

```bash
# 同步派生版本号
npm run version:sync

# 检查派生版本号是否和 release.config.json 一致
npm run version:check
```

`apps/desktop` 下的 `npm run dev`、`npm run build`、`npm run build:pkg` 和
`npm run check` 会自动执行版本同步或校验；macOS / Windows 打包脚本也会在读取版本号前自动同步。

发布版本只能通过根目录 release 命令自增：

```bash
npm run release -- patch  # 1.4.27 -> 1.4.28
npm run release -- minor  # 1.4.27 -> 1.5.0
npm run release -- major  # 1.4.27 -> 2.0.0
```

`patch` 用于日常修复发布；`minor` 用于大型 feature 发布；`major` 用于平台级重构或破坏兼容的发布。普通 dev/build/check/package 命令只同步或校验版本，不会自增版本号。

如果当前版本已经创建过 tag / GitHub Release，但 release 构建失败或产物需要覆盖补发，使用：

```bash
npm run release -- republish
```

`republish` 不会自增版本号，会用 `release.config.json` 的当前版本覆盖重发对应的 `v<version>` tag / GitHub Release。它要求当前分支是 `main`，本地 `HEAD` 和 `origin/main` 一致，并且版本检查通过。

发布前可先 dry-run：

```bash
npm run release:dry -- patch
npm run release:dry -- minor
npm run release:dry -- major
npm run release:dry -- republish
```

Git tag 必须和配置版本一致：`release.config.json` 中的 `1.4.28` 对应 tag `v1.4.28`。

打包：

```bash
# macOS
./scripts/build-macos-pkg.sh
# output: dist/AIMD-<version>.pkg

# Windows
./scripts/build-windows-installer.cmd
# output: dist/AIMD-Desktop_<version>_windows_x64-setup.exe
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

## License

TBD.
