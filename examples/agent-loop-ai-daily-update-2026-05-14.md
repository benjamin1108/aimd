# Agent Loop 诊断记录：更新 AI 日报 AIMD

## 任务

用户请求：`请更新目录下的ai日报`

工作目录：`/Users/benjamin/Dev/aimd/examples`

目标文件：`ai-daily-2026-04-30.aimd`

完成结果：将 AIMD 正文更新为 `AI 日报｜2026-05-14`，并最终用 `aimd new --title --embed-local-images` 重新生成包，使正文标题和 manifest 标题一致。最终 `aimd doctor` 通过。

## 实际 Agent Loop

### 1. 识别目录和可用文件

动作：

```bash
pwd
rg --files
```

结果：

- 当前目录是 `/Users/benjamin/Dev/aimd/examples`
- 目录下只有一个候选日报文件：`ai-daily-2026-04-30.aimd`

判断：

- 用户说“目录下的 ai 日报”，因此默认更新该文件，而不是新建另一个文件。

### 2. 读取 AIMD skill 说明

动作：

```bash
sed -n '1,220p' /Users/benjamin/.agents/skills/aimd/SKILL.md
```

关键约束：

- `.aimd` 文件必须通过 `aimd` CLI 写入。
- 编辑前必须 `aimd read`。
- 写入或资产操作后必须 `aimd doctor`。
- 不允许手动 unzip/mutate/re-zip AIMD 包。

判断：

- 后续所有 `.aimd` 读写都走 `aimd` CLI。

### 3. 读取原始 AIMD 状态

动作：

```bash
aimd info ai-daily-2026-04-30.aimd --json
aimd read ai-daily-2026-04-30.aimd
aimd assets list ai-daily-2026-04-30.aimd --json
```

观察：

- manifest 标题是 `AI 日报｜2026-04-30`
- 正文也是 2026-04-30 的日报
- 包内有 1 个图片资产
- 图片引用为 `asset://aimd-paste-1777480282044910000-image-001`

判断：

- 需要保留图片资产引用，更新正文内容。

### 4. 查找是否有仓库引用固定文件名

动作：

```bash
rg -n "ai-daily|AI 日报|2026-04-30" ..
git status --short
```

观察：

- README 和测试里引用了 `examples/ai-daily-2026-04-30.aimd`
- 工作区已有大量与本任务无关的未提交修改

判断：

- 不改文件名，避免破坏现有 fixture 引用。
- 不碰无关 dirty worktree。

### 5. 联网检索当天 AI 新闻

动作：

- 使用 web search/open 查询 2026-05-14 附近 AI 新闻。
- 重点查官方源和较可靠媒体源。

使用到的主要来源：

- OpenAI company announcements
- OpenAI TanStack npm supply-chain response
- OpenAI voice intelligence models in API
- Anthropic news
- Google AI / Android / developer blog
- Axios
- AP News
- Tom's Hardware 引述 Bloomberg 报道
- GitHub 项目页和趋势页

判断：

- 因为“日报”要求最新信息，必须联网。
- 内容结构沿用原日报：一句话总览、今日重点、开源项目、产品模型、科研技术、商业投融资、风险治理、关键词、结论。

### 6. 第一次写入方案：创建临时 Markdown 再 `aimd write`

动作：

1. 用 `apply_patch` 在当前目录新增 `ai-daily-2026-05-14.md`
2. 写入完整新日报正文
3. 用 `aimd write` 更新 AIMD

命令：

```bash
aimd write ai-daily-2026-04-30.aimd --input ai-daily-2026-05-14.md --canonicalize
```

验证：

```bash
aimd doctor ai-daily-2026-04-30.aimd
aimd read ai-daily-2026-04-30.aimd
aimd assets list ai-daily-2026-04-30.aimd --json
```

结果：

- `aimd doctor` 通过
- 正文已更新为 2026-05-14
- 图片资产仍然存在

问题：

- `aimd info` 里的 manifest 标题仍是旧的 `AI 日报｜2026-04-30`

原因：

- `aimd write` 的语义是替换 `main.md`，同时保留 package metadata。
- 这符合 CLI 设计，但不符合这次“更新日报”的实际期望，因为正文标题和 manifest 标题不一致。

低效点：

- 第一次写入前没有先确认 `aimd write` 是否支持更新 title。
- 产生了一次额外写入和一次额外验证。

### 7. 清理临时 Markdown 文件

动作：

```text
apply_patch Delete File: ai-daily-2026-05-14.md
```

判断：

- 不在 examples 目录保留临时 Markdown，避免污染示例目录。

### 8. 检查 AIMD CLI 是否有更新 manifest title 的命令

动作：

```bash
aimd --help
aimd write --help
aimd canonicalize --help
aimd new --help
aimd assets --help
aimd manifest ai-daily-2026-04-30.aimd
aimd assets extract --help
```

观察：

- `aimd write` 没有 `--title` 参数
- `aimd canonicalize` 不能改标题
- `aimd new` 支持 `--title`
- `aimd assets extract` 可以提取已有资产

判断：

- 若要让 manifest 标题也更新，官方 CLI 路径是重新生成 AIMD 包。

### 9. 第二次写入方案：提取资产，重新生成 AIMD

动作：

```bash
aimd assets extract ai-daily-2026-04-30.aimd aimd-paste-1777480282044910000-image-001 --output /private/tmp/ai-daily-image.jpg
aimd read ai-daily-2026-04-30.aimd > /private/tmp/ai-daily-2026-05-14.md
perl -0pi -e 's|asset://aimd-paste-1777480282044910000-image-001|/private/tmp/ai-daily-image.jpg|g' /private/tmp/ai-daily-2026-05-14.md
aimd new ai-daily-2026-04-30.aimd --input /private/tmp/ai-daily-2026-05-14.md --title 'AI 日报｜2026-05-14' --embed-local-images
```

