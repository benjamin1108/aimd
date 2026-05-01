---
aimd_docu_tour: |
  eyJ2ZXJzaW9uIjoxLCJ0aXRsZSI6IkFJTUQg5Lqn5ZOB5a6h5p+l5LiO5p625p6E5LyY5YyW5a+86KeIIiwic3RlcHMi
  Olt7InRhcmdldElkIjoi5oC757uTIiwibmFycmF0aW9uIjoi5pys5qyh5a6h5p+l55qE5qC45b+D57uT6K665piv77ya
  55WM6Z2i5bqU6IGa54Sm55So5oi35Lu75Yqh6ICM6Z2e5bel56iL6LCD6K+V44CC5oiR5Lus5bCG6YCa6L+H6YeN5p6E
  5L+h5oGv5p625p6E77yM5bCG5a6e546w57uG6IqC5LuO5Li76Lev5b6E5Lit5Yml56a744CCIn0seyJ0YXJnZXRJZCI6
  IumrmOS8mOWFiOe6p+mXrumimCIsIm5hcnJhdGlvbiI6IuW9k+WJjeiuvue9rumhteWtmOWcqOS4pemHjeeahOaAp+iD
  veS4juS6pOS6kumXrumimO+8jOWmgum7keWxj+W7tui/n+OAgemFjee9ruaXoOazleaMgeS5heWMluWPiuWPlua2iOaM
  iemSruWkseaViO+8jOi/meS6m+aYr+W9seWTjeeUqOaIt+S/oeS7u+eahOmmluimgemanOeijeOAgiJ9LHsidGFyZ2V0
  SWQiOiLkuLvnlYzpnaItdXgt6Zeu6aKYIiwibmFycmF0aW9uIjoi5Li755WM6Z2i5bel5YW35qCP5Yqf6IO95re35p2C
  77yM5LiU5L+d5a2Y54q25oCB5LiO5pON5L2c5YWl5Y+j5YiG56a744CC5bu66K6u5oyJ5oSP5Zu+6YeN5paw5YiG57uE
  77yM56Gu5L+d5qC45b+D5pON5L2c6Lev5b6E5riF5pmw5LiU56ym5ZCI55Sf5Lqn5bel5YW35Lmg5oOv44CCIn0seyJ0
  YXJnZXRJZCI6IuaWh+ahiOWuoeaguOinhOWImSIsIm5hcnJhdGlvbiI6IuaIkeS7rOWwhuaOqOihjOaWsOeahOaWh+ah
  iOinhOWIme+8mumakOiXj+aKgOacr+WunueOsOe7huiKgu+8jOS7heWxleekuuacieWKqeS6jueUqOaIt+WGs+etluea
  hOS/oeaBr++8jOW5tuWIqeeUqOWtl+auteagh+mimOaJv+aLheino+mHiui0o+S7u+OAgiJ9LHsidGFyZ2V0SWQiOiJs
  bG0tcHJvdmlkZXIt5p625p6E5Yaz562WIiwibmFycmF0aW9uIjoi5Li65o+Q5Y2H56iz5a6a5oCn77yM5oiR5Lus5bCG
  5pS+5byDIFB5dGhvbi9MaXRlTExNIOS+nei1lu+8jOi9rOWQkSBSdXN0IOWOn+eUnyBQcm92aWRlciDmir3osaHvvIzl
  rp7njrDlkITmqKHlnovmnI3liqHnmoTmj5Lmi5TlvI/nrqHnkIbjgIIifSx7InRhcmdldElkIjoi5o6o6I2Q5LiL5LiA
  5q2lIiwibmFycmF0aW9uIjoi5ZCO57ut5bel5L2c5bCG5LyY5YWI5L+u5aSN6K6+572u6aG155qE5oCn6IO95LiO5oyB
  5LmF5YyW6Zeu6aKY77yM5bm25ZCM5q2l5o6o6L+b5p625p6E6YeN5p6E77yM5Lul5a6e546w5pu06L276YeP44CB5pu0
  5LiT5Lia55qE5qGM6Z2i56uv5L2T6aqM44CCIn1dfQ==
