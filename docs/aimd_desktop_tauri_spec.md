# AIMD Desktop：Tauri 长期架构 SPEC

## 1. 文档信息

**产品代号**：AIMD Desktop  
**文档类型**：Technical SPEC  
**版本**：v0.1 草案  
**状态**：建议方案  
**目标阶段**：从 macOS WKWebView MVP 演进为可发布的生产级桌面编辑器  
**相关实现**：

- `cmd/aimd/`：现有 Go CLI
- `internal/aimd/`：AIMD 容器读写
- `internal/pack/`、`internal/unpack/`：打包/解包能力
- `internal/preview/`、`internal/view/`：当前 macOS WebView MVP

---

## 2. 结论

长期推荐架构：

```text
AIMD Core / CLI: Go
Desktop Shell: Tauri
Editor UI: Tiptap / ProseMirror / Milkdown
Distribution: standalone .app / .dmg, later .msi / AppImage
```

不建议短期全量重写为 Rust。AIMD 的格式读写、打包、解包、校验、导出和 CLI 自动化能力已经由 Go 实现，继续保留更稳。Tauri 应作为桌面产品层，负责窗口、菜单、文件选择、剪贴板、系统集成、自动更新、签名打包和前端工程化。

---

## 3. 背景

当前 `aimd view` 已经实现了 macOS 原生窗口阅读/编辑能力，但它仍是 MVP 形态：

1. 前端 HTML/CSS/JS 以内嵌字符串维护，工程化弱。
2. 编辑体验依赖手写 `contenteditable`，选区、格式切换、粘贴、图片、撤销重做等行为容易变复杂。
3. 文件选择、剪贴板、右键菜单、快捷键等桌面能力需要手写 Objective-C / WebView 兜底。
4. 当前 AppleScript `.app` 只是文件关联壳，不是完整生产级桌面应用。
5. 如果继续在 `webview_go` 上叠加复杂编辑器，会逐渐变成低层维护负担。

因此，长期桌面编辑器应从“薄 WebView MVP”升级为“标准桌面应用壳 + 成熟编辑器内核”。

---

## 4. 目标

### 4.1 产品目标

- 用户双击 `.aimd` 后打开一个完整桌面应用。
- 默认进入阅读模式，切换后可进行 inline 富文本编辑。
- 支持插入、删除、复制、粘贴图片，图片保存进 `.aimd` 包内。
- 支持 Markdown 常见编辑能力：标题、粗体、斜体、行内代码、代码块、引用、列表、任务列表、链接、表格、分割线。
- 支持保存、另存为、导出、解包、查看资源清单。
- 支持系统菜单、快捷键、右键菜单、文件关联、最近文件。
- 最终支持 macOS、Windows、Linux。

### 4.2 工程目标

- 保留现有 Go CLI 和格式核心能力。
- 桌面 UI 独立成 Tauri app，不污染 CLI。
- 前端采用现代工程栈，避免继续维护大段 Go 字符串 HTML。
- 编辑器采用成熟内核，不再手写复杂 `contenteditable` 行为。
- 桌面端调用 AIMD Core 的边界清晰、可替换。
- 发布产物是 standalone 应用，不要求用户安装 Go、Node、Rust。

---

## 5. 非目标

v0.1 阶段不做：

- 不全量重写 Go Core 为 Rust。
- 不把 CLI 能力塞进桌面端导致自动化能力退化。
- 不自行实现完整富文本编辑器内核。
- 不优先做多人协作、云同步、评论批注。
- 不在第一阶段追求复杂排版能力，比如 Word 级分页、页眉页脚、打印版式。

---

