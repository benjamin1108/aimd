# AIMD Desktop · 高清 PDF 导出功能设计方案

> 由架构师 + 体验设计师 subagent 产出。dev/QA 可据此立项。

---

## 0. 侦查结论速览（设计前提）

以下是本方案所有决策的客观依据，全部来自代码：

- **CLI 风格**：`cmd/aimd/main.go` 用标准库 `flag` + 子命令分发；`export` 子命令已存在但只支持 `html` 一个 format（`runExport` 入口在 `main.go:218-245`）。新增 `export pdf` 完全契合现有惯例。
- **HTML 渲染管线**：`internal/render/html.go` 的 `render.Markdown(src, resolve)` 把 markdown 转 HTML body 片段，`render.Page(title, body)` 包成完整自包含 HTML，CSS 全部硬编码在 `internal/render/css.go` 的 `defaultCSS`。`internal/export/html.go` 只是把资源以 `data:` URI base64 内嵌后调 `render.Page`。
- **桌面 sidecar 调用范式**：Tauri 侧 `src-tauri/src/lib.rs` 用 `run_aimd_json(app, args, stdin_bytes)` 同步调用 `aimd` 二进制（`Command::new(...).stdout(piped).stderr(piped)`），从 stdout 解析 JSON。`aimd_binary()` 已有 dev / 打包资源 / 环境变量三段式查找。新命令直接复用即可。
- **Sidecar 的 desktop JSON 子命令**：`internal/desktop/desktop.go` 已经把"open / save / render / add-image"等做成 JSON-in JSON-out 形式，是 Tauri 与 Go 之间的稳定 API 层。PDF 导出可以并入这套（如 `aimd desktop export-pdf`）也可以单走 `aimd export pdf`，下面会论证。
- **保存对话框已有**：`rfd::FileDialog` 的 `save_file` / 多按钮 `MessageDialog` 都已经在 `lib.rs` 用过（`choose_save_aimd_file`、`confirm_discard_changes`），同样模式可以直接复用做 PDF 保存。
- **能力声明**：`tauri.conf.json` 没有引用 `tauri-plugin-shell` / `tauri-plugin-dialog`；当前权限用的是 `core:default` + 自管 rfd 弹窗，**意味着无需改 capability 也能加 PDF 命令**，只在 Cargo.toml 里加新 crate 即可。
- **Cargo 依赖**：`src-tauri/Cargo.toml` 已经有 `zip`, `serde_json`, `rfd`，没有 `tauri-plugin-shell`，没有内嵌 Chromium 依赖，包体积纯净。
- **前端 toolbar**：`src/ui/template.ts` 顶栏右侧 `quick-actions` 区域目前是 `保存 / 另存为 / 关闭文档` 三按钮，**没有任何"导出"入口**——这是 PDF 入口的天然落点。
- **Sidebar 资源面板**：`asset-section` 已经把每个图片的 mime/size 列出来（`chrome.ts:25-42`），导出对话框可以复用这个模式展示"将包含 N 张图片 / 总大小 X MB"。
- **现有 CSS 是单一来源**：`render.PreviewCSS()` 暴露给外部读取——这点至关重要，意味着 PDF 用的样式可以和"阅读模式"完全一致，做到 WYSIWYG。

---

## 1. 技术路线对比

### 路线 A：Tauri WebView print-to-PDF（webview 自打印）

**做法**：在 Tauri 主窗口或新开一个隐藏 webview 中加载"打印优化版"HTML，调用 `WebView::print_to_pdf`（macOS 走 WebKit、Windows 走 WebView2、Linux 走 WebKitGTK 都原生支持）。

| 维度 | 评估 |
|---|---|
| 可行性 | 高。Tauri 2 的 `WebviewWindow` 在三平台都暴露打印能力，无需额外二进制。 |
| 矢量文本 | **是**。WebKit / Chromium 都直出矢量 PDF，文字可选可复制可搜索。 |
| 字体嵌入 | **是**。WebKit 默认嵌入字体子集；CJK 字体通过 system fallback。 |
| 图片保真 | **是**。原始 raster 直接编码；SVG 保持矢量。Retina 资源用 `@2x` 或大尺寸源图能保留物理像素。 |
| DPI / 分辨率 | 文本与矢量天然分辨率无关。Raster 由源图决定。 |
| 跨平台一致性 | 中。三平台浏览器内核不同：macOS/iOS WebKit、Windows Edge WebView2 (Chromium)、Linux WebKitGTK；分页换行和字体回退会有细微差。 |
| 实现复杂度 | 低。Rust 侧 ~150 行，前端侧 ~300 行。 |
| 二进制体积 | 0 字节膨胀。 |
| 外部依赖 | 无（Tauri 已内置 webview）。 |
| 主要坑点 | (1) Linux 上 WebKitGTK 的 `print_to_pdf` 历史上有 bug，需要降级方案；(2) headless 打印需要新建一个不可见 webview window，要等 `load` 完成事件后再打印；(3) 页眉页脚定制能力依赖 `@page` CSS，跨内核支持不齐。 |

