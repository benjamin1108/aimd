# /goal: AIMD Git 原生协作能力终态重构

## 背景

AIMD 当前 `.aimd` 文件是 zip 容器，内部已经是：

```text
main.md
manifest.json
assets/...
```

这个结构适合继续演进为 Git 友好的单文件文档格式。目标不是把 `.aimd` 改成纯文本，也不是牺牲单文件体验；而是让 Git 通过 AIMD 提供的 driver 理解 zip 内部的 Markdown、manifest 和 assets。

需要一次性推到长期终态：

- 本地 `git diff` 能看到 `.aimd` 内部正文和资源清单变化。
- Git merge 能解包三方 `.aimd`，合并 `main.md`、manifest 和 assets，再重新打包。
- `.aimd` 打包结果尽量 canonical，减少无意义 binary blob 变化。
- 提供系统级 macOS `.pkg` 分发，把 App 和 `aimd` CLI 一起安装到稳定路径。
- 桌面 App 设置页可显式安装、检测、修复和卸载 Git driver。
- 冲突不是 opaque binary conflict，而是尽量体现在 `main.md` 中，AIMD UI 能提示用户解决。

## 产品目标

完成 AIMD 的 Git 原生协作能力：

1. 保持 `.aimd` 为 zip 单文件容器。
2. 新增稳定 `aimd` CLI，提供 Git driver 命令。
3. 新增 Git diff driver，让 `git diff *.aimd` 显示可读文本。
4. 新增 Git merge driver，让 `.aimd` 能进行结构化三方合并。
5. 新增 canonical pack，减少无意义 zip 变化。
6. 新增系统级 PKG 安装方案，把 `aimd` CLI 安装到 `/usr/local/bin/aimd`。
7. 设置页新增 Git 集成安装/检测/卸载入口。
8. App 打开有冲突标记的 `.aimd` 时给出明确提示。

## 非目标

- 不把 `.aimd` 改成纯文本主格式。
- 不引入 `.aimd.assets/` 作为主工作格式。
- 不做图片像素级合并。
- 不要求 GitHub/GitLab Web UI 运行本地 textconv；网页 diff 支持不是本 goal 目标。
- 不静默修改用户 Git 配置；必须由用户在设置页显式启用。
- 不依赖用户移动路径不稳定的 App 内部临时路径作为长期 driver 命令；系统级安装后优先使用 `/usr/local/bin/aimd`。

## 现状约束

当前代码事实：

- `crates/aimd-core/src/manifest.rs`
  - `FILE_MAIN_MD = "main.md"`
  - `FILE_MANIFEST = "manifest.json"`
  - `DIR_ASSETS = "assets/"`
- `crates/aimd-core/src/reader.rs` 已能读取 zip、manifest、`main.md` 和 asset bytes。
- `crates/aimd-core/src/writer.rs` 已能写 zip，但需要 canonical 化。
- 当前 workspace 没有独立产品级 `aimd` CLI，需要新增。
- 当前分发没有系统级 CLI 安装，需要新增 macOS `.pkg` 打包路径。

## 目标架构

### `.aimd` 内部结构

继续使用：

```text
main.md
manifest.json
assets/<asset-file>
```

长期要求：

- `main.md` 是唯一正文源。
- `manifest.json` 是资源和包元信息索引。
- 图片资源放在 `assets/`。
- asset id 和 asset path 应尽量内容寻址，至少支持 sha256 稳定识别。
- manifest assets 按稳定顺序输出。
- zip entry 顺序稳定。
- zip timestamp 固定。
- 同样输入多次 pack，输出应尽量字节一致。

### CLI

新增 workspace binary：`aimd`。

建议新增 crate：

```text
crates/aimd-cli/
  src/main.rs
```

命令：

```bash
aimd git-diff <file.aimd>
aimd git-merge <base.aimd> <ours.aimd> <theirs.aimd> <path>
aimd git-install [--global|--repo]
aimd git-uninstall [--global|--repo]
aimd git-doctor [--repo]
aimd canonicalize <file.aimd>
```

其中 Git driver 最核心的是：

```bash
aimd git-diff
aimd git-merge
```

