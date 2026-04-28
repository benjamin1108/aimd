# AIMD 当前阶段说明

## 1. 阶段名称

**阶段**：v0.1 Core 已落地，macOS viewer/editor MVP 验证中  
**日期**：2026-04-28  
**状态**：可用但不应继续把当前 WebView MVP 当作长期生产级编辑器堆功能

---

## 2. 当前定位

当前仓库的核心价值是：

```text
Markdown + assets -> 单文件 .aimd
.aimd -> 可检查、可解包、可预览、可导出
```

当前 `aimd view` 的定位是：

```text
macOS 原生 WebView MVP
用于验证阅读、编辑、图片插入、保存回包的产品方向
```

它不是长期最终形态。长期桌面编辑器建议按 `aimd_desktop_tauri_spec.md` 迁移到 Tauri + 成熟编辑器内核。

---

## 3. 已完成能力

### Core / CLI

- `.aimd` ZIP 容器。
- `manifest.json`。
- `main.md`。
- `assets/`。
- `pack`。
- `unpack`。
- `inspect`。
- `preview`。
- `view`。
- `seal`。
- `export html`。

### macOS 集成

- `scripts/install-mac.sh` 可构建并安装 `aimd`。
- 可注册 `.aimd` 文件双击关联。
- 当前使用 AppleScript `.app` 转发到 `aimd view`。

### Viewer / Editor MVP

- 阅读模式。
- 编辑模式。
- inline 编辑基础能力。
- Markdown 常见格式按钮。
- 图片选择插入。
- 图片粘贴兜底。
- 删除图片。
- 保存回 `.aimd`。
- 右键菜单预留扩展入口。

---

## 4. 当前已知问题

当前 viewer/editor 是 MVP，存在结构性限制：

- 前端以 Go 字符串内嵌，维护成本高。
- 复杂编辑行为依赖手写 `contenteditable`。
- 选区、撤销重做、粘贴清洗、格式嵌套、表格编辑等会继续变复杂。
- WebView 与 macOS 原生剪贴板/文件选择存在兼容兜底代码。
- UI 质量可继续提升，但不建议投入过多长期编辑器能力在当前实现上。

---

## 5. 当前阶段推荐工作

优先级从高到低：

1. 稳定 AIMD Core。
2. 补足 AIMD 文件格式 SPEC。
3. 明确 manifest schema。
4. 增加 Core 层测试，尤其是 rewrite、asset 管理、pack/unpack round-trip。
5. 将当前 macOS viewer 控制在 MVP 范围。
6. 启动 Tauri Desktop 原型。
7. 启动 VS Code 插件命令型原型。

---

## 6. 暂缓事项

以下事项不建议继续堆在当前 `webview_go` viewer 上：

- 完整富文本编辑器。
- 表格复杂编辑。
- 高级图片排版。
- 完整撤销重做模型。
- 插件化编辑器扩展。
- 生产级右键菜单系统。
- 多窗口复杂状态管理。

这些能力应放到 Tauri Desktop 或 VS Code 插件中实现。

---

## 7. 下一阶段建议

### Phase A：规格固化

产出：

- `aimd_file_format_spec.md`
- `aimd_manifest_schema.md`
- Core round-trip 测试

目标：

- 让 `.aimd` 格式边界稳定。
- 为 Tauri、VS Code、SDK 提供共同协议。

### Phase B：Tauri Shell 原型

产出：

- `apps/desktop-tauri`
- 可打开 `.aimd`
- 可展示正文和图片
- 可调用 Go sidecar

目标：

- 验证桌面应用发布路径。

### Phase C：VS Code 插件命令型原型

产出：

- `apps/vscode`
- `AIMD: Inspect`
- `AIMD: Pack Markdown`
- `AIMD: Unpack AIMD`

目标：

- 让开发者工作流先跑起来。

---

## 8. 当前架构原则

```text
Go Core 不丢
CLI 不退化
Viewer 不过度复杂化
Desktop 用 Tauri 演进
VS Code 插件服务开发者和 Agent
所有入口共享同一个 AIMD 语义
```

---

## 9. 判断一项新需求该放哪里

| 需求 | 应放位置 |
|---|---|
| pack/unpack/manifest/asset 规则 | Go Core / 文件格式 SPEC |
| 命令行自动化 | CLI |
| 普通用户双击编辑 | Tauri Desktop |
| 开发者工作流 | VS Code Plugin |
| Agent 生成报告 | CLI / AIMD Server |
| 临时预览验证 | 当前 viewer / preview |
| 完整富文本编辑 | Tauri Desktop / VS Code Plugin，不放当前 viewer |

---

## 10. 当前完成标准

当前阶段可以认为完成，当：

- CLI 能稳定处理 `.aimd`。
- 文件格式 SPEC 初稿完成。
- 当前 viewer 不再承担长期编辑器扩展。
- Tauri 和 VS Code 的原型路径明确。
- 文档分类清晰，后续新需求知道应该进入哪条线。