---

# AIMD UX / 产品审查记录

日期：2026-05-01

本文档记录本轮审查中发现的 UX、产品逻辑、信息架构、文案和技术风险问题。
为避免 Markdown 宽表格在应用里渲染错乱，本文使用分组清单，不使用大宽表。

## 总结

当前问题分成两类：

1. 产品和 UX 结构问题：核心动作被平铺成同一层级，低频控件占据高频区域，设置页把实现细节暴露给用户。
2. 实现和可靠性问题：设置窗口打开前会黑屏，部分设置记不住，取消按钮不生效，设置窗口固定尺寸但内容容纳不好。

最重要的方向是：不要把界面做成工程调试面板。界面应该围绕用户任务组织：

- 连接模型。
- 设置导览生成规则。
- 阅读或编辑当前文档。
- 只有在需要排障时才展示高级诊断。

## 高优先级问题

### 1. 设置窗口打开慢，先黑屏 2-3 秒

问题：

点击设置后，窗口会先黑屏大约 2-3 秒，然后设置界面才出现。

为什么严重：

设置窗口应该立即出现。黑屏会让用户感觉命令没有响应，或者应用卡住了。

需要确认：

- 设置 WebView 是否在等待 JavaScript 初始化。
- Python / LiteLLM 依赖检测是否阻塞首屏渲染。
- 全局 CSS 或模块加载是否延迟首屏绘制。
- Tauri 单独创建设置窗口的生命周期是否有额外开销。

建议方向：

设置页应该先渲染外壳，再异步检测依赖状态。用户应先看到设置界面，而不是等诊断跑完。

### 2. 设置页需要整体重构

问题：

当前设置页像工程配置面板，把模型凭证、内容生成参数、运行环境检测和实现警告混在一个长表单里。

为什么严重：

用户不是按代码模块理解产品的。用户关心的是：

- 我怎么连接模型？
- 我怎么控制导览生成效果？
- 出问题了怎么诊断？

建议结构：

- 模型连接
  - Provider
  - 模型
  - API Key
  - API Base，可选
- 导览生成
  - 导览步数
  - 输出语言
  - 未来的内容生成指导
- 高级诊断
  - 生成引擎状态
  - 依赖详情
  - 修复指引

AI 步骤设置 / 导览步数不应该放在大模型密钥配置里。它是内容生成指导，不是认证配置。

### 3. 设置页文案暴露了实现细节

问题：

设置页里出现了类似这些说明：

- 通过 LiteLLM 调用模型。
- 桌面端通过系统 python3 调用。
- API Key 保存在本地浏览器存储。
- 需要执行 `pip install litellm`。

为什么严重：

这些是实现语言，不是产品语言。它会让应用看起来不成熟，也会让用户产生不必要的安全焦虑。

建议方向：

主设置页使用面向用户的表达：

- API Key
- 仅保存在本机
- 生成引擎不可用
- 打开诊断

技术细节可以保留，但应该放在“高级诊断”里，而不是默认展示在主路径上。

### 4. 设置窗口尺寸和内容布局不匹配

问题：

设置窗口看起来太小，内容压边，边框和文字没有被舒适地容纳。

为什么严重：

设置页应该稳定、可扫描、有边界感。现在的布局让人感觉脆弱和拥挤。

可能原因：

- 设置窗口固定为不可调整尺寸。
- 常驻解释文案太多。
- 分组密度太高。
- 底部按钮占据横向空间。
- 内容区没有清晰的滚动策略。

建议方向：

- 如果保留固定 header / footer，中间内容必须干净滚动。
- 删除不必要的常驻 hint。
- 增加留白，或调整设置窗口尺寸。
- 底部按钮始终完整可见，不压边。

### 5. 设置数据存储有问题，切换选项记不住

问题：

用户反馈：切换选项后根本记不住。

为什么严重：

设置不持久化会直接摧毁用户信任。比没有设置更糟，因为它制造了“我已经配置好了”的假象。

