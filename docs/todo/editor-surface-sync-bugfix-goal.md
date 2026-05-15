# /goal: 编辑区与预览区未保存状态同步 bugfix 生产目标

## 背景

AIMD Desktop 同时存在多个文档表面：

- 可编辑表面：可视化编辑区、Markdown 源码区。
- 渲染/预览表面：阅读区、源码区右侧预览、Git diff 渲染预览，以及可视化编辑区自身的 rendered HTML。
- 文档容器：多 Tab、草稿、普通 Markdown、AIMD 包、Git 工作区文件。

当前 rendered surface 已经归一到统一渲染管线，但“同一份文档在未保存状态下如何在多个表面之间同步”仍然存在竞态风险。根因是 Markdown 源、canonical HTML、surface DOM、source-preserving model、dirty 状态、异步 render timer 没有共同的 per-tab/per-version 状态合同。

这不是单个 UI 刷新 bug。本目标要求彻底收敛文档状态同步模型，排除以下最大交错场景下的数据丢失、旧预览、旧 HTML 可编辑、错误保存和跨 Tab 污染风险。

## 已确认风险

### 源码区修改后切 Tab 会让原文档 HTML 缓存停在旧版本

源码区输入会立即更新 `state.doc.markdown` 并通过 `scheduleRender()` 启动 220ms 异步渲染。当前 `scheduleRender()` 是全局 timer，不绑定触发时的 tab、markdown version 或 markdown snapshot。

风险序列：

1. 打开文档 A。
2. 切到 Markdown 源码区，输入新内容。
3. 在 220ms debounce 内切到文档 B。
4. timer 触发时按当前 active tab 渲染 B，而不是渲染 A。
5. A 的 `doc.markdown` 是新版本，但 A 的 `doc.html`、outline、paintedVersion 仍可能是旧版本。
6. 切回 A 时，各渲染表面可能从旧 `doc.html` 重绘，导致源码区和预览/可视化区不一致。

### 源码区修改后立刻进入可视化编辑可能编辑旧 HTML，并被 pending render 覆盖

源码输入后 render 尚未完成时，切到可视化编辑区会根据当前 `doc.html` 和 `htmlVersion` 判断是否 repaint。此时 `doc.markdown` 已更新，但 `doc.html` 可能仍是旧 HTML。

风险序列：

1. 在源码区输入 `SOURCE_A`。
2. 立即切到可视化编辑区。
3. 可视化编辑区显示旧 HTML 或尚未对应 `SOURCE_A` 的 HTML。
4. 用户立刻输入 `VISUAL_B`。
5. pending render 返回后重写 visual editor DOM，并在 paint 回调里把 `inlineDirty` 清为 false。
6. `VISUAL_B` 可能被覆盖，保存时只保存 `SOURCE_A` 或旧 markdown。

### 可视化 flush 失败后保存仍可能继续

`flushInline()` 在不能安全完成 source-preserving patch 或结构转换时会设置 `state.inlineDirty = true` 并返回 warning。部分离开文档路径会检查 `inlineDirty` 并阻断，但保存、另存、导出、健康检查、格式化等路径仍可能只调用 `flushInline()` 而不检查 flush 是否成功。

风险序列：

1. 在可视化编辑区做一个不能安全转换为 Markdown 的结构编辑。
2. `flushInline()` warning 并保持 `inlineDirty = true`。
3. 用户点击保存或触发导出/格式化。
4. 调用方继续使用旧 `doc.markdown`。
5. 应用显示保存成功或继续后续操作，但可视化区里尚未同步的修改没有进入 Markdown。

### 任务 checkbox 和工具栏直接改 Markdown 时可能绕过 source model 同步

任务 checkbox、图片 alt、格式工具栏等路径可能直接修改 `state.doc.markdown`。这些入口必须与源码输入走同一套 mutation 合同，否则会出现：

- `sourceModel.markdown !== state.doc.markdown` 的短暂不一致。
- 可视化编辑随后 flush 时退回整文档 HTML->Markdown。
- source-preserving 的低 churn 语义被破坏。
- pending render 和 visible DOM 的版本关系不可证明。

## 目标

建立生产级文档同步状态机，使所有未保存修改在多编辑区、多预览区、多 Tab、异步 render、保存/导出/格式化路径中都满足以下合同：

