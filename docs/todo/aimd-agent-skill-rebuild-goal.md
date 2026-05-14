# /goal: AIMD Agent Skill 生产级重构与跨 Agent 安装

## 背景

仓库当前有一个 `skill/` 目录，用来指导 Agent 读写 `.aimd` 文档：

```text
skill/
├── SKILL.md
├── scripts/aimd_io.py
└── references/
    ├── format.md
    └── recipes.md
```

当前 skill 的主体思路是对的：让 Agent 通过稳定脚本读正文、看 manifest、提取资源、替换正文、增加资源、清理无引用资源、从 Markdown 新建 `.aimd`。但它已经和当前 AIMD 仓库发生明显漂移：

- 文档仍提到旧 Go CLI、`internal/manifest/manifest.go`、`aimd inspect/view/preview/seal/unpack/export html/pack` 等当前不存在的命令。
- 当前真实 CLI 在 `crates/aimd-cli`，只暴露 Git diff/merge/canonicalize/git config 相关命令。
- `skill/scripts/aimd_io.py` 能覆盖大量 Agent 读写场景，但没有随 PKG 安装成稳定入口，其他 Agent 拿到 skill 后不一定能找到脚本。
- skill 没有提供跨 Agent skills 目录安装能力。
- skill 不是以“极高效阅读、编辑、生成 AIMD”为核心重新设计的生产文档，仍像早期内部工具说明。

用户目标是：彻底删除旧 skill，再重写一个生产级 AIMD skill。新 skill 要能指导各类 Agent 高效阅读、编辑、生成 `.aimd`，并借助 AIMD PKG/CLI 的安装能力，把 skill 安装到通用 Agent 的用户级或项目级 skills 目录。

## 当前 CLI 能力评估

当前 `aimd` CLI 已有命令：

```text
aimd git-diff <file.aimd>
aimd git-merge <base.aimd> <ours.aimd> <theirs.aimd> <path>
aimd canonicalize <file.aimd>
aimd git-install --global|--repo
aimd git-uninstall --global|--repo
aimd git-doctor [--repo]
```

这些命令适合 Git 集成，但不足以支撑新 skill 的生产目标。

### 足够的部分

- `canonicalize` 可用于写后稳定化，减少无意义 diff。
- `git-diff` 可作为只读 fallback，给 Agent 快速看 `main.md`、manifest 摘要和资源表。
- macOS PKG 已安装 `/Applications/AIMD.app` 和 `/usr/local/bin/aimd`，可以作为稳定系统入口。
- PKG 构建脚本已经能把 CLI 打进系统路径，具备扩展为“安装 skill”的基础。

### 不足的部分

要让 Agent 高效读写 `.aimd`，CLI 至少还缺：

- `aimd read FILE`：输出 `main.md`。
- `aimd info FILE [--json]`：输出标题、版本、资源数量、作者、生成来源、健康状态。
- `aimd manifest FILE`：输出完整 manifest JSON。
- `aimd assets list FILE [--json]`：列出资源。
- `aimd assets extract FILE ASSET_ID --output PATH|-`：提取资源字节。
- `aimd write FILE --input body.md|--stdin [--gc] [--canonicalize]`：替换正文并保留资源/manifest。
- `aimd assets add FILE LOCAL_PATH [--id ID] [--name NAME] [--role ROLE] [--mime MIME]`：增加本地资源并输出 `asset://id` 引用。
- `aimd assets remove FILE ASSET_ID`：删除资源。
- `aimd gc FILE`：删除正文未引用资源。
- `aimd new OUT.aimd --input source.md [--title TITLE] [--embed-local-images]`：从 Markdown 生成 `.aimd`。
- `aimd doctor FILE [--json]` 或 `aimd inspect FILE [--json]`：校验 zip、manifest、entry、asset path、sha256、引用缺失、孤儿资源。
- `aimd skill install --agent AGENT --scope user|project [--path PATH] [--force]`：安装 AIMD skill 到目标 Agent 的 skills 目录。
- `aimd skill list-agents`：列出支持的 Agent 和安装路径。
- `aimd skill doctor`：检查当前机器各 Agent skill 目录和 AIMD CLI 可用性。