### 路线 B：Go sidecar 内置 headless 渲染器

包含三个子方案：

**B1 chromedp / go-rod**：用户系统装的 Chrome / Chromium / Edge 来 headless 渲染。
- 体积：sidecar ~+5MB（chromedp 库），但**强依赖用户机器上有 Chrome/Edge**，macOS 用户大量没装独立 Chrome（Safari 用户）。失败概率高。
- 质量：和路线 A 等价，且更稳定（统一 Chromium 内核）。
- 否决：依赖外部 Chrome 安装，体验差。

**B2 wkhtmltopdf 二进制随包分发**：
- 体积：+30MB×3 平台。
- 质量：基于过时的 WebKit 分支，CSS Grid / Flex / `color-mix()` 等现代特性支持差，而我们的 `defaultCSS` 已经在用 `color-mix`。
- 否决：体积+功能落后双输。

**B3 typst / weasyprint 等专用排版引擎**：
- 体积：weasyprint 需 Python 运行时；typst 是 Rust，可静态链接，但需把 markdown 翻译成 typst 标记语言，语义损失大、表格/code highlight/嵌入 HTML 块都得二次实现。
- 否决：是另一套渲染管线，等于把 `internal/render` 重写一遍。

### 路线 C：调用系统 PDF 服务

**做法**：macOS 走 `NSPrintOperation` + `NSPrintInfo` 输出 PDF（无对话框）；Windows 走 "Microsoft Print to PDF" 虚拟打印机；Linux 走 `cups-pdf`。

| 维度 | 评估 |
|---|---|
| 质量 | macOS 极佳（系统级矢量 PDF + 字体嵌入）。 |
| 跨平台 | 极差。Windows / Linux 实现路径完全不同，且 Linux 不保证 cups-pdf 安装。 |
| 实现复杂度 | 三平台各一份原生代码。 |
| 否决理由 | 维护负担 ≥ 收益，且最终质量和路线 A 没有可感知差距。 |

### 路线 D：导出 HTML + 让用户用浏览器打印（保留作"快速通道"）

**做法**：复用现有 `aimd export html` 输出，提示用户"在浏览器打印另存为 PDF"。
- 优点：零开发工作量，质量和 A 一样（都是浏览器打印）。
- 缺点：体验差三步走（导出→打开→打印），不能算产品级 PDF 导出。
- 角色：作为路线 A 失败时的最终兜底入口（在错误对话框里给一个"改为导出 HTML 后手动打印"按钮）。

### 推荐

- **主路线：A（Tauri WebView print-to-PDF）**
  - 理由：零依赖、零体积膨胀、矢量+字体嵌入+图片原始像素全部满足"高清"定义，跨平台一份核心代码，与现有 `internal/render` 渲染管线天然 WYSIWYG（用同一份 CSS）。
- **Fallback：D（导出 HTML 后让用户手动打印）**
  - 理由：不引入新依赖，UI 上只需在 PDF 失败的错误对话框内增加一个"改为导出 HTML"按钮，跳到现有 `export.HTML` 流程。
- **二阶段考虑：B1（chromedp）作为"专业模式"**
  - 仅在 v3 阶段、且确认有用户报告 webview 打印质量不够时再开。

---

## 2. "高清"的可验收定义

dev 必须在最终交付时逐条勾选；QA 用同一张表做验收：

