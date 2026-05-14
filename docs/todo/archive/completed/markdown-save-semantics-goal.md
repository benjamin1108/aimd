# /goal: 普通 Markdown 与 AIMD 混合图片引用的保存语义修正

## 背景

当前普通 Markdown 打开后，只要正文里存在本地图片引用，例如：

```md
![AIMD Desktop](docs/assets/readme/hero-desktop.png)
```

应用会把文档标记为 `needsAimdSave`。用户即使只修改一行文本，点击保存也会被强制引导到“另存为 `.aimd`”。

这个逻辑不符合 Markdown 用户预期：本地图片路径、相对图片路径、远程图片 URL 都是普通 Markdown 的合法内容。它们不应该自动触发 AIMD 转换。

本轮目标是重构保存判断：**只有用户引入 AIMD 专属资源或显式选择打包资源时，才转换为 `.aimd`；普通 Markdown 文本修改必须保存回原 `.md`。**

## 核心原则

- 普通 `.md` 保持普通 `.md` 的保存语义。
- Markdown 引用本地图片不等于 AIMD 内嵌资源。
- `.aimd` 允许混合存在：
  - `asset://...` 内嵌资源
  - 本地相对/绝对图片路径
  - 远程图片 URL
- 保存动作不能隐式改变用户文档格式。
- 打包本地/远程图片必须是显式动作。
- 用户手动插入或粘贴图片时，才进入 AIMD 资源体系。

## 术语定义

### 外部图片引用

Markdown 正文中原生可表达的图片引用：

- 相对路径：`![x](images/a.png)`
- 绝对本地路径：`![x](/Users/foo/a.png)`
- 远程 URL：`![x](https://example.com/a.png)`
- HTML 图片：`<img src="images/a.png">`

这些引用不要求保存为 `.aimd`。

### AIMD 专属资源

普通 Markdown 无法安全表达或无法离线承载的应用资源：

- `asset://...`
- 用户通过 AIMD 插图按钮插入的图片
- 用户粘贴截图/图片后由 AIMD 生成的内嵌资源
- `.aimd` manifest 中的内嵌资源
- Docu-Tour / AIMD 元数据等非 Markdown 能力

这些内容要求保存为 `.aimd`。

## 建议状态模型

不要继续用 `needsAimdSave` 同时表达“存在本地图片引用”和“必须转换 AIMD”。

建议拆成两个语义：

```ts
type AimdDocument = {
  // ...
  hasExternalImageReferences?: boolean;
  requiresAimdSave?: boolean;
};
```

含义：

- `hasExternalImageReferences`
  - 仅表示正文里有本地/远程图片引用。
  - 用于状态提示、健康检查、显式打包入口。
  - 不影响普通保存。
- `requiresAimdSave`
  - 表示当前文档已经包含普通 Markdown 无法安全保存的 AIMD 专属资源。
  - 只有这个为 `true` 时，`.md` 保存才需要转换 `.aimd`。

如果为了兼容现有代码仍暂时保留 `needsAimdSave`，也必须把它的含义收窄为 `requiresAimdSave`，不能再由普通本地图片引用触发。

## 保存场景矩阵

