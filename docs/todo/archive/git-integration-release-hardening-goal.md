# /goal: Git 集成设置页发布级硬化

## 背景

AIMD 已经实现 `.aimd` Git diff / merge driver、`aimd` CLI、macOS PKG 安装脚本和设置页 Git 集成入口，但当前设置页仍未达到可发布标准。

用户实际看到的状态示例：

```text
Git
OK
aimd CLI in PATH
未就绪 · 需要系统级 PKG 或开发环境 PATH
/usr/local/bin/aimd
OK
当前仓库
OK · 未设置
.gitattributes
未就绪 · 未写入
仓库 driver
未就绪 · aimd git-diff
全局 driver
未就绪 · aimd git-merge %O %A %B %P
诊断
aimd CLI 不在 PATH 中；尚未配置 AIMD Git driver
```

这暴露出几个发布阻断问题：

- `/usr/local/bin/aimd` 已存在且可执行，但 `aimd` 不在 App 进程 PATH 中，设置页仍直接要求 PATH 可用，导致用户不知道下一步该做什么。
- 点击“启用全局 Git 集成 / 禁用全局 Git 集成”没有可感知结果，失败时也没有足够日志和诊断。
- “当前仓库 OK · 未设置”语义错误；未设置仓库路径不应显示为 OK。
- 全局 driver 未配置时，状态只显示期望命令，没有显示当前实际 Git config 值、写入失败原因、权限问题或 PATH 问题。
- 后台缺少结构化日志，用户反馈“没反应”时无法从日志判断是前端没触发、Tauri invoke 没到、git config 失败、PATH 解析失败还是状态刷新错误。
- 真实桌面环境里，设置页使用 `window.confirm()` 确认启用 Git 集成；Tauri 2 WebView 会吞掉该确认框并返回 `false`，导致用户点击“启用全局 Git 集成”后直接显示“已取消 / 未修改 Git 配置”，后端写配置命令根本不会执行。

本 goal 的目标不是重新设计 Git driver，而是把设置页 Git 集成从“功能存在”推进到“用户可理解、可诊断、可发布”。

## 产品目标

完成 Git 集成设置页发布级硬化：

1. 点击全局启用、全局禁用、仓库启用、仓库禁用、写入 `.gitattributes`、检查/修复时，必须有明确的进行中、成功、失败状态。
2. 用户不需要打开开发者工具，也能知道操作是否执行、执行了什么、失败在哪里、下一步该怎么修。
3. 后端必须记录结构化日志，能追踪每一次 Git 集成操作的 request id、动作、scope、命令、退出码、stderr/stdout 摘要和最终状态。
4. `/usr/local/bin/aimd` 存在时，Git driver 配置应优先写稳定绝对入口或可解释的稳定命令，不能因为 App PATH 没有 `/usr/local/bin` 就让用户卡住。
5. 状态展示必须区分“未检查 / 未设置 / 不适用 / OK / 失败”，不能用 OK 包装缺失配置。
6. 设置页必须支持一键检测与可操作修复建议，而不是只刷新当前状态。
7. 覆盖真实失败路径和成功路径的 Rust 单元测试、前端 E2E、以及命令执行日志断言。

## 非目标

- 不改变 `.aimd` 文件格式。
- 不重做 Git diff / merge driver 的 core 合并算法。
- 不要求 GitHub/GitLab Web UI 支持本地 textconv。
- 不静默修改用户 Git 配置；启用/禁用仍必须由用户显式点击确认。
- 不把所有诊断都打到普通用户主界面；普通状态要简短，详细日志进入后台日志和调试诊断。

## 当前问题清单

### 1. PATH 与稳定 CLI 入口语义不清

当前状态可以同时出现：

```text
aimd CLI in PATH: 未就绪
/usr/local/bin/aimd: OK
```

发布态要求：

- 如果 `/usr/local/bin/aimd` 存在且可执行，应显示“系统 CLI 已安装”。
- “CLI in PATH”只能作为附加诊断，不能阻塞使用稳定路径。
- Git config 写入策略必须明确：
  - 若 `aimd` 在 PATH 中可用，允许写 `aimd git-diff` / `aimd git-merge %O %A %B %P`。
  - 若 `aimd` 不在 PATH 但 `/usr/local/bin/aimd` 可执行，应写 `/usr/local/bin/aimd git-diff` / `/usr/local/bin/aimd git-merge %O %A %B %P`，或明确提示用户把 `/usr/local/bin` 加入 Git 可见 PATH。
  - 状态页必须显示当前采用的 driver 命令和原因。