需要确认的可能原因：

当前 Docu-Tour 配置看起来使用 localStorage。如果设置窗口和主窗口不是同一个 WebView 存储上下文，就可能出现设置窗口写入后主窗口读不到的问题。

建议方向：

使用 Tauri 后端作为统一配置源。主窗口和设置窗口都通过同一组 load / save 命令读写配置。localStorage 最多作为迁移兜底。

### 6. 取消按钮不生效

问题：

设置页取消按钮不生效。

为什么严重：

取消是设置页最基本的信任动作。用户必须确信点取消不会保存当前改动，并且窗口会按预期关闭。

需要确认：

- 点击事件是否触发。
- Tauri window close 调用是否失败。
- 是否被 form 行为或焦点状态干扰。
- 是否存在“切换即保存”，导致取消无法撤销。

建议行为：

取消应该关闭设置窗口，并且不保存当前未提交改动。如果只在点击保存时写入配置，这个逻辑最清楚。

## 主界面 UX 问题

### 7. “宽度”控件放错位置

问题：

文档 toolbar 里放了“宽度”下拉菜单。

为什么严重：

阅读宽度不是高频文档操作，不应该占据主工具栏，更不应该和阅读 / 编辑 / 源码 / 导览放在同一层级。

额外问题：

三个固定选项用下拉菜单很重。一个低频视图偏好被做成了显眼控件。

建议方向：

从主工具栏移除宽度控件。放进“视图”菜单或低优先级外观设置。如果一定要在界面上保留，也应该是轻量分段控件或图标选择，而不是主 toolbar 下拉。

### 8. 工具栏混合了不同类型的功能

问题：

当前 toolbar 把这些东西放在一起：

- 阅读
- 编辑
- 源码
- 宽度
- 导览

为什么严重：

它们不是同一类动作。阅读 / 编辑 / 源码是文档模式；宽度是显示偏好；导览是内容生成和播放功能。混在一起会打乱产品逻辑。

建议方向：

按意图分组：

- 文档模式：阅读 / 编辑 / 源码
- 内容生成：生成导览 / 播放导览
- 视图偏好：宽度

### 9. 阅读 / 编辑 / 源码被设计成同级模式

问题：

当前 UI 把阅读、编辑、源码做成同级 tab。

为什么严重：

对于文档工具，主路径应该更清楚。现在像一个调试工具，好像文档的每种表示方式都是同等核心。

建议方向：

以“编辑文档”为中心。阅读可以是预览或专注模式，源码应该是高级模式。

### 10. 导览入口的信息架构不清楚

问题：

导览入口放在宽度旁边。

为什么严重：

Docu-Tour 不是视图设置，它是内容生成和播放功能。它的位置应该反映这一点。

建议方向：

把导览放到文档增强、结构、大纲或独立生成区域里。入口需要明确区分：

- 生成导览
- 更新导览
- 播放已有导览

### 11. 保存状态离保存动作太远

问题：

保存状态显示在右下角很小的状态 pill 里。

为什么严重：

用户会看标题、正文和保存按钮，不会自然扫右下角。保存状态是高优先级信息，不能放在视觉边缘。

建议方向：

保存状态靠近标题或保存按钮：

- 已保存
- 有未保存修改
- 正在保存
- 保存失败

### 12. 保存按钮禁用状态含义不清楚

问题：

文档已保存时，保存按钮变成禁用状态。

为什么严重：

禁用的主按钮容易被理解为功能不可用或坏了，尤其当界面没有解释原因时。

建议方向：

显示清楚的“已保存”状态，或者让保存按钮保持可用但重复保存无副作用。当前状态需要更明确。

### 13. 文件操作分散

问题：

新建、打开、保存、另存为、新窗口、关闭分散在顶部、侧边栏和更多菜单里。

为什么严重：

用户无法形成稳定的文件操作心智模型。

建议方向：

文件级操作集中在一个稳定区域。侧边栏应专注导航和文档结构，不要重复文件操作。

