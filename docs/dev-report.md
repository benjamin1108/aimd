# Dev Report — 第 8 轮 (2026-04-30 22:00)

## 本轮修复

### [BUG-R001] `replace_aimd_asset` 不更新 manifest 中的 sha256/size/mime

- **位置**: `apps/desktop/src-tauri/src/lib.rs:652-739`（旧行号）
- **修复**: 完全重写函数，改用 `Reader::open` → `RewriteOptions` + `rewrite_file` 路径，彻底走 Writer 层。`Writer::add_asset` 内部重算 sha256/size/mime，manifest 随 ZIP 内容同步更新。同时移除了不再需要的 `zip` crate 直接依赖（从 `Cargo.toml` 删除），并改用 `tempfile` 做 RAII 临时文件管理（BUG-R008 一并处理）。
- **影响面**: `replace_aimd_asset` Tauri 命令行为改变（之前只替换 ZIP 字节但不更新 manifest，现在是完整 round-trip）；`verify_assets()` 调用之后不会再报 sha256 mismatch；`find_asset_by_hash` 去重依据正确。
- **验证**: cargo test 61/61 / clippy 0 warnings / e2e 224/224

### [BUG-R002] `referenced_asset_ids` 非 UTF-8 字节静默返回空集合导致 GC 清空所有资产

- **位置**: `crates/aimd-core/src/rewrite.rs:35-41`
- **修复**: 改用 `regex::bytes::Regex` 直接在 `&[u8]` 上匹配 `asset://([A-Za-z0-9._-]+)`，完全跳过 UTF-8 转换。asset id 本身限定为 ASCII 字符集，捕获组字节可安全做 `from_utf8`，非 UTF-8 markdown 不再静默返回空集合。同时删除已无用的 `use regex::Regex` 导入。
- **影响面**: `referenced_asset_ids` 函数语义改变（更安全）；`rewrite_file` 的 GC 路径不再有数据丢失风险。
- **验证**: cargo test 61/61 / clippy 0 warnings

### [DOC-002] `docs/windows-desktop.md` 全文描述 Go sidecar 架构

- **位置**: `docs/windows-desktop.md`（全文 68 行）
- **修复**: 整篇重写为纯 Rust + Tauri 架构，删除所有 Go/sidecar 相关内容，目录名从 `apps/desktop-tauri` 改为 `apps/desktop`，更新构建命令、产物路径、验证项和 Troubleshooting。
- **影响面**: 文档唯一，无代码依赖。
- **验证**: 静态走读

### [BUG-R003] comrak `header_ids` 与 `inject_heading_ids` 双重注入

- **位置**: `crates/aimd-render/src/lib.rs:42`
- **修复**: 删除 `opts.extension.header_ids = Some(String::new())`，comrak 不再在 heading 内嵌 `<a id="...">`，heading id 由 `inject_heading_ids` 单一来源负责。
- **影响面**: render 输出的 heading 结构变化（之前双 id，现在 `<h1 id="slug">` 单 id，没有内嵌 `<a>`）；前端 `extractOutlineFromHTML` 用 `h.id` 取值，行为变正确；e2e `06-outline-and-resizer` 中断言 heading 有 id 的用例已验证通过。
- **验证**: cargo test 61/61 / e2e `render_produces_heading_with_id_attribute`

### [BUG-R004] `slugify` 把所有非 ASCII（含 CJK）折叠为 `-`

- **位置**: `crates/aimd-render/src/lib.rs:160-164`
- **修复**: 判断条件从 `c.is_whitespace() || !c.is_ascii()` 改为 `c.is_whitespace() || (c.is_ascii() && !c.is_alphanumeric())`，保留 Unicode 字母数字（`c.is_alphanumeric()` 含 CJK），只折叠空白和 ASCII 标点为 `-`。新增 CJK 和混合标题的 slugify 测试用例。
- **影响面**: 中文/CJK 标题的 heading id 现在保留原文字符（如 `id="ai-日报-2026-04-30"`），与 Goldmark 行为对齐；现有纯 ASCII heading 的 id 不变。
- **验证**: cargo test 61/61（`test_slugify` 包含新 CJK 用例）

### [BUG-R005] `parse_simple_yaml` 对含冒号的 value 截断（ISO 时间戳等）

- **结论**: 代码走查确认当前实现已正确。`line.find(':')` 找第一个冒号，`line[colon_idx + 1..]` 取之后所有内容作为 value，`date: 2026-04-30T12:00:00Z` 会被正确解析为 `value="2026-04-30T12:00:00Z"`，QA 报告的复现描述有误（可能基于旧代码）。
- **处理**: 新增单元测试 `test_parse_iso_timestamp_value_not_truncated` 锁定正确行为，防止将来回退。
- **验证**: cargo test `aimd-mdx` 13/13