结论：生产级新 skill 不应继续依赖未安装的 `skill/scripts/aimd_io.py` 作为唯一入口。短期可以保留脚本作为 skill 内部 fallback，但发布目标应把核心读写能力迁入 Rust CLI 或把脚本随 PKG 安装到稳定路径并由 `aimd` 包装调用。推荐迁入 Rust CLI，减少 Python 版本、PATH、脚本位置、权限和跨 Agent 差异。

## 产品目标

完成 AIMD Agent Skill 的生产级重构：

1. 彻底移除旧 `skill/` 内容，重建一个清晰、现代、无旧 Go 痕迹的新 skill。
2. 新 skill 能指导 Agent 极高效地完成三类任务：
   - 阅读 `.aimd`：快速拿正文、元数据、资源清单、必要时提取图片。
   - 编辑 `.aimd`：安全替换正文、保留资源、增加/删除图片、清理孤儿资源、校验结果。
   - 生成 `.aimd`：从 Markdown、本地图片、AI 生成报告创建单文件文档。
3. 新 skill 默认使用稳定 `aimd` CLI，而不是要求 Agent 手工 unzip/zip。
4. AIMD CLI 补齐 Agent 工作流需要的读写/生成/检查/安装 skill 命令。
5. macOS PKG 安装后，系统应具备：
   - `/usr/local/bin/aimd` 可执行。
   - `aimd skill install ...` 可以把 AIMD skill 安装到常见 Agent 的用户级或项目级 skills 目录。
6. 支持一批通用 Agent 的 skills 目录映射，且文档明确用户级和项目级路径。
7. 建立端到端测试：CLI 读写 `.aimd`、skill 安装、安装后的 skill 内容可用。

## 非目标

- 不改变 `.aimd` 文件格式。
- 不在本轮实现 PDF/DOCX/HTML 渲染导出能力，除非已有 core 能力可以安全暴露。
- 不要求所有第三方 Agent 都真的加载 skill；本轮只负责把文件安装到其约定目录并提供清晰诊断。
- 不自动删除或覆盖用户已有同名 skill，除非用户显式 `--force`。
- 不在卸载 AIMD PKG 时默认删除各 Agent 里的 skill；卸载 skill 应提供独立命令。
- 不让 Agent 直接编辑 ZIP 内部结构。

## 支持的 Agent 目录映射

CLI 和文档必须支持以下 Agent 名称、用户级路径和项目级路径：

| Agent | 用户级 skills 目录 | 项目级 skills 目录 |
|---|---|---|
| ClaudeCode | `~/.claude/skills/` | `.claude/skills/` |
| GitHubCopilot | `~/.copilot/skills/` | `.github/skills/` |
| OpenAI Codex | `~/.agents/skills/` | `.agents/skills/` |
| GeminiCLI | `~/.gemini/skills/` | `.gemini/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Amp | `~/.config/agents/skills/` | `.agents/skills/` |
| Goose | `~/.agents/skills/` | `.agents/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/` | `.agents/skills/` |
| Cline | `~/.agents/skills/` | `.agents/skills/` |
| Warp | `~/.agents/skills/` | `.agents/skills/` |
| Continue | `~/.continue/skills/` | `.continue/skills/` |
| Roo | `~/.roo/skills/` | `.roo/skills/` |
| KiroCLI | `~/.kiro/skills/` | `.kiro/skills/` |
| QwenCode | `~/.qwen/skills/` | `.qwen/skills/` |
| OpenHands | `~/.openhands/skills/` | `.openhands/skills/` |
| Qoder / QoderWork | `~/.qoderwork/skills/` | `.qoder/skills/` |

要求：

- Agent 名称匹配大小写不敏感，支持常见别名，例如 `codex`、`openai-codex`、`claude-code`、`github-copilot`、`qoderwork`。
- 用户级路径必须展开 `~`。
- 项目级路径默认相对当前工作目录，也允许 `--project PATH` 指定。
- 安装目录下的 skill 文件夹建议固定为 `aimd/`，即 `<skills-dir>/aimd/SKILL.md`。

## 新 skill 结构

重建后的 `skill/` 建议结构：

```text
skill/
├── SKILL.md
├── references/
│   ├── cli.md
│   ├── format.md
│   ├── agent-install.md
│   └── safety.md
└── examples/
    ├── read-edit-flow.md
    ├── generate-from-markdown.md
    └── add-image-flow.md