### 14. 侧边栏重复当前文档信息

问题：

侧边栏的当前文档卡片重复了顶部标题里的信息。

为什么严重：

侧边栏长期占空间，应该提供导航和结构价值，而不是重复 chrome 信息。

建议方向：

侧边栏优先展示大纲和文档导航。当前文档身份由顶部 header 承担。

### 15. 资源为空时仍占空间

问题：

资源区无内容时仍显示。

为什么严重：

空区域降低信息密度，让界面显得没设计完。

建议方向：

资源区在无资源时默认折叠，或者只在文档有资源时展开。

### 16. 空态像 landing page，不像生产工具启动页

问题：

空态使用大标题和营销式说明，占据大量空间。

为什么严重：

这是桌面生产工具。首屏应该帮助用户继续工作或开始工作。

建议方向：

空态改成 launchpad：

- 最近文档
- 新建文档
- 打开 AIMD
- 导入 Markdown
- 拖放文件提示

产品解释应退居次级。

### 17. 视觉层级过于平均

问题：

很多控件视觉权重接近。当前文档、主动作、次级动作、状态之间没有足够明确的层级。

为什么严重：

当所有东西都很轻，用户必须逐个阅读控件才能理解优先级。

建议方向：

建立更明确的层级：

- 当前文档身份
- 当前状态
- 主动作
- 次级文档操作
- 高级操作

## 可访问性和交互问题

### 18. 全局禁止文本选择

问题：

CSS 全局使用 `user-select: none`。

为什么严重：

文档工具里，用户可能需要复制文件路径、状态、诊断信息、错误信息或设置值。全局禁选太粗暴。

建议方向：

默认允许文本选择。只在具体控件上禁用选择，避免交互干扰。

### 19. 焦点状态不系统

问题：

按钮和输入控件缺少统一的 `focus-visible` 体系。

为什么严重：

键盘用户需要知道焦点在哪里。这也是桌面应用精致度的一部分。

建议方向：

为按钮、select、input、菜单项和 toolbar 控件添加统一焦点样式。

### 20. 窄桌面宽度下源码预览被直接移除

问题：

窗口变窄时，源码预览 pane 被隐藏。

为什么严重：

这不只是移动端问题，窄桌面窗口也会受影响。Markdown 源码编辑没有预览反馈，体验会下降。

建议方向：

窄窗口下应提供“源码 / 预览”切换，而不是直接移除预览。

### 21. 切换动画会短暂降低可读性

问题：

workspace pane 使用淡入动画。

为什么严重：

快速切换或自动截图时，内容会短暂变浅，出现不可读状态。

建议方向：

缩短或移除正文淡入。如果需要动画，只轻微动画容器，不要让正文文本从很低透明度出现。

## 技术架构问题

### 22. Python + LiteLLM 是否是正确方案

问题：

当前生成链路看起来依赖 Python / LiteLLM，类似 sidecar 或系统依赖模式。

为什么严重：

这可能带来：

- 启动慢或检测慢。
- 安装和打包复杂。
- 跨平台问题。
- 故障模式变多。
- 技术细节被迫暴露到 UI。

需要回答：

- LiteLLM 是否是 provider 抽象必须依赖？
- 是否可以直接用 Rust 调 provider HTTP API？
- 是否可以通过 Tauri command 由前端配置、后端请求？
- 应用是否应该自带受控 sidecar，而不是依赖系统 Python？
- API Key 存储和传递的安全边界是什么？
- macOS 和 Windows 的长期打包方案是什么？

建议方向：

在继续打磨当前设置 UI 前，先做一次架构评估。如果运行时方案变化，设置页 UX 也会跟着变化。

### 23. 设置持久化应统一

问题：

需要跨窗口共享的设置，不应该依赖每个 WebView 自己的浏览器存储。

建议方向：

使用 Tauri 后端配置文件或安全存储层。前端通过统一命令读取和保存。

### 24. API Key 存储需要产品和安全决策

问题：

当前界面暴露了存储实现，但产品上仍需要明确 API Key 到底如何保存。