- `git-doctor` 必须验证最终写入的命令能被 `git config` 和 Git driver 调用环境找到。

### 2. 全局启用/禁用点击无反馈

当前用户反馈“点击全局启用禁用都没反应”。

发布态要求：

- 前端点击后立即进入 `处理中...` 状态，并禁用相关按钮防止重复点击。
- 成功后必须显示：
  - “全局 Git driver 已启用”
  - 写入的四个 key：
    - `diff.aimd.textconv`
    - `diff.aimd.cachetextconv`
    - `merge.aimd.name`
    - `merge.aimd.driver`
  - 写入后的实际值。
- 禁用成功后必须显示：
  - “全局 Git driver 已禁用”
  - 哪些 key 已删除，哪些 key 原本不存在。
- 失败后必须显示短文案：
  - “全局 Git driver 启用失败”
  - 失败原因摘要。
  - 下一步动作，例如“检查 Git 是否可用”或“查看诊断日志”。
- 前端不能把失败吞掉；`invoke` reject、超时、权限错误、`git config` 非 0 都必须可见。

### 3. 后台结构化日志缺失

必须新增 Git 集成专用日志事件，至少包括：

```rust
GitIntegrationLog {
    request_id: String,
    action: String,
    scope: "global" | "repo" | "status" | "doctor" | "gitattributes",
    repo_path: Option<String>,
    command: Option<Vec<String>>,
    started_at: DateTime,
    elapsed_ms: u64,
    exit_code: Option<i32>,
    stdout_tail: String,
    stderr_tail: String,
    result: "ok" | "failed",
    message: String,
}
```

要求：

- 每次 Tauri command 入口都生成 request id。
- 每次调用 `git` 都记录命令、scope、耗时、退出码、stderr/stdout 摘要。
- 日志不能包含敏感信息；当前 Git config 命令不含 token，但仍要统一走脱敏/截断。
- 前端操作失败时显示 request id，方便用户提供问题上下文。
- 日志写到现有后台日志/调试控制台机制；调试模式关闭时不主动打扰，但用户主动点“检查/修复”时可显示诊断摘要。

### 4. 状态模型需要重做

当前状态字段过于布尔化，导致“当前仓库 OK · 未设置”这类误导文案。

发布态建议模型：

```ts
type ReadinessState =
  | "ok"
  | "missing"
  | "notConfigured"
  | "notApplicable"
  | "error"
  | "checking";
```

设置页显示必须满足：

- Git：
  - OK / Git 不可用 / 检查失败。
- 系统 CLI：
  - `/usr/local/bin/aimd` 已安装且可执行。
  - `/usr/local/bin/aimd` 不存在。
  - `/usr/local/bin/aimd` 存在但不可执行。
- PATH CLI：
  - PATH 可找到 `aimd`。
  - PATH 找不到，但系统 CLI 可用时只作为提示，不作为阻断。
- 当前仓库：
  - 未填写：显示“未设置”，不是 OK。
  - 已填写但不是 Git repo：显示失败。
  - 已填写且是 Git repo：OK，并显示 repo root。
- `.gitattributes`：
  - 未设置仓库路径：不适用。
  - 仓库中缺失：未写入。
  - 已配置：OK。
- driver 状态：
  - 显示全局和仓库分别的实际 config 值。
  - 若当前值和预期不一致，显示“未配置 / 配置不匹配”，而不是只显示预期命令。

### 5. 检查/修复必须真正可操作

“检查/修复”按钮不能只是刷新。

发布态行为：

- 点击后运行 doctor。
- Doctor 输出：
  - 总体状态：可用 / 不完整 / 失败。
  - 按项诊断：Git、CLI、全局 driver、仓库 driver、`.gitattributes`。
  - 建议动作：
    - 安装系统 PKG。
    - 启用全局 driver。
    - 填写仓库路径。
    - 写入 `.gitattributes`。
    - 修复 PATH 或改用 `/usr/local/bin/aimd`。
- 对能自动修复且不会越权的项目提供按钮：
  - 写入 `.gitattributes`。
  - 启用/禁用全局 driver。
  - 启用/禁用仓库 driver。
- 对需要管理员权限或外部安装的项目，只给明确说明，不假装能修。

### 6. Git config 写入必须健壮

Rust 后端要求：