```

原则：

- `SKILL.md` 必须短、强、可执行，优先给命令速查和决策树。
- 长解释放到 references，避免 Agent 每次加载过多上下文。
- 不再保留旧 Go CLI 叙述。
- 不再把 `aimd_io.py` 作为主要入口；如果短期保留脚本，只能作为 fallback/reference。
- 所有写操作必须强调：先读正文，再编辑临时 Markdown，再 `aimd write`，最后 `aimd doctor` 或 `aimd canonicalize`。

## 新 SKILL.md 内容要求

`SKILL.md` 必须包含：

1. 触发条件：
   - 用户提到 `.aimd`、AIMD 文档、Markdown 单文件打包、图文报告归档、读取/修改/生成 AIMD。
2. 快速原则：
   - 不手工 unzip/zip 写回。
   - 不把 `asset://id` 改成相对路径。
   - 写前读、写后校验。
   - 资源操作走 CLI。
3. 命令速查：
   - 阅读：`aimd read/info/manifest/assets list/assets extract`
   - 编辑：`aimd write/assets add/assets remove/gc/canonicalize/doctor`
   - 生成：`aimd new`
   - 安装 skill：`aimd skill install`
4. 高效工作流：
   - 总结 `.aimd`
   - 修改正文
   - 增加图片
   - 从 Markdown 生成 `.aimd`
   - 清理和校验
5. 失败处理：
   - CLI 不存在时提示安装 PKG 或从源码构建。
   - 资源缺失、SHA mismatch、manifest 损坏时不要继续写入，先报告。
   - 写操作失败时不删除原文件。

## CLI 扩展要求

### 1. CLI 参数框架

当前 `crates/aimd-cli/src/main.rs` 使用手写参数解析。新增大量命令后应迁移到 `clap`，因为 workspace 已有 `clap` 依赖痕迹，且命令层级会变复杂。

目标命令形态：

```text
aimd read FILE
aimd info FILE [--json]
aimd manifest FILE
aimd doctor FILE [--json]
aimd write FILE --input PATH|--stdin [--gc] [--canonicalize]
aimd new OUT.aimd --input SOURCE.md [--title TITLE] [--embed-local-images]
aimd gc FILE
aimd canonicalize FILE

aimd assets list FILE [--json]
aimd assets extract FILE ASSET_ID --output PATH|-
aimd assets add FILE LOCAL_PATH [--id ID] [--name NAME] [--role ROLE] [--mime MIME]
aimd assets remove FILE ASSET_ID

aimd skill list-agents
aimd skill install --agent AGENT --scope user|project [--project PATH] [--force]
aimd skill uninstall --agent AGENT --scope user|project [--project PATH]
aimd skill doctor [--json]

aimd git-diff FILE
aimd git-merge BASE OURS THEIRS PATH
aimd git-install --global|--repo
aimd git-uninstall --global|--repo
aimd git-doctor [--repo]
```

### 2. 读写能力放入 `aimd-core`

优先复用或扩展 `aimd-core`：

- `Reader::open`、`main_markdown`、`verify_assets`
- `writer`
- `rewrite_file`
- `pack_run_with_markdown`
- `canonical`
- `export_markdown_with_assets` 如果需要解包导出

要求新增的 CLI 写操作必须：

- 原子写入。
- 保留未知 manifest 字段，除非当前 Rust结构无法支持；如果无法保留，必须在 goal 实现时明确记录并测试。
- 重算资源 `size` 和 `sha256`。
- 排序 canonical。
- 对非法 asset id 报错。
- 对找不到的 asset path 报错或在 doctor 中明确报告。

### 3. `doctor/inspect` 输出

新增 `aimd doctor FILE`，用于 Agent 写后校验。

必须检查：