建议方向：

决定 API Key 存储方式：

- OS Keychain / Credential Manager。
- Tauri 安全存储插件。
- 本地配置文件。
- 不保存，每次输入。

界面文案应表达产品承诺，而不是暴露无关实现。

## 文案审核规则

### 只展示能帮助用户决策的信息

应该展示：

- 当前选择了哪个 provider。
- API Key 是否缺失。
- 生成功能是否可用。
- 出错了是什么，以及怎么恢复。

默认不应该展示：

- 内部用了哪个库。
- 哪个进程执行模型调用。
- 用哪个浏览器存储 API 保存 key。
- 没出问题前就展示安装命令。

### 字段标题应该承担解释责任

如果字段标题足够清楚，就不要再写一段 hint 重复解释。

例子：

- “Provider”不需要一段解释 provider。
- “API Key”不需要常驻说明“这是必须的”，除非为空或校验失败。
- “演示稿步数”可以改成更产品化的“导览步数”或“导览长度”。

### 风险和恢复信息应该靠近问题

不要给所有字段都配永久警告文案。

例子：

- 缺少 key：在 API Key 下方显示错误。
- 运行环境不可用：在高级诊断里显示。
- Provider 不支持：在 Provider 附近显示。
- 保存失败：在保存按钮附近显示。

### 高级细节必须折叠

Python / LiteLLM / 安装命令这类信息可以存在，但应该在“高级诊断”中，不应放在默认设置路径。

## 建议的信息架构

### 主文档 Header

应该包含：

- 文档标题。
- 文件路径或简短位置提示。
- 保存状态。
- 主要文件操作。

不应该包含：

- 宽度选择。
- 运行环境诊断。
- 低频偏好。

### 文档 Toolbar

应该包含：

- 核心文档模式或工作流控制。
- 编辑模式下的编辑工具。

不应该混入：

- 视图偏好。
- 内容生成。
- 运行时设置。

### 侧边栏

应该专注：

- 大纲。
- 文档结构。
- 有价值时展示资源。

应该避免：

- 重复当前文档标题。
- 展示大面积空分区。

### 设置页

建议分区：

1. 模型连接
2. 导览生成
3. 高级诊断

## 设置页文案改写方向

### Header

当前方向：

“Docu-Tour 通过 LiteLLM 调用模型生成导读脚本。”

更好的方向：

“配置模型连接和导览生成。”

### 模型连接

字段：

- Provider
- 模型
- API Key
- API Base

文案原则：

- 描述要短。
- 只在需要校验或警告时展示说明。
- 不暴露实现细节。

### 导览生成

字段：

- 导览步数
- 输出语言
- 未来：生成指导 / 内容偏好

文案原则：

这是生成结果设置，不是模型凭证设置。

### 高级诊断

内容：

- 生成引擎状态。
- 依赖详情。
- 修复指引。

文案原则：

这里可以展示技术细节，因为用户明确进入了诊断区域。

## 推荐下一步

1. 确认设置窗口黑屏原因。
2. 判断 Python + LiteLLM 是否继续作为目标架构。
3. 在改文案前，先重设设置页信息架构。
4. 把“宽度”从主 toolbar 移走。
5. 用统一配置源修复设置持久化。
6. 修复取消按钮。
7. 用产品语言重写设置页文案。
8. 对设置页布局、持久化、关闭行为做专项 QA。

## LLM Provider 架构决策

本节记录新的模型接入方向。目标是：架构优秀、边界清楚、便于未来扩展，同时不把 Python / LiteLLM / pip / sidecar 这类实现细节暴露给用户。

### 结论

不继续把 LiteLLM / Python sidecar 作为默认生成链路。

采用 AIMD 自己的 Rust provider layer：

```text
Docu-Tour 业务逻辑
  -> AIMD LLM Provider Trait
    -> DashScopeProvider
    -> GeminiProvider
    -> OpenAICompatibleProvider
    -> 后续 Anthropic / Ollama / OpenRouter / 其他 provider
```

