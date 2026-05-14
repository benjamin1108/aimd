# /goal: 网页导入设置支持选择具体模型

## 背景

AIMD Desktop 的设置页已经拆成“常规 / AI / 模型 / 网页导入”。当前 `AI / 模型` 分类可以为每个 provider 配置模型、API Key 和 API Base；但 `网页导入` 分类只能选择 provider，不能选择具体模型。

这会导致一个实际问题：用户可能希望全局模型用于普通 AI 能力，而网页导入使用另一个更适合长文清洗、结构化分章或成本更低的模型。当前只能切换 provider，不能在同一 provider 下指定网页导入模型。

需要在“网页导入”设置中增加模型选择能力：网页导入可以独立选择 provider + model，但 API Key / API Base 仍复用对应 provider 的全局凭证，避免重复填写密钥。

## 目标

完成网页导入模型选择能力：

- “网页导入”设置页增加模型选择控件。
- 用户可以为网页导入独立选择：
  - provider
  - model
- 网页导入模型配置持久化到设置文件。
- 网页导入执行 `refine_markdown` 时使用网页导入设置中的 provider + model。
- API Key / API Base 继续复用 `AI / 模型` 中对应 provider 的凭证。
- 旧设置文件兼容：没有网页导入 model 字段时，默认使用该 provider 的全局已配置模型；如果全局也没有，则使用 provider 默认模型。

## 非目标

- 不新增网页导入专用 API Key。
- 不新增网页导入专用 API Base。
- 不改变全局 `AI / 模型` 配置的语义。
- 不改变网页导入是否启用 LLM 的开关语义。
- 不改变网页导入的后台导入流程、图片本地化、草稿创建、窗口打开逻辑。
- 不调整 prompt、分章策略或模型调用参数，除非是为了传递选定模型所必需。

## 当前问题面

当前代码面大致如下：

- `apps/desktop/src/settings/main.ts`
  - `AI / 模型` 分类有 `#provider`、`#model-select`、`#model`。
  - `网页导入` 分类只有：
    - `#webclip-llm-enabled`
    - `#webclip-provider`
    - `#webclip-output-language`
  - 没有 `#webclip-model-select` 或等价模型选择控件。
- `apps/desktop/src/core/types.ts`
  - `WebClipSettings` 只有 `llmEnabled`、`provider`、`outputLanguage`。
- `apps/desktop/src/core/settings.ts`
  - `DEFAULT_WEB_CLIP_SETTINGS` 没有 model。
  - `coerceWebClipSettings()` 不处理 model。
- `apps/desktop/src-tauri/src/settings.rs`
  - Rust `WebClipSettings` 没有 `model` 字段。
- `apps/desktop/src/document/web-clip.ts`
  - 调用 `refine_markdown` 时传递 `provider` 和 `outputLanguage`，没有传递 model。
- `apps/desktop/src-tauri/src/importer.rs`
  - `refine_markdown` 根据传入 provider 从全局 `settings.ai.providers.*` 取 `cred.model`。
  - 因此网页导入无法覆盖模型。

## 数据结构

建议扩展设置结构：

```ts
type WebClipSettings = {
  llmEnabled: boolean;
  provider: ModelProvider;
  model: string;
  outputLanguage: WebClipOutputLanguage;
};
```

Rust 同步：

```rust
pub struct WebClipSettings {
    pub llm_enabled: bool,
    pub provider: String,
    pub model: String,
    pub output_language: String,
}
```

默认值：

```ts
webClip: {
  llmEnabled: false,
  provider: "dashscope",
  model: defaultModelForProvider("dashscope"),
  outputLanguage: "zh-CN",
}
```

兼容策略：

- 如果旧设置没有 `webClip.model`：
  - 前端 `coerceWebClipSettings()` 应给出 provider 默认模型。
  - 设置页加载时可以进一步用对应 provider 的全局模型填充显示值，这样旧用户默认延续当前行为。
- 如果 `webClip.provider` 切换：
  - 如果该 provider 下已有网页导入模型草稿，保留。
  - 如果没有，默认使用该 provider 的全局模型。
  - 如果全局模型为空，使用 `defaultModelForProvider(provider)`。

## UI 要求

在“网页导入”分类中，保留当前结构，并加入模型选择：

- “开启大模型智能排版与清洗”保持现有位置。
- “使用模型 Provider”或“Provider”选择 provider。
- Provider 下方增加“模型”选择控件。
- 模型控件行为应尽量复用 `AI / 模型` 页已有逻辑：
  - 使用 `MODEL_OPTIONS[provider]` 渲染选项。
  - 支持“自定义模型...”。
  - 自定义模型使用文本输入。
  - 切换 provider 时刷新模型选项。
- 文案建议：
  - Provider 标签：`Provider`
  - 模型标签：`网页导入模型`
  - 提示：`API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。`