| 维度 | 验收标准 |
|---|---|
| 文本矢量 | 在 Preview / Adobe Reader 中能选中所有正文、标题、代码、表格文字；`Ctrl+F` 能命中；导出后用 `mutool show out.pdf trailer` 或 `pdftotext out.pdf -` 能拿到完整文本。 |
| 字体嵌入 | `pdffonts out.pdf` 显示所有用到的字体均为 `emb=yes`（subset 即可），不依赖目标设备已装相应字体。 |
| CJK 字体回退 | 中英混排不出现"豆腐块"；macOS 走 PingFang SC、Windows 走微软雅黑、Linux 走 Noto Sans CJK SC，由 `defaultCSS` 中的 font-family 链路保证。 |
| 图片保真 | PNG/JPG 源像素被原样嵌入（不二次压缩），`pdfimages -list out.pdf` 显示宽高与原图一致；SVG 保持矢量（在 PDF 中放大无锯齿）。 |
| Retina 截图 | 2x/3x 截图按物理像素嵌入；CSS 用 `max-width: 100%` 控制显示尺寸，不缩小源像素。 |
| 代码块 | 等宽字体、代码不被裁剪（开启 word-wrap 选项后软换行不丢字符）、行号（如启用）不参与复制。 |
| 表格 | 边框完整、不在分页处被腰斩（用 `break-inside: avoid` for `<tr>`）、列宽自适应。 |
| 引用、列表、任务列表 | 与桌面"阅读模式"视觉完全一致（共用 `defaultCSS`）。 |
| 链接 | 外链在 PDF 中可点击（webview 打印自动保留 `<a href>`）。 |
| 大纲/书签 | PDF 大纲面板（Outline）能展开 H1/H2/H3，与文档结构一致。 |
| 目录页（TOC，可选） | 启用时生成可点击跳转的目录，页码正确。 |
| 页码、页眉页脚 | 通过 `@page` CSS 控制，三平台显示一致或退化策略明确。 |

---

## 3. 体验设计

### 3.1 入口

参考 `template.ts:96-126` 的 `head-actions` → `quick-actions`：当前是 "保存 / 另存为 / 关闭文档" 三按钮。

**设计决策**：
- 在 `quick-actions` 区域新增一个 **"导出"按钮**（次级按钮 `secondary-btn`，图标 `ICONS.share` 或 `ICONS.download` 待新增），位置在"另存为"和"关闭文档"之间。
- 点击"导出"弹出**轻量浮层菜单**（参考 `link-popover` 的浮层模式，模板 `template.ts:157-165`），两项：
  - 导出为 PDF…（默认高亮）
  - 导出为 HTML…（沿用现有 `export.HTML`）
- 浮层关闭即按 ESC 或点外部，沿用现有 popover 行为。
- 不做"文件→导出"二级菜单：当前应用没有原生菜单栏（无 `tauri::menu::Menu`），新增成本不值得。
- 键盘快捷键：`⇧⌘E` 导出 PDF（与 `⌘S` 保存 / `⇧⌘S` 另存为 同源系列）。在 `mode.ts` / `main.ts` 已有的 keydown 监听里挂钩。
- 当文档处于 `isDraft`（未保存草稿）时，"导出"按钮禁用，并 tooltip 提示"先保存为 .aimd 再导出"。理由：PDF 导出走 sidecar，sidecar 需要一个真实 .aimd 路径来 resolve 资源；草稿强制走"先保存"流程更可控。

### 3.2 导出对话框（Modal）

**两档设计**：默认状态只露最小可用，"高级选项"折叠在下方。

**最小态字段**：
- 文件名输入框（默认值：`<aimd 文件名 stem>-<YYYYMMDD>.pdf`，例如 `白皮书-20260430.pdf`）
- 保存位置：显示路径，右侧"选择…"按钮调 `rfd::FileDialog::save_file`
- 纸张：单选 `A4` / `Letter`（默认按 locale：zh / 大陆 → A4；en-US → Letter）
- 边距：单选胶囊 `窄 / 普通 / 宽`，默认"普通"
- 主按钮：`导出`；次按钮：`取消`；左下角小字 `> 高级选项`

**高级态额外字段**：
- 自定义纸张尺寸（mm，宽 × 高）
- 自定义边距（上 右 下 左，mm）
- 主题：`跟随当前预览（默认）` / `强制亮色` / `强制暗色`（暗色 PDF 用于演示场景）
- 包含封面：开关，开启时填入 `封面标题 / 副标题 / 作者`，默认从 manifest title 推
- 包含目录（TOC）：开关，开启时可选 `目录深度 H1–H3 (默认) / H1–H4 / H1–H6`
- 包含页码：开关 + 位置选择（左下/居中/右下），默认开+居中
- 页眉模板：文本框，支持占位符 `{title}` `{date}` `{page}` `{totalPages}`，默认空
- 页脚模板：同上，默认 `第 {page} / {totalPages} 页`
- 代码块换行：单选 `软换行（推荐）` / `溢出（横向滚动条不进 PDF，会被裁切）`，默认软换行
- 图片最大宽度：滑杆 `60% / 80% / 100% / 原始`，默认 100%
- "记住这些设置"复选框（写入 `localStorage`）

