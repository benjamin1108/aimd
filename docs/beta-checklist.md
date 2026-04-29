# AIMD 桌面版 Beta 发布门槛

> 由主对话（dispatcher 角色）维护。QA 每轮 mark 状态，dev 不得越权修改。

状态标记：`[x]` = e2e 通过；`[~]` = 静态推断通过、无 e2e 覆盖；`[ ]` = 未通过 / 未覆盖。

> **第 1 轮（2026-04-28）**：BUG-001 阻塞，详见旧版 `docs/qa-report.md`。
> **第 2 轮（2026-04-28 后续）**：BUG-001/002/005 全部修复 + e2e 验证；新发现 BUG-006 (P1, turndown GFM)；建议进入 ship-prep。
> **第 3 轮（2026-04-29）**：BUG-006 已修（装 turndown-plugin-gfm + 11-gfm-tables.spec.ts 验证）；`npm run build` 成功产出 .app + .dmg（8.44 MB）；e2e 36/36 全绿。**沙箱内迭代到此结束，剩余项需用户在真机上手动冒烟。**
> **第 4 轮（2026-04-29）**：用户报告三个编辑器 bug。发现 BUG-008 (P1，新建文档无焦点，e2e 稳定复现 10/10)、BUG-009 (P1，链接按钮 WKWebView 下 selection 丢失，静态推断)、BUG-010 (P2，重复点击格式按钮 WKWebView 下光标飞出，静态推断)。e2e 163/165 通过，2 失败（BUG-008）。

## 核心功能

- [ ] 双击 `.aimd` 文件打开（macOS file association）— ship-prep 手动
- [~] 通过 `⌘O` 打开
- [x] 通过侧栏底部"打开 AIMD 文件"按钮打开
- [x] 阅读模式正确渲染 markdown
- [x] 编辑模式（inline WYSIWYG）所有工具栏按钮可用：
  - [x] 粗体 / 斜体 / 删除线
  - [x] H1 / H2 / H3 / 正文
  - [x] 无序列表 / 有序列表 / 引用
  - [x] 行内代码 / 插入图片
  - [ ] **链接** — BUG-009 (P1)，WKWebView 下 selection 丢失导致 createLink 无效
- [x] 源码模式 textarea + 实时预览同步
- [x] 三种模式互相切换不丢数据  ← BUG-001 已修复，e2e 全绿
- [x] `⌘S` 保存（间接覆盖 + e2e 10 直接验证 invoke 收到 markdown）
- [~] 保存后 dirty 标记复位
- [x] 插入图片正确写入 `asset://` 引用（e2e 10 覆盖）
- [x] 保存后再打开，图片仍是 `asset://` 引用（不被替换为 data URL）

## 侧栏

- [x] 大纲自动从渲染态提取
- [x] 大纲点击在阅读 / 编辑 / 源码模式下都能滚动到对应标题  ← BUG-002 已修复
- [~] 资源段显示嵌入图片缩略图
- [x] 文档↔大纲、大纲↔资源 之间的拖动手柄可用
- [x] 双击拖动手柄复位

## 状态与反馈

- [x] 状态指示器在 idle / loading / success / warn / info 下颜色正确
- [x] dirty 状态在 doc-card 和 status pill 同步显示
- [~] 文档标题、路径、未保存指示器一致

## 健壮性

- [~] 中文 IME 输入正常（拼音/五笔候选不丢字）— e2e 09 用合成 composition 事件覆盖；真实 IME 候选窗仍需手动
- [~] 路径含空格 / 中文 正常打开保存 — 静态推断通过，ship-prep 手动
- [ ] 大文件（10MB+ 嵌入资源）打开不卡死  ← BUG-003 关注
- [x] 极小窗口（< 760px）布局不破 — e2e 07 覆盖（侧栏隐藏 + 单列）
- [~] 极宽窗口（4K）阅读区域有合理 max-width
- [x] 粘贴恶意 HTML 被 sanitize — e2e 08 覆盖（BUG-005 已修复）

## 构建与打包

- [x] `npm run typecheck` 干净
- [x] `npm run build:web` 干净
- [x] `go vet ./...` 干净
- [x] `go build ./...` 干净
- [ ] `npm run test:e2e` 全绿  ← 163/165（2 failed，BUG-008）
- [x] `npm run build`（tauri release）产出 .app 与 .dmg ← `target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg` (8.44 MB)
- [ ] .dmg 拖入 /Applications 后可冷启动 ← 手动

## 已知非阻塞缺陷（不阻塞 beta，留迭代）

- BUG-003 (P2) — Save 全量 rewrite，ship-prep 手动验大文件
- BUG-004 (P3) — applyHTML 副作用，无可观察症状
- BUG-007 (P3) — < 760px 极小窗口缺"打开"入口（⌘O 仍可用）
- BUG-010 (P2) — 重复点击格式按钮 WKWebView 下光标可能飞出，静态推断（Chromium e2e 无法复现）
- BUG-011 (P3) — applyBlockFormat("P") 的防御性 focus 缺失

## 不阻塞 beta（可推后）

- 字体加载优化
- 暗色模式
- 多文档 tab
- 命令面板（⌘P）
- 撤销/重做的工具栏按钮（系统快捷键已可用）
