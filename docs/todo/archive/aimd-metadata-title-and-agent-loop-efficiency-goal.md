# /goal: AIMD Metadata 标题同步与 Agent Loop 效率提升

## 背景

`examples/agent-loop-ai-daily-update-2026-05-14.md` 记录了一次真实 Agent Loop：用户要求“更新目录下的 ai 日报”，Agent 成功把 `examples/ai-daily-2026-04-30.aimd` 更新为 `AI 日报｜2026-05-14`，但过程中出现明显绕路。

关键问题：

- `aimd write FILE --input body.md --canonicalize` 只替换正文并保留 manifest metadata。
- 日报正文标题更新后，manifest `title` 仍保持旧值 `AI 日报｜2026-04-30`。
- 为同步 manifest title，Agent 被迫走“提取资产 -> 将 `asset://id` 替换成本地图片路径 -> `aimd new --title --embed-local-images` 重建包”的绕行路径。
- 重建包会改变 asset id，例如从 `asset://aimd-paste-...` 变成 `asset://ai-daily-image-001`，增加不必要 diff 和快照风险。
- skill 没有把“正文编辑”和“metadata/title 更新”区分清楚，导致 Agent 先走了一次错误但合法的 `aimd write`。

这个问题不是日报专属，而是所有“更新文档标题、日期、作者、生成来源、报告版本”等任务都会遇到。

## 产品目标

完成 AIMD metadata/title 更新能力和 Agent 工作流效率优化：

1. CLI 支持不重建包、不改变 asset id 的 manifest title 更新。
2. CLI 支持在替换正文时同时更新 title，避免 Agent 分两次写。
3. `aimd doctor/info` 能帮助 Agent 快速发现正文 H1 与 manifest title 不一致。
4. AIMD skill 明确区分：
   - 只改正文：使用 `aimd write`
   - 改正文且改标题：使用 `aimd write --title` 或等价命令
   - 只改标题：使用 `aimd set-title`
5. 日报类、报告类、日期滚动类文档的 Agent Loop 不再需要提取资产和重建包。
6. 建立回归测试，证明 title 更新保留正文、保留资源、保留 asset id、保留未知 manifest 字段。

## 非目标

- 不改变 `.aimd` 文件格式。
- 不引入手工 unzip/mutate/zip 工作流。
- 不为本轮实现复杂 metadata 编辑 UI。
- 不在 `aimd new` 中解决所有 asset id 稳定策略；本目标优先避免不必要重建。
- 不实现 AI 日报生成器或联网新闻采集器。

## CLI 设计

### 1. 新增 `aimd set-title`

目标命令：

```bash
aimd set-title FILE TITLE [--canonicalize]
```

行为：

- 原子写入。
- 只更新 manifest `title` 和 `updatedAt`。
- 保留 `main.md` 原文。
- 保留所有资源和 asset id。
- 保留 manifest 未知字段。
- 默认不修改正文 H1。
- `--canonicalize` 时写后稳定 ZIP/manifest 顺序。
- 写入前必须校验 ZIP、manifest、entry、asset path、sha256、size；严重错误时拒绝写入。

### 2. 扩展 `aimd write`

目标命令：

```bash
aimd write FILE --input body.md|--stdin [--title TITLE] [--gc] [--canonicalize]
```

行为：

- 替换正文。
- 如果提供 `--title`，同步更新 manifest title。
- 不提供 `--title` 时保持当前 metadata 保留语义。
- 与当前 `--gc`、`--canonicalize` 兼容。
- 更新 title 不应改变 asset id。

### 3. 可选：`aimd title`

如果命令命名更适合短命令，可考虑：

```bash
aimd title FILE
aimd title FILE --set TITLE
```

但首选 `set-title`，因为意图明确，不和 shell/文档概念冲突。

## Doctor / Info 改进

### 1. H1 与 Manifest Title 一致性提示

`aimd doctor FILE` 增加 warning：