交互细节：

- 网页导入模型选择不应该修改 `AI / 模型` 分类里的全局模型。
- `恢复默认模型`按钮仍只影响 `AI / 模型` 当前 provider，不应重置网页导入模型。
- 如果网页导入 LLM 未开启，模型控件可以保持可编辑；用户可以提前配置。
- 如果 provider 的全局 API Key 未配置，不在这里重复提示；实际导入或连接测试路径继续给业务失败反馈。

## 后端要求

`refine_markdown` 应支持接收 model：

```ts
invoke("refine_markdown", {
  markdown,
  provider: webClipConfig.provider,
  model: webClipConfig.model,
  guardReason: null,
  outputLanguage: webClipConfig.outputLanguage,
})
```

Rust command 建议：

```rust
pub async fn refine_markdown(
    app: AppHandle,
    markdown: String,
    provider: String,
    model: Option<String>,
    guard_reason: Option<String>,
    output_language: Option<String>,
) -> Result<String, String>
```

模型选择规则：

- `model` 参数存在且非空：使用该模型。
- 否则回退到 `settings.web_clip.model`。
- 如果仍为空：回退到对应 provider 的全局 `settings.ai.providers.*.model`。
- 如果仍为空：回退到 provider 默认模型。

凭证选择规则：

- provider 仍决定 API Key / API Base 来自哪个全局 credential。
- 不允许前端传 API Key / API Base 给 `refine_markdown`。

## 需要修改的文件

优先修改：

- `apps/desktop/src/core/types.ts`
  - `WebClipSettings` 增加 `model: string`。
- `apps/desktop/src/core/settings.ts`
  - `DEFAULT_WEB_CLIP_SETTINGS` 增加 model。
  - `coerceWebClipSettings()` 处理 model。
  - 如果需要，增加 helper：`defaultWebClipModelForProvider(settings, provider)`。
- `apps/desktop/src-tauri/src/settings.rs`
  - Rust `WebClipSettings` 增加 `model`。
  - 默认 model 使用 provider 默认模型。
  - `save_settings()` 规范化 model，空值填默认。
  - 旧设置兼容测试覆盖 model 默认值。
- `apps/desktop/src/settings/main.ts`
  - 网页导入分区增加模型 select + 自定义 input。
  - 增加 `webClipModelSelectEl` / `webClipModelEl`。
  - `fill()` / `captureFormToDraft()` / `readSettings()` / `serialize()` 纳入 webClip model。
  - 切换 `#webclip-provider` 时刷新网页导入模型选项。
- `apps/desktop/src/document/web-clip.ts`
  - 调用 `refine_markdown` 时传入 `model: webClipConfig.model`。
- `apps/desktop/src-tauri/src/importer.rs`
  - `refine_markdown` command 接收 model 参数。
  - `ModelConfig.model` 使用网页导入模型选择。
- `apps/desktop/e2e/*settings*.spec.ts`
  - 更新 mock settings 里的 `webClip` payload。
  - 增加网页导入模型设置保存测试。
- `apps/desktop/e2e/43-web-clip-resilience.spec.ts`
  - 更新 `refine_markdown` mock，断言收到 `model`。
  - 增加或更新一条测试：网页导入使用配置的模型而不是全局 active provider 的模型。

## 测试要求

至少覆盖：

- TypeScript：
  - `npm run typecheck`
- Rust：
  - `cargo test -p aimd-desktop`
- 设置页 E2E：
  - 网页导入 tab 显示模型选择控件。
  - 默认模型按 provider 填充。
  - 切换 provider 后模型选项刷新。
  - 自定义网页导入模型可以保存。
  - 保存 payload 包含 `webClip.model`。
- 网页导入 E2E：
  - LLM enabled 时，`refine_markdown` 收到 `provider`、`model`、`outputLanguage`。
  - 网页导入模型可以不同于全局 `AI / 模型` 当前 provider 的模型。
  - 旧 mock 没有 `webClip.model` 时仍不崩，使用默认或全局模型。
- Rust 设置测试：
  - 旧设置缺少 `webClip.model` 时默认不为空。
  - `webClip.model` 能反序列化并 round-trip。

## 验收标准

- 用户可以在“网页导入”设置中选择具体模型。
- 网页导入模型保存后重开设置仍保留。
- 网页导入调用 LLM 时使用该模型。
- 网页导入模型不会覆盖 `AI / 模型` 页里的全局模型。
- API Key / API Base 仍只在 `AI / 模型` 中配置并复用。
- 旧设置文件兼容。
- 相关 E2E、TypeScript、Rust 测试通过。

## 交付说明

完成实现后请列出：

- 新增或修改的设置字段。
- 网页导入设置页新增控件及行为。
- `refine_markdown` 参数和模型选择规则。
- 旧设置兼容策略。
- 已运行的验证命令和结果。