### 3.3 进度与反馈

- 点击"导出"后，对话框转成 progress 态：
  - 进度条 + 文案 `正在生成 PDF…` → `正在写入文件…` → `已导出`
  - 三阶段映射：(1) sidecar 加载文档+渲染 HTML；(2) Rust 侧 webview load + print_to_pdf；(3) 写盘
- "取消"按钮全程可见。Rust 侧通过 `oneshot::channel` 通知正在跑的 print 任务取消（无法真正中断 print_to_pdf 时，丢弃返回结果即可）。
- 完成后对话框换成成功态：图标 + `已保存到 ~/Downloads/xxx.pdf`，两个按钮：`在 Finder 中显示`（复用现有 `reveal_in_finder`）/ `完成`。
- 顶栏 status pill 同步状态（复用 `setStatus(...)`）。

### 3.4 失败兜底

| 失败场景 | 文案与降级 |
|---|---|
| sidecar 启动失败 | "找不到 aimd 渲染器，请重新安装 AIMD Desktop" + "查看日志" 按钮（打开 stderr 收集到的内容） |
| webview 创建失败 | "PDF 渲染器初始化失败" + "改为导出 HTML 并手动打印"（路线 D 兜底） |
| `print_to_pdf` 返回错误 | 同上，并把 error 文案展开折叠 |
| 写盘失败（权限/磁盘满） | "无法写入 <path>：<systemError>" + "选择其他位置…" |
| 用户在保存对话框点取消 | 静默返回 |
| 目标路径已存在 | rfd 系统对话框已会处理"覆盖确认"，无需自定义 |

### 3.5 保存路径策略

- 默认目录：`~/Downloads`（macOS/Linux）或 `%USERPROFILE%\Downloads`（Windows）
- 记忆策略：导出成功后把目录写入 `localStorage` key `aimd:export:lastDir`，下次打开对话框时优先它
- 默认文件名：`<aimd-stem>-<YYYYMMDD>.pdf`，stem 由 `path/util.ts` 的 `fileStem(doc.path)` 算出
- 如果文档是"未保存草稿"（无 path），导出按钮禁用

---

## 4. 实现计划（垂直切片）

> 每个切片都能独立 demo，之间有清晰交付物；不强制顺序，可并行（前端切片可以先 mock）。

### 切片 1：Go 侧"PDF 渲染就绪 HTML"生成器

**文件**：
- 新增 `internal/render/pdf_css.go` —— 一段 print-targeted CSS 字符串常量 `printCSS`，包含：`@page` 尺寸/边距、`prefers-color-scheme` 强制覆盖、`break-inside: avoid` 等分页规则、页眉页脚 `@page :first/:left/:right` content 槽位。
- 改造 `internal/render/html.go`：新增 `PrintPage(opts PrintPageOptions, body []byte) []byte`，与现有 `Page` 并列，注入 `defaultCSS + printCSS + 用户自定义 @page`。
- 新增 `internal/export/pdf_html.go` —— 复用 `export.HTML` 的资源 base64 内嵌逻辑，但调 `render.PrintPage` 而非 `render.Page`。**注意**：图片必须 base64 内嵌，因为后续 webview 加载这个 HTML 是用 data URL 或临时文件，没有 file:// 资源解析上下文。

**新增依赖**：无。

**接口草案**（伪代码）：
```go
type PrintPageOptions struct {
    Title         string
    Paper         string  // "A4" | "Letter" | "custom"
    PaperWidthMM  float64 // for custom
    PaperHeightMM float64
    MarginTopMM, MarginRightMM, MarginBottomMM, MarginLeftMM float64
    Theme         string  // "auto" | "light" | "dark"
    IncludeCover  bool
    CoverTitle, CoverSubtitle, CoverAuthor string
    IncludeTOC    bool
    TOCDepth      int     // 3 by default
    PageNumbers   bool
    PageNumberPos string  // "left" | "center" | "right"
    HeaderTemplate, FooterTemplate string  // {title} {date} {page} {totalPages}
    CodeWrap      bool
    ImageMaxWidth string  // "60%" | "80%" | "100%" | "original"
}
```