- `doc.markdown` 是文档内容的唯一源。
- `doc.html` 必须明确标记自己对应哪个 Markdown 版本，不能被当作永远最新。
- 每一次 Markdown 修改都递增 per-tab markdown version，并使旧 render result、旧 surface DOM、旧 source model 失效或更新。
- 每一次 render 都绑定触发时的 tab、markdown snapshot、markdown version、path、format，不允许后续 active tab 变化改变渲染对象。
- 可视化编辑区只允许展示和编辑与当前 Markdown 版本一致的 HTML。
- 任何未成功 flush 的可视化编辑都必须阻断保存、另存、导出、格式化、健康检查、切换 Git diff 或关闭文档。
- 所有直接修改 Markdown 的入口必须走同一个 mutation API，不允许继续散落手写 `state.doc.markdown = ...`。

## 非协商要求

### 统一 Markdown mutation API

实现一个统一入口，例如：

```ts
commitMarkdownChange({
  tabId,
  markdown,
  origin,
  dirty,
  preserveSourceModel,
})
```

具体命名可以按代码风格调整，但必须集中处理：

- 更新 `doc.markdown`。
- 递增 per-tab `markdownVersion`。
- 标记 `doc.dirty`。
- 更新 `hasGitConflicts`、`hasExternalImageReferences`、`requiresAimdSave`、`needsAimdSave`。
- 重建或同步 `sourceModel`。
- 清理 `sourceDirtyRefs`、`sourceStructuralDirty` 的正确时机。
- 标记当前 `doc.html` 是否仍匹配最新 Markdown。
- 安排 per-tab render。
- 同步 active facade 和 tab state。
- 持久化 session snapshot 的正确时机。

以下入口不得继续直接散写 Markdown 状态：

- Markdown 源码 textarea input。
- 可视化 `flushInline()` 成功提交。
- 任务 checkbox toggle。
- 图片 alt 更新。
- 格式工具栏插入块。
- 粘贴或插图导致的 Markdown 改写。
- 格式化返回结果。
- 保存为 Markdown/AIMD 后返回的 canonical Markdown。
- 任何后续新增的文档内容变更入口。

### per-tab/per-version render 调度

替换全局 loose `renderTimer` 语义。render 任务必须至少绑定：

- `tabId`。
- `markdownVersion`。
- `markdown` snapshot。
- `path` snapshot。
- `format` snapshot。
- `isDraft` snapshot。

render 完成后只能应用到同一个 tab、同一个 markdown version。若 tab 已切换但版本仍匹配，应更新该 tab 的 canonical HTML/outline/htmlVersion，并把表面标记为 stale；如果该 tab 当前可见，再 repaint 可见表面。

不允许出现：

- A 文档触发的 render 在 B 文档 active 时渲染 B。
- A 文档触发的 render 因为切到 B 而被悄悄丢失，导致 A 的 markdown 新、html 旧。
- 旧版本 render result 覆盖新版本 markdown 的 HTML。
- hidden surface hydrate 或 stale render 修改当前 active tab 状态。

### canonical HTML 版本合同

每个 open document tab 必须能回答：

- 当前 `doc.markdown` 的版本是多少。
- 当前 `doc.html` 对应的 Markdown 版本是多少。
- 当前 render 是否 pending。
- 当前 render 是否失败。
- 各 surface paintedVersion 对应哪个 htmlVersion。

`htmlVersion` 只能表示 canonical HTML 自身版本，不能隐式表示 Markdown 已同步。需要新增或等价表达：

- `markdownVersion`。
- `renderedMarkdownVersion` 或 `htmlMarkdownVersion`。
- `pendingRenderVersion`。
- 必要时的 `renderErrorVersion`。

切换 read/source/edit 或切回某个 tab 时，不能只比较 `paintedVersion[mode] === htmlVersion`；还必须确认 `doc.html` 对应当前 `doc.markdown`。

### 进入可视化编辑前必须有同步屏障

从 source/read/其他 tab 进入可视化编辑区时，如果 canonical HTML 尚未对应当前 Markdown，必须采用以下其中一种生产级策略：

- 立即执行并等待当前 tab 当前 markdownVersion 的 render，然后再展示可编辑 DOM。
- 或展示非可编辑 loading/同步状态，禁用 visual editor 输入，直到 render 完成。

不允许：

- 用旧 `doc.html` repaint 可视化编辑区。
- 让用户在旧 HTML 上继续编辑。
- 依赖固定 `setTimeout` 等待。
- 在 pending render 返回时覆盖已有 `inlineDirty` 的可视化输入。

