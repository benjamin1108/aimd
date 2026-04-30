---
title: AIMD QA Report — Wave 2 (2026-04-30)
scope: "Tauri + Go sidecar → 纯 Rust + TS" 重构独立 QA 巡检
---

# QA Report — Wave 2 (2026-04-30)

## 1. 真包构建结果

| 产物 | 路径 | 大小 |
|---|---|---|
| Windows MSI | `target/release/bundle/msi/AIMD Desktop_0.1.0_x64_en-US.msi` | 4.5 MB |
| Windows NSIS .exe | `target/release/bundle/nsis/AIMD Desktop_0.1.0_x64-setup.exe` | 2.8 MB |
| release 主程序 | `target/release/aimd-desktop.exe` | 13 MB |

构建命令：`cd apps/desktop && npm run build`（含 `beforeBuildCommand: npm run build:web`）

构建耗时：约 22 秒（Cargo release compile 20.6 s + WiX/NSIS 打包 1.4 s）

构建警告：无

结论：**通过**。sidecar 残留引用已清除，WiX + NSIS 双通道打包均成功产出。`bundle.resources` 已无 `aimd` / `aimd.exe` 条目，`beforeBuildCommand` 只含 `npm run build:web`，无 Go 相关指令。

---

## 2. 端到端往返抽查

### 新增集成测试

新增两个集成测试文件，使用 `include_bytes!` 嵌入真实 fixture（`examples/ai-daily-2026-04-30.aimd`，850 KB）：

- `crates/aimd-core/tests/roundtrip_examples.rs`（9 个测试）
- `crates/aimd-render/tests/roundtrip_render.rs`（6 个测试）

所有 15 个新增测试通过，完整 workspace 测试计数：60 passed / 0 failed（含原有 45 个 unit test）。

`crates/aimd-render/Cargo.toml` 已添加 `[dev-dependencies]` 节：

```toml
[dev-dependencies]
aimd-core = { path = "../aimd-core" }
tempfile = { workspace = true }
```

### 检查项结果

| 检查项 | 结果 |
|---|---|
| frontmatter 卡片 `<section class="aimd-frontmatter">` | 通过 |
| GFM 表格 `<table>` | 通过 |
| heading 带 `id=` 属性 | 通过 |
| asset:// 无 resolver 时原样保留 | 通过 |
| asset:// 有 resolver 时被替换 | 通过 |
| SHA-256 资产完整性（fixture 26 个 asset） | 通过 |
| rewrite GC 保留所有被引用 asset | 通过（asset 数量一致） |
| rewrite 后 createdAt 不变 | 通过 |
| rewrite 后 updatedAt 推进 | 通过 |
| rewrite 无残留 .tmp 文件 | 通过 |

---

## 3. 代码评审发现

### P1（严重，应修）

#### [BUG-R001] `replace_aimd_asset` 不更新 manifest.json 中的 sha256/size/mime

- **位置**: `apps/desktop/src-tauri/src/lib.rs:652-739`
- **发现方式**: 代码走查
- **现象**: 函数直接在 ZIP 字节层替换文件内容，完全跳过 manifest.json 中该资产的 sha256、size、mime 字段更新。替换后 ZIP 中的文件二进制已变，但 manifest 元数据仍指向旧值。
- **影响**:
  1. `Reader::verify_assets()` 调用（SHA-256 完整性检查）必然失败
  2. `find_asset_by_hash` 用 manifest.sha256 做去重依据，错误的旧值导致同一图片重复插入
  3. manifest.size 错误，前端资源面板显示文件大小不准确
- **重现**: 调用 `replace_aimd_asset` 后用 `Reader::open` + `verify_assets()` 检查返回 `InvalidData: sha256 mismatch`
- **建议修法**: 通过 `Reader` 读取旧 manifest，找到目标 asset 条目，用新字节重算 sha256/size/mime，然后用 `Writer` 重新写出完整 ZIP（含更新后的 manifest.json）。或至少在 ZIP 层操作完成后，单独读写 manifest 条目更新元数据。

#### [BUG-R002] `referenced_asset_ids` 对非 UTF-8 字节静默返回空集合，`gc_unreferenced=true` 时会删光所有资产