业务层只依赖 AIMD 自己定义的请求和响应类型，不直接依赖任何第三方 LLM SDK。

### 设计原则

1. 上层抽象由 AIMD 自己掌握。

   第三方库只能作为 provider adapter 的实现细节，不能泄漏到 Docu-Tour、设置页或主业务逻辑。

2. DashScope 优先走官方 HTTP API。

   Rust 生态里的 `async-dashscope` 是非官方 SDK。它可以作为参考或后续评估对象，但默认不作为核心依赖。直接用 `reqwest` 调 DashScope 官方 HTTP API 更可控，也更接近“官方支持”。

3. `genai` 可作为非 DashScope provider 的实现候选。

   `genai` 可以用于 Gemini、OpenAI-compatible、Anthropic、Ollama、Groq、Together、OpenRouter 等 provider。但不能让 `genai` 决定 AIMD 的上层模型抽象。

4. Provider 扩展必须是插拔式。

   新增 provider 时，只新增 adapter，不改 Docu-Tour 业务流程。

5. 设置页只暴露产品概念。

   用户只看到 Provider、模型、API Key、API Base、导览生成设置。用户不应该看到底层用了哪个 Rust crate、HTTP endpoint、sidecar、Python 或 pip。

### 推荐模块结构

```text
apps/desktop/src-tauri/src/llm/
  mod.rs                  # provider trait、统一请求/响应、provider 分发
  dashscope.rs            # DashScope 官方 HTTP API adapter
  gemini.rs               # Gemini adapter，后续实现
  openai_compatible.rs    # OpenAI-compatible adapter，后续实现
```

### 建议统一接口

```rust
pub struct GenerateJsonRequest {
    pub system: String,
    pub user: serde_json::Value,
    pub max_steps: usize,
    pub temperature: f32,
}

pub struct GenerateJsonResponse {
    pub value: serde_json::Value,
}

#[async_trait]
pub trait LlmProvider {
    async fn generate_json(&self, request: GenerateJsonRequest) -> Result<GenerateJsonResponse, String>;
}
```

实际实现可以不完全照抄这个接口，但原则必须保留：业务层请求 JSON，provider 层负责把它翻译成各家 API 需要的格式，并把响应解析回统一 JSON。

### DashScope Adapter 方向

DashScope 采用官方 HTTP API：

```text
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation
```

国际版或代理通过 API Base 覆盖：

```text
https://dashscope-intl.aliyuncs.com/api/v1
https://dashscope-us.aliyuncs.com/api/v1
```

请求策略：

- 使用 `Authorization: Bearer <api_key>`。
- 使用 `result_format: "message"`。
- 尽量使用官方支持的 JSON 输出参数；如果模型返回 Markdown fence 或包裹文本，provider 层负责提取 JSON。
- 错误信息在 provider 层转成用户可读文案，不把原始 HTTP/SDK 噪音直接抛给界面。

### 为什么不用 LiteLLM 作为默认路径

- 用户不应该安装 Python / LiteLLM。
- 打包 Python runtime 会显著增大体积。
- sidecar 增加启动、依赖、权限、跨平台和安全复杂度。
- 设置页会被迫解释 LiteLLM、Python、pip 等实现细节。
- AIMD 当前主要需要可控的文档生成，不需要把完整模型网关内置进桌面 app。

### 为什么不直接把 `genai` 当总架构

`genai` 可以帮助接入多个 provider，但它不是 AIMD 的产品抽象。AIMD 需要自己的稳定接口，这样未来可以：

- 某个 provider 用 `genai`。
- 某个 provider 用官方 HTTP。
- 某个 provider 用专用 SDK。
- 某个 provider 被替换时不影响业务层。

### 后续扩展方式

新增 provider 的步骤：

1. 在配置类型里新增 provider 枚举值。
2. 新增 adapter 文件。
3. 在 provider 分发函数里注册。
4. 给设置页加 provider 选项。
5. 增加最小生成测试。

Docu-Tour 业务逻辑不应因为新增 provider 被改动。