## 6. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 AIMD Desktop                  │
│                 Tauri App                     │
├──────────────────────────────────────────────┤
│ Frontend                                      │
│ - React / Vue / Svelte                        │
│ - Tiptap / ProseMirror / Milkdown             │
│ - AIMD document state                         │
│ - Editor UI / toolbar / menus                 │
├──────────────────────────────────────────────┤
│ Tauri Backend                                 │
│ - File dialogs                                │
│ - Clipboard                                   │
│ - Native menu / shortcuts                     │
│ - App lifecycle                               │
│ - IPC commands                                │
│ - Sidecar process management                  │
├──────────────────────────────────────────────┤
│ AIMD Core                                     │
│ - Go CLI sidecar initially                    │
│ - Future: Go library bridge or Rust crate     │
├──────────────────────────────────────────────┤
│ AIMD File                                     │
│ - manifest.json                               │
│ - main.md                                     │
│ - assets/*                                    │
└──────────────────────────────────────────────┘
```

---

## 7. 模块划分

### 7.1 AIMD Core

继续由 Go 负责。

职责：

- 创建 `.aimd`
- 读取 `.aimd`
- 重写 `main.md`
- 添加/删除 assets
- 校验 SHA-256
- 解包
- 导出
- seal
- inspect

对桌面端提供的最小能力：

```text
open(file) -> Document
save(file, document) -> void
addAsset(file, path | bytes) -> Asset
deleteAsset(file, assetID) -> void
renderMarkdown(markdown) -> html
inspect(file) -> Manifest
export(file, format) -> output
```

### 7.2 Tauri Backend

职责：

- 打开文件选择器
- 保存/另存为
- 读取系统剪贴板
- 写入系统剪贴板
- 注册菜单和快捷键
- 处理文件关联启动参数
- 管理最近文件
- 调用 AIMD Core
- 向前端暴露安全 IPC 命令

示例命令：

```text
open_aimd(path) -> DocumentDTO
save_aimd(path, payload) -> SaveResult
choose_image_files() -> Path[]
paste_image_files() -> Path[] | ImageBytes[]
add_image(path, image_path) -> AssetDTO
delete_asset(path, asset_id) -> void
reveal_asset(path, asset_id) -> void
```

### 7.3 Frontend

推荐技术：

- Vite
- TypeScript
- React 或 Vue
- Tiptap / ProseMirror / Milkdown
- CSS Modules / Tailwind / vanilla CSS 均可，但必须组件化

职责：

- 阅读模式
- 编辑模式
- 工具栏
- 右键菜单
- 编辑器状态
- 文档保存状态
- 错误提示
- 资源面板
- 设置面板

---

## 8. 编辑器内核选择

### 8.1 推荐：Tiptap / ProseMirror

优点：

- 成熟富文本模型。
- 对 inline 编辑、选区、marks、nodes、history 支持好。
- Markdown 和 HTML 转换生态成熟。
- 图片、链接、表格、任务列表等扩展较完整。
- 适合做生产级编辑器。

缺点：

- 学习成本高。
- Markdown round-trip 需要认真设计。
- 自定义节点和序列化规则需要工程投入。

### 8.2 备选：Milkdown

优点：

- Markdown-first。
- 更接近 AIMD 的源格式。
- 适合 Markdown 文档编辑器定位。

缺点：

- 富文本产品级定制能力需要评估。
- 插件生态和团队熟悉度需要验证。

### 8.3 不推荐：继续手写 contenteditable

原因：

- 选区行为难稳定。
- 格式嵌套难控制。
- 粘贴清洗复杂。
- 撤销重做难正确。
- 表格、任务列表、图片、链接交互会快速膨胀。

---

## 9. 数据模型

### 9.1 AIMD Document DTO

```ts
type AimdDocument = {
  path: string
  title: string
  markdown: string
  manifest: AimdManifest
  assets: AimdAsset[]
  dirty: boolean
}
```

### 9.2 Asset DTO

```ts
type AimdAsset = {
  id: string
  path: string
  mime: string
  size: number
  sha256: string
  role: "content-image" | "cover" | "attachment"
  url: string
}
```

### 9.3 Editor Document Model

编辑器内部应使用 ProseMirror JSON 或等价 AST。保存时转换为 Markdown，并确保图片引用使用：

```markdown
![alt](asset://asset-id)
```

---

## 10. 保存策略

### 10.1 v1 保存行为

- 用户显式点击保存或按 `Cmd/Ctrl+S` 才写入文件。
- 编辑时状态为 dirty。
- 保存时执行：

```text
Editor AST -> Markdown -> AIMD Core rewrite -> update manifest.updatedAt
```

### 10.2 图片插入

流程：

```text
选择/粘贴图片
-> Tauri Backend 读取文件或剪贴板
-> AIMD Core addAsset
-> 返回 asset://id
-> Editor 插入 image node
-> 文档 dirty
```

### 10.3 图片删除

默认行为：

- 从正文移除图片节点。
- 是否立即删除 asset 可做设置。

建议默认策略：

- 保存时扫描正文仍引用的 `asset://id`。
- 未引用 asset 标记为 orphan。
- 用户可在资源面板清理 orphan assets。

原因：避免用户误删正文图片后无法撤销。

---

## 11. 文件关联与启动

macOS：

- `.aimd` 关联到 AIMD Desktop `.app`。
- 双击文件时通过启动参数或 open-file event 传入路径。

Windows：

- 注册 `.aimd` 文件关联。
- 双击通过 argv 传入路径。

Linux：

- `.desktop` 文件注册 MIME 类型。

---

## 12. 发布形态

### 12.1 macOS

目标产物：

```text
AIMD Desktop.app
AIMD Desktop.dmg
```

要求：

- 不依赖用户安装 Go。
- 不依赖用户安装 Node。
- 不依赖用户安装 Rust。
- `.app` 内包含前端资源和必要 sidecar。
- 后续支持签名、公证、自动更新。

### 12.2 Sidecar 策略

初期推荐把现有 Go CLI 作为 sidecar：

```text
AIMD Desktop.app/
  Contents/
    MacOS/
      AIMD Desktop
    Resources/
      sidecar/
        aimd
```

优点：

- 迁移风险低。
- 继续复用现有 Go 实现。
- CLI 仍可独立发布。

缺点：

- 前后端通过进程调用或 IPC，性能和错误处理要设计。
- sidecar 版本要和桌面 app 版本绑定。

---

## 13. 安全模型

Tauri 命令必须最小授权：

- 前端不能任意读写文件系统。
- 文件访问必须来自用户选择、打开文件或最近文件授权。
- sidecar 调用参数必须严格转义。
- 禁止前端传任意 shell 命令。
- 图片导入只允许受支持 MIME/扩展名。
- 渲染 Markdown 时要限制不安全 HTML，或明确设置可信边界。

---

## 14. 与当前实现的关系

当前实现保留为：

- CLI 主实现
- 预览服务
- macOS MVP viewer
- 开发验证工具

Tauri Desktop 成熟后：

- `aimd view` 可以继续打开轻量 viewer。
- 桌面端可以成为默认 `.aimd` 双击应用。
- CLI 和 Desktop 使用同一 AIMD Core 能力。

---

## 15. 迁移计划

### Phase 0：当前 MVP 收敛

目标：

- 修复现有 viewer 的明显交互问题。
- 保持 CLI 稳定。
- 明确 AIMD Core API 边界。

完成标准：

- Go tests 通过。
- `pack/unpack/inspect/seal/export/view` 可用。
- 当前 viewer 不再作为长期复杂编辑器继续堆功能。

### Phase 1：Tauri Shell 原型

目标：

- 新建 `apps/desktop-tauri`。
- 能打开一个 `.aimd` 文件。
- 能显示渲染结果。
- 能调用 Go sidecar 获取 manifest、markdown、assets。

完成标准：

- macOS 可运行 `.app`。
- 双击或菜单打开文件可用。
- 无编辑能力也可接受。

### Phase 2：编辑器内核接入

目标：

- 接入 Tiptap/ProseMirror 或 Milkdown。
- 支持基础 Markdown 编辑。
- 支持图片插入、删除、保存。

完成标准：

- 标题、段落、粗体、斜体、代码、引用、列表、链接、图片可编辑。
- 保存后 `.aimd` 可被 CLI inspect / unpack。

### Phase 3：生产级桌面能力

目标：

- 文件关联。
- 最近文件。
- 菜单栏。
- 快捷键。
- 右键菜单。
- 错误提示。
- 资源面板。
- 自动更新预研。

完成标准：

- macOS `.dmg` 可分发。
- 用户无需命令行即可完成打开、编辑、保存、导出。

### Phase 4：跨平台

目标：

- Windows。
- Linux。

完成标准：

- 三端基本功能一致。
- 文件关联和安装包可用。

---

## 16. 技术风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Markdown round-trip 丢格式 | 高 | 采用成熟 Markdown parser/serializer，定义 AIMD Markdown 子集 |
| Go sidecar IPC 复杂 | 中 | 初期用 JSON stdin/stdout 或命令粒度 API，后续再优化 |
| Tauri 学习成本 | 中 | 先做 shell 原型，不一次性迁移所有功能 |
| 编辑器内核定制复杂 | 高 | 先选 Tiptap/ProseMirror，限制 v1 节点集合 |
| 跨平台文件关联差异 | 中 | macOS 先行，Windows/Linux 后置 |
| 签名/公证/自动更新 | 中 | 发布阶段单独处理，不阻塞原型 |

---

## 17. 决策记录

### ADR-001：保留 Go Core

决定：保留 Go 作为 AIMD Core 和 CLI。

理由：

- 当前实现已可用。
- Go 单文件二进制适合 CLI 分发。
- 格式工具需要稳定、自动化友好。
- 重写 Rust 成本高且短期收益低。

### ADR-002：Tauri 只负责桌面产品层

决定：Tauri 作为 Desktop Shell，不替代 AIMD Core。

理由：

- Tauri 擅长桌面壳、系统集成、打包发布。
- 前端工程体验更适合复杂编辑器。
- 可逐步迁移，避免破坏 CLI。

### ADR-003：不继续手写复杂 contenteditable

决定：长期编辑器必须采用成熟编辑器内核。

理由：

- 当前 MVP 已暴露选区、粘贴、格式嵌套等问题。
- 继续手写会消耗大量维护成本。
- 生产级编辑器需要稳定 AST、history、schema、插件系统。

---

## 18. 未来扩展

AIMD 的长期产品形态不应只有一个桌面应用。推荐形成多个入口共享同一个 AIMD Core：

```text
CLI              自动化、Agent、CI、批处理
Tauri Desktop    普通用户的独立桌面阅读/编辑器
VS Code Plugin   开发者、技术写作者、Agent 工作流
SDK              第三方工具和服务集成
Web Preview      轻量查看和分享
```

### 18.1 VS Code 插件

VS Code 插件是 v0.3 Editor Integration 的重点方向，定位为开发者和 Agent 入口。

推荐能力：

- 打开 `.aimd` 文件。
- 以 Markdown 或自定义编辑器方式编辑 `main.md`。
- 在预览中解析并展示 `asset://id` 图片。
- 保存时重写 `.aimd` 包。
- 提供资源树：manifest、assets、校验状态、orphan assets。
- 命令面板支持 `Pack`、`Unpack`、`Inspect`、`Export HTML`、`Seal`。
- 支持粘贴/拖拽图片并自动写入 `.aimd` assets。
- 支持把普通 Markdown 项目一键转换为 `.aimd`。
- 支持 AI metadata / provenance 的查看与编辑。

第一阶段实现方式：

```text
VS Code Extension (TypeScript)
-> bundled aimd CLI
-> child_process 调用 pack / unpack / inspect / export
```

长期实现方式：

```text
VS Code Extension
-> aimd server --stdio
-> JSON-RPC / LSP-style API
-> Go AIMD Core
```

建议新增命令：

```text
aimd server --stdio
```

建议 RPC：

```text
openDocument(path) -> DocumentDTO
saveDocument(path, markdown, assets) -> SaveResult
addAsset(path, imagePath) -> AssetDTO
deleteAsset(path, assetID) -> void
inspect(path) -> ManifestDTO
render(path | markdown) -> HTML
export(path, format) -> Output
```

VS Code 插件与 Tauri 的关系：

- Tauri 面向普通用户和独立桌面体验。
- VS Code 插件面向开发者、技术写作者和 Agent。
- 两者不共享 UI 代码也可以接受，但必须共享 AIMD Core 语义。
- 不允许插件实现一套与 CLI 不兼容的 AIMD 打包逻辑。

### 18.2 Language Server / AIMD Server

当桌面端、VS Code 插件和 Agent 集成都需要稳定 API 时，应引入长期后台协议：

```text
aimd server --stdio
aimd server --http 127.0.0.1:0
```

职责：

- 提供文档打开、保存、资源管理、渲染、校验 API。
- 避免每个宿主都重复实现 ZIP/manifest/asset 逻辑。
- 给 VS Code、Tauri、Agent 共用。

非目标：

- 不在后台 server 中执行任意文档脚本。
- 不暴露任意文件系统读写。

### 18.3 SDK

v1.0 之后应提供多语言 SDK。

优先级：

1. Go SDK：从现有 `internal/` 抽出稳定公共包。
2. TypeScript SDK：用于 VS Code 插件、Web 工具、Agent。
3. Rust SDK：如果 Tauri 后端长期需要更紧密集成，再考虑实现。

### 18.4 Web Preview / Web App

`aimd seal` 已经证明浏览器内自渲染可行。未来可扩展：

- 浏览器打开 `.aimd` 预览。
- Web 上传 `.aimd` 做只读查看。
- 轻量在线转换工具。

限制：

- Web 端不应成为主编辑器优先级。
- 大文件和隐私场景优先走本地桌面/CLI。

### 18.5 Agent 工作流

AIMD 适合作为 AI Agent 输出报告的封装格式。

推荐能力：

- Agent 生成 Markdown 和图片后直接调用 `aimd pack`。
- 记录模型、提示词摘要、来源、审核状态。
- 支持 `inspect --json` 给 Agent 读取文档结构。
- 支持 `server --stdio` 给 Agent 做增量写入。

---

## 19. 推荐目录结构

```text
aimd/
├── cmd/
│   └── aimd/                     # Go CLI
├── internal/                     # Go AIMD Core
├── apps/
│   └── desktop-tauri/
│       ├── src/                  # frontend
│       ├── src-tauri/            # Tauri backend
│       ├── package.json
│       └── README.md
│   └── vscode/
│       ├── src/                  # VS Code extension
│       ├── package.json
│       └── README.md
├── docs/
│   ├── README.md
│   ├── current_stage.md
│   ├── aimd_mrd_v_0_1.md
│   └── aimd_desktop_tauri_spec.md
└── scripts/
```

---

## 20. 第一版 Tauri 原型验收清单

- [ ] `apps/desktop-tauri` 可启动。
- [ ] 可以通过菜单打开 `.aimd`。
- [ ] 可以显示文档标题、正文、图片。
- [ ] 可以查看 manifest 和 assets。
- [ ] 可以保存 Markdown 修改。
- [ ] 可以选择图片并插入。
- [ ] 可以粘贴图片并插入。
- [ ] `.aimd` 保存后 `aimd inspect` 校验通过。
- [ ] macOS `.app` 打包成功。

---

## 21. 第一版 VS Code 插件验收清单

- [ ] 插件可安装到本地 VS Code。
- [ ] 命令面板包含 `AIMD: Inspect`。
- [ ] 命令面板包含 `AIMD: Pack Markdown`。
- [ ] 命令面板包含 `AIMD: Unpack AIMD`。
- [ ] 能打开 `.aimd` 并展示 manifest 摘要。
- [ ] 能将 `.aimd` 解包到临时工作区编辑。
- [ ] 能保存并重新打包 `.aimd`。
- [ ] 能展示 assets tree。
- [ ] 能粘贴或选择图片写入 assets。
- [ ] 保存后的 `.aimd` 可通过 CLI `inspect` 校验。

---

## 22. 结语

AIMD 的长期路线不应是把当前 MVP WebView 不断补丁化，而应把系统拆成稳定的格式核心和专业的桌面编辑器：

```text
Go Core keeps the format reliable.
Tauri makes the desktop app shippable.
ProseMirror-class editor makes editing maintainable.
```

这是兼顾短期资产复用和长期产品质量的方案。