如果用户已经在可视化编辑区产生 `inlineDirty`，后续 render result 不得重写 visual editor DOM；必须先完成或阻断 flush，再决定是否 repaint。

### `flushInline()` 必须返回可判定结果

`flushInline()` 不能继续以 `void` + 修改全局 `inlineDirty` 的隐式协议作为调用方判断依据。它必须返回明确结果，例如：

```ts
type FlushInlineResult =
  | { ok: true; markdownChanged: boolean }
  | { ok: false; reason: string };
```

所有调用方必须处理失败结果。失败时必须阻断：

- 保存。
- 另存。
- 导出 HTML/PDF/Markdown 项目。
- 健康检查。
- 格式化。
- 切换文档 Tab。
- 切换 Git diff 主视图。
- 关闭文档或窗口的保存后继续流程。

失败时必须保持：

- `doc.dirty = true`。
- `inlineDirty = true`。
- 用户可见状态提示。
- 可视化 DOM 不被旧 render 覆盖。
- 文件系统不写入旧 Markdown 并显示“已保存”。

### 保存语义不能回退

修复同步问题不能破坏现有保存合同：

- 普通 `.md` 保存仍然保存回原 `.md`，除非文档确实包含 AIMD 管理资源而需要转换。
- `.aimd` 保存仍保留资源与 manifest 语义。
- source-preserving editor 仍以局部 patch 为正常路径。
- 整文档 HTML->Markdown 只能作为明确、受控、可测试的 fallback，不能成为普通编辑保存路径。
- 不允许用“保存前强制 whole-document turndown”掩盖版本同步问题。

### 多 Tab 状态不能互相污染

每个 open document tab 必须持有自己的：

- `doc`。
- `mode`。
- `sourceModel`。
- `sourceDirtyRefs`。
- `sourceStructuralDirty`。
- `inlineDirty`。
- `markdownVersion`。
- `htmlVersion`。
- `htmlMarkdownVersion`。
- `pendingRenderVersion`。
- `paintedVersion`。
- view state。

active facade 只是当前 tab 的视图绑定，不能成为异步 render 的身份来源。异步任务必须回写自己捕获的 tab，而不是回写“当前 active tab”。

### Frontmatter 产品语义保持一致

本目标不改变 frontmatter 的产品语义：

- 阅读区和源码预览区继续显示 YAML frontmatter 的不可编辑元信息块。
- 可视化编辑区仍不把 YAML frontmatter 当作普通正文暴露。
- Markdown 源码区继续显示并允许编辑原始 frontmatter。
- 同步修复不得让 frontmatter 在不同区域出现“有时显示、有时丢失、有时可编辑”的漂移。

如果实现为了同步屏障重绘可视化编辑区，必须继续使用 visual-editor profile 的 frontmatter 策略。

## 必须覆盖的最大算例

### 算例 A：源码修改后立即切 Tab

1. 打开 A、B 两个文档。
2. 在 A 的 Markdown 源码区追加唯一文本 `A_SOURCE_PENDING_RENDER_SENTINEL`。
3. 不等待 220ms，立即切到 B。
4. 等待超过 render debounce 和 mock render 延迟。
5. 切回 A。
6. A 的源码区、阅读区、源码预览、可视化编辑区都必须包含 sentinel。
7. B 不得出现 sentinel。
8. A 的 tab state 中 canonical HTML 必须对应最新 markdownVersion。

### 算例 B：源码修改后立即进入可视化并输入

1. 在源码区追加 `SOURCE_SENTINEL`。
2. 立即切到可视化编辑区。
3. 在 render 尚未返回前尝试输入 `VISUAL_SENTINEL`。
4. 合法结果只能是以下之一：
   - visual editor 被同步屏障临时禁用，输入不能发生，render 完成后展示 `SOURCE_SENTINEL`。
   - 或 visual editor 已经等到最新 HTML 后才允许输入，最终 Markdown 同时包含 `SOURCE_SENTINEL` 和 `VISUAL_SENTINEL`。
5. 不允许 pending render 覆盖 `VISUAL_SENTINEL`。
6. 保存 payload 必须与最终 UI 一致。

### 算例 C：可视化 flush 失败后保存必须阻断

1. 在可视化编辑区制造一个当前 source-preserving 不能安全表达的结构修改。
2. 触发保存、另存、导出、格式化、健康检查各一次。
3. 每条路径都必须收到 flush 失败结果并中止。
4. 不允许调用 `save_markdown`、`save_aimd`、`save_markdown_as`、`save_aimd_as` 或任何导出写文件命令。
5. UI 保持 dirty，并提示用户切到 Markdown 模式处理。

