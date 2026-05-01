# Dev Report — 第 2 轮 设计打磨 (2026-05-01)

## 本轮目标

第 1 轮把 P0 / P1 / P2 阻塞 bug 修完后，用户反馈"功能在堆砌，不是设计"——
菜单、设置页、导览播放态都需要从产品视角重做 IA 与视觉。本轮全部由主线
Claude 直接动手（不调度 subagent），先用 taste-skill 出设计规范，再实现。

## 改动总览

### 设置窗口（settings.html / settings/main.ts / windows.rs）

| 旧 | 新 |
|----|----|
| 高度可拖（`resizable: true`，min 520x500） | 固定 640x720，禁止 resize |
| 字段顺序：Provider / Model / API Key / API Base / 步数+语言 | 按 Provider→凭证→生成参数→运行环境 三段分组 |
| 字段无副标题，文案晦涩 | 每个字段配人话副标题，DashScope/Gemini 给原型解释、API Base 给"留空使用官方接入点"等 |
| 依赖状态条只显示一次 | 加 "重新检测" 按钮 |
| Provider option label = "DashScope" | "DashScope（通义千问）" / "Gemini（Google）" |
| 单页 form | `<fieldset>` + `<legend>` + `.settings-group-label` + `.settings-group-desc` |

### 顶部工具栏视觉降噪（template.ts / styles）

- ⋯ 菜单按钮：`secondary-btn icon-only` → **`ghost-btn icon-only`**（无边框、透明 bg、hover 才出底色），视觉权重低于保存按钮
- 模式切换：阅读 / 编辑 / 源码 三个 mode-btn 去掉 SVG 图标，纯文字分段控件，active 段加 weight 提升
- ⋯ 菜单里加 `<div class="action-menu-group-label">文件 / 危险</div>` 分组标题（10px uppercase，0.08em letter-spacing）

### 导览状态点（template.ts / chrome.ts / tour.ts）

`#tour-menu-toggle` 加 `<span id="tour-status-dot">` 状态点：
- `data-state="none"`：display:none（无导览）
- `data-state="ready"`：显示，`--tone-info` 蓝点，2px 白描边
- `data-state="generating"`：脉冲动画 `tour-dot-pulse 1.4s`，warn 色

`tour.ts` 在 `generateDocuTour` 期间手动切到 `generating`，结束 reset 给 `updateChrome` 重新决定。

### Docu-Tour 播放态视觉系统（docutour/tour.ts / styles/docutour.css）

- 聚光框 outline：3px 高饱和黄 → **1.5px 半透明 `rgba(255, 220, 110, 0.55)`**，加 `0 0 0 4px rgba(255,220,110,0.18)` 柔和外晕
- 遮罩压暗：`rgba(15,13,9,0.48)` → `rgba(15,13,9,0.32)`
- 控制条：bottom 28→40 让出底部状态条；改 `rgba(15,13,9,0.78)` + `backdrop-filter: blur(10px)`；新增 `inset 0 1px 0` 顶光高光；z-index 1203→1210
- 退出 ×：从 `position: fixed; top:18; right:20`（与顶部 ⋯/保存打架）→ 移入控制条左侧，圆形 28×28，半透明 + 1px 内描边

### 源码模式 metadata banner（template.ts / mode.ts / docutour/frontmatter.ts）

新增 `summarizeFrontmatter()` 工具，统计 `yamlLineCount` / `hasDocuTour` / `docuTourSteps`。
进入 source 模式时 `refreshSourceBanner()` 在 textarea 上方插入 info banner：

> **源码视图**：开头 N 行是 Front-matter，含 **Docu-Tour 导览数据（X 步）**。这些通常由阅读 / 编辑模式自动维护，可手改但建议从顶部菜单操作。

`#markdown` input 时也调一次 `refreshSourceBanner()`，banner 文案随编辑实时更新。
切回阅读 / 编辑模式自动 hidden。

### CSS 模块化拆分（**核心结构改动**）

`src/styles.css` 从 **2418 行** 单文件，拆成 `src/styles/` 子目录下 13 个模块 +
20 行 `@import` 清单：