- 所有 `git` 调用使用参数数组，不拼 shell 字符串。
- 所有调用有超时。
- 捕获 stdout/stderr。
- `git config --unset-all` 如果 key 不存在，不应作为禁用失败。
- 启用后必须重新读取 config 验证实际值。
- 禁用后必须重新读取 config 验证 key 已删除。
- 如果写入成功但验证失败，返回失败并记录日志。
- 全局配置失败时返回原始 stderr 摘要，例如权限、home 不可写、git 不存在。
- 仓库配置必须先解析 repo root；非 Git repo 必须返回明确错误。

### 7. 前端交互必须发布级

设置页要求：

- 所有按钮都有 loading/disabled 状态。
- 操作结果必须保留在页面上，不被下一次自动刷新立刻覆盖。
- 成功、失败、诊断文案使用短句，不堆 Rust stderr。
- 详细 stderr/stdout 放进“诊断详情”折叠区或后台日志。
- 用户取消确认时，状态显示“已取消”，而不是无反应。
- 全局启用/仓库启用确认文案必须明确说明会修改 Git config，并显示 scope。
- 确认框必须走 Rust 端原生对话框；不能在 Tauri 实跑路径依赖 `window.confirm()`。
- 禁用操作也应显示确认或至少成功/失败反馈。

### 8. 可发布测试要求

#### Rust 后端

必须新增或补齐测试：

- Git 不存在时 status/doctor 返回清晰失败。
- `/usr/local/bin/aimd` 存在但不在 PATH 时，doctor 给出可用策略。
- 全局启用写入正确 key，并验证实际值。
- 全局禁用删除 key；key 不存在时仍视为成功。
- 全局写入失败时返回 stderr 摘要和 request id。
- 仓库启用写入 `.git/config`。
- 非 Git repo 仓库启用返回清晰错误。
- `.gitattributes` 写入幂等。
- `git config` 超时会终止进程并返回超时错误。
- 每个操作都会生成结构化日志。

#### Frontend / E2E

必须新增或补齐测试：

- 点击全局启用后，前端调用 `git_integration_enable_global`，显示处理中，再显示成功。
- 点击全局禁用后，前端调用 `git_integration_disable_global`，显示成功。
- 后端 reject 时，页面显示失败和 request id。
- 用户取消 confirm 时，页面显示“已取消”，且不会调用后端写操作。
- `/usr/local/bin/aimd` OK 但 PATH 缺失时，页面不能把功能整体标为不可用；必须显示系统 CLI 可用。
- 未填写仓库路径时，“当前仓库”显示未设置，`.gitattributes` 和仓库 driver 显示不适用。
- 点击检查/修复后调用 doctor，显示诊断消息和建议动作。
- E2E 不能只 mock happy path；至少覆盖一次失败路径。

#### 手工验收

在 macOS 本机至少验证：

```bash
/usr/local/bin/aimd git-doctor
git config --global --get diff.aimd.textconv
git config --global --get merge.aimd.driver
```

设置页手工操作：

1. 打开设置页 Git 集成。
2. 点击检查/修复，确认有诊断输出。
3. 点击启用全局 Git 集成，确认状态变为已启用。
4. 关闭设置页重开，确认状态仍为已启用。
5. 点击禁用全局 Git 集成，确认状态变为未配置。
6. 填写当前仓库路径，点击写入 `.gitattributes`，确认文件只追加一次。
7. 点击启用当前仓库 Git 集成，确认 `.git/config` 写入。

## 验收标准

- 用户点击全局启用/禁用时不再出现“无反应”。
- 任何失败都有用户可见的短反馈和后台结构化日志。
- `/usr/local/bin/aimd` 已安装时，Git 集成不被 App PATH 缺失错误阻断。
- 状态页不再出现“当前仓库 OK · 未设置”这类误导状态。
- Doctor 能解释当前状态，并给出下一步动作。
- 全局 driver 和仓库 driver 的实际 Git config 值可见、可验证。
- `git config --unset-all` key 不存在时禁用操作仍成功。
- E2E 覆盖全局启用、全局禁用、取消确认、后端失败、PATH 缺失但系统 CLI 可用、doctor 诊断。
- `npm --prefix apps/desktop run check` 通过。
- `cargo test -p aimd-desktop git_integration` 通过。
- `npx playwright test e2e/48-git-native-integration.spec.ts` 通过。
- `git diff --check` 通过。

## 建议优先级

1. 先修后端状态模型与全局 enable/disable 的返回、验证、日志。
2. 再修前端状态渲染和按钮交互，确保点击有反馈。
3. 再补 doctor 的可操作建议。
4. 最后补 E2E 和手工验收记录。
