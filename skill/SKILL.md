---
name: aimd
description: |
  读写 AIMD (.aimd) 文档的工具集。AIMD 是 AI 生成时代的单文件文档容器（ZIP 内含 manifest.json + main.md + assets/），用于把 Markdown、图片、元数据打包成一个可迁移文件。
  当用户提到 .aimd 文件、AIMD 文档、AI 报告打包、Markdown 文档容器，或者要求“读这个 .aimd”“修改 .aimd 内容”“给 .aimd 加图片”“把这篇 Markdown 打包成 aimd”“查看 aimd 的元数据/资源”等任何涉及 AIMD 文档读写的任务时，应使用此 skill。
  即使用户只是说“帮我看下 report.aimd 写了什么”或“在这个 .aimd 里追加一段”，也应触发此 skill。
---

# AIMD 文档读写

`.aimd` 文件是一个 ZIP 容器，结构是：

```
file.aimd
├── manifest.json   # 元数据、资源清单、SHA-256
├── main.md         # Markdown 正文（图片用 asset://id 引用）
└── assets/         # 打包的图片和资源
```

本 skill 通过 `scripts/aimd_io.py` 进行所有读写。脚本是纯 Python（zipfile + json + hashlib），无外部依赖。**不要**手工 unzip / 重新 zip `.aimd` 文件，那样会丢元数据或破坏 SHA-256。

## 调用入口

```bash
SCRIPT="<本skill目录>/scripts/aimd_io.py"
python3 $SCRIPT <subcommand> [args...]
```

## 任务 → 命令速查表

| 任务 | 命令 |
|---|---|
| 读 `.aimd` 的正文（最常用） | `python3 $SCRIPT read FILE` |
| 看元信息（标题、作者、资源数） | `python3 $SCRIPT info FILE` |
| 看完整 manifest JSON | `python3 $SCRIPT manifest FILE` |
| 列出所有资源（图片/附件） | `python3 $SCRIPT list FILE` |
| 取出某个资源的字节 | `python3 $SCRIPT extract FILE ASSET_ID -o out.png` |
| 替换正文（保留元数据和资源） | `python3 $SCRIPT write FILE -i body.md` |
| 替换正文 + 清理失引资源 | `python3 $SCRIPT write FILE -i body.md --gc` |
| 把本地图片加进去 | `python3 $SCRIPT add-asset FILE path/to/img.png` |
| 删除某个资源 | `python3 $SCRIPT remove-asset FILE ASSET_ID` |
| 改标题/作者/AI 出处 | `python3 $SCRIPT set-meta FILE --title T --author NAME:ai` |
| 清理未被正文引用的资源 | `python3 $SCRIPT gc FILE` |
| 从 `.md` + 本地图片新建 `.aimd` | `python3 $SCRIPT new OUT.aimd -i input.md` |

每个子命令都支持 `--help` 查看完整参数。

## 三种常见工作流

### 1. 读 / 总结 `.aimd`
最简单：
```bash
python3 $SCRIPT read report.aimd            # 拿到正文 Markdown
python3 $SCRIPT info report.aimd            # 看元数据/资源数
```
正文中的图片以 `![alt](asset://image-001)` 形式出现。如果回答需要看图，再用 `extract` 把对应 asset 取出。

### 2. 修改 `.aimd` 正文
**始终遵循三步流：read → 编辑 → write。** 不要替换整个 `.aimd`，否则会丢资源和 manifest。

```bash
python3 $SCRIPT read report.aimd > /tmp/body.md
# 用 Edit/Write 修改 /tmp/body.md
python3 $SCRIPT write report.aimd -i /tmp/body.md
```

也支持 stdin：`some_pipeline | python3 $SCRIPT write report.aimd`。

如果你确定删了某段后，对应图片就再也用不上了，加 `--gc` 一并清理：
```bash
python3 $SCRIPT write report.aimd -i body.md --gc
```

### 3. 从零打包一个 `.aimd`
当用户给一个 `.md` 文件（图片是相对路径的本地文件）想生成 `.aimd`：

```bash
python3 $SCRIPT new report.aimd -i source.md
# 自动：复制本地图片到 assets/，把 ![alt](img.png) 改写为 ![alt](asset://img-001)
```

`source.md` 中的 `http(s)://` 图片会保留为远程引用；`asset://` 引用会原样保留。找不到的本地图片会发警告但不阻断。

## 加图片到现有 `.aimd`

```bash
# 把本地图片加为内容图，自动分配 id
python3 $SCRIPT add-asset report.aimd ./chart.png
# 输出: added asset chart-001 -> assets/chart.png ...
# 输出: reference it as: ![alt](asset://chart-001)

# 然后修改正文，插入这个引用
python3 $SCRIPT read report.aimd > /tmp/body.md
# 编辑 /tmp/body.md，加入 ![Chart](asset://chart-001)
python3 $SCRIPT write report.aimd -i /tmp/body.md
```

显式 id / 不同 role：
```bash
python3 $SCRIPT add-asset report.aimd cover.jpg --id cover --role cover --name cover.jpg
```

## 标记 AI 出处（推荐）

AIMD 的核心场景之一是给 AI 生成内容标 provenance。修改后建议补上：
```bash
python3 $SCRIPT set-meta report.aimd \
  --author "Claude:ai" \
  --gen-by type=ai --gen-by model=claude-opus-4-7 --gen-by provider=anthropic
```

## 重要约束

- **不要用 `unzip` + `zip` 手工编辑 `.aimd`。** 会丢 `updatedAt`、SHA-256、资源排序。
- **`asset://id` 是稳定引用形式。** 改正文时不要把它们改写成相对路径——`.aimd` 内部就靠这些 URI 关联资源。
- **ID 命名约束：** `[A-Za-z0-9._-]+`。`add-asset` 自动 sanitize；手动指定 `--id` 时遵守此正则。
- **跨平台路径：** 资源 path 始终是 `assets/<filename>`（POSIX 风格），不要用反斜杠。
- **写操作是原子的：** 通过临时文件 + rename，半途崩溃不会损坏原文件。

## 进一步阅读

只有以下情况才打开参考文档（避免一次性塞满上下文）：

- 需要详细的 manifest schema / asset role 含义 / SHA-256 校验细节 → `references/format.md`
- 需要更复杂的工作流（多语言文档、签名、批量打包、与 `aimd` Go CLI 互通）→ `references/recipes.md`

```bash
# 按需读取
cat <本skill目录>/references/format.md
cat <本skill目录>/references/recipes.md
```
