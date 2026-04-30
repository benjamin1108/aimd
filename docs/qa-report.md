# QA 报告 — 第 7 轮 (2026-04-30)

> 本轮触发原因：用户验收第 6 轮交付时发现 3 个回归 / 未达预期：
> 1) 保存按钮在保存后**仍然没有灰掉**（第 6 轮的 fix 不完整）
> 2) YAML frontmatter "只展示了 tag，没有内容"，且**位置在标题上方而非下方**
> 3) 多窗口"按钮 + 快捷键"方向理解错了，用户要的是 **Finder 双击多个 .aimd 自动开多个窗口**
> BUG 编号从 BUG-022 起；其中 BUG-022/023/024 是第 6 轮回归。

---

## 摘要

- **P0 阻塞: 1**（BUG-022 保存按钮，破坏核心保存语义）
- **P1 严重: 2**（BUG-023 YAML 渲染位置 + 内容缺失，BUG-024 多窗口 Finder 行为）
- 本轮**不跑** e2e（用户已经手测确认问题，让 dev agent 改完一次性跑构建即可）

---

## P0（阻塞——核心保存交互失效）

### [BUG-022] 保存按钮在保存后仍然亮（dirty=false 却 disabled=false）— 第 6 轮 fix 不完整

- **精确根因**: `apps/desktop-tauri/src/document/persist.ts:42–57`（aimd 分支）和 `apps/desktop-tauri/src/document/persist.ts:25–39`（markdown 分支）的 `try / finally` 结构里：

  ```typescript
  setStatus("正在保存", "loading");
  saveEl().disabled = true;          // 行 43：保存中禁用按钮，防双击
  try {
    const doc = await invoke<AimdDocument>("save_aimd", { ... });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false }, state.mode);
    // ↑ applyDocument 内部 → updateChrome() → saveEl().disabled = !dirty && !isDraft
    //   = !false && !false = true ✅ 此时 disabled 已被 updateChrome 正确设为 true
    rememberOpenedPath(doc.path);
    setStatus("已保存", "success");
  } catch (err) {
    console.error(err);
    setStatus("保存失败", "warn");
  } finally {
    saveEl().disabled = false;       // 行 56：⚠️ 把 updateChrome 设的 disabled=true 又冲回 false！
  }
  ```

  第 6 轮的 fix 给 `applyDocument` 调用点加了 `dirty: false`，让 `updateChrome` 内部计算出 `disabled=true` —— 但**紧接着 `finally` 块又执行 `saveEl().disabled = false`**，把按钮强行点亮。markdown 分支（行 25–39）有完全相同的 bug。

- **修复方向（推荐）**:
  - 删掉 `finally { saveEl().disabled = false; }` 两处，改为 `finally { updateChrome(); }`，让按钮状态完全由 state 驱动（已是单一真源）。
  - **同样的检查**也要做：`saveDocumentAs`（persist.ts:71, 92）的 `saveAsEl().disabled = true / finally { saveAsEl().disabled = false }` —— 这个其实没问题（saveAs 永远 enabled when has doc，不靠 dirty），但为了一致性建议同样改成 `finally { updateChrome(); }`。
- **验证步骤**（dev agent 自查时必跑）:
  1. 启动 app，打开任意 .aimd 文件 → 立即看顶栏「保存」按钮 → **应是灰色** disabled
  2. 进入编辑模式，按 ⌘B 改一下文字 → **应变橙色** enabled
  3. 按 ⌘S 保存 → 保存完成后 → **应立即变回灰色** disabled
  4. 这三步任一不符 → fix 不完整，继续查
- **架构提醒**: 这是单一真源原则（state.doc.dirty + state.doc.isDraft → updateChrome → DOM）破坏的典型例子。直接操作 `saveEl().disabled` 必须以 state 为准，不能在 finally 里盲设 false。

---

## P1（严重——影响阅读观感和多文档工作流）