### [BUG-R006] `manifest.rs` 测试中 sha256 字符串只有 63 位

- **位置**: `crates/aimd-core/src/manifest.rs:215`
- **修复**: 将测试数据中的 63 位 sha256 补全为 64 位（`...2ec73b00...da3ec` → `...2ec73b00...da3ecf`）。
- **验证**: cargo test 61/61

### [BUG-R007] `replace_aimd_asset` ZIP 过滤逻辑双 `if` 不直观

- **修复**: BUG-R001 修复时整个函数已完全重写，旧的双 `if` ZIP 逻辑已移除。BUG-R007 连带修复。

### [BUG-R008] `add_image_bytes` 临时文件在极端 panic 路径下泄漏

- **位置**: `apps/desktop/src-tauri/src/lib.rs:501-516`（旧行号）
- **修复**: 改用 `tempfile::Builder::new().prefix("aimd-paste-").suffix(&ext).tempfile()` 创建 RAII 临时文件，`NamedTempFile` drop 时自动清理，不再依赖手工 `fs::remove_file`。同时在 `Cargo.toml` 加入 `tempfile = { workspace = true }`。
- **验证**: cargo test 61/61

### [DOC-001] `README.md` 英文区 "Build from Source" 节引用 Go 工具链

- **位置**: `README.md:271-282`（旧行号）和 `README.md:395-410`
- **修复**:
  - "Build from Source" 节删除 `go install` 命令，改为 `cargo build --workspace --release && npm run build`
  - "Development" 节删除 `go test ./...` / `go build`，改为 `cargo test --workspace` / `cargo clippy`
  - `cd apps/desktop-tauri` 改为 `cd apps/desktop`
- **验证**: 静态走读

### [DOC-003] `docs/current_stage.md` 描述 Go Core + sidecar 阶段

- **位置**: `docs/current_stage.md`（全文 188 行）
- **修复**: 整篇重写为当前 Rust workspace 架构，更新已完成能力列表、构建状态表、下一阶段建议和各入口职责分工表；删除所有 Go/sidecar/webview_go 相关描述。
- **验证**: 静态走读

---

## 未修的 bug 与原因

无。本轮 QA 报告中全部 P1/P2/P3 bug 及文档问题均已处理。BUG-R005 已确认不存在实际问题，补充了回归测试替代修复。

---

## 构建状态

- `cargo fmt --all`: 5 文件格式化
- `cargo build --workspace --release`: 19.73s
- `cargo test --workspace --release`: **61 passed / 0 failed**（较上轮 +1 新增 ISO 时间戳测试）
- `cargo clippy --workspace --all-targets --release -- -D warnings`: 0 warnings / 0 errors
- `npm run typecheck` (apps/desktop): 通过
- `npm run build:web` (apps/desktop): 通过，JS 70 KB / CSS 25 KB
- `npm run test:e2e` 第 1 轮: 223 passed / 1 failed（`02-document-flow.spec.ts:89` 偶发超时，同 QA 报告记录的 flaky，与本轮修改无关）
- `npm run test:e2e` 第 2 轮: **224 passed / 0 failed**
- tauri build (full): 跳过（QA 报告已确认打包正常，本轮不涉及 Tauri 配置或打包逻辑）

---

## 给 QA 的回归提示

1. **BUG-R001**（`replace_aimd_asset`）：重点回归「图片压缩/替换」场景，替换后打开文档应正常显示新图片；调用 `verify_assets()` 不应再报 sha256 mismatch；e2e spec 14（image-compression）和 34（idempotent-optimize）已全量通过。
2. **BUG-R002**（GC 安全）：可构造含 `\xff\xfe` 等非 UTF-8 字节的 markdown，保存后所有资产应保留；`rewrite_file_gc_removes_unreferenced_assets` 单元测试已覆盖正确路径。
3. **BUG-R003/R004**（heading id）：中文标题锚点 id 现在保留 CJK 字符（如 `id="ai-日报-2026-04-30"`），大纲跳转可正常命中；请确认前端 `extractOutlineFromHTML` 能正确取到 `h.id`。
4. **DOC-001/002**：Windows 开发者按新 `docs/windows-desktop.md` 操作，无需安装 Go，只需 Rust + Node.js。
5. **BUG-R005**（ISO 时间戳）：已加单元测试确认不截断，请验证 frontmatter 卡片中 `date: 2026-04-30T12:00:00Z` 显示为完整值。
6. **偶发 flaky**：`e2e/02-document-flow.spec.ts:89` 建议将超时从 30s 提高至 60s，或在第一个操作前加 `waitForLoadState('networkidle')`。