- ZIP 是否能打开。
- `manifest.json` 是否存在且 JSON 可解析。
- `format == "aimd"`。
- `entry` 是否存在，通常为 `main.md`。
- `main.md` 是否 UTF-8。
- 每个 `assets[].path` 是否存在。
- 每个资源 `sha256` 是否匹配。
- 每个资源 `size` 是否匹配。
- 正文中的 `asset://id` 是否在 manifest 中存在。
- manifest 中是否有正文未引用资源。

输出：

- 默认人类可读摘要。
- `--json` 输出结构化结果，便于 Agent 判断是否继续。
- 有严重错误时 exit 非 0；仅孤儿资源 warning 时 exit 0 或专门 warning code，行为需文档化。

### 4. Skill 安装命令

新增 `aimd skill install`。

行为：

- 从 AIMD 安装资源或仓库 `skill/` 目录复制 `aimd` skill 到目标 Agent skills 目录。
- 如果目标已存在：
  - 无 `--force`：拒绝覆盖，输出当前路径和修复建议。
  - 有 `--force`：替换整个 `aimd/` skill 目录。
- 创建目标目录。
- 输出安装位置和下一步提示。
- 不要求 sudo，除非用户指定了需要权限的项目路径。

建议命令：

```bash
aimd skill install --agent codex --scope user
aimd skill install --agent claude-code --scope project --project /path/to/repo
aimd skill list-agents
aimd skill doctor
```

`aimd skill doctor` 要显示：

- 当前 `aimd` CLI 路径。
- 当前 skill 源路径。
- 每个支持 Agent 的用户级路径是否存在、是否可写、是否已安装 AIMD skill。
- 当前目录可安装的项目级路径。

### 5. PKG 打包集成

macOS PKG 目前只安装：

```text
/Applications/AIMD.app
/usr/local/bin/aimd
```

为了支持 `aimd skill install`，PKG 需要让 CLI 能找到 skill 源文件。可选方案：

#### 方案 A：把 skill 作为 App bundle resource

安装到：

```text
/Applications/AIMD.app/Contents/Resources/skill/aimd/
```

`/usr/local/bin/aimd` 运行时按固定路径查找该 resource。优点是卸载 App 时一起消失；缺点是 CLI 与 App 路径耦合。

#### 方案 B：把 skill 安装到系统 share 目录

安装到：

```text
/usr/local/share/aimd/skill/aimd/
```

`aimd skill install` 从该路径复制。优点是 CLI 独立；缺点是 PKG 卸载脚本要删除该目录。

#### 推荐

采用方案 B。因为 `aimd` CLI 已经安装到 `/usr/local/bin/aimd`，把 skill 源安装到 `/usr/local/share/aimd/skill/aimd/` 更符合 CLI 工具语义，也更容易被非 App 场景使用。

PKG 脚本需要改为安装：

```text
/Applications/AIMD.app
/usr/local/bin/aimd
/usr/local/share/aimd/skill/aimd/
```

卸载脚本同步删除：

```text
/usr/local/share/aimd
```

## 实现计划

### 阶段 1：清理旧 skill

- 删除旧 `skill/SKILL.md`、`skill/scripts/aimd_io.py`、旧 references。
- 新建生产级 `skill/` 结构。
- 写新的 `SKILL.md`、`references/cli.md`、`references/format.md`、`references/agent-install.md`、`references/safety.md`。
- 所有内容以当前 Rust AIMD 为准。

### 阶段 2：扩展 CLI 读写命令

- 将 `aimd-cli` 迁移到 `clap`。
- 新增 `read/info/manifest/doctor/write/new/gc/assets` 命令。
- 使用 `aimd-core` 读写，避免 Python 逻辑分叉。
- 保留现有 Git 命令兼容。
- 增加 CLI 单元测试和 golden fixture。

### 阶段 3：扩展 skill 安装命令

- 新增 Agent path registry。
- 新增 `aimd skill list-agents/install/uninstall/doctor`。
- 支持 user/project scope。
- 支持 `--force`。
- 测试所有 path 解析和别名。

### 阶段 4：PKG 集成