- **位置**: `crates/aimd-core/src/rewrite.rs:36`
- **发现方式**: 代码走查
- **现象**: 
  ```rust
  let text = std::str::from_utf8(markdown).unwrap_or("");
  ```
  markdown 含非 UTF-8 字节时静默返回 `""`，`referenced_asset_ids` 返回空集合。之后 `rewrite_file` 以 `gc_unreferenced: true` 运行时，认为所有 asset 均未被引用，全部删除。
- **影响**: 数据丢失——文档内所有嵌入图片被批量删除，且不可恢复
- **重现**: 构造含非 UTF-8 字节（如未经验证的外部 paste）的 markdown，调用 `save_aimd`
- **建议修法**: 改为返回 `io::Result<HashSet<String>>`，将 UTF-8 转换失败作为错误上传；或改用 `String::from_utf8_lossy` 并记录 warn，不降级为静默空集合

### P2（建议优化，不阻塞 release）

#### [BUG-R003] comrak `header_ids` 与 `inject_heading_ids` 双重注入，CJK 标题产生两个不同 id

- **位置**: `crates/aimd-render/src/lib.rs:42` 和 `48,80-133`
- **发现方式**: 代码走查 + comrak 行为验证（`cargo run` 直接打印 comrak 输出）
- **现象**:
  - `opts.extension.header_ids = Some(String::new())` 让 comrak 在 heading 内嵌 `<a ... id="slug">` 锚点（comrak slug 保留 CJK，如 `id="ai-日报-2026"`）
  - `inject_heading_ids` 检查 `<h1>` 开标签是否含 `id=`，此时 `<h1>` 无 id（id 在内嵌 `<a>` 上），于是再加一个 `id=` 到 `<h1>` 标签（使用 `slugify`，CJK 折叠为 `-`，结果不同）
  - 最终 HTML：`<h1 id="ai-"><a id="ai-日报-2026" ...></a>AI 日报</h1>`，双 id 且值不一致
- **影响**: 无效 HTML（同一文档两个 id 同名或中文标题双 id 不匹配），大纲跳转与页内锚点链接行为取决于哪个 id 被前端 `extractOutlineFromHTML` 捡到（当前前端用 `h.id`，即 `inject_heading_ids` 生成的那个，CJK 会被截断）
- **建议修法（二选一）**:
  - A. 删除 `opts.extension.header_ids = Some(String::new())`，完全依赖 `inject_heading_ids`，同步修 `slugify` 保留 CJK（见 BUG-R004）
  - B. 删除 `inject_heading_ids`，完全依赖 comrak 的内建 id，前端 `extractOutlineFromHTML` 从 `<a id="...">` 取 id 而非 `h.id`

#### [BUG-R004] `slugify` 把所有非 ASCII 字符（含 CJK）折叠为 `-`，中文标题锚点 id 退化

- **位置**: `crates/aimd-render/src/lib.rs:160-164`
- **发现方式**: 代码走查
- **现象**: 
  ```rust
  } else if c.is_whitespace() || !c.is_ascii() {
      // → push '-'
  ```
  `slugify("AI 日报 2026-04-30")` → `"ai-2026-04-30"`（`日报` 被替换为单个 `-`），与 comrak / Goldmark 的保留 Unicode 字母算法不一致
- **影响**: AI 生成文档（高频含中文标题）的锚点 id 信息丢失，大纲标识不直观
- **建议修法**: 将条件改为 `c.is_whitespace() || (c.is_ascii() && !c.is_alphanumeric())`，Unicode 字母/数字字符（含 CJK）保留原字符后 lowercase

#### [BUG-R005] `parse_simple_yaml` 对含冒号的 value 截断（ISO 时间戳等）

- **位置**: `crates/aimd-mdx/src/frontmatter.rs:119`
- **发现方式**: 代码走查
- **现象**: 
  ```rust
  let colon_idx = match line.find(':') { ... };
  let value = line[colon_idx + 1..].trim();
  ```
  `line.find(':')` 找第一个冒号，`date: 2026-04-30T12:00:00Z` 会被解析为 `key=date, value=2026-04-30T12`，后缀 `:00:00Z` 丢失