### [BUG-023] YAML frontmatter "只展示了 tag 没有内容" + 位置应该在标题下方

- **位置**:
  - `internal/render/html.go:21–50`（`Markdown` 函数 —— 当前把 frontmatter 卡片**前置**到整个 body 之前）
  - `internal/mdx/frontmatter.go:61–141`（`RenderFrontmatterHTML` + `parseSimpleYAML` —— parser 当前对 block scalar `|` `>` 和 flow-style 数组 `[a, b]` 处理不完善）
- **现象（用户原话）**:
  > YAML frontmatter这个**只展示了 tag，没有内容**，另外 YAML frontmatter 应该用一种优雅的样式**展示在标题下面，而不是上面**

- **拆成两个子问题独立修**:

  #### 23a. 渲染位置：从"标题上方"改为"H1 标题下方"
  
  当前 `html.go:46–48`：
  ```go
  out := buf.Bytes()
  if hasFM {
      out = append(mdx.RenderFrontmatterHTML(fm), out...)  // ← 前置到全文档头
  }
  ```
  
  期望流程：
  ```
  [<h1>标题</h1>]
  [<section class="aimd-frontmatter">...</section>]   ← 元数据卡片插这里
  [其余正文]
  ```
  
  **修复**：
  ```go
  out := buf.Bytes()
  if hasFM {
      card := mdx.RenderFrontmatterHTML(fm)
      // 找首个 </h1>，插在它之后；找不到就 fallback 到前置
      if idx := bytes.Index(out, []byte("</h1>")); idx >= 0 {
          insertAt := idx + len("</h1>")
          merged := make([]byte, 0, len(out)+len(card)+1)
          merged = append(merged, out[:insertAt]...)
          merged = append(merged, '\n')
          merged = append(merged, card...)
          merged = append(merged, out[insertAt:]...)
          out = merged
      } else {
          out = append(card, out...)
      }
  }
  ```
  
  注意 `bytes.Index` 找的是 ASCII "</h1>" 子串，goldmark 输出大概率是 `<h1 id="...">...</h1>`，闭合 tag 是固定的 `</h1>`，匹配没问题。

  #### 23b. Parser "只展示了 tag 没有内容" 调研 + 增强
  
  用户原话歧义：可能是
  - **解释 A**："只展示了 tag 字段（标签字段），其他字段（title/date 等）都没了" → parser 漏字段
  - **解释 B**："标签（dt/key 部分）展示了，内容（dd/value 部分）是空的" → value 解析失败
  
  让 dev agent 先**写一个测试**再决定修哪里。新建 `internal/mdx/frontmatter_test.go`：
  
  ```go
  package mdx
  
  import "testing"
  
  func TestExtractFrontmatter_basic(t *testing.T) {
      src := []byte("---\ntitle: Test\ntags:\n  - foo\n  - bar\ndate: 2026-01-01\n---\n\n# Body\n")
      fm, body, ok := ExtractFrontmatter(src)
      if !ok { t.Fatal("expected frontmatter") }
      if string(body) != "# Body\n" { t.Errorf("body=%q", body) }
      if !bytes.Contains(fm, []byte("title: Test")) { t.Errorf("missing title") }
  }
  
  func TestRenderFrontmatterHTML_simpleKeys(t *testing.T) {
      fm := []byte("title: 测试\ndate: 2026-04-30\ntags:\n  - alpha\n  - beta\n")
      html := string(RenderFrontmatterHTML(fm))
      // 必须包含三个 dt 和三个 dd
      for _, want := range []string{"<dt>title</dt>", "<dd>测试</dd>",
                                    "<dt>date</dt>", "<dd>2026-04-30</dd>",
                                    "<dt>tags</dt>", "<dd>alpha, beta</dd>"} {
          if !strings.Contains(html, want) {
              t.Errorf("missing %s in:\n%s", want, html)
          }
      }
  }
  
  func TestRenderFrontmatterHTML_blockScalar(t *testing.T) {
      // 当前 parser 对 "|" / ">" 块标量不支持，验证 fallback
      fm := []byte("description: |\n  Line 1\n  Line 2\n")
      html := string(RenderFrontmatterHTML(fm))
      // 至少不应该把 "|" 当成 value 字面量原样输出
      if strings.Contains(html, "<dd>|</dd>") {
          t.Errorf("block scalar | leaked literally as value: %s", html)
      }
  }
  
  func TestRenderFrontmatterHTML_flowArray(t *testing.T) {
      // tags: [foo, bar] flow-style
      fm := []byte("tags: [foo, bar]\n")
      html := string(RenderFrontmatterHTML(fm))
      // 期望解析成 "foo, bar" 而非字面 "[foo, bar]"
      if !strings.Contains(html, "<dd>foo, bar</dd>") &&
         !strings.Contains(html, "<dd>[foo, bar]</dd>") {
          t.Errorf("flow array not handled at all: %s", html)
      }
      // 至少有 dd
      if !strings.Contains(html, "<dt>tags</dt>") {
          t.Errorf("missing tags dt: %s", html)
      }
  }
  ```
  
  跑一次 `go test ./internal/mdx -v -run Frontmatter`。哪些测试 fail，就动 parser 修哪个 case。
  
  **Parser 增强建议**（按需补齐 parseSimpleYAML）:
  - **块标量** `key: |` / `key: >`：value 是 "|" 或 ">" 时，吃后续缩进行（前缀至少 2 空格），把它们 join 成 value（`|` 用 \n、`>` 用空格）。
  - **flow array** `key: [a, b, c]`：value 以 `[` 开头、`]` 结尾时，去掉中括号，按 `,` split，trim 每项，join 成 `"a, b, c"`。
  - 其他保持不变；解析不动的 fallback 到现在的 `<pre><code>原文</code></pre>`。