解释：

- 先把旧包里的图片资产导出到 `/private/tmp`。
- 把正文里的 `asset://...` 临时替换成真实图片路径。
- 用 `aimd new --embed-local-images` 重新生成 AIMD，让 CLI 重新嵌入图片并写入新 manifest title。

结果：

- 新资产 id 变成 `asset://ai-daily-image-001`
- 图片 sha256 与原资产一致
- manifest 标题更新为 `AI 日报｜2026-05-14`

### 10. 最终验证

动作：

```bash
aimd doctor ai-daily-2026-04-30.aimd
aimd info ai-daily-2026-04-30.aimd --json
aimd read ai-daily-2026-04-30.aimd
aimd assets list ai-daily-2026-04-30.aimd --json
git status --short ai-daily-2026-04-30.aimd
git diff --stat -- ai-daily-2026-04-30.aimd
ls -la
```

结果：

- `aimd doctor`：`status: ok`
- `aimd info`：title 为 `AI 日报｜2026-05-14`
- assetCount 为 `1`
- 图片资产 sha256 保持不变
- 当前目录只剩 `ai-daily-2026-04-30.aimd`，没有遗留临时 Markdown
- Git 只显示该 AIMD 文件被修改

## 主要效率问题

### 1. skill 没有明确“更新正文标题时也要同步 manifest title”的推荐路径

当前 skill 说明里 `Edit body` 的快速路径是：

```bash
aimd read report.aimd > /tmp/report.md
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```

这个路径适合正文编辑，但不适合“日报日期更新”这类需要同步 manifest title 的任务。

建议：

- 在 skill 里增加一节 “Update document title / regenerate package metadata”。
- 明确说明：`aimd write` 会保留 metadata；如需改 title，应使用支持 title 的 CLI 子命令，或重新生成包。

### 2. 缺少直接修改 AIMD manifest title 的 CLI

为了同步标题，实际绕了一圈：

1. 提取资产
2. 读出正文
3. 替换 asset 引用为本地路径
4. `aimd new --title --embed-local-images`

建议：

- AIMD CLI 增加类似命令：

```bash
aimd set-title report.aimd "AI 日报｜2026-05-14"
```

或：

```bash
aimd write report.aimd --input body.md --title "AI 日报｜2026-05-14" --canonicalize
```

### 3. `aimd new` 重建包会改变 asset id

原引用：

```text
asset://aimd-paste-1777480282044910000-image-001
```

新引用：

```text
asset://ai-daily-image-001
```

图片内容 hash 不变，但 asset id 改变。

风险：

- 如果外部测试或快照依赖具体 asset id，重建包会造成不必要 diff。

建议：

- CLI 支持保留 asset id 的 title 更新。
- 或提供 `aimd rebuild --preserve-asset-ids --title ...`。

### 4. 生成正文时使用了当前目录临时文件

第一次写入时创建了：

```text
ai-daily-2026-05-14.md
```

虽然之后删除了，但更理想的方式是从一开始就写到 `/private/tmp`。

建议：

- skill 中的示例统一使用 `/tmp` 或 `/private/tmp` 存放中间 Markdown。
- 当前目录只保留最终产物，减少误提交风险。

### 5. 全文写入较长，缺少结构化生成辅助

日报正文较长，当前流程是一次性生成 Markdown 正文。

风险：

- 容易引入来源链接格式错误。
- 表格行较长，容易出现 Markdown 结构问题。
- 后续如果要稳定批量生成日报，难以复用。

建议：

- 为日报类文档建立模板，例如：

```text
templates/ai-daily.md
```

- 让 agent 先生成结构化 source notes，再渲染为 Markdown。
- 最后运行一个轻量 lint，检查：
  - 标题日期是否一致
  - manifest title 是否一致
  - 是否存在 `utm_source=chatgpt.com`
  - Markdown 表格列数是否一致
  - asset 引用是否都能被 `aimd doctor` 验证

## 更优 Loop 建议

如果未来继续做“更新目录下 AI 日报”任务，推荐流程：

1. `rg --files` 找 `.aimd`
2. `aimd info --json` + `aimd read` + `aimd assets list --json`
3. 判断是否需要更新 manifest title
4. 如果只改正文，用 `aimd write`
5. 如果要改标题：
   - 优先用未来的 `aimd write --title` 或 `aimd set-title`
   - 当前 CLI 下，用 `/private/tmp` 中间文件 + `aimd new --title --embed-local-images`
6. `aimd doctor`
7. `aimd info --json` 确认 title、assetCount、healthStatus
8. `aimd read` 抽样确认正文标题和 asset 引用
9. `git status --short <file>` 确认只改目标文件

## 最小可复用命令骨架

当前 CLI 能力下，同步正文和 manifest title 的骨架如下：

```bash
aimd assets list report.aimd --json
aimd assets extract report.aimd <asset-id> --output /private/tmp/report-image.jpg
aimd read report.aimd > /private/tmp/report.md
# 编辑 /private/tmp/report.md，并把 asset://<asset-id> 替换成本地图片路径
aimd new report.aimd --input /private/tmp/report.md --title "新标题" --embed-local-images
aimd doctor report.aimd
aimd info report.aimd --json
```

## 结论

这次 loop 的主要浪费来自两个点：

1. 先走了 `aimd write`，然后才发现 manifest title 不会更新。
2. 为同步 title，被迫通过“提取资产 + 重建包”的方式绕行。

skill 层面最值得优化的是：把 `aimd write` 的 metadata 保留语义写得更显眼，并为“更新标题/日期类文档”提供专门流程。CLI 层面最值得补的是：直接更新 manifest title，避免重建包和 asset id 变化。
