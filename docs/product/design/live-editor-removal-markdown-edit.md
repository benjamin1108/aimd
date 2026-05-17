# Live Editor 移除与 Markdown 编辑双面板校准记录

## 目标校准

- 产品模式收敛为 `read` / `edit`。
- `read` 是只读渲染阅读表面。
- `edit` 是 Markdown textarea + 渲染预览 split，Markdown 源码是唯一可写权威。
- 旧 Live Editor DOM、source-preserve patch、flush 同步、可视化 DOM 命令和相关测试不再保留。

## 当前真实入口

- 模式状态：`Mode`、open tab、session restore、菜单事件、toolbar 事件和 rendered surface profile 已从三态收敛为两态。
- 编辑入口：textarea input、Markdown toolbar、图片选择/粘贴、任务 checkbox、格式化应用和 workspace rename 都通过 Markdown mutation 或 textarea input 进入统一 Markdown 更新路径。
- 渲染入口：阅读表面使用 `reader` profile，编辑预览使用 `edit-preview` profile；任务 checkbox 仍通过 Markdown mutation 更新源码。
- CSS 入口：桌面样式仍在 `apps/desktop/src/styles/` 分层模块中，源码/预览对调用 `data-edit-pane-order` 驱动，不使用运行时 inline layout 写入。
- 测试入口：旧 Live Editor 专测已删除，新的 `04-format-toolbar.spec.ts`、`42-editor-core-capabilities.spec.ts` 和 `67-reading-editing-two-panel.spec.ts` 覆盖 Markdown toolbar、核心编辑能力和阅读/编辑双面板合同。

## UI 合同

- 宽屏默认源码在左、预览在右；对调后预览在左、源码在右。
- 窄屏默认源码在上、预览在下；对调后预览在上、源码在下。
- 对调状态是 UI/session 状态，不改变文档内容或 dirty 状态。
- 模式切换只显示“阅读”“编辑”，不再显示“预览”“MD”或第三个可视化编辑入口。