### 算例 D：任务 checkbox 后立即继续可视化编辑

1. 文档包含多个任务项、frontmatter、表格、图片和 ordered list。
2. 在阅读区或源码预览区勾选任务 checkbox。
3. 立即切到可视化编辑区并修改相邻段落文本。
4. 最终 Markdown 必须同时包含任务勾选变化和段落变化。
5. 未变化的 frontmatter、表格、ordered list、asset URL 必须保持 source-preserving 稳定。
6. 不允许因为 `sourceModel` 短暂落后而触发整文档 churn。

### 算例 E：慢 render 与跨 Tab 回写

1. A 触发慢 render。
2. B 触发快 render 并保持 active。
3. A 的慢 render 后返回。
4. B 当前 DOM、outline、状态栏、paintedVersion 不得被 A 污染。
5. A 的 render result 若仍匹配 A 的最新 markdownVersion，必须写入 A 的 tab state。
6. 切回 A 后不需要再依赖用户输入才能看到最新渲染。

### 算例 F：保存后状态与所有表面一致

1. 分别从 source mode、edit mode、read mode 触发保存。
2. 保存成功后 `dirty=false`。
3. 保存 payload、`doc.markdown`、`doc.html` 对应的 markdownVersion、阅读区、源码预览、可视化编辑区必须一致。
4. 若 render 失败，不能把旧 HTML 标记成当前版本。

## 回归测试要求

新增一个专门的 e2e 文件，例如：

```text
apps/desktop/e2e/61-editor-surface-sync-races.spec.ts
```

测试必须覆盖上述 A-F 算例。测试中要使用可控的 mock render 延迟和保存 payload 捕获，不能用“等待足够久后肉眼看起来正常”的方式掩盖竞态。

同时更新已有相关测试，确保不回退：

- `03-mode-switch-preserves.spec.ts`
- `10-insert-image-mode-hop.spec.ts`
- `31-md-open-association.spec.ts`
- `42-editor-core-capabilities.spec.ts`
- `46-git-workspace-panel.spec.ts`
- `50-source-preserving-editor.spec.ts`
- `52-open-documents-tabs.spec.ts`
- `53-tab-session-state.spec.ts`
- `60-rendered-surface-unification.spec.ts`

如已有测试依赖“等待 400ms 后再切模式”的稳定路径，需要新增相反测试：不等待 render，立即切换并继续操作。

## 验收门禁

完成本目标前必须通过：

```bash
npm --prefix apps/desktop run check
npm --prefix apps/desktop run test:e2e -- apps/desktop/e2e/03-mode-switch-preserves.spec.ts apps/desktop/e2e/10-insert-image-mode-hop.spec.ts apps/desktop/e2e/31-md-open-association.spec.ts apps/desktop/e2e/42-editor-core-capabilities.spec.ts apps/desktop/e2e/46-git-workspace-panel.spec.ts apps/desktop/e2e/50-source-preserving-editor.spec.ts apps/desktop/e2e/52-open-documents-tabs.spec.ts apps/desktop/e2e/53-tab-session-state.spec.ts apps/desktop/e2e/60-rendered-surface-unification.spec.ts apps/desktop/e2e/61-editor-surface-sync-races.spec.ts
cargo check --workspace
git diff --check
```

如果 `npm run check` 因 code-size gate 失败，必须继续拆分超长文件，不能降低门禁。

## 完成定义

本目标只有在以下条件全部满足时才算完成：

- 所有 Markdown 变更入口都进入统一 mutation API。
- 所有 render 任务都绑定 tab 和 markdownVersion。
- 切换到可视化编辑区前不会展示旧 HTML。
- pending render 不会覆盖用户未 flush 的可视化输入。
- `flushInline()` 失败会阻断所有可能写入旧 Markdown 的路径。
- 多 Tab 下异步 render 不会丢失触发 tab 的最新 HTML，也不会污染 active tab。
- 保存、另存、导出、格式化、健康检查、Git diff 切换、关闭文档的行为都通过明确 flush 结果驱动。
- frontmatter、source-preserving、普通 Markdown 保存语义不回退。
- 新增和既有回归测试全部通过。
- 目标完成后将本文档移动到 `docs/todo/archive/`。