- **CSS 复核**: `apps/desktop-tauri/src/styles.css:1646–1680` 的 `.aimd-frontmatter` 卡片样式整体 OK，但**新位置**（H1 下方）的 `margin-top` 需要加一点（比如 `margin-top: 8px`），让卡片与 H1 视觉上有清晰间距而非粘住。
- **不动的部分**: turndown 回写（编辑模式 → markdown 时保留 frontmatter）—— 第 6 轮已记为下一轮 TODO，本轮**继续暂不做**。但要确保现状不会更糟：在编辑模式下展示的 inline-editor 里**不要**显示 frontmatter section（用户编辑时看到元数据卡片，turndown 回去时变成奇怪 markdown 会更糟）。
  - 简单兜底：`apply.ts:applyDocument` / `outline.ts:applyHTML` 在向 `inlineEditorEl` 注入 HTML 前，先用 `tmp.querySelectorAll(".aimd-frontmatter").forEach(el => el.remove())` 摘掉 frontmatter section。reader 和 preview 不动。

---

### [BUG-024] 多窗口：用户要的是 Finder 双击多个 .aimd 自动开多个窗口（不是按钮）

- **现状**:
  - 第 6 轮加了 `#new-window` 按钮 + ⌘⇧N 快捷键（`apps/desktop-tauri/src/main.ts:56–58, lib.rs:495 windows::open_in_new_window`）—— 这个保留，**不删**。
  - 但**真正核心场景**没修：用户在 Finder 里选中多个 .aimd 双击 → 当前行为是所有文件 emit `aimd-open-file` 给所有已存在窗口，最后一个文件 win，前面的被覆盖；或者所有文件全部"打架"覆盖单个 main 窗口。
