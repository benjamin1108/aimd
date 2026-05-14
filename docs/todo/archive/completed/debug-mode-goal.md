# /goal: 增加调试模式开关，默认不打搅用户

## 背景

AIMD Desktop 当前有一个内置调试控制台：应用启动时会 patch `console.*`，收集运行时日志、未捕获异常和后端诊断；一旦出现 `warn` / `error`，底部状态栏会主动显示“调试”指示器，点击可打开调试控制台。

这个机制对开发和排障有价值，但对普通用户来说过于打扰。像缺失本地图片、WebView 诊断、Vite 连接、web clip extractor 诊断、PDF 侧车日志等信息，不应该在用户没有明确开启调试模式时主动出现在主界面、菜单或弹窗里。

需要新增一个设置项：“启用调试模式”。默认关闭。关闭时，调试能力可以继续在内部收集必要信息，但不得主动打搅用户；开启后才显示调试入口、调试控制台、详细诊断和调试级别菜单/状态。

## 产品目标

完成一个设置驱动的调试模式：

- 设置页新增“启用调试模式”开关，默认关闭。
- 调试模式关闭时：
  - 不显示底部 `#debug-indicator`。
  - 不因为 `console.warn` / `console.error` 主动亮起调试入口。
  - 不自动打开或提示打开调试控制台。
  - 不在菜单中暴露“调试控制台”入口，或入口保持隐藏/禁用。
  - 不把技术诊断、内部 warning、开发日志作为普通用户状态提示。
  - 用户没有主动执行调试/诊断动作时，不出现技术性弹窗、浮层、窗口或状态噪音。
- 调试模式开启时：
  - 保留当前调试控制台能力。
  - `warn` / `error` 可以显示底部调试指示器。
  - 菜单可以显示“调试控制台”入口。
  - 可以查看、复制、清空运行时日志。
- 用户主动触发的业务失败仍要有简短、可操作反馈，不受调试模式关闭影响。

## 核心原则

调试模式不是“是否允许报错”。它控制的是“是否把技术细节打到用户脸上”。

必须区分三类信息：

- 用户动作反馈：保存失败、导出失败、网页导入失败、资源检查失败、模型连接失败。这些要继续显示，但文案要短，面向用户操作。
- 后台诊断信息：console warn/error、WebView extractor diagnostics、PDF sidecar log、缺失本地图片 hydrate 失败、内部重试、代理图片下载诊断。这些默认只进入内部日志，不主动透出。
- 开发调试入口：调试控制台、调试状态栏指示器、调试菜单项、日志复制等。只有调试模式开启时出现。

## 非目标

- 不删除调试控制台。
- 不删除日志收集能力。
- 不吞掉用户主动操作的失败反馈。
- 不把所有 `console.warn` / `console.error` 改成静默。
- 不改变 `.aimd` 文件格式。
- 不改变网页导入、PDF 导出、图片 hydrate、资源检查等核心业务流程。
- 不新增复杂的日志级别系统；第一版只需要一个全局调试模式开关。

## 设置设计

在应用设置中新增 UI 设置字段：

```ts
type UiSettings = {
  showAssetPanel: boolean;
  debugMode: boolean;
};
```

Rust 设置结构同步增加：

```rust
pub struct UiSettings {
    pub show_asset_panel: bool,
    pub debug_mode: bool,
}
```

默认值：

```ts
ui: {
  showAssetPanel: false,
  debugMode: false,
}
```

旧设置文件没有 `ui.debugMode` 时，必须按 `false` 补齐。

设置页位置：

- 放在“常规”分类。
- 文案建议：
  - 标题：启用调试模式
  - 说明：显示调试控制台入口和运行时诊断。关闭后，后台日志仍会保留，但不会主动打扰。

保存后应通过现有 `aimd-settings-updated` 事件即时同步到主窗口；不要求重启生效。

## 需要检查的代码面

优先检查和修改：

- `apps/desktop/src/core/types.ts`
  - 扩展 `UiSettings`，新增 `debugMode: boolean`。
- `apps/desktop/src/core/settings.ts`
  - 扩展 `DEFAULT_UI_SETTINGS`。
  - 更新 `coerceUiSettings()`，旧设置兼容默认关闭。
  - `loadAppSettings()` / `saveAppSettings()` 保持字段 round-trip。
- `apps/desktop/src-tauri/src/settings.rs`
  - 扩展 Rust `UiSettings`。
  - 默认 `debug_mode = false`。
  - 增加或更新设置兼容测试。
- `apps/desktop/src/settings/main.ts`
  - 在“常规”设置中新增开关。
  - `fill()` / `captureFormToDraft()` / `readSettings()` / `serialize()` 纳入 `debugMode`。
  - 保存后沿用现有 `aimd-settings-updated`。
