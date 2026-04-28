# AIMD — AI Markdown Document

> Markdown 负责写内容，AIMD 负责让内容成为完整文档。

AIMD 是面向 AI 生成内容时代的**单文件 Markdown 文档格式**，把正文、图片、元数据封装进一个 `.aimd` 文件。文档移到任何目录、发给任何人，图片都不会再丢。

`.aimd` 本质是 ZIP，普通解压工具就能打开检查；AIMD CLI + 系统集成让"创建 → 双击查看 → 分享"全程不用操心命令行。

文档索引见 [`docs/README.md`](docs/README.md)，产品背景见 [`docs/aimd_mrd_v_0_1.md`](docs/aimd_mrd_v_0_1.md)。

## 三种使用方式

| 场景 | 用法 | 体验 |
|---|---|---|
| **本机日常使用** | 双击 `.aimd` 文件 | 弹出原生 macOS 窗口（WKWebView） |
| **命令行 / Agent** | `aimd pack/view/preview/...` | 自动化、批处理、CI 集成 |
| **分享给没装 aimd 的人** | `aimd seal a.aimd` | 单文件 `.html`，对方双击就能看 |

## 安装

### macOS：一键安装 + 注册双击关联（推荐）

```bash
git clone https://github.com/aimd-org/aimd.git
cd aimd
./scripts/install-mac.sh
```

脚本会：
1. 编译 `aimd` 二进制 → `~/.local/bin/aimd`
2. 在 `~/Applications/` 放一个 AppleScript .app，注册 `.aimd` 扩展名给 Launch Services
3. 之后**任何 `.aimd` 文件双击即弹原生窗口**，零命令行

无 `sudo`，无 `/usr/local`，全部用户态可逆（`rm -rf ~/Applications/AIMD\ Viewer.app ~/.local/bin/aimd`）。

### 通用：从源码构建（Go ≥ 1.22）

```bash
go env -w GOPROXY=https://goproxy.cn,direct   # 国内加速
go install github.com/aimd-org/aimd/cmd/aimd@latest
```

## 快速开始

```bash
# 打包：扫描 markdown 中的图片引用，生成单文件 .aimd
aimd pack report.md -o report.aimd

# 双击查看（macOS，需先跑过 install-mac.sh）
open report.aimd

# 命令行查看
aimd view    report.aimd     # 原生窗口（macOS）
aimd preview report.aimd     # 本地 HTTP，浏览器打开

# 看清单 / 校验完整性
aimd inspect report.aimd

# 解包成普通 markdown 项目（图片路径自动还原）
aimd unpack report.aimd -o report-out/

# 封成离线自渲染 HTML，发给没装 aimd 的人
aimd seal report.aimd -o report.html
```

仓库自带样例：`examples/report/`。运行 `./scripts/smoke.sh` 一键跑通 pack / inspect / unpack / export / preview 全链路。

## 命令一览

| 命令 | 说明 |
|---|---|
| `aimd pack <md> [-o out.aimd] [--title T]` | 扫描本地图片引用，复制到 `assets/` 并打包 |
| `aimd unpack <aimd> [-o dir] [--keep-asset-uri]` | 解包为普通 markdown 项目 |
| `aimd inspect <aimd> [--json]` | 打印 manifest、资源清单、SHA-256 校验状态 |
| `aimd view <aimd> [--width W --height H]` | macOS 原生 WKWebView 窗口（推荐） |
| `aimd preview <aimd> [--port N] [--no-open]` | 启 loopback HTTP，浏览器看 |
| `aimd seal <aimd> [-o out.html]` | 单文件自渲染 HTML（嵌入 ZIP + JS 解析器） |
| `aimd export html <aimd> [-o out.html]` | 静态 HTML，图片以 base64 内嵌（不推荐大图） |
| `aimd version` | 版本与规范号 |

flag 可置于位置参数前或后，CLI 自动 permute。

## `.aimd` 文件结构

```
report.aimd                (ZIP 容器)
├── manifest.json          文档元数据 + 资源清单 + SHA-256
├── main.md                Markdown 正文，图片用 asset://<id> 引用
└── assets/                打包进来的资源
    ├── cover.svg
    └── trend.png
```

`main.md` 中所有 `![](本地路径.png)` 在 `pack` 时会被改写为 AIMD 内部 URI：

```markdown
![封面](asset://cover-001)
```

`aimd unpack` 默认反向改写成 `assets/cover.svg` 之类的相对路径，普通 Markdown 编辑器无障碍打开。

## 三种"渲染"方式的内部差异

| | view | preview | seal |
|---|---|---|---|
| 形态 | 原生窗口 | 浏览器标签页 | 独立 .html 文件 |
| 资源传输 | loopback HTTP，**流式** | loopback HTTP，**流式** | base64 嵌 ZIP，JS 运行时解 |
| 大图（10×100MB）友好度 | ✅ 浏览器层懒加载 + 流式 | ✅ 同上 | ⚠️ HTML 体积 ~1.33×ZIP，浏览器解析压力大 |
| 离线分发 | ❌ 需 aimd 二进制 | ❌ 需 aimd 二进制 | ✅ 任何浏览器双击即看 |
| 临时文件 | 无 | 无 | 一个独立 .html |

## 开发

```bash
go test ./...                       # 单元测试
go build -o bin/aimd ./cmd/aimd
./scripts/smoke.sh                  # 端到端冒烟测试
./scripts/install-mac.sh            # 重装 macOS .app（更新二进制时跑一次）
```

依赖：
- `github.com/yuin/goldmark` —— Markdown → HTML 渲染
- `github.com/webview/webview_go` —— macOS 原生 WKWebView 封装（cgo）
- `internal/seal/vendor/` —— 内嵌的 `marked.min.js` 与 `fflate.min.js`，用于 sealed HTML 在浏览器内自渲染

## 实现状态

- ✅ **v0.1 MVP**：pack / unpack / inspect / preview / export html
- ✅ **超出 v0.1 范围已实现**：
  - `seal` —— 单文件自渲染 HTML（原 v0.4 计划）
  - `view` —— macOS 原生窗口（部分 v2.0 自渲染体验）
  - `install-mac.sh` —— `.aimd` 系统级双击关联
- ⏳ **v0.2**：AI metadata 层（model、prompt、来源追踪、provenance）
- ⏳ **v0.3**：VS Code 插件
- ⏳ **v1.0**：开放规范 + 多语言 SDK + 签名校验

完整路线图见 MRD 第 16 节。

## 协议

待定。