| 场景 | 保存目标 | 是否转换 AIMD | 要求 |
| --- | --- | --- | --- |
| 新建空白文档 | `.aimd` | 是 | AIMD 自己创建的新文档没有原始 `.md` 路径 |
| 打开 `.aimd` 后改文本 | 原 `.aimd` | 否 | 正常调用 `save_aimd` |
| 打开 `.aimd` 后插入图片 | 原 `.aimd` | 否 | 图片进入 AIMD 资源体系 |
| 打开 `.aimd` 后引用本地图片路径 | 原 `.aimd` | 否 | 保留外部引用，不自动打包 |
| 打开 `.aimd` 后引用远程图片 URL | 原 `.aimd` | 否 | 保留外部引用，不自动下载 |
| 打开 `.md` 无图片，只改文本 | 原 `.md` | 否 | 调用 `save_markdown` |
| 打开 `.md` 有相对本地图片，只改文本 | 原 `.md` | 否 | 调用 `save_markdown`，不能弹 `.aimd` 保存 |
| 打开 `.md` 有绝对本地图片，只改文本 | 原 `.md` | 否 | 调用 `save_markdown` |
| 打开 `.md` 有远程图片，只改文本 | 原 `.md` | 否 | 调用 `save_markdown`，不自动下载 |
| 打开 `.md` 后手动插入图片 | `.aimd` | 是 | 保存时提示/进入 `.aimd` 保存流程 |
| 打开 `.md` 后粘贴截图/图片 | `.aimd` | 是 | 保存时提示/进入 `.aimd` 保存流程 |
| 打开 `.md` 后点击“保存为 AIMD” | `.aimd` | 是 | 显式转换并可打包资源 |
| 打开 `.md` 后点击“收进文件/打包资源” | `.aimd` | 是 | 显式把外部图片转成 `asset://...` |
| 关闭 dirty `.md`，选择保存，仅文本变化 | 原 `.md` | 否 | 不能弹 `.aimd` 文件选择器 |
| 关闭 dirty `.md`，已插入 AIMD 图片 | `.aimd` | 是 | 需要转换，否则资源会丢失 |

## 具体行为要求

### 打开普通 Markdown

打开 `.md` / `.markdown` / `.mdx` 时：

- 不因本地图片引用设置 `requiresAimdSave`。
- 不因远程图片引用设置 `requiresAimdSave`。
- 可以扫描并设置 `hasExternalImageReferences`。
- 状态栏不能显示“保存时另存为 .aimd”。
- 顶部路径提示保持普通 Markdown 语义。

### 普通保存

`saveDocument()` 中：

- `format === "markdown"` 且 `requiresAimdSave !== true`：
  - 直接调用 `save_markdown(path, markdown)`。
  - 保存成功后 `dirty = false`。
  - 不调用 `choose_save_aimd_file`。
  - 不调用 `save_aimd_as`。
  - 不调用 `package_local_images`。
  - 不调用 `package_remote_images`。

- `format === "markdown"` 且 `requiresAimdSave === true`：
  - 进入 `.aimd` 保存/转换流程。
  - 文案必须说明原因：当前文档包含内嵌图片或 AIMD 专属资源。

### 手动插入图片

当用户在普通 Markdown 中通过 AIMD 插图按钮插入图片：

- 继续使用 AIMD 资源体系。
- 设置 `requiresAimdSave = true`。
- 状态栏提示“包含内嵌图片，保存时需转换为 AIMD”。
- 保存时走 `.aimd` 文件选择器。

### 粘贴图片

当用户在普通 Markdown 中粘贴截图或图片文件：

- 继续使用 AIMD 资源体系。
- 设置 `requiresAimdSave = true`。
- 保存时走 `.aimd` 文件选择器。

### 显式保存为 AIMD

保留并强化显式动作：

- 菜单项建议使用“保存为 AIMD”或“打包为 AIMD”。
- 该动作可以把本地/远程图片收进 `.aimd`。
- 这是用户主动格式转换，不应由普通保存隐式触发。

### 另存为

当前 `saveDocumentAs()` 默认只选择 `.aimd`，这会让普通 Markdown 用户误解。

推荐拆分：

- `另存 Markdown...`
- `保存为 AIMD...`

如果本轮不拆菜单，至少要做到：

- 普通保存不会进入 `saveDocumentAs()`。
- `saveDocumentAs()` 的文案明确是“保存为 AIMD”，不要伪装成普通另存。

## AIMD 中混合图片引用规则

`.aimd` 文档允许混合图片引用：

```md
![内嵌图](asset://img-001)
![本地项目图](docs/assets/a.png)
![远程图](https://example.com/a.png)
```

保存 `.aimd` 时默认行为：