**切片产出**：`go test ./internal/export -run TestPDFHTML` 产出几份样张 HTML 文件，肉眼浏览器打开打印即可验证 print CSS 正确性。**这一步不依赖 Tauri，能独立验证。**

### 切片 2：Go CLI `aimd export pdf` 子命令（"假"PDF）

> 注：这个切片产出的 PDF 实际上是"为 PDF 准备好的 HTML 文件"，让 Tauri 侧负责打印。命名上我们仍把命令叫 `export pdf`，但 v1 的 `aimd export pdf` 子命令暂时只做以下两件事之一：

**方案 2A（推荐）**：`aimd export pdf-html <input.aimd> -o out.html [--paper A4 ...]`
- 子命令名故意用 `pdf-html`，明确表达"这是给打印用的 HTML 中间产物"
- 产出文件给 Tauri 侧 webview 加载
- CLI 用户自己也能用：`aimd export pdf-html foo.aimd -o foo.html && open -a "Google Chrome" foo.html` 然后手动打印

**方案 2B（备选）**：`aimd desktop print-html <input.aimd>` 走 stdin/stdout JSON 流，返回 `{ "htmlPath": "/tmp/xxx.html" }`
- 更内聚于 desktop API 层
- 缺点：CLI 用户没办法直接用

**最终建议两者都做**：CLI 提供 `aimd export pdf-html`（公开能力），Desktop 层 `aimd desktop export-pdf-prepare` 调它（工程便利）。

**文件**：
- 改 `cmd/aimd/main.go` 的 `runExport`：新增 `case "pdf-html"` 分支
- 新增 `internal/export/pdf_html.go`（同切片 1）
- 改 `internal/desktop/desktop.go`：新增 `export-pdf-prepare` JSON 子命令，输入 `{markdown, options}` 输出 `{htmlPath}`
- 把 `cmd/aimd/main.go:39` 的 usage 字符串里 `export` 一行更新成 `export     Export a .aimd to another format (html, pdf-html for v0.1)`

**新增依赖**：无。

### 切片 3：Tauri Rust 侧 `print_to_pdf` 命令

**文件**：
- 改 `apps/desktop-tauri/src-tauri/src/lib.rs`：新增 `export_pdf` invoke handler；新增辅助 `choose_save_pdf_file(suggested_name)`
- 改 `apps/desktop-tauri/src-tauri/Cargo.toml`：根据下面调研结论决定是否加新 crate

**Tauri 2 的 webview 打印能力调研**：Tauri 2 的 `tauri::webview::Webview` 暴露 `print()`（弹出系统打印对话框），但**不直接暴露 `print_to_pdf`**。两条实现路径：

- **3a（推荐）**：在 macOS 上用 `objc2-web-kit` 调 `WKWebView::createPDF(...)`；在 Windows 上调 WebView2 的 `ICoreWebView2_7::PrintToPdfAsync`；在 Linux 上调 `webkit_print_operation_run_dialog_for_frame` 并用 `WEBKIT_PRINT_OPERATION_RESPONSE_PRINT` + `Gtk::PrintOperation` 输出 PDF。**复杂度高、维护负担重**，但保留完整控制力。
- **3b（务实推荐）**：使用 `headless_chrome` 或 `chromiumoxide` crate（**用户机器上的 Chromium**），fallback 到 `tauri-plugin-shell` 调系统命令。但这又退化成路线 B。**否决。**
- **3c（最务实）**：**自带 Wry / 用一个隐藏 Tauri webview window 显示 print preview HTML，调它的原生 `print()`**——但 `print()` 弹打印对话框，不直接出 PDF。

经过权衡，**v1 推荐 3a 但只先做 macOS 实现**（Windows 用 3d 兜底，Linux 用路线 D 兜底）：

- **3d（v1 Windows / Linux 兜底）**：用 `webview2-com` (Windows) / `tao` 自带的 print 能力调出系统 "Print to PDF" 对话框，让用户在对话框里选保存路径。体验略差（多一步系统对话框）但完全跨平台不依赖第三方 Chrome。