- `apps/desktop/src/core/state.ts`
  - `state.uiSettings` 默认值增加 `debugMode: false`。
- `apps/desktop/src/main.ts`
  - `applyAppSettings()` 同步 `debugMode`。
  - 底部 `#debug-indicator` 的显示必须同时满足：
    - `state.uiSettings.debugMode === true`
    - warn/error count > 0
  - 点击调试指示器打开控制台只在调试模式开启时有效。
  - 菜单事件 `"debug-console"` 在调试模式关闭时应忽略或给出不打扰的 no-op，不弹窗。
  - `aimd-pdf-log` 等后台日志仍可收集，但不触发用户可见入口。
- `apps/desktop/src/debug/console.ts`
  - 保留 ring buffer 和 console patch。
  - 增加调试模式状态控制，例如 `setDebugMode(enabled)` 或让订阅者传入策略。
  - `onDebugChange()` 不应该在调试模式关闭时导致 UI 主动显示。
  - `openDebugConsole()` 在调试模式关闭时不应打开；如果必须允许菜单调用，返回 false 或静默 no-op。
  - 复制/清空日志时生成的 `[debug-console] 已复制...` 信息不要在关闭模式下再触发用户可见提示。
- `apps/desktop/src-tauri/src/menu.rs`
  - 评估是否能运行时隐藏/禁用“调试控制台”菜单项。
  - 如果 Tauri 菜单运行时动态隐藏成本较高，至少主窗口收到 `"debug-console"` 菜单事件时在调试模式关闭下 no-op。
  - 更好的结果：调试模式关闭时菜单不显示或禁用；开启后显示/启用。
- `apps/desktop/src/ui/template.ts`
  - `#debug-indicator` 已默认 `hidden`，保持默认隐藏。
  - 不新增普通用户可见的调试入口。
- `apps/desktop/src/document/web-clip.ts`
  - extractor diagnostics 当前会 `console.debug/info/warn/error` 输出。关闭调试模式时可以继续写内部 buffer，但不能导致调试入口亮起。
  - 用户可见 `setStatus()` 只保留业务状态，例如“网页导入失败”“正在处理图片”，不要显示内部诊断细节。
- `apps/desktop/src/document/assets.ts`
  - 本地图片 hydrate 失败可以保留内部日志，但默认不应触发调试入口。
  - 缺图是否需要用户知道，应通过资源检查或文档内缺图表现处理，不靠调试控制台打扰。
- `apps/desktop/src/document/health.ts`
  - 资源检查是用户主动动作，结果面板和状态提示应继续显示。
  - 不受调试模式关闭影响。
- `apps/desktop/src/document/export.ts`
  - 导出失败是用户主动动作，简短失败状态继续显示。
  - 详细错误进调试日志；关闭调试模式时不主动提示调试控制台。
- `apps/desktop/src/session/snapshot.ts`
  - 恢复失败/恢复成功的用户态提示保持简短。
- `apps/desktop/src/webview/injector.ts`
  - extractor 页面里的 console 输出不应成为主窗口普通用户噪音。
  - 诊断仍通过 payload 带回，主窗口按调试模式决定是否透出。

## 透出逻辑清单

实现时必须逐项检查这些用户可见面：

- 主窗口底部状态栏：
  - `#status-pill`
  - `#status`
  - `#debug-indicator`
  - `#debug-indicator-count`
- 应用菜单：
  - AIMD -> 设置...
  - AIMD -> 调试控制台
  - 文件 / 视图菜单不应新增调试噪音。
- 调试控制台窗口/浮层：
  - `openDebugConsole()`
  - 复制日志、清空日志、级别过滤。
- 设置窗口：
  - 常规分类的调试模式开关。
  - 保存后主窗口即时生效。
- 网页导入相关窗口/浮层：
  - `#web-clip-panel`
  - extractor hidden/fallback window
  - `show_extractor_window`
  - `web_clip_progress`
  - `web_clip_raw_extracted.diagnostics`
- 资源检查面板：
  - `#health-panel`
  - 这是用户主动诊断，不受调试模式隐藏。
- 更多菜单：
  - 不新增“查看日志/调试”入口。
  - 已有业务入口不受影响。
- 原生菜单事件：
  - `"debug-console"` 必须受调试模式控制。
- Console 捕获：
  - `console.debug/info/log/warn/error`
  - `window.error`
  - `unhandledrejection`
- 后端事件：
  - `aimd-pdf-log`
  - `aimd-settings-updated`
  - `aimd-menu`
  - web clip 相关事件。

## 行为要求

### 默认关闭

默认安装、旧设置升级、清空设置后：

