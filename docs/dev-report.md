# Dev Report — 第 7 轮 (2026-04-30)

## 本轮修复

### [BUG-022] 保存按钮保存后仍然亮（dirty=false 却 disabled=false）

- **位置**: `apps/desktop-tauri/src/document/persist.ts:36–57`（markdown 分支和 aimd 分支）、`persist.ts:88–93`（saveDocumentAs 分支）
- **修复**: 删掉 3 处 `finally { saveEl()/saveAsEl().disabled = false; }`，全部改为 `finally { updateChrome(); }`，让按钮状态完全由 `state.doc.dirty + state.doc.isDraft → updateChrome → DOM` 单一真源驱动。
- **影响面**: `saveDocument`（markdown 分支）、`saveDocument`（aimd 分支）、`saveDocumentAs` 三条路径。`upgradeMarkdownToAimd` 本身不含 finally 块，不受影响。
- **验证**: typecheck ✅ / build:web ✅ / 静态走读 ✅

### [BUG-023a] YAML frontmatter 位置从标题上方改到 H1 标题下方

- **位置**: `internal/render/html.go:45–57`
- **修复**: 渲染完 markdown 后，用 `bytes.Index(out, []byte("</h1>"))` 找到首个 H1 闭合标签，将 frontmatter card 插入其后；找不到 H1 时 fallback 前置（原行为）。
- **影响面**: 仅影响阅读/预览模式渲染顺序，编辑模式和 turndown 回写不受影响。
- **验证**: go vet ✅ / go test ✅ / 静态走读 ✅

### [BUG-023b] YAML frontmatter Parser 增强（块标量 `|` / `>`、flow array `[a, b]`）

- **位置**: `internal/mdx/frontmatter.go` — `parseSimpleYAML` 函数
- **测试驱动**: 先写 `internal/mdx/frontmatter_test.go`（4 个用例），跑测试后发现 `TestRenderFrontmatterHTML_blockScalar` fail（`|` 被字面输出为 value），其余 3 个 PASS。
- **修复**: 在 scalar 分支前加两个 case：
  - `value == "|"` 或 `">"` 时，消费后续缩进行，join 成真正的值（`|` 用 `\n`，`>` 用空格）
  - `value` 以 `[` 开头 `]` 结尾时，去掉括号按 `,` split，trim 每项，join 成 `"a, b"` 格式
- **影响面**: 仅 `parseSimpleYAML` 内部逻辑，输出格式不变。
- **验证**: `go test ./internal/mdx -v` 4 个新 case 全 PASS ✅ + 原有 6 个 case 全 PASS ✅

### [BUG-023 兜底] 编辑模式不显示 frontmatter 卡片

- **位置**: `apps/desktop-tauri/src/ui/outline.ts` — `applyHTML` 函数（edit 分支）和 `paintPaneIfStale` 函数（edit 分支）
- **修复**: 两处在向 `inlineEditorEl` 注入 HTML 前，先用临时 div 解析 HTML，`querySelectorAll(".aimd-frontmatter").forEach(el => el.remove())` 摘掉 frontmatter section，再赋值 `innerHTML`。reader / previewEl 不受影响。
- **影响面**: 编辑模式（inline editor）不再显示元数据卡片，turndown 回写时不会出现奇怪 markdown。
- **验证**: typecheck ✅ / build:web ✅

### [BUG-024] Finder 双击多个 .aimd 自动开多窗口（含 emit race 修复）

- **位置**:
  - `apps/desktop-tauri/src-tauri/src/windows.rs`（全改）
  - `apps/desktop-tauri/src-tauri/src/lib.rs`（import 区增 AtomicBool、`initial_open_path` 重写、`.manage(WindowPending)` 注册、`RunEvent::Opened` 重写）
- **关键决策**:
  - `MAIN_INITIALIZED: AtomicBool` 静态变量，在 `initial_open_path` 首次调用时置 true，标记主窗口已 bootstrap。
  - `windows.rs` 新增 `WindowPending(pub Mutex<HashMap<String, String>>)`，`open_in_new_window` 改为先把 path 存入 per-window map（以 label 为 key），不再 emit event，彻底消除 race condition（旧实现在 DOMContentLoaded 之前发 emit，监听器还不存在，path 丢失）。
  - `initial_open_path` 新增 `tauri::Window` 和 `WindowPending` 参数：先查 per-window map（新窗口），找到直接返回；main 窗口走原 argv + global PendingOpenPaths 通道；两条路都在返回前 `MAIN_INITIALIZED.store(true)`。
  - `RunEvent::Opened` 冷启动（`!MAIN_INITIALIZED`）时，第 1 个文件入 `PendingOpenPaths`（主窗口取走），其余文件各开新窗口。热路径（`MAIN_INITIALIZED=true`）下每个文件都开新窗口。不再广播 emit。
  - 原第 6 轮的 `⌘⇧N` 按钮 + `open_in_new_window` 命令保留，新窗口无 path 时正常进入 launchpad。
- **净增行数**: `lib.rs` 净增约 22 行；`windows.rs` 净增约 12 行。
- **验证**: cargo check ✅

## 未修的 bug 与原因

无。本轮 BUG-022/023/024 全部修完。

## 构建状态

- typecheck: ✅
- npm run build:web: ✅
- go vet ./...: ✅
- go test ./internal/aimd ./internal/mdx: 10/10 PASS ✅（含 4 个新 frontmatter case）
- cargo check: ✅（Rust 端全量编译通过）
- npm run test:e2e: 跳过（QA 报告明确本轮不跑 e2e）⏭
- tauri build (full): 跳过 ⏭

## 给 QA 的回归提示

**重点回归 BUG-022**（核心保存交互）：
1. 打开任意 .aimd 文件 → 「保存」按钮应是灰色 disabled
2. 进入编辑模式，改一下内容 → 按钮应变橙色 enabled
3. 按 ⌘S 保存完成后 → 按钮应立即变回灰色 disabled

**重点回归 BUG-023**（frontmatter 渲染）：
用 QA 报告的测试样本（含 title/date/author/tags/draft 5 个字段）打开阅读模式：
- 渲染顺序：H1 标题 → frontmatter 卡片 → 正文（不是卡片在标题上面）
- 卡片 5 个字段全部有内容（tags 显示为 `alpha, beta, gamma`）
- 切换到编辑模式：编辑区内不显示元数据卡片

**BUG-024 手测路径**（需真实 app 环境，e2e 无法覆盖）：
- 冷启动：Finder 选 3 个 .aimd 双击 → 弹出 3 个独立窗口，每个加载对应文件
- 热启动：app 已有窗口时双击新 .aimd → 新窗口弹出，原窗口不变
- ⌘⇧N 按钮：新窗口进入 launchpad（无文档），原窗口不变
