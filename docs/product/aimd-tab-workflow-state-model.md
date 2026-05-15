# AIMD 标签页工作流状态模型

这份说明记录 workflow-tabs 完成后的最终状态模型，用来约束后续产品文案、状态归属和代码边界。

## 对象层级

用户可感知的层级是：

```text
项目 -> 打开的文档 -> 当前标签页 -> 文档视图 -> 检查器
```

- **项目** 是可选的本地目录上下文，显示在左侧项目树中。它负责文件发现、项目内文件操作和 Git 仓库上下文。关闭项目只清空项目树和 Git 状态，不关闭已打开的文档标签页。
- **打开的文档** 是当前窗口的工作会话，保存在 `state.openDocuments.tabs` 中，并由 `state.openDocuments.activeTabId` 指向当前标签页。
- **当前标签页** 是保存、另存为、导出、格式化、关闭当前标签页、资源检查和资源打包等文档命令的目标。
- **文档视图** 是当前标签页的视图状态：`read`、`edit`、`source`，对用户显示为 `预览`、`可视编辑`、`Markdown`。
- **检查器** 是当前文档侧栏：大纲、资源、Git、健康。Git 仍然是项目范围，但检查器和 Git review 不能覆盖当前文档身份。

## 当前标签页 facade

应用仍保留 `state.doc`、`state.mode`、`state.sourceModel` 等字段作为活动标签页 facade，兼容现有编辑器代码。真正的工作集来源是标签页列表：

- `bindFacadeFromTab(tab)` 在切换标签页时把 tab 写入 facade。
- `syncActiveTabFromFacade()` 在渲染标签页、持久化会话或切换标签页前，把 facade 的最新内容写回当前 tab。
- 新增跨文档逻辑应优先通过 `openDocuments`、`tabs`、`activeTab` 相关 helper 操作，不应假设全局只有一个文档。

## 稳定状态位置

长期可见的文档状态显示在标题区 `#doc-state-badges`：

- 格式：`Markdown`、`AIMD`、`草稿`
- 脏状态：`未保存`
- 保存格式风险：`保存需选格式`
- Git 冲突：`Git 冲突`
- 已恢复工作副本但磁盘文件变化：`磁盘已变化`
- 打开项目时的路径归属：`项目内` 或 `项目外`

底部 status pill 仍用于临时反馈和简短稳定摘要，但不能成为持久文档状态的唯一展示位置。

## 检查器归属

检查器数据必须归属到发起操作的标签页或当前标签页：

- 大纲和资源列表从当前标签页的文档渲染。
- 健康检查结果保存在 `OpenDocumentTab.healthReport` 上；异步结果只写回对应目标 tab。
- 资源打包会捕获 document operation target，即使用户中途切换标签页，结果也写回发起命令的 tab。
- Git review 是项目范围，在主区域显示为 `Git review · 项目变更`；返回 review 时恢复当前文档视图。

## 会话恢复 schema

Session V2 保存打开文档工作集，而不是单个文档：

- 每个 tab 保存 id、kind、路径或草稿 id、标题、格式、模式、视图状态、基础文件 fingerprint，以及可选 dirty working copy。
- 干净但路径不可用的 tab 在恢复时跳过。
- dirty 草稿和 dirty 路径文档的工作副本会恢复。
- dirty 路径文档的磁盘 fingerprint 变化时，tab 仍恢复，并标记 `recoveryState: "disk-changed"`。
- OS 初始打开路径会在 session 恢复后再路由，并与已恢复 tab 去重。

## 路径注册表

Rust 窗口路径注册表支持同一窗口注册多个路径：

- 打开路径型 tab 时注册该文件路径，用于跨窗口去重和聚焦。
- 关闭路径型 tab 时只注销该路径。
- Save As 和项目内重命名会把受影响 tab 的旧路径更新为新路径。
- 关闭窗口仍会移除该窗口拥有的全部路径。

不要把它退回到 one-path-per-window 行为；那会破坏多标签页去重和跨窗口聚焦。
