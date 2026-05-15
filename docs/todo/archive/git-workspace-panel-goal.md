# /goal: 在大纲区域新增 Git 仓库管理 Tab

## 背景

AIMD Desktop 已有目录管理能力：用户可以打开一个本地目录，并在侧边栏浏览 `.aimd` / Markdown 文档。下一步需要在当前“大纲”区域增加 Git 支持：当打开的目录本身是 Git 仓库时，在大纲区域出现一个 `Git` tab，让用户完成基础 Git 管理。

这个能力是文档工作区的辅助面板，不是完整 Git 客户端。第一版重点是安全、可解释、可上线：查看仓库状态、stage / unstage、提交、push / pull。不要加入高风险或复杂 Git 工作流。

## 产品目标

在左侧栏下方当前“大纲”区域增加 tab：

- 默认 tab 是 `大纲`。
- 如果当前打开目录本身是 Git 仓库，则显示 `Git` tab。
- 如果当前打开目录不是 Git 仓库，则不显示 `Git` tab，也不要出现“不是仓库”的占位提示。
- `Git` tab 用于管理当前工作目录对应的 Git 仓库。

仓库判断必须严格使用当前工作目录 root：

- root 下存在 `.git/` 目录，或 `.git` 文件，才视为 Git 仓库。
- 不向父目录自动查找。
- 不把“子目录属于上级仓库”作为第一版支持范围。

## V1 功能范围

`Git` tab 第一版必须支持：

- 显示当前分支名。
- 显示 upstream / ahead / behind 信息（如果存在）。
- 显示工作区状态摘要：
  - modified
  - added
  - deleted
  - renamed
  - untracked
  - conflicted
- 显示变更文件列表。
- 点击文件查看该文件 diff 预览。
- stage 单个文件。
- unstage 单个文件。
- stage all。
- unstage all。
- 输入 commit message。
- commit。
- refresh。
- push 当前分支。
- pull 当前分支。

push / pull 要复用用户系统 Git 配置和 credential helper，因此第一版使用系统 `git` CLI。

## 非目标

第一版不要做：

- branch checkout。
- create branch。
- merge。
- rebase。
- reset。
- stash。
- amend commit。
- force push。
- conflict resolve 编辑器。
- history graph。
- interactive patch staging。
- 全仓库搜索。

如果遇到冲突状态：

- 可以显示 conflicted 文件。
- 禁止 commit / pull / push。
- 提示用户使用外部 Git 工具或命令行解决冲突。

## 后端设计

在 `apps/desktop/src-tauri/src` 下新增 `git.rs` 或等价模块，并注册 Tauri commands。

建议 commands：

```ts
get_git_repo_status(root: string): GitRepoStatus
get_git_file_diff(root: string, path: string): GitFileDiff
git_stage_file(root: string, path: string)
git_unstage_file(root: string, path: string)
git_stage_all(root: string)
git_unstage_all(root: string)
git_commit(root: string, message: string)
git_pull(root: string)
git_push(root: string)
```

DTO 建议：

```ts
type GitRepoStatus = {
  isRepo: boolean;
  root: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  clean: boolean;
  conflicted: boolean;
  files: GitChangedFile[];
  error?: string;
};

type GitChangedFile = {
  path: string;
  originalPath?: string;
  staged: GitFileState;
  unstaged: GitFileState;
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
};

type GitFileDiff = {
  path: string;
  stagedDiff: string;
  unstagedDiff: string;
  isBinary: boolean;
};
```

具体字段可按实现调整，但必须能支撑 UI 显示分支、变更列表、stage 状态、diff 和冲突状态。

## 后端实现要求

### Git 仓库检测

- 只检测 workspace root 本身。
- root 下有 `.git` 目录或 `.git` 文件才返回 `isRepo: true`。
- 非仓库时返回 `isRepo: false`，不要报错。

### 命令执行

- 使用 `std::process::Command::new("git")`，不要通过 shell 拼接命令。
- 所有命令使用固定 allowlist，不允许前端传任意 Git 参数。
- 所有命令都必须设置当前目录为 repo root。
- stdout / stderr 要限制长度，防止超大输出卡死 UI。
- 命令需要超时保护；如当前项目没有通用 timeout helper，可以先实现小型 helper。
- 找不到 `git` 时返回明确错误。

### 路径安全

- 所有传入的 root 必须 canonicalize。
- 所有传入的文件 path 必须在 root 内。
- 禁止 `..` 逃逸。
- stage / unstage / diff 等文件级操作都只能作用于 root 内文件。

### 状态解析

推荐使用：

```bash
git status --porcelain=v2 -z --branch
```

原因：

- 机器可解析。
- 能拿到 branch/upstream/ahead/behind。
- 能区分 staged / unstaged / renamed / untracked / conflicted。