- **位置**: `apps/desktop-tauri/src-tauri/src/lib.rs:500–516`（`RunEvent::Opened` 处理）
  ```rust
  app.run(|app_handle, event| {
      if let RunEvent::Opened { urls } = event {
          for url in urls {
              if let Ok(path) = url.to_file_path() {
                  if is_supported_doc_extension(&path) {
                      let path = path.to_string_lossy().to_string();
                      if let Some(pending) = app_handle.try_state::<PendingOpenPaths>() {
                          if let Ok(mut paths) = pending.0.lock() {
                              paths.push(path.clone());
                          }
                      }
                      let _ = app_handle.emit("aimd-open-file", path);  // ← 广播给所有窗口
                  }
              }
          }
      }
  });
  ```

- **修复方向（推荐）**:

  分场景处理：
  - **冷启动 + 多文件**（app 没在跑，用户 Finder 选 3 个 .aimd 双击）：第 1 个文件交给主窗口（走原 `initial_open_path` 通道），剩下 2 个开新窗口
  - **热启动**（app 已经在跑，用户再双击新文件）：永远开新窗口，**不要**广播 emit 给已有窗口

  实现：
  1. **新增静态原子标志** `MAIN_INITIALIZED: AtomicBool`，在 `initial_open_path` 命令首次被调用时置 `true`（说明主窗口至少完成了一次 bootstrap）。
  2. **改造 `RunEvent::Opened`**：
     ```rust
     use std::sync::atomic::{AtomicBool, Ordering};
     static MAIN_INITIALIZED: AtomicBool = AtomicBool::new(false);

     // 顶层文件 import 区不变，下面是 app.run 里的新逻辑
     app.run(move |app_handle, event| {
         if let RunEvent::Opened { urls } = event {
             let mut consumed_main = false;
             for url in urls {
                 if let Ok(path) = url.to_file_path() {
                     if !is_supported_doc_extension(&path) { continue; }
                     let path_str = path.to_string_lossy().to_string();

                     // 主窗口尚未 bootstrap：第一份文件走 PendingOpenPaths（被
                     // initial_open_path 取走），其余文件开新窗口
                     if !MAIN_INITIALIZED.load(Ordering::SeqCst) && !consumed_main {
                         if let Some(p) = app_handle.try_state::<PendingOpenPaths>() {
                             if let Ok(mut paths) = p.0.lock() {
                                 paths.push(path_str.clone());
                             }
                         }
                         consumed_main = true;
                         continue;
                     }

                     // 热路径：每个文件单开新窗口
                     let h = app_handle.clone();
                     let p = path_str.clone();
                     tauri::async_runtime::spawn(async move {
                         let _ = windows::open_in_new_window(h, Some(p)).await;
                     });
                 }
             }
         }
     });
     ```
  3. **改 `initial_open_path`**：
     ```rust
     #[tauri::command]
     fn initial_open_path(pending: State<'_, PendingOpenPaths>) -> Option<String> {
         let result = if let Some(path) = std::env::args()
             .skip(1)
             .find(|arg| is_supported_doc_extension(std::path::Path::new(arg))) {
             Some(path)
         } else {
             pending.0.lock().ok().and_then(|mut p| p.pop())
         };
         MAIN_INITIALIZED.store(true, Ordering::SeqCst);
         result
     }
     ```