- `asset://...` 正常保存到 `.aimd`。
- 本地图片路径默认保留引用，不自动打包。
- 远程图片 URL 默认保留引用，不自动下载。
- 只有用户点击“收进文件/打包资源”时，才转换为 `asset://...`。

健康检查应区分：

- 已内嵌资源：离线可用。
- 本地外部引用：依赖本机路径或项目目录。
- 远程外部引用：依赖网络。

不要把外部引用直接视为保存错误。

## 需要检查的现有代码面

优先检查并修改：

- `apps/desktop/src/document/lifecycle.ts`
  - `openMarkdownDocument()` 当前用本地图片引用设置 `needsAimdSave`，需要改。
- `apps/desktop/src/document/persist.ts`
  - `saveDocument()` 当前对 `state.doc.needsAimdSave || state.doc.assets.length > 0` 强制 `saveDocumentAs()`，需要重构。
  - `prepareAimdMarkdownForSave()` 当前会自动打包本地图片，需确认只对 AIMD 显式保存或 AIMD 文档保存生效。
- `apps/desktop/src/editor/images.ts`
  - 插入图片时如果当前是 Markdown，应设置 `requiresAimdSave`。
- `apps/desktop/src/editor/paste.ts`
  - 粘贴图片时如果当前是 Markdown，应设置 `requiresAimdSave`。
- `apps/desktop/src/ui/chrome.ts`
  - 路径提示和状态栏文案不能把普通本地图片引用说成“保存时另存为 .aimd”。
- `apps/desktop/src/session/snapshot.ts`
  - 会话恢复需要保留新状态字段。
- `apps/desktop/src/core/types.ts`
  - 更新文档状态类型。
- `apps/desktop/src/document/health.ts`
  - 健康检查中“打包资源”动作保留为显式转换。

## 测试要求

至少补充或更新这些 E2E：

- 打开含 `![img](docs/a.png)` 的 `.md`，只改文本，`Cmd+S` 调用 `save_markdown`，不调用 `save_aimd_as`。
- 打开含绝对本地图片路径的 `.md`，只改文本，保存回 `.md`。
- 打开含远程图片 URL 的 `.md`，只改文本，保存回 `.md`，不调用远程图片下载/打包。
- 打开含本地图片的 `.md`，图片预览正常，保存后仍是 `.md`。
- 打开 `.md` 后手动插入图片，保存触发 `.aimd` 保存流程。
- 打开 `.md` 后粘贴截图/图片，保存触发 `.aimd` 保存流程。
- 关闭 dirty `.md` 选择保存，仅文本变化时保存回 `.md`。
- 关闭 dirty `.md` 且包含 AIMD 插入资源时，提示保存为 `.aimd`。
- `.aimd` 中同时存在 `asset://...`、本地图片路径、远程图片 URL 时，普通保存不自动打包外部图片。
- 显式点击“保存为 AIMD/打包资源”时，才把外部图片收进 `.aimd`。

## 验收标准

- 普通 Markdown 引用本地图片时，文本修改保存回原 `.md`。
- 普通 Markdown 引用远程图片时，文本修改保存回原 `.md`。
- 普通 Markdown 只有在用户插入/粘贴 AIMD 图片资源后，才要求保存为 `.aimd`。
- `.aimd` 文档允许混合 `asset://`、本地路径、远程 URL。
- 保存 `.aimd` 不再默认把所有外部图片自动打包。
- 打包本地/远程图片只能由显式动作触发。
- 状态栏和路径提示文案准确，不把普通图片引用描述成必须转换 AIMD。
- `npm run check` 通过。
- 相关 Playwright E2E 通过。

## 非目标

本轮不做：

- 完整资产管理器。
- 自动迁移所有历史 `.aimd` 图片引用。
- 图片路径重写 UI。
- 远程图片下载队列管理。
- Git 变更联动。
- PDF 导出策略调整，除非现有测试暴露必要回归。