- 修改 `scripts/build-macos-pkg.sh`，安装 skill 源到 `/usr/local/share/aimd/skill/aimd/`。
- 修改 `scripts/uninstall-macos-pkg.sh`，删除 `/usr/local/share/aimd`。
- README 下载/卸载/Agent skill 安装说明同步更新。
- `docs/packaging-macos-pkg.md` 同步更新。

### 阶段 5：端到端验证

- 用示例 Markdown 生成 `.aimd`。
- 读取正文、manifest、资源列表。
- 增加图片并写入正文引用。
- 删除正文引用后 `gc`。
- `doctor` 通过。
- `canonicalize` 后 Git diff 稳定。
- `aimd skill install --agent codex --scope project --project /tmp/repo` 安装成功。
- 至少抽样验证 `claude-code`、`github-copilot`、`codex`、`gemini`、`cursor`、`opencode` 的路径解析。

## 测试要求

### Rust 测试

- `cargo test -p aimd-core`
- `cargo test -p aimd-cli`

新增覆盖：

- `read` 输出与 `main.md` 一致。
- `info --json` 输出稳定结构。
- `manifest` 输出完整 JSON。
- `assets list --json` 输出资源元数据。
- `assets extract` 字节一致。
- `write` 保留资源并刷新 `updatedAt`。
- `write --gc` 删除未引用资源。
- `assets add` 自动生成合法 id/path。
- `assets add --id` 非法 id 失败。
- `assets remove` 删除指定 id。
- `new --embed-local-images` 改写本地图片为 `asset://id`。
- `doctor` 能发现 sha mismatch、missing asset、missing referenced asset、orphan asset。
- `skill install` 不覆盖已有 skill，除非 `--force`。
- 所有 Agent path registry 映射正确。

### 脚本/PKG 测试

- `bash -n scripts/build-macos-pkg.sh`
- `bash -n scripts/uninstall-macos-pkg.sh`
- `./scripts/build-macos-pkg.sh --skip-build` 在已有产物下能把 skill 放进 pkg root。
- 安装后 `/usr/local/share/aimd/skill/aimd/SKILL.md` 存在。
- 卸载脚本删除 `/usr/local/share/aimd`。

### 文档测试

- README 中的 skill 安装命令可以直接复制执行。
- `skill/SKILL.md` 中引用的所有命令都真实存在。
- references 中不出现旧 Go CLI、`internal/manifest/manifest.go`、不存在的 `aimd inspect/view/preview/seal/unpack/export html/pack`。

## 验收标准

完成后必须满足：

1. `skill/` 不再包含旧 Python-first/Go CLI 叙述。
2. `aimd --help` 能展示读写、资源、skill 安装、Git 集成四类能力。
3. `aimd doctor example.aimd --json` 可被 Agent 稳定解析。
4. Agent 修改 `.aimd` 的标准流程为：

```bash
aimd read report.aimd > /tmp/report.md
# 编辑 /tmp/report.md
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```

5. 从 Markdown 生成 `.aimd` 的标准流程为：

```bash
aimd new report.aimd --input report.md --embed-local-images
aimd doctor report.aimd
```

6. 安装 skill 的标准流程为：

```bash
aimd skill install --agent codex --scope user
aimd skill install --agent claude-code --scope project --project /path/to/repo
```

7. macOS PKG 安装后，用户不需要 clone 仓库也能执行 `aimd skill install`。
8. README、PKG 文档、skill references 和 CLI help 互相一致。

## 风险与注意事项

- 不同 Agent 的 skill 目录规范可能变化。本文使用用户给定路径作为当前目标，CLI 要把这些路径集中管理，便于后续更新。
- `~/.agents/skills/` 被多个 Agent 共用，安装同一个 `aimd` skill 时应视为幂等。
- 项目级 `.agents/skills/` 也被多个 Agent 共用，不能假设只属于 Codex。
- 如果 CLI 使用 Rust typed manifest 读写，未知 manifest 字段可能丢失；必须在实现前确认 `aimd-core` 是否需要保留未知字段，或明确当前格式不承诺未知字段 roundtrip。
- `doctor` 的 exit code 语义要稳定，否则 Agent pipeline 容易误判。
- PKG 安装系统 share 目录需要管理员权限，和当前 `/usr/local/bin/aimd` 一样属于预期。