| 模块 | 行数 | 内容 |
|------|------|------|
| `tokens.css` | 117 | `:root` 变量、base resets、button 重置、body 背景 |
| `frame.css` | 54 | `.app-frame` / `.panel` / 拖入文件 overlay |
| `sidebar.css` | 388 | sidebar 全套：brand / icon-btn / sb-resizer / doc-card / outline / asset / sidebar-foot |
| `workspace.css` | 322 | workspace grid / head / doc-toolbar 容器 / body / empty-state / recent-section / foot+status-pill |
| `toolbar.css` | 250 | toolbar-select / action-menu (含 group-label / sep / danger / icon) / mode-switch / source-banner / tour-status-dot / starter & quick actions |
| `buttons.css` | 147 | primary / secondary / ghost / text + .lg / .sm 修饰符 |
| `reader.css` | 335 | .reader / editor-split / .aimd 排版（h1-h4、list、blockquote、img、code、table）/ frontmatter-card / 滚动条 polish |
| `editor.css` | 122 | format-toolbar (含 ::after tooltip) / inline-editor (contenteditable) |
| `lightbox.css` | 55 | image lightbox |
| `docutour.css` | 124 | overlay / highlight / control / exit |
| `settings.css` | 185 | settings 全套（独立窗口） |
| `debug-console.css` | 123 | debug modal + minimized dock |
| `overlays.css` | 93 | file-ctx-menu + link-popover |
| `responsive.css` | 75 | 1020 / 900 / 760 三个断点 |

`styles.css` 主入口现在是：

```css
@import "./styles/tokens.css";
@import "./styles/frame.css";
... 共 14 个 @import
```

最大模块 388 行（sidebar）。Vite 构建产物 CSS 大小 35.50 KB **不变**，证明拆分零增量。

## 验证

| 检查项 | 状态 |
|--------|------|
| `npm run typecheck` | ✅ |
| `npm run build:web` | ✅（CSS 35.50 KB 不变） |
| `cargo check` | ✅ |
| `cargo test` | ✅ |
| `npx playwright test` | ✅ **247 passed / 0 failed**（上一轮 238，本轮新增 9 条覆盖设计决策） |

## 新增 e2e 用例（`38-design-polish.spec.ts` × 9）

钉死本轮设计决策，避免下次回归：

1. ⋯ 按钮使用 ghost-btn 而非 secondary-btn
2. 保存按钮保留 primary-btn 主色权重
3. 模式切换 — 不渲染 mode-btn-icon SVG（纯文字）
4. ⋯ 菜单展开后存在 2 个 action-menu-group-label
5. 无导览文档 tour-status-dot data-state=none
6. 含导览文档 tour-status-dot data-state=ready
7. 无 frontmatter 时进入 source 模式不显示 banner
8. 含 frontmatter + Docu-Tour 时显示 banner，文案包含 Docu-Tour 步数
9. 切回阅读模式后 banner 自动隐藏

## 已知未做 / 留下一轮

- **lib.rs 仍 941 行**：上一轮已经拆出 `docutour.rs` / `menu.rs`，但 `lib.rs` 还有命令注册、窗口生命周期、State 注入、Manager 等装配逻辑。本轮聚焦前端体验，没再动 Rust 层。下一轮可考虑拆出 `commands.rs`（命令注册）或 `app.rs`（builder 装配）。
- **图标 / 文字混排（P2-1）**：本轮通过把 mode-btn 改纯文字做了一半。format-toolbar 的 ICON + ft-btn--text "正文" 仍混排，但那是格式工具栏，文字与图标各表达不同含义（正文 vs 加粗等），保持现状。
- **Docu-Tour metadata 折叠（P2-3）**：source 模式不强制折叠 textarea（textarea 不支持），改为顶部 banner 提示。如果后续上 CodeMirror 替换 textarea，可以做真正的折叠区。
- **API Key Keychain（P1-5）**：本轮只补了 UI 提示文字 + TODO，迁移到系统 Keychain 留下一轮（涉及 `tauri-plugin-stronghold` 或 keyring 选型）。

## 给下一轮 QA 的回归提示

- **设置窗口**：高度不能拖，分组标题正确显示，点字段输入框不破环固定布局
- **顶部工具栏**：保存按钮和 ⋯ 视觉权重明显不同（保存有 fill bg，⋯ 是透明）
- **模式切换**：三个段控件没有图标
- **导览菜单**：无导览文档点开 ⋯ 旁的"导览"，圆点不显示；含导览的文档圆点显示蓝色
- **Docu-Tour 播放**：聚光框柔和、控制条偏底部 40px 不挤压状态条、退出 × 在控制条左侧不在右上角
- **Source 模式**：含 frontmatter 文档的 textarea 上方有蓝色 info banner，文案包含"Front-matter"和（如果有）"Docu-Tour 导览数据（N 步）"
- **CSS 模块化**：所有视觉应当与拆分前一致；如果发现样式漏了，去对应 `src/styles/<模块>.css` 找