**接口草案**：
```rust
#[derive(Debug, Deserialize)]
struct PdfExportOptions {
    paper: String,
    paper_width_mm: Option<f64>,
    paper_height_mm: Option<f64>,
    margin_top_mm: f64,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
    margin_left_mm: f64,
    theme: String,
    include_cover: bool,
    cover_title: Option<String>,
    cover_subtitle: Option<String>,
    cover_author: Option<String>,
    include_toc: bool,
    toc_depth: u8,
    page_numbers: bool,
    page_number_pos: String,
    header_template: Option<String>,
    footer_template: Option<String>,
    code_wrap: bool,
    image_max_width: String,
}

#[derive(Debug, Serialize)]
struct PdfExportResult { output_path: String, bytes: u64, duration_ms: u64 }

#[tauri::command]
async fn export_pdf(
    app: AppHandle,
    aimd_path: String,
    markdown: String,
    output_path: String,
    options: PdfExportOptions,
) -> Result<PdfExportResult, String> {
    // 1) 调 sidecar 生成 print-ready HTML 临时文件（路径放 std::env::temp_dir().join("aimd-pdf-XXXX.html")）
    // 2) 创建一个不可见 WebviewWindow（visible=false, focus=false），加载 file://<htmlPath>
    // 3) 等 onLoadEnd 事件
    // 4) 调平台特定 print_to_pdf，写到 output_path
    // 5) 关闭隐藏 window，删除临时 html
    // 6) 返回 PdfExportResult
}

#[tauri::command]
fn choose_save_pdf_file(suggested_name: Option<String>) -> Option<String> {
    // 复用 lib.rs:44 的 choose_save_aimd_file 模式，filter 改成 PDF
}
```

**依赖增量**：
- macOS：`objc2 = "0.5"`, `objc2-web-kit = "0.2"`（约 +200KB binary）
- Windows：`webview2-com = "0.32"`（约 +500KB binary）
- Linux：用现有 `webkit2gtk` (Tauri 已传递依赖)，无新增

**capabilities**：`src-tauri/capabilities/default.json` 不需改（命令注册即用），但要把 webview 临时文件目录加进 `assetProtocol.scope`：把当前 `["$TEMP/aimd-desktop-assets/**"]` 扩成 `["$TEMP/aimd-desktop-assets/**", "$TEMP/aimd-pdf-render/**"]`。

### 切片 4：前端 UI——按钮 + 浮层菜单

**文件**：
- 改 `apps/desktop-tauri/src/ui/template.ts`：在 `quick-actions` 里 `save-as` 之后插入 `<button id="export" class="secondary-btn">…</button>`；在 main 里加一个 `export-popover` div（结构参考 `link-popover`）
- 改 `apps/desktop-tauri/src/core/dom.ts`：导出新 DOM 引用 `exportEl`、`exportPopoverEl`
- 改 `apps/desktop-tauri/src/ui/chrome.ts`：在 `updateChrome` 中根据 `doc.isDraft` 控制 `exportEl().disabled`
- 新增 `apps/desktop-tauri/src/ui/export-menu.ts`：浮层显隐 + 选项分发

**新增依赖**：无。

### 切片 5：前端 UI——导出对话框 Modal

**文件**：
- 新增 `apps/desktop-tauri/src/ui/export-dialog.ts`：构造 modal DOM、双档设计、表单状态、调 `invoke('export_pdf', ...)`
- 改 `apps/desktop-tauri/src/styles.css`：新增 `.export-dialog`, `.export-dialog__field` 等样式（沿用现有 design tokens：`--fg`, `--border`, `--link`，且 `secondary-btn` `primary-btn` 直接复用）
- 新增 `apps/desktop-tauri/src/document/export-pdf.ts`：业务流，串"调 `choose_save_pdf_file` → 调 `export_pdf` → 调 `reveal_in_finder` (可选) → 通知 setStatus"
- 改 `apps/desktop-tauri/src/main.ts`：挂键盘 `⇧⌘E`、绑定 `exportEl().onclick` 到 `openExportMenu`

**新增依赖**：无（不引入对话框库，纯手写）。

### 切片 6：打磨——封面/TOC/页眉页脚

放在切片 5 之后单独做，因为这三项对 print CSS 复杂度都不小：

- **TOC**：在 `internal/render/html.go` 增加 `extractTOC(body []byte, depth int) []TOCEntry`（goldmark 已生成 heading id，直接 DOM walk 就行），插入到 `<main>` 起始处
- **封面**：渲染前在 markdown body 前面插入一个 `<section class="cover">`，CSS `break-after: page`
- **页眉页脚**：用 `@page { @top-center { content: ... }; @bottom-center { content: counter(page) " / " counter(pages) } }`；注意 WebKit 对 `@page` 边距盒（margin boxes）支持有限，可能需要在 print 之前用 JS 把页码写进固定定位元素