- **影响**: frontmatter 卡片中带冒号的 value（ISO 时间戳、URL、YAML 映射值）显示截断
- **建议修法**: 改用 `line.splitn(2, ':')` 只切第一个冒号，余下部分整体作为 value

### P3（nit / 风格）

#### [BUG-R006] `manifest.rs` 测试数据中 sha256 字符串只有 63 位（应为 64 位）

- **位置**: `crates/aimd-core/src/manifest.rs:215`
- **现象**: `"ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469f490bee0b29da3ec"` 长度 63，不是合法 SHA-256（64 位），注释误导维护者
- **建议修法**: 改为合法值或加注释说明这是刻意伪造的测试用哈希

#### [BUG-R007] `replace_aimd_asset` ZIP 过滤逻辑双 `if` 不直观

- **位置**: `apps/desktop/src-tauri/src/lib.rs:672-677`
- **现象**: 两个相邻 if 条件组合含蓄，`old_name == new_name` 时 line 672 不触发而 line 675 触发，行为正确但难以 review
- **建议修法**: 合并为单条件 `if entry.name() == old_name || entry.name() == new_name { continue; }`

#### [BUG-R008] `add_image_bytes` 临时文件在极端 panic 路径下泄漏

- **位置**: `apps/desktop/src-tauri/src/lib.rs:510-514`
- **现象**: 临时文件清理依赖手工 `fs::remove_file`，若中间路径 panic 则泄漏（正常错误路径无问题）
- **建议修法**: 使用 `tempfile::NamedTempFile` RAII 自动清理

---

## 4. 静态校验

| 工具 | 结果 |
|---|---|
| `cargo test --workspace`（debug） | 60 passed / 0 failed（含 15 个新增集成测试） |
| `cargo test --workspace --release` | 60 passed / 0 failed |
| `cargo clippy --workspace --all-targets --release -- -D warnings` | 0 warnings，0 errors |
| `npm run typecheck` (apps/desktop) | 通过 |
| `npm run build:web` (apps/desktop) | 通过，JS 70 KB / CSS 25 KB |
| `npm run test:e2e` 第 1 轮 | 223 passed / 1 failed（偶发超时，见下） |
| `npm run test:e2e` 第 2 轮 | 224 passed / 0 failed |

### e2e 偶发失败分析

**失败 spec**: `e2e/03-mode-switch-preserves.spec.ts:86` — "edits in source mode survive switching to edit mode"

**原因**: `locator('#empty-open').click()` 超时 30s，截图为空白页（Vite dev server 响应慢导致页面在 30s 内未完成渲染）。这是环境级 flaky，第 2 轮同一 spec 正常通过。

**建议**: 将该 spec 超时从 30s 提高至 60s，或在第一个操作前加 `waitForLoadState('networkidle')`。

---

## 5. 文档配置审查

### 已清除（通过）

- `tauri.conf.json`：无 sidecar 条目，`bundle.resources` 未配置
- `apps/desktop/package.json`：无 `build:sidecar` 脚本
- `build-windows.bat`：只检查 Node.js + Cargo + WebView2，无 Go 检查
- `build-dmg.sh`：只安装 node + rust，无 Go 安装步骤
- `scripts/smoke.sh`：只跑 e2e，无 Go CLI
- `scripts/install-mac.sh`：明确注释 "no Go required"

### 仍有残留（待更新）

#### [DOC-001] `README.md` 英文区 "Build from Source" 节仍引用 Go 工具链（P2）

- **位置**: `README.md:271-282` 和 `README.md:395-410`
- **问题**: 
  - line 271: `Requires Go 1.22 or newer.`
  - line 274,281: `go install github.com/aimd-org/aimd/cmd/aimd@latest`
  - line 397-398: `go test ./...` / `go build -o bin/aimd ./cmd/aimd`
  - line 405-406: `cd apps/desktop-tauri`（目录已改名为 `apps/desktop`）
- **建议**: 英文区 Development 节与中文区对齐（只含 `cargo test --workspace` + `npm run test:e2e`）

#### [DOC-002] `docs/windows-desktop.md` 全文描述 Go sidecar 架构（P1）