- **新窗口 emit 的 race condition 问题**（一并修）:

  `windows.rs:open_in_new_window` 当前在 `WebviewWindowBuilder::build()` 之后立刻 `window.emit("aimd-open-file", p)`。但新窗口的 JS / `listen("aimd-open-file")` 注册要等 DOMContentLoaded 之后才存在 —— **emit 大概率在 listener 之前发出，被丢失**。第 6 轮的"按钮 → 新窗口"测试因为按钮场景没传 path，没暴露这个 race。Finder 双击场景每次都传 path，必现。

  **修复方向**: 改成"per-window pending map"：
  ```rust
  use std::collections::HashMap;
  
  #[derive(Default)]
  pub struct WindowPending(pub Mutex<HashMap<String, String>>);
  
  pub async fn open_in_new_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
      let nanos = ...;
      let label = format!("doc-{}", nanos);
      // 先把 path 存到 per-window pending（如果有），让新窗口的 initial_open_path 取走
      if let Some(p) = path {
          if let Some(wp) = app.try_state::<WindowPending>() {
              if let Ok(mut map) = wp.0.lock() {
                  map.insert(label.clone(), p);
              }
          }
      }
      WebviewWindowBuilder::new(...).build().map_err(|e| e.to_string())?;
      Ok(())
  }
  ```
  
  然后 `initial_open_path` 同时检查 per-window 和 global pending：
  ```rust
  #[tauri::command]
  fn initial_open_path(
      window: tauri::Window,
      pending: State<'_, PendingOpenPaths>,
      wp: State<'_, WindowPending>,
  ) -> Option<String> {
      let label = window.label().to_string();
      // 1. per-window pending（新窗口走这条）
      if let Ok(mut map) = wp.0.lock() {
          if let Some(p) = map.remove(&label) {
              MAIN_INITIALIZED.store(true, Ordering::SeqCst);
              return Some(p);
          }
      }
      // 2. main 窗口才检查 argv + global pending
      let result = if label == "main" {
          if let Some(path) = std::env::args().skip(1).find(...) {
              Some(path)
          } else {
              pending.0.lock().ok().and_then(|mut p| p.pop())
          }
      } else { None };
      MAIN_INITIALIZED.store(true, Ordering::SeqCst);
      result
  }
  ```
  
  并在 `tauri::Builder::default()` 的链上加 `.manage(WindowPending::default())`（lib.rs 大概第 466 行附近）。

- **验证步骤**:
  1. App 不在跑 → Finder 选 3 个 .aimd 双击 → 应弹出 3 个独立窗口，每个加载对应文件
  2. App 在跑（已开 1 个文档）→ 双击新 .aimd → 新窗口开起来，原窗口不变
  3. ⌘⇧N 新窗口按钮（第 6 轮加的）依然能用，新窗口启动时不带文档进入 launchpad
  4. ⌘O 在新窗口里能开文档，与 main 窗口完全独立
- **架构提醒**:
  - `MAIN_INITIALIZED` 用 `AtomicBool` 静态，不要塞进 PendingOpenPaths 那个 Mutex（避免锁竞争）
  - `WindowPending` 抽到 `windows.rs` 里定义并 `pub` 导出，`lib.rs` 只 `mod windows;` 引用
  - `lib.rs` 当前 642 行，本轮净增 < 30 行（命令函数新增 `tauri::Window` 参数 + 静态 atomic）。windows.rs 净增 < 30 行（WindowPending struct + map insert）。

---

## 共性架构守则（继承第 6 轮）

1. **不要把 main.ts / chrome.ts / lib.rs 写长**。
2. **state 是单一真源**：DOM 属性（特别是 `disabled`）由 `updateChrome()` 单点设置，业务函数不要在 finally 里盲设。
3. **测试驱动**：BUG-023b 必须先写 frontmatter_test.go，看哪个 test fail 再改 parser。
4. 改完一次性跑：
   ```bash
   cd apps/desktop-tauri && npm run typecheck && npm run build:web
   cd ../.. && go vet ./... && go test ./internal/aimd ./internal/mdx
   ```
   全过再写 dev-report；e2e 不强求。

---

## 测试用素材

YAML frontmatter 阅读模式手测样本（写到 `/tmp/test-fm.md` 临时文件）:

```
---
title: 测试文档
date: 2026-04-30
author: 测试用户
tags:
  - alpha
  - beta
  - gamma
draft: true
---

# 主标题

正文第一段。元数据卡片应该出现在这一段**之前、主标题之后**。
```

期望阅读模式渲染顺序：
1. `<h1>主标题</h1>`
2. `<section class="aimd-frontmatter"><dl>` 含 5 个 dt/dd 配对（title/date/author/tags/draft）
3. `<p>正文第一段...</p>`

5 个字段都应可见且每个字段都有内容（除非 YAML 里值就是空）。