- 如果 `main.md` 第一个 H1 存在，且与 manifest `title` 不一致，输出 warning。
- warning 不应导致非零退出。
- `--json` 中提供结构化 warning code，例如：

```json
{
  "severity": "warning",
  "code": "title_mismatch",
  "message": "manifest title does not match first H1",
  "manifestTitle": "AI 日报｜2026-04-30",
  "bodyTitle": "AI 日报｜2026-05-14"
}
```

### 2. Info 输出正文 H1

`aimd info FILE --json` 增加：

```json
{
  "title": "AI 日报｜2026-05-14",
  "bodyTitle": "AI 日报｜2026-05-14"
}
```

让 Agent 在读取全文前快速判断是否存在 title drift。

## Skill 更新要求

更新 `skill/SKILL.md` 和 `skill/references/cli.md`：

### 1. 明确 `aimd write` 语义

必须写清楚：

- `aimd write` 默认保留 manifest metadata。
- 如果任务涉及文档标题、日期、报告名、manifest title，同步使用 `--title` 或 `set-title`。

### 2. 增加高频流程：更新日报/报告标题

建议 workflow：

```bash
aimd info report.aimd --json
aimd read report.aimd > /private/tmp/report.md
# edit /private/tmp/report.md
aimd write report.aimd --input /private/tmp/report.md --title "AI 日报｜2026-05-14" --canonicalize
aimd doctor report.aimd
aimd info report.aimd --json
```

只改标题：

```bash
aimd set-title report.aimd "AI 日报｜2026-05-14" --canonicalize
aimd doctor report.aimd
```

### 3. 明确避免的低效路径

除非确实要重新导入本地图片，否则不要为了改 title 执行：

```bash
aimd assets extract ...
aimd new ... --embed-local-images
```

因为这会改变 asset id，增加 diff。

## 额外效率改进发散

这些不一定全部进入同一 PR，但应在实现时评估优先级。

### 1. `aimd edit` 复合命令

减少 Agent 自己拼临时文件流程：

```bash
aimd edit report.aimd --input body.md --title "..." --gc --canonicalize --doctor
```

或让 `aimd write` 支持 `--doctor`：

```bash
aimd write report.aimd --input body.md --title "..." --canonicalize --doctor
```

成功时输出一份 JSON summary，失败时不替换原文件。

### 2. `aimd export-markdown`

提供更明确的读取入口：

```bash
aimd export-markdown report.aimd --output /private/tmp/report.md --assets /private/tmp/report-assets
```

用途：

- 让 Agent 修改图文文档时拿到本地 asset 文件。
- 避免手写 `assets extract` 循环。
- 需要重建时能保留资源映射。

### 3. `aimd rebuild --preserve-asset-ids`

如果未来仍需要重建包，应支持：

```bash
aimd rebuild report.aimd --input body.md --title "..." --preserve-asset-ids
```

目标：

- 同 sha256 资产复用原 asset id。
- 新资产才生成新 id。
- 删除未引用资产可选。

### 4. `aimd lint-markdown`

给 Agent 生成长 Markdown 报告前后使用：

```bash
aimd lint-markdown report.md --profile ai-daily
```

可检查：

- 标题日期和目标日期一致。
- Markdown 表格列数一致。
- 链接 URL 不包含 `utm_source=chatgpt.com`。
- 没有空链接、坏的 Markdown 图片语法。
- `asset://id` 只在 `.aimd` 上下文中出现。

### 5. `aimd doctor --strict-agent`

为 Agent pipeline 提供更强校验：

```bash
aimd doctor report.aimd --json --strict-agent
```

额外检查：

- manifest title 与 H1 不一致。
- 存在 orphan asset。
- 存在远程图片但文档预期是离线归档。
- manifest 里缺 `generatedBy` 或作者字段时给 warning。

### 6. `aimd info --summary`

让 Agent 快速决策，不必先读完整正文：

```bash
aimd info report.aimd --json --summary
```

建议包含：