- **位置**: `docs/windows-desktop.md`（全文 68 行）
- **问题**:
  - line 3: `uses the Go aimd CLI as a bundled sidecar`
  - line 9: `Go 1.22 or newer, with go available in PATH`
  - line 28,42: `From apps/desktop-tauri:`（目录已改名）
  - line 35: `npm run build:sidecar, which builds: bin/aimd.exe`（命令和产物已不存在）
  - line 51: `apps/desktop-tauri/src-tauri/target/...`（路径已变）
  - line 64: `If go is not recognized, install Go`
- **影响**: Windows 开发者按此文档操作会失败，且误以为需要安装 Go
- **建议**: 全文重写为纯 Rust + Tauri 架构，更新目录名为 `apps/desktop`，删除所有 sidecar/Go 相关内容

#### [DOC-003] `docs/current_stage.md` 描述 Go Core + sidecar 阶段（P3）

- **位置**: `docs/current_stage.md:71,128,131,155,169`
- **问题**: 文档描述旧 Go + WebView sidecar 阶段状态（"Go Core 不丢"等），已被 Rust 架构取代
- **建议**: 归档为历史文档或更新为当前 Rust crate 架构

---

## 6. Beta 清单（本轮新增 / 更新项）

| 状态 | 项目 |
|---|---|
| [x] | `npm run tauri build` 产出 Windows MSI + NSIS installer |
| [x] | `cargo test --workspace` 60 tests 全绿（含 15 个新增集成测试） |
| [x] | `cargo clippy --workspace --release -D warnings` 无警告 |
| [x] | 真实 fixture 往返：open → manifest → main.md → render → rewrite GC → verify |
| [x] | SHA-256 资产完整性（fixture 26 个 asset 全部校验通过） |
| [x] | GFM 表格渲染为 `<table>` |
| [x] | heading 带 id 属性（用于大纲跳转） |
| [x] | frontmatter 卡片生成 |
| [x] | asset:// resolver 替换 |
| [x] | e2e 224/224 通过（第 2 轮全量） |
| [~] | `replace_aimd_asset` 执行后 manifest.json sha256/size 正确 — BUG-R001（P1 未修） |
| [~] | 非 UTF-8 markdown 的 GC 安全 — BUG-R002（P1 未修） |
| [~] | 中文标题锚点 id 一致性 — BUG-R003/R004（P2 未修） |
| [~] | frontmatter 时间戳 value 完整显示 — BUG-R005（P2 未修） |
| [ ] | `docs/windows-desktop.md` 更新为 Rust 架构 — DOC-002（P1 文档未更新） |

---

## 7. 总评

### Ship-readiness

**修完 P1 后可发**

| 类别 | 数量 |
|---|---|
| P1 阻塞（代码） | 2（BUG-R001、BUG-R002） |
| P1 阻塞（文档） | 1（DOC-002） |
| P2 建议修 | 3（BUG-R003、BUG-R004、BUG-R005） |
| P3 nit | 3（BUG-R006、BUG-R007、BUG-R008） |

### 重构验证结论

- Go 源码（`cmd/`, `internal/`, `go.mod`, `bin/`）已确认删除
- Tauri sidecar 配置残留已清除
- 三个 Rust crate 单元测试 45 个全绿，新增集成测试 15 个全绿，合计 60 tests
- Windows release bundle 正常产出（MSI 4.5 MB + NSIS 2.8 MB）
- e2e 224 passed / 0 failed（全 mock 模式，未触达 Rust 后端；本轮新增集成测试填补此盲区）
- clippy release 无警告

### 建议修复优先级

1. **BUG-R001**（P1）：`replace_aimd_asset` 通过 Reader/Writer 层更新 manifest 元数据
2. **BUG-R002**（P1）：`referenced_asset_ids` UTF-8 失败返回 `Result` 而非空集合
3. **DOC-002**（P1）：重写 `docs/windows-desktop.md` 为 Rust 架构
4. **BUG-R003/R004**（P2）：选定一套 heading id 生成策略（comrak 内建 or inject），修 CJK slug 保留
5. **BUG-R005**（P2）：YAML value 只在第一个冒号处切分
6. **DOC-001**（P2）：README 英文区删 Go 引用，修目录名
7. 在 CI 中加 `cargo test --workspace --release`（当前只有 debug 模式测试）