- `ui.debugMode === false`。
- 启动主窗口时不显示调试指示器。
- 发生 `console.warn("x")` 或 `console.error("x")` 后，仍不显示调试指示器。
- 点击或触发原生菜单 `"debug-console"` 不打开调试控制台。
- 后台 PDF/web-clip/image hydrate 诊断不影响用户界面。
- 用户主动保存/导出/导入/资源检查失败时，仍显示短状态或业务面板。

### 开启调试模式

用户在设置中开启并保存后：

- 主窗口即时收到设置更新。
- 后续 warn/error 会显示底部调试指示器和数量。
- 如果开启前已经收集了 warn/error，开启后可以立即显示已有计数。
- 点击调试指示器打开调试控制台。
- 原生菜单 `"debug-console"` 可以打开调试控制台。
- 关闭调试模式后，调试指示器立即隐藏；已打开的调试控制台应关闭或至少隐藏，不继续浮在用户界面上。

### 用户动作反馈

调试模式关闭不应隐藏这些反馈：

- 保存失败。
- 另存为取消/失败。
- 导出 Markdown/HTML/PDF 成功或失败。
- 网页导入失败。
- 模型连接测试失败。
- 资源检查结果。
- 图片嵌入失败。
- 打开文件失败。

但反馈文案应面向用户，不直接贴内部 stack trace 或长异常。详细信息留在调试日志。

## 推荐实现策略

1. 先扩展设置 schema，保证 `ui.debugMode` 默认关闭并可保存。
2. 在主窗口维护一个当前调试模式状态：

```ts
state.uiSettings.debugMode
```

3. 调试控制台模块提供显式开关：

```ts
export function setDebugMode(enabled: boolean) {
  debugMode = enabled;
  if (!enabled) closeDebugConsole();
  emitChange();
}

export function isDebugModeEnabled() {
  return debugMode;
}
```

4. `onDebugChange()` 继续报告 error count，但主窗口显示 `#debug-indicator` 时必须检查 `debugMode`。
5. `openDebugConsole()` 在 `debugMode === false` 时直接返回，不创建 modal。
6. `applyAppSettings()` 中调用 `setDebugMode(settings.ui.debugMode)` 并刷新 `updateChrome()`。
7. 菜单事件 handler：

```ts
"debug-console": () => {
  if (state.uiSettings.debugMode) openDebugConsole();
}
```

8. 如要进一步完善原生菜单隐藏，新增后端 command 或菜单项状态更新；如果不做，必须在验收说明里写明菜单项可能可见但不会打开窗口。更推荐做到隐藏/禁用。

## 测试要求

至少补充或更新这些测试：

- TypeScript:
  - `npm run typecheck`
- Rust:
  - `cargo test -p aimd-desktop`
- 设置兼容:
  - 旧设置文件没有 `ui.debugMode` 时默认 `false`。
  - 保存设置时 `debugMode` round-trip。
- 设置页 E2E:
  - 常规设置显示“启用调试模式”开关。
  - 勾选保存后，主窗口收到 `aimd-settings-updated` 并生效。
- 主窗口 E2E:
  - 默认关闭时，触发 `console.warn` / `console.error` 后 `#debug-indicator` 仍 hidden。
  - 默认关闭时，触发 `"debug-console"` 菜单事件不创建 `.debug-modal`。
  - 开启后，触发 `console.warn` 显示 `#debug-indicator`，计数正确。
  - 开启后，点击 `#debug-indicator` 打开 `.debug-modal`。
  - 开启后再关闭，`#debug-indicator` hidden，`.debug-modal` hidden。
- 业务反馈回归:
  - 调试模式关闭时，用户主动导出失败/网页导入失败/资源检查仍显示业务状态或面板。

如现有 E2E mock `load_settings` / `save_settings`，要加入：

```ts
ui: {
  showAssetPanel: false,
  debugMode: false,
}
```

## 验收标准

- 默认情况下，普通用户不会因为内部 warn/error 看到调试入口、调试窗口或技术诊断提示。
- 设置页可以开启/关闭调试模式，保存后主窗口即时生效。
- 开启调试模式后，现有调试控制台能力仍可用。
- 关闭调试模式后，底部调试指示器和调试控制台立即消失。
- 用户主动操作的成功/失败反馈不被吞掉。
- 旧设置文件兼容，`debugMode` 默认关闭。
- `npm run typecheck` 通过。
- Rust 设置测试通过。
- 相关 E2E 覆盖默认关闭和开启后的关键路径。

## 交付说明

完成实现后请列出：

- 新增或修改的设置字段。
- 设置页新增的开关文案。
- 调试指示器、调试控制台、菜单事件的控制逻辑。
- 哪些诊断信息默认只进入日志，不再主动透出。
- 哪些用户主动操作反馈仍保留。
- 已运行的验证命令和结果。
- 如果原生菜单项暂时无法动态隐藏，只能 no-op，也要明确说明。
