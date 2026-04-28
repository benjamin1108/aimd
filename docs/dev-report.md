# Dev Report — 第 2 轮 (2026-04-28)

## 本轮修复

### [BUG-006] turndown 默认配置静默压扁表格、丢任务列表 checkbox（P1）

- **位置**:
  - `apps/desktop-tauri/src/main.ts:3-5`（新增 `import { gfm } from "turndown-plugin-gfm"`）
  - `apps/desktop-tauri/src/main.ts:84-93`（在 `new TurndownService(...)` 之后调用 `turndown.use(gfm)`）
  - `apps/desktop-tauri/src/turndown-plugin-gfm.d.ts`（新增 ambient module declaration —— 插件无官方 TS types，最小 .d.ts 仅声明 `gfm`/`tables`/`taskListItems`/`strikethrough`/`highlightedCodeBlock` 五个 plugin 函数签名）
  - `apps/desktop-tauri/package.json`（新增 `turndown-plugin-gfm@^1.0.2` 依赖，2 个 transitive 包）
- **修复**: 安装 `turndown-plugin-gfm`，在 turndown 实例化后立即 `use(gfm)`。`gfm` 包同时启用 tables、taskListItems、strikethrough、highlightedCodeBlock 四个子插件。
- **根因复盘**:
  - turndown 的核心规则不识别 `<table>` / `<input type=checkbox>`，没有 GFM 插件就把 table 当成 4 个孤立 cell 段落、把 checkbox 静默丢弃。
  - QA 报告中的复现：`<table><tr><th>A</th><th>B</th>...` → `"A\n\nB\n\n1\n\n2"`；`<ul><li><input type=checkbox> task one</li>...` → `"-    task one"`（checkbox 丢失）。
- **strikethrough 兼容性**:
  - 现有手写 strikethrough rule 使用 `~~content~~`（GFM 标准），plugin 自带的 strikethrough rule 用单 `~content~`（非标准）。
  - turndown 同名 rule 后注册覆盖前注册（`addRule` 语义），所以 `turndown.use(gfm)` 在前、`turndown.addRule("strikethrough", …)` 在后，最终生效的是手写规则，行为不变。`e2e/04-format-toolbar.spec.ts` 的 strikethrough 测试维持全绿可证。
- **影响面**:
  - 仅影响 HTML→markdown 方向（turndown），即 `flushInline` 路径（用户在 inline editor 编辑或粘贴 HTML 后切 source / 按 ⌘S）。markdown→HTML 方向（Goldmark + GFM extension，`internal/render/html.go`）原本就支持表格 / 任务列表，无需改动。
  - bundle 体积：`dist/assets/index.js` 36.27 kB → 38.12 kB（+1.85 kB），gzip 11.60 kB → 12.20 kB（+0.60 kB），可接受。
- **验证**:
  - typecheck ✅
  - build:web ✅（38.12 kB JS / 18.10 kB CSS，gzip 12.20 / 4.28）
  - 新增 `e2e/11-gfm-tables.spec.ts` 2 例：
    - 粘贴 `<table>` 含 `<thead>` + 2 行 `<tbody>` → 切 source → 断言 textarea markdown 含 pipe-table 头 / 分隔行 / 数据行（4 个 regex 全中）
    - 粘贴 `<ul><li><input type=checkbox disabled> task one</li><li><input type=checkbox disabled checked> task two</li></ul>` → 切 source → 断言 markdown 含 `- [ ] task one` 和 `- [x] task two`
  - 全量 e2e 36/36 ✅
  - go vet ./... ✅
  - go build ./... ✅

## 未修的 bug 与原因

### [BUG-003] Tauri 后端 `Save` 全量重写所有资源（P2）
- **未修原因**: dispatcher 第 1 / 2 轮均明确跳过。

### [BUG-004] `applyHTML` 副作用过重（P3）
- **未修原因**: dispatcher 跳过；e2e 无可观察症状。

### [BUG-007] 极小窗口（< 760px）无打开入口（P3，本轮新增）
- **未修原因**: dispatcher 第 2 轮明确跳过，留下轮决策。⌘O 仍可用，桌面 .app 默认窗口宽度通常 ≥ 1000px。

## 构建状态

- typecheck: ✅
- npm run build:web: ✅（38.12 kB JS / 18.10 kB CSS，gzip 12.20 kB / 4.28 kB）
- go vet ./...: ✅
- go build ./...: ✅
- npm run test:e2e: ✅ **36 passed / 0 failed**（前 34 例维持全绿 + 新增 11-gfm-tables 2 例）
- **tauri build (full): ✅**
  - .app: `apps/desktop-tauri/src-tauri/target/release/bundle/macos/AIMD Desktop.app`（约 20 MB）
  - .dmg: `apps/desktop-tauri/src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg`，**8,848,721 字节（约 8.44 MB）**
  - 注：本轮顺便把 `apps/desktop-tauri/src-tauri/tauri.conf.json` 的 `bundle.targets` 从 `["app"]` 扩到 `["app", "dmg"]`，否则只产 .app 不产 .dmg。这是 ship-prep 必需配置（dispatcher 要求 .dmg 产物）。

## 给 QA 的回归提示

- **重点回归**: BUG-006 修复涉及 turndown 配置全局，请在 inline editor 真实粘贴各种 HTML（来自 Notion / Google Docs / GitHub README）验证表格 + 任务列表 + 删除线都正确转 markdown。`e2e/11-gfm-tables.spec.ts` 已覆盖核心断言。
- **顺带回归**: turndown 升级 GFM 后 `htmlToMarkdown` 行为对**普通**段落 / 标题 / 列表无任何改动（前 34 例全绿可证），但请关注嵌套结构（list-in-quote、quote-in-list 等）的渲染。
- **ship-prep 阶段**: 把 `bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg` 拖入 /Applications，冷启动验证；然后做未覆盖项手动验证：双击 .aimd 文件关联、⌘O 真实 NSOpenPanel、含空格/中文路径、10MB+ 大文件（BUG-003 关注）。

## 第 2 轮总结

BUG-006 已修（turndown 装 `gfm` 插件 + 写新 spec + 全量回归全绿）；e2e **36 / 36 通过**（新增 2 例 GFM 表格 / 任务列表回归）；tauri release build 成功，**.dmg 产物路径 `apps/desktop-tauri/src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg`，大小 8,848,721 字节（≈ 8.44 MB）**。