Diff：

```bash
git diff -- <path>
git diff --cached -- <path>
```

提交：

```bash
git commit -m <message>
```

要求：

- commit message 不能为空。
- conflicted 状态下禁止 commit。
- commit 成功后刷新状态。

Push / Pull：

```bash
git push
git pull --ff-only
```

要求：

- `pull` 使用 `--ff-only`，避免自动 merge。
- push / pull 失败时显示 stderr 摘要。
- 无 remote / 无 upstream 时给出明确提示。

## 前端设计

### 结构

改造当前大纲区域为文档侧栏 tab：

```text
[ 大纲 ] [ Git ]
```

- `大纲` 默认选中。
- `Git` 只有当前 workspace root 是 Git 仓库时显示。
- 没有打开 workspace 时不显示 `Git`。
- 不是 Git 仓库时不显示 `Git`。

建议新增状态：

```ts
type SidebarDocTab = "outline" | "git";

state.git = {
  isRepo: boolean;
  status: GitRepoStatus | null;
  loading: boolean;
  error: string;
  selectedPath: string;
};
```

也可以按项目现有 state 风格拆分，不强制以上形态。

### Git tab UI

Git tab 需要保持工具型密度，不要做成大页面。

建议布局：

```text
main · 7 changes        [刷新]
origin/main ↑1 ↓0       [Pull] [Push]

Changes
[Stage all] [Unstage all]
M  apps/foo.ts          [stage]
A  docs/bar.md          [unstage]
?? draft.md             [stage]

Commit
[ commit message input ]
[Commit]

Diff
...
```

UI 要求：

- 文件列表行高稳定。
- 文件名过长省略，但 title 中保留完整路径。
- diff 使用 monospace，限制高度，可滚动。
- 禁止危险操作按钮。
- conflicted 状态下明确标识冲突文件，并禁用 commit / pull / push。
- clean 状态显示“没有待提交修改”。
- no upstream / no remote 状态下 push / pull 按钮应禁用或给出明确错误。

### 触发时机

- 打开 workspace 后检查 Git 仓库状态。
- 刷新 workspace 后重新检查 Git 仓库状态。
- 切换到 `Git` tab 时加载/刷新 status。
- stage / unstage / commit / push / pull 成功或失败后刷新 status。
- 文档保存后可以 debounce 刷新 Git status。

## 集成要求

- 不影响现有大纲功能。
- 不影响目录树。
- 不影响资源面板开关。
- 不影响文档打开、保存、导出、资源检查。
- Git tab 只能操作当前 workspace root。
- 如果用户打开的是单个文档而不是 workspace，Git tab 不显示。

## 测试要求

至少补充：

### Rust 单元测试

- 非仓库 root 返回 `isRepo: false`。
- root 下有 `.git` 目录时返回 `isRepo: true`。
- root 下有 `.git` 文件时返回 `isRepo: true`。
- 路径逃逸被拒绝。
- `git status --porcelain=v2 -z --branch` 解析覆盖：
  - branch
  - upstream
  - ahead / behind
  - modified
  - added
  - deleted
  - renamed
  - untracked
  - conflicted

### E2E / 前端测试

使用 Tauri invoke mock 覆盖：

- 非 Git workspace 不显示 `Git` tab。
- Git workspace 显示 `Git` tab，但默认仍停在 `大纲`。
- 点击 `Git` tab 后显示分支、变更列表。
- stage / unstage 调用对应 command。
- commit message 为空时不能提交。
- commit 成功后刷新 status。
- conflicted 状态禁用 commit / pull / push。

### 门禁

必须运行：

```bash
npm run check
cargo test -p aimd-desktop
```

如新增 E2E，运行对应 Playwright spec。

## 验收标准

- 非 Git 目录不显示 `Git` tab。
- Git 目录显示 `Git` tab，默认仍显示 `大纲`。
- `Git` tab 能显示分支、upstream、ahead/behind、变更文件。
- 能 stage / unstage 单文件。
- 能 stage all / unstage all。
- 能提交非空 commit message。
- 能执行 `git push`。
- 能执行 `git pull --ff-only`。
- 冲突状态下禁止 commit / pull / push。
- 找不到 git / 无 upstream / push 失败 / pull 失败时有可读错误。
- 所有 Git 文件操作都不能越过 workspace root。
- 现有大纲、目录、资源面板设置不回归。
- `npm run check` 通过。
- `cargo test -p aimd-desktop` 通过。
- 新增或相关 E2E 通过。

## 交付说明

完成后请列出：

- 新增/修改的后端 Git commands。
- Git 状态解析策略。
- 前端大纲/Git tab 的入口与交互。
- 路径安全与危险操作限制。
- 已运行的测试命令和结果。
- 未覆盖的已知风险。
