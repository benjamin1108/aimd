输出语言策略：

- 目标输出语言：{target_language}。
- `reason` 使用目标输出语言。
- 当 `needed=false` 时，不要翻译或改写文档正文。
- 当 `needed=true` 时，正文原则上使用目标输出语言；如果原文语言与目标语言不同，必须完整忠实翻译，而不是只翻译标题、摘要或关键点。
- 如果输出 YAML frontmatter，`language` 字段在正文使用目标语言时应为 `{language_code}`。
- 链接、`asset://` URL、代码、命令、产品名、模型名、数字和表格语义必须保持不变。