- manifest title
- body H1
- asset count
- referenced asset count
- orphan asset count
- first 3 headings
- health status
- title mismatch flag

### 7. 日报模板不是 AIMD core 功能

AI 日报模板、新闻采集、source notes 可以独立为 examples 或 skill reference，不应塞进 core CLI。

建议后续若要稳定生产日报：

```text
examples/templates/ai-daily.md
examples/templates/ai-daily-source-notes.md
```

Agent Loop：

1. 生成 source notes。
2. 渲染 Markdown。
3. `aimd lint-markdown --profile ai-daily`。
4. `aimd write --title --canonicalize --doctor`。

## 实现计划

### 阶段 1：Core 写入能力

- 在 `aimd-core` 增加 manifest title 更新 helper。
- 复用现有 `rewrite_file` 或扩展 `RewriteOptions`：
  - `title: Option<String>`
  - 原子写入
  - 保留资源
  - 保留未知 manifest 字段
  - 刷新 `updatedAt`
- 补测试：只改 title、改正文+title、保留 asset id、保留 unknown fields。

### 阶段 2：CLI 命令

- `aimd set-title FILE TITLE [--canonicalize]`
- `aimd write ... --title TITLE`
- `aimd info --json` 增加 `bodyTitle`
- `aimd doctor --json` 增加 title mismatch warning
- 更新 help 文案。

### 阶段 3：Skill 与文档

- 更新 `skill/SKILL.md`
- 更新 `skill/references/cli.md`
- 更新 examples 中 read/edit flow。
- `quick_validate.py skill` 必须通过。
- 确认 PKG payload 里的 skill 仍带合法 YAML frontmatter 和 `agents/openai.yaml`。

### 阶段 4：端到端回归

用 `examples/ai-daily-2026-04-30.aimd` 或测试 fixture 验证：

1. 原文件有 1 个 asset。
2. `aimd read` 输出正文。
3. `aimd write --title "AI 日报｜2026-05-14"` 后：
   - `aimd doctor` 通过。
   - `aimd info --json` title 和 bodyTitle 一致。
   - asset id 不变。
   - asset sha256 不变。
   - Git diff 不出现无意义 asset 重命名。

## 测试要求

### Rust 测试

- `cargo test -p aimd-core`
- `cargo test -p aimd-cli`

新增覆盖：

- `set-title` 只改 manifest title 和 updatedAt。
- `write --title` 同时改正文和 manifest title。
- title 更新保留 asset id/path/sha256/size/mime/role。
- title 更新保留 unknown manifest fields。
- title 更新在 asset sha mismatch 时失败且不替换原文件。
- `doctor --json` 能发现 H1/title mismatch。
- `doctor` 对 title mismatch 只 warning，不非零退出。
- `info --json` 输出 bodyTitle。

### Skill / 文档测试

- `python3 .../skill-creator/scripts/quick_validate.py skill`
- `rg` 确认 skill 不再推荐通过 `aimd new` 绕行修改 title。
- `skill/SKILL.md` 中出现的命令都真实存在于 `aimd --help` 或子命令 help。

### PKG 测试

- `bash -n scripts/pkg/preinstall`
- `bash -n scripts/pkg/postinstall`
- `bash -n scripts/build-macos-pkg.sh`
- `./scripts/build-macos-pkg.sh`
- `pkgutil --payload-files dist/AIMD-1.0.0.pkg` 包含更新后的 skill。

## 验收标准

完成后必须满足：

1. Agent 更新日报标题不再需要提取资产或重建包。
2. `aimd write --title` 是“改正文 + 改 manifest title”的标准路径。
3. `aimd set-title` 是“只改 manifest title”的标准路径。
4. asset id 在 title 更新流程中保持不变。
5. `aimd doctor --json` 能暴露 title mismatch。
6. AIMD skill 明确提示 `aimd write` 的 metadata 保留语义。
7. 用 `examples/agent-loop-ai-daily-update-2026-05-14.md` 中记录的问题复盘，确认主要低效点已经被消除。