### 切片 7：错误处理 + 日志

- Rust 侧 `export_pdf` 全部错误都包成 `String`，由前端 `export-dialog.ts` 渲染（已有 setStatus error 红色态）
- sidecar stderr 在 print HTML 失败时累计，写入 `app.path().app_log_dir()` 下的 `pdf-export.log`，错误对话框给一个"打开日志"按钮
- 打点：成功/失败计数+耗时，只打到 `console.log`（v1 不接 telemetry）

---

## 5. 测试矩阵

### 5.1 内容类型矩阵（视觉回归 + 人工检查）

针对每种内容，在 `examples/pdf-fixtures/` 准备一份 `.aimd`，跑 `aimd export pdf`，把输出 PDF 转成 PNG（`pdftoppm -r 150`）后用 `pixelmatch` 与 baseline 对比：

| Fixture | 关键校验 |
|---|---|
| `gfm-table.aimd` | 表头加粗、对齐、长表格分页时表头重复（`thead { display: table-header-group }`） |
| `task-list.aimd` | 复选框样式、勾选/未勾选状态 |
| `code-fence-multi-lang.aimd` | 代码块字体等宽、长行换行/不裁切 |
| `inline-html.aimd` | `<div>`, `<details>`, `<sub>`, `<sup>` 渲染 |
| `mixed-cjk.aimd` | "你好 Hello 你好 Hello"无方块字体回退异常 |
| `images-mixed-dpi.aimd` | 包含 1x、2x、3x 截图，每张文件大小校验未被压缩 |
| `svg-diagram.aimd` | SVG 流程图在 PDF 中放大 400% 仍清晰（矢量） |
| `nested-quotes-list.aimd` | 嵌套引用 + 嵌套列表 |
| `large-50pages.aimd` | 长文档：导出耗时 < 10s（M1）；分页正确；TOC 跳转正确 |
| `empty.aimd` | 空文档不报错，输出 1 页空白 |
| `huge-image-50mb.aimd` | 单图 50MB，确保不 OOM、最终 PDF 体积合理 |

### 5.2 选项组合矩阵（参数化 e2e）

| 参数 | 取值 |
|---|---|
| paper | A4, Letter, custom 200×300mm |
| margin | narrow, normal, wide, custom 30mm |
| TOC | off, depth=3, depth=6 |
| 页码 | off, left/center/right |
| 主题 | auto/light/dark |
| codeWrap | true/false |

笛卡尔积太大，用 pairwise 取 ~20 组组合跑 Playwright，每组只断言：(1) 文件生成；(2) 文件大小 > 10KB；(3) 用 `pdfinfo` 抓出来的 `Page size` 匹配预期。

### 5.3 单元测试

- `internal/render`：`TestPrintCSS_PaperSizes`、`TestExtractTOC_Depth`、`TestPrintPage_OmitsCover_WhenNotEnabled`
- `internal/export`：`TestPDFHTML_EmbedsAssetsAsBase64`、`TestPDFHTML_RespectsTheme`
- `internal/desktop`：`TestExportPDFPrepare_ReturnsHTMLPath`

### 5.4 E2E（Playwright，复用现有 `apps/desktop-tauri/e2e/`）

- `export.spec.ts`：打开 fixture → 点导出 → 浮层 → 选 PDF → 默认参数 → 期望文件出现在临时目录 → 用 Node `fs.statSync` 校验大小 > 0
- `export-cancel.spec.ts`：导出过程中点取消 → 输出文件不存在
- `export-draft-disabled.spec.ts`：新建草稿状态下，导出按钮 disabled
- `export-replace-existing.spec.ts`：目标已存在 → 系统对话框替换 → 文件被覆写

### 5.5 跨平台差异点

| 平台 | 重点 |
|---|---|
| macOS 14/15 | WKWebView print API；@2x retina 资源；PingFang SC fallback |
| Windows 11 | WebView2 PrintToPdfAsync；微软雅黑 fallback；中文文件名编码 |
| Linux (Ubuntu 24.04 / Fedora 40) | WebKitGTK 打印能力 + Noto Sans CJK 是否预装 |