`git-install/git-uninstall/git-doctor` 可由 CLI 和 App 设置页共用，也可以先在 Rust command 层实现等价逻辑，但最终 Git config 应写入稳定命令：

```bash
aimd git-diff
aimd git-merge %O %A %B %P
```

### 系统级 CLI 分发

长期终态要求 macOS 提供系统级 `.pkg` 安装包。

`.pkg` 安装内容：

```text
/Applications/AIMD.app
/usr/local/bin/aimd
```

要求：

- `/usr/local/bin/aimd` 是稳定 CLI 入口。
- 推荐安装真实 CLI binary；如果用 wrapper/symlink，必须确保 App 更新和移动后不易失效。
- 安装到 `/usr/local/bin` 需要管理员授权，这是系统级 PKG 的预期行为。
- `.pkg` 不应静默写用户 Git config。
- `.pkg` 安装后，App 设置页应能检测到 `/usr/local/bin/aimd`。
- 设置页启用 Git 集成时优先写入：

```bash
aimd git-diff
aimd git-merge %O %A %B %P
```

而不是 App bundle 内部路径。

保留 DMG 作为普通 App 分发不是本 goal 的重点；本 goal 的 Git driver 分发以系统级 PKG 为准。

## 短期能力：Git diff driver

### `.gitattributes`

仓库应能写入或建议写入：

```gitattributes
*.aimd diff=aimd merge=aimd
```

注意：`.gitattributes` 可以随仓库提交，但不能自动配置本地命令。

### Git config

全局启用：

```bash
git config --global diff.aimd.textconv "aimd git-diff"
git config --global diff.aimd.cachetextconv true
git config --global merge.aimd.name "AIMD merge driver"
git config --global merge.aimd.driver "aimd git-merge %O %A %B %P"
```

当前仓库启用：

```bash
git config diff.aimd.textconv "aimd git-diff"
git config diff.aimd.cachetextconv true
git config merge.aimd.name "AIMD merge driver"
git config merge.aimd.driver "aimd git-merge %O %A %B %P"
```

### `aimd git-diff`

输入：

```bash
aimd git-diff path/to/doc.aimd
```

输出稳定纯文本，不输出图片二进制。

建议格式：

```text
--- AIMD main.md ---
<main.md utf-8 text>

--- AIMD manifest.json ---
<canonical manifest json>

--- AIMD assets ---
id	path	mime	size	sha256	role
...
```

要求：

- `main.md` 必须原样输出为文本。
- `manifest.json` 必须 canonical 输出。
- assets 清单必须按 id/path 稳定排序。
- 不输出 asset bytes。
- `.aimd` 损坏时输出清晰错误并返回非 0。
- 不要因为 `updatedAt` 等派生字段刷屏；必要时 canonical diff 输出可以弱化或稳定化这些字段。

## 中期能力：canonical zip pack

需要重构 `aimd-core` writer / rewrite / pack 路径，使 `.aimd` 保存尽量稳定。

### Canonical 规则

- zip entries 固定顺序：
  1. `main.md`
  2. `manifest.json`
  3. `assets/...` 按路径排序
- zip entry timestamp 固定，例如 DOS epoch `1980-01-01 00:00:00`。
- compression method 和参数固定。
- manifest JSON pretty 输出稳定。
- manifest assets 按 id/path/sha256 排序。
- 不在普通保存中无意义更新 `updatedAt`。
  - 如果必须保留 `updatedAt`，只在内容实际变化时更新。
  - Git diff textconv 可选择稳定显示或弱化 `updatedAt`。
- 相同内容多次 canonical pack 后应尽量 byte-identical。

### 新增 API

建议在 `aimd-core` 新增：

```rust
canonicalize_aimd(input: &Path, output: &Path) -> Result<()>
unpack_for_git(input: &Path) -> Result<GitAimdPackage>
pack_canonical(package: GitAimdPackage, output: &Path) -> Result<()>
```

具体命名可按代码风格调整。

## 长期能力：Git merge driver

### `aimd git-merge`

Git 调用：

```bash
aimd git-merge %O %A %B %P
```

参数语义：

- `%O`：base，共同祖先 `.aimd`
- `%A`：ours，当前分支 `.aimd`，merge driver 必须把结果写回这个路径
- `%B`：theirs，被合入分支 `.aimd`
- `%P`：工作区路径，仅用于日志/提示

