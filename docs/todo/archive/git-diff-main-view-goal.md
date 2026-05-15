# /goal: Git Diff 主视图与侧栏视口优化

## 背景

当前 Git tab 第一版已经能显示仓库状态和基础操作，但交互体验还不能上线：

- 新增文件显示 `??`，对普通用户不友好。
- diff 放在侧栏里，空间太小，容易溢出。
- diff 没有增删颜色，阅读效率低。
- 左侧目录区、大纲/Git 区不能折叠，也不能调整高度。
- diff 应该像代码查看器一样在主文档区打开，而不是挤在侧栏。

本轮目标是把 Git 功能调整为：侧栏负责状态与操作，主文档区负责 diff 阅读。

## 产品目标

### 1. 优化 Git 文件状态标识

不要直接显示 Git 原始状态码 `??`。

文件状态显示改为：

- modified: `M`
- added: `A`
- deleted: `D`
- renamed: `R`
- untracked: `NEW`
- conflicted: `CONFLICT`

要求：

- `NEW` 替代 `??`。
- `CONFLICT` 使用危险色。
- tooltip/title 中保留中文说明。
- 状态标识宽度稳定，不撑开文件行。

## 2. Diff 从侧栏移到主文档区

Git tab 内不再显示 diff 正文。

点击 Git 文件后：

- 选中文件。
- 调用 `get_git_file_diff(root, path)`。
- 主文档区切换到 Git diff 查看视图。
- Git tab 保持可用。

建议状态：

```ts
type MainView = "document" | "git-diff";

state.mainView = "document";

state.git.diffView = {
  path: string;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string;
};
```

## 3. Git Diff 主视图

主区域打开 diff 时布局为：

```text
[返回文档]  apps/foo.ts

staged
diff...

unstaged
diff...
```

要求：

- 主区域替代当前文档阅读区，不使用 modal。
- 有明确“返回文档”按钮。
- 如果当前没有打开文档，也可以打开 diff。
- 如果没有可返回文档，返回按钮禁用或隐藏。
- 点击目录树文档时自动回到文档视图。
- diff 加载失败时在主区域显示错误。

## 4. Diff 渲染质量

实现 unified diff viewer。

最低要求：

- `+` 行绿色背景。
- `-` 行红色背景。
- `@@` hunk 行弱强调背景。
- `diff --git`、`index`、`---`、`+++` 使用 muted 样式。
- 使用 monospace。
- 保留缩进和空格。
- 横向超出时 diff 容器内部滚动。
- 纵向超出时主内容区滚动。
- diff 不能撑破主布局或侧栏。
- 二进制文件显示“二进制文件无文本 diff”。

## 5. 后端 Diff 截断

检查并增强 `GitFileDiff` DTO：

```ts
type GitFileDiff = {
  path: string;
  stagedDiff: string;
  unstagedDiff: string;
  isBinary: boolean;
  truncated?: boolean;
};
```

要求：

- diff 输出有大小上限。
- 超出上限时设置 `truncated: true`。
- 前端显示“diff 过大，已截断”。
- 继续保持路径安全：不能越过 workspace root。
- 不允许前端传任意 Git 参数。

## 6. 左侧栏折叠与高度调整

### 目录区折叠

目录区增加折叠按钮：

- 默认展开。
- 折叠后保留标题行和打开目录入口。
- 状态持久化到 localStorage。

### 大纲/Git 区折叠

大纲/Git 区增加折叠按钮：

- 默认展开。
- 折叠后保留 tab/header。
- Git tab 显示规则不变：只有 workspace root 本身是 Git 仓库才显示。

### 高度调整

目录区与大纲/Git 区之间增加垂直拖拽分隔条：

- 可调整两个区域高度比例。
- 有合理最小高度。
- 窗口 resize 后不溢出。
- 不影响资源面板开关和资源区 resizer。

## 7. Git tab 职责收敛

Git tab 只保留：

- branch / upstream / ahead / behind。
- refresh。
- pull / push。
- stage all / unstage all。
- 文件列表。
- 单文件 stage / unstage。
- commit message / commit。
- 错误和冲突提示。

移除 Git tab 内的 Diff 区块。

## 8. 操作后刷新规则

stage / unstage / commit / pull / push 后：

- 刷新 Git status。
- 如果当前主区域是 git-diff，且文件仍存在，刷新该文件 diff。
- 如果文件不再存在或没有 diff，清空 diff 视图并回到文档视图或显示空状态。
- 冲突状态继续禁用 commit / pull / push。

## 9. 测试要求

补充或更新 E2E：

- untracked 文件显示 `NEW`，不显示 `??`。
- Git tab 内不再出现 diff 正文。
- 点击 Git 文件后，主文档区显示 diff 视图。
- diff 新增/删除/hunk 行有对应 class。
- diff 横向超出时不撑破主布局。
- 返回文档按钮能回到文档视图。
- 没有打开文档时也能打开 diff 视图。
- 点击目录树文档后回到文档视图。
- 目录区可折叠/展开。
- 大纲/Git 区可折叠/展开。
- 拖拽目录区与大纲/Git 区分隔条后高度变化。
- 非 Git workspace 仍不显示 Git tab。
- 资源面板默认隐藏/显示设置不回归。

## 10. 验收标准

- 新增文件不再显示 `??`。
- diff 不再显示在侧栏。
- 点击 Git 文件后主文档区打开 diff 查看器。
- diff 有清晰的增删颜色和 hunk 样式。
- diff 横向/纵向滚动不破坏布局。
- 左侧目录区可折叠。
- 左侧大纲/Git 区可折叠。
- 目录区和大纲/Git 区之间可调整高度。
- 现有目录树、大纲、Git 操作、资源面板设置不回归。
- `npm run check` 通过。
- `cargo test -p aimd-desktop` 通过。
- 相关 Playwright E2E 通过。

## 非目标

本轮不做：

- split diff。
- inline comment。
- branch checkout。
- merge / rebase / stash / reset。
- conflict resolve 编辑器。
- history graph。
- interactive patch staging。