QA 在 v1 阶段只承诺 **macOS** + **Windows** 两平台；Linux 标记 "experimental，建议改走 HTML 导出 + 浏览器打印"。

---

## 6. 风险与未决问题

### 6.1 需要产品/用户决策

1. **Linux 是否承诺 v1 一致性？** 不承诺则 v1 直接降级到路线 D（导出 HTML 后用户自打印），UI 上对 Linux 用户隐藏 PDF 选项。**建议接受降级。**
2. **是否做加密 PDF（密码保护）？** 三平台 webview 的 `print_to_pdf` 都不直接支持加密。需要的话要在切片 7 之后引入 `lopdf` (Rust crate) 做后处理。**建议 v1 不做。**
3. **暗色主题 PDF 是否默认？** 暗色 PDF 不利于打印，但适合屏幕分享。建议默认"跟随预览"，并在用户预览处于 dark 时弹一句"暗色 PDF 不适合打印，是否切换为亮色？"。
4. **CJK 字体许可**：是否随包分发 Noto Sans CJK 以保证 Linux/老 Windows 渲染？随包 ~20MB，且各字体许可证不同。**建议不内嵌，依赖系统字体。**
5. **是否暴露"开发者模式"导出原始 print HTML（路线 2A 的产物）给 power user？** 高级选项里加一个隐藏开关。

### 6.2 已知技术风险

- **WebKitGTK print API 不稳**：Linux 路径风险最高，必须有路线 D 兜底
- **@page CSS 的页眉页脚跨内核不一致**：可能要降级用"前端 JS 在打印前把页码画进页脚 div"
- **包体积**：macOS 仅 +200KB（objc2-web-kit），Windows +500KB（webview2-com），可接受
- **首次 print 慢**：webview 冷启动可能 1-2 秒，需要在进度条上覆盖这段静默期
- **Tauri 2 的 `WebviewWindow::new` 在 setup 之外的运行期能否创建隐藏窗口** —— 需要早期 spike 验证；如果不行，得复用主窗口跳转，体验更差。**这是切片 3 的最大未知点，建议第一周做 ≤ 2 天的 spike。**

### 6.3 分阶段建议

**v1（4 周）**：
- 切片 1, 2, 3 (仅 macOS), 4, 5
- 主路线 + 路线 D 兜底
- 不含封面/TOC/页眉页脚高级特性
- Linux 走兜底

**v2（+2 周）**：
- 切片 6（封面 / TOC / 页眉页脚 / 自定义 header footer 模板）
- Windows 平台正式上架
- 切片 7 完整化（日志、错误对话框打磨）

**v3（按需）**：
- Linux 原生 PDF（webkit2gtk）
- PDF 加密 / 元数据（作者、关键词）写入
- 引入 chromedp 作为"专业模式"备选引擎（仅当用户报告质量问题时）

---

## 执行摘要

**推荐路线**：用 Tauri 隐藏 webview 的 `print_to_pdf` 作为主路线（零依赖、矢量+字体嵌入+原图保真，与现有 `internal/render/css.go` 共用一份样式天然 WYSIWYG），以"导出 HTML 让用户手动打印"作为兜底。Go 侧新增 `aimd export pdf-html` 子命令产出 print-ready 自包含 HTML，Rust 侧新增 `export_pdf` invoke 命令负责加载 + 打印 + 写盘，前端在 `quick-actions` 区加"导出"按钮和浮层菜单 + 双档导出对话框。

**v1 范围（约 4 周）**：基础 PDF 导出（A4/Letter、三档边距、亮/暗主题、复用预览样式）、保存对话框、进度条、取消、Finder 显示；macOS 完整支持，Linux 降级到 HTML 兜底，Windows 用系统打印对话框过渡。封面/目录/页眉页脚放 v2。

**关键风险**：(1) Tauri 2 隐藏 webview 创建并 print_to_pdf 的可行性必须第一周 spike 验证；(2) WebKitGTK 在 Linux 的打印 API 历史不稳，所以 v1 不承诺 Linux 一致性；(3) `@page` 边距盒在三内核的页眉页脚支持差异，可能要降级用 JS 注入页码。

### 关键文件路径

- `internal/render/html.go` · `internal/render/css.go`
- `cmd/aimd/main.go`
- `apps/desktop-tauri/src-tauri/src/lib.rs`
- `apps/desktop-tauri/src/ui/template.ts`
