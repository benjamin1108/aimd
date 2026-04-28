# AIMD 文档索引

本文档用于说明 `docs/` 下各文件的职责边界，避免后续迭代时出现重复、冲突或不知道应该更新哪份文档。

## 文档分类

| 文件 | 类型 | 主要回答 | 更新时机 |
|---|---|---|---|
| `aimd_mrd_v_0_1.md` | MRD | 为什么需要 AIMD、面向谁、解决什么市场和产品问题 | 产品定位、目标用户、路线图发生变化时 |
| `aimd_desktop_tauri_spec.md` | Technical SPEC | 长期桌面架构如何演进，Tauri、VS Code、SDK、Agent 如何接入 | 桌面端、插件、SDK、工程架构变化时 |
| `current_stage.md` | Stage Note | 当前阶段做到哪里、下一步做什么、哪些事情暂缓 | 每个阶段开始/结束，或迭代方向变化时 |

## 职责边界

### MRD

MRD 保持高层，不写具体代码结构。

适合放：

- 市场背景
- 用户问题
- 产品定位
- 核心价值
- 高层路线图
- MVP 用户故事

不适合放：

- Tauri 目录结构
- IPC/RPC 接口
- 编辑器内核选择细节
- 插件实现方案
- 当前 sprint 任务

### Technical SPEC

SPEC 负责工程方案和技术边界。

适合放：

- 长期架构
- 模块边界
- 数据模型
- 保存策略
- 编辑器内核选择
- Tauri / VS Code / SDK / Agent 集成方案
- 技术风险和 ADR

不适合放：

- 市场宣传文案
- 非技术路线的商业判断
- 每日开发状态

### Stage Note

Stage Note 是当前阶段的执行说明。

适合放：

- 当前状态
- 已完成
- 正在做
- 暂缓事项
- 下一阶段入口条件
- 当前实现的已知问题

不适合放：

- 长篇市场分析
- 长期架构细节
- 完整 API 规范

## 当前无冲突结论

截至当前文档整理：

1. `aimd_mrd_v_0_1.md` 将 VS Code 插件列为 v0.3 Editor Integration，这与 `aimd_desktop_tauri_spec.md` 中“VS Code Plugin 是开发者/Agent 入口”的定位一致。
2. `aimd_mrd_v_0_1.md` 将 `view` 视为提前交付的体验能力，`aimd_desktop_tauri_spec.md` 将其定义为 MVP viewer，而非长期生产级编辑器，两者不冲突。
3. `aimd_desktop_tauri_spec.md` 明确保留 Go Core / CLI，这与 README 中 CLI-first 的使用方式一致。
4. Tauri Desktop、VS Code Plugin、CLI 的关系已经统一为多入口共享 AIMD Core，不是互相替代。

## 后续新增文档建议

当对应工作启动时再新增：

- `aimd_file_format_spec.md`：开放 `.aimd` 文件格式规范。
- `aimd_manifest_schema.md`：manifest JSON schema。
- `aimd_vscode_plugin_spec.md`：VS Code 插件详细 SPEC。
- `aimd_tauri_prd.md`：桌面端产品需求和交互文档。
- `aimd_security_model.md`：沙箱、HTML 渲染、签名和校验。

新增文档前先检查是否只是现有文档的一个章节；只有当内容足够独立、会被不同受众维护时才拆分。
