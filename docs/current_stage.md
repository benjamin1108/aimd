# AIMD 当前阶段说明

## 1. 阶段名称

**阶段**：v0.1 纯 Rust + Tauri 桌面 — Windows/macOS 双平台 release 就绪  
**日期**：2026-04-30  
**状态**：P1 bug 已修，e2e 224/224 通过，可发 Beta

---

## 2. 当前架构

```text
Rust workspace
  crates/aimd-core    — .aimd 格式读写、资产 GC、rewrite
  crates/aimd-mdx     — frontmatter 解析、asset:// 重写
  crates/aimd-render  — Markdown → HTML（comrak GFM）
  apps/desktop        — Tauri 2 桌面应用（Windows + macOS）
```

前端（TypeScript + Vite）嵌入 Tauri WebView，通过 Tauri IPC 调用 Rust 命令。无 Go sidecar，无外部 CLI 依赖。

---

## 3. 已完成能力

### Core（`crates/aimd-core`）

- `.aimd` ZIP 容器读写（`Reader` / `Writer`）
- `manifest.json` 元数据（title、createdAt、updatedAt、assets SHA-256）
- `main.md` 文档体
- `assets/` 资产管理（SHA-256 去重、GC、完整性校验）
- `rewrite_file`：原地重写，支持资产增删和 GC
- `pack_run`：Markdown 目录 → `.aimd`

### 渲染（`crates/aimd-render`）

- GFM 扩展（table、tasklist、strikethrough、autolink、footnotes）
- frontmatter 卡片（`<section class="aimd-frontmatter">`）
- heading id 注入（`inject_heading_ids`，CJK 保留）
- `asset://` resolver 替换

### 桌面（`apps/desktop`）

- 打开 `.aimd` / `.md` / `.markdown` / `.mdx`
- 编辑模式（contenteditable）+ 预览模式
- 保存、另存为、Markdown 导入
- 图片插入（文件选择 + 粘贴）、图片压缩、图片删除
- asset 替换（走 Reader/Writer，manifest 元数据同步更新）
- SHA-256 完整性校验
- 单实例（Windows/Linux）
- Windows MSI + NSIS installer
- macOS bundle

---

## 4. 构建与测试状态

| 检查项 | 状态 |
|---|---|
| `cargo test --workspace` | 60+ tests 全绿 |
| `cargo clippy --workspace --release -D warnings` | 0 警告 |
| `npm run typecheck` (apps/desktop) | 通过 |
| `npm run build:web` (apps/desktop) | 通过 |
| `npm run test:e2e` | 224/224 通过 |
| Windows MSI + NSIS | 正常产出 |

---

## 5. 下一阶段建议

1. AI 元数据与溯源（model、prompt、source、review status）
2. 文档健康检查（缺失资产、断链、超大文件）
3. 更好的导出 UI（sealed HTML、PDF、DOCX、Markdown 项目）
4. VS Code / Cursor 插件命令型原型
5. 开放文件格式 SPEC、manifest schema、SDK、签名/验证

---

## 6. 各入口职责分工

| 需求 | 应放位置 |
|---|---|
| pack/unpack/manifest/asset 规则 | `crates/aimd-core` |
| Markdown 解析与资产 URI | `crates/aimd-mdx` |
| Markdown → HTML 渲染 | `crates/aimd-render` |
| 普通用户双击编辑 | `apps/desktop`（Tauri） |
| 开发者工作流 | VS Code 插件（待做） |
| Agent 生成报告 | CLI / AIMD Server（待做） |