流程：

1. 解包 base / ours / theirs。
2. 读取各自 `main.md`。
3. 对 `main.md` 做三方文本 merge。
4. 合并 manifest。
5. 合并 assets。
6. 重新 canonical pack 到 `%A`。
7. 返回退出码：
   - `0`：合并结果已写回 `%A`
   - 非 `0`：无法安全合并，Git 保持冲突状态

### `main.md` 合并

不要手写脆弱文本合并算法。优先使用 Git 自身能力：

```bash
git merge-file -p ours.md base.md theirs.md
```

或者使用等价三方 merge crate/库。

冲突策略采用：

```text
保留 conflict markers 并重新打包成 .aimd
```

即当同一段落冲突时，合并后的 `main.md` 包含：

```markdown
<<<<<<< ours
...
=======
...
>>>>>>> theirs
```

然后仍然返回 `0`，让 `.aimd` 文件可打开，AIMD UI 负责提示用户解决冲突。

只有在容器损坏、asset id 同名不同内容、manifest 无法解析等硬错误时返回非 `0`。

### assets 合并

图片和二进制资源不做像素级 merge。使用集合合并。

规则：

- same id + same sha256 / same bytes：保留一份。
- only in ours：保留。
- only in theirs：保留。
- only in base 且两边都不引用：可删除。
- only in base 但 merged `main.md` 仍引用：保留。
- same id + different sha256：硬冲突，返回非 `0` 或写入 manifest conflict 后返回 `0`；第一版建议硬冲突返回非 `0`。
- 不确定是否引用时，偏保守保留资源，后续 GC 可以清理。

合并后的 assets：

- 按 path/id 排序。
- 校验每个 manifest asset 对应 zip entry 存在。
- 校验 sha256。

### manifest 合并

manifest 应尽量可重建，减少冲突。

建议策略：

- `assets[]` 从合并后的资源集合重建。
- `entry` 固定为 `main.md`。
- `format/version` 使用当前格式。
- `title` 优先从合并后的 `main.md` 或 frontmatter 推导，避免与正文重复冲突。
- `createdAt` 使用 base/ours/theirs 中最早的有效值。
- `updatedAt` 仅在实际内容变化时更新，或 canonical pack 中稳定处理。
- `generatedBy/rendering/authors` 如两边同字段不同，保守保留 ours 并记录 warning；若字段对产品关键，再设计细粒度冲突。

## AIMD App 设置页：Git 集成

### 设置入口

设置页新增分区：

```text
Git 集成
```

显示：

- Git 是否已安装。
- `aimd` CLI 是否可执行。
- `/usr/local/bin/aimd` 是否存在且可执行。
- 当前仓库是否有 `.gitattributes`。
- 当前仓库 driver 状态。
- 全局 driver 状态。

操作：

- `启用当前仓库 Git 集成`
- `启用全局 Git 集成`
- `写入 .gitattributes`
- `检查/修复`
- `禁用当前仓库 Git 集成`
- `禁用全局 Git 集成`

### 用户确认

启用前必须明确提示：

```text
启用后，Git 在 diff/merge .aimd 文件时会调用 AIMD 命令。
这会修改 Git 配置，可随时关闭。
```

不要静默写入 Git config。

如果 CLI 未安装或不可执行，应提示用户安装系统级 AIMD PKG，或在开发环境中给出当前构建可用的修复方式。

### 后端命令

新增 Tauri commands，命名可调整：

```rust
git_integration_status(repo_path: Option<String>) -> GitIntegrationStatus
git_integration_enable_global() -> Result<GitIntegrationStatus, String>
git_integration_disable_global() -> Result<GitIntegrationStatus, String>
git_integration_enable_repo(repo_path: String) -> Result<GitIntegrationStatus, String>
git_integration_disable_repo(repo_path: String) -> Result<GitIntegrationStatus, String>
git_integration_write_gitattributes(repo_path: String) -> Result<GitIntegrationStatus, String>
git_integration_doctor(repo_path: Option<String>) -> Result<GitDoctorResult, String>
```

这些命令内部可以调用 `git config`，但必须：

- 使用参数数组，不拼 shell 字符串。
- 超时保护。
- 捕获 stderr。
- 不要求用户必须在 Git repo 中才能看全局状态。
- 写 `.gitattributes` 必须幂等，不重复追加。

## AIMD App 冲突 UI

当打开 `.aimd` 后，如果 `main.md` 包含 Git conflict markers：

```text
<<<<<<<
=======
>>>>>>>
```

App 应：

- 顶部状态提示：`文档包含 Git 冲突，请解决后保存`
- 禁止或警告一键格式化，避免模型误清理冲突标记。
- 提供“查找下一个冲突”基础能力，或至少在源码/编辑模式可见。
- 保存时如果仍有冲突，提醒用户确认。

第一版 UI 可以只做检测和提示，不要求完整冲突编辑器。

## 文件与模块建议

### Rust core

- `crates/aimd-core/src/git_diff.rs`
- `crates/aimd-core/src/git_merge.rs`
- `crates/aimd-core/src/canonical.rs`
- 更新 `writer.rs`
- 更新 `manifest.rs`
- 更新 `reader.rs`

### CLI

- 新增 `crates/aimd-cli/`
- 更新 workspace `Cargo.toml`

### Desktop

- `apps/desktop/src-tauri/src/git_integration.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- macOS packaging scripts/config for system `.pkg`
- `apps/desktop/src/settings/main.ts`
- `apps/desktop/src/core/settings.ts` 或新增 UI state 类型
- `apps/desktop/src/document/apply.ts` / `ui/chrome.ts` 增加冲突提示

### Repo

- 新增或更新 `.gitattributes`
- 文档：`docs/git-integration.md`
- 文档：`docs/packaging-macos-pkg.md`

## 测试要求

### aimd-core / aimd-cli

- `git-diff` 输出包含 `main.md`。
- `git-diff` 输出 canonical manifest。
- `git-diff` 输出 assets 清单，不输出图片 bytes。
- canonical pack 同输入多次输出稳定。
- assets 排序稳定。
- manifest assets 排序稳定。
- 两边改 `main.md` 不同段落，`git-merge` 自动合并。
- 两边改同一段，`git-merge` 生成 conflict markers 并重新 pack。
- 两边新增不同图片，合并后 assets 取并集。
- same id different sha256 时安全失败。
- 损坏 `.aimd` 返回清晰错误。

### Desktop Rust

- Git 未安装时 status 可返回清晰状态。
- CLI 不在 PATH 时显示未安装/不可执行。
- `/usr/local/bin/aimd` 存在但不可执行时显示明确错误。
- 启用全局写入正确 config。
- 禁用全局清理 config。
- 启用 repo 写入 `.git/config`。
- `.gitattributes` 写入幂等。
- 不在 Git repo 时 repo enable 给出清晰错误。
- macOS PKG 构建产物包含 `/Applications/AIMD.app` 和 `/usr/local/bin/aimd`。
- PKG 安装脚本不写用户 Git config。

### Frontend / E2E

- 设置页显示 Git 集成分区。
- 点击启用前有明确确认。
- 启用后状态更新。
- 禁用后状态更新。
- 打开包含 conflict markers 的 `.aimd` 显示冲突提示。
- 含冲突文档点击一键格式化时被阻止或强提示。

## 验收标准

- `.aimd` 仍为 zip 单文件。
- `aimd git-diff file.aimd` 可输出可读、稳定文本。
- 配置 driver 后，本地 `git diff *.aimd` 可看到正文和资源清单变化。
- `aimd git-merge base ours theirs path` 能对可合并变更生成新的 `.aimd`。
- 正文冲突写入 `main.md` conflict markers，AIMD 可打开并提示。
- 图片资源不做像素级 merge，只做内容寻址集合合并。
- `.aimd` 保存/pack 尽量 canonical，减少无意义变更。
- macOS PKG 能系统级安装 App 和 `/usr/local/bin/aimd`。
- PKG 安装后设置页能检测 CLI 并启用 Git driver。
- 设置页可显式启用、检测、修复和禁用 Git 集成。
- 不静默修改用户 Git 配置。
- 测试覆盖 diff、merge、canonical、设置页和冲突提示。
