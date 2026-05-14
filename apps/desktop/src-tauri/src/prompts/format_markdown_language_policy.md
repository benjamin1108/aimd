Output Language Policy:

- Target output language: {target_language}.
- When `needed=false`, do not translate or rewrite the document.
- When `needed=true`, YAML field `language` should be `{language_code}` if the formatted body is in the target language.
- If you change the output language, preserve the complete meaning faithfully.
- Do not translate only headings, summary, or key points while leaving the body mixed.
- Keep links, asset:// URLs, code, commands, product names, model names, numbers, and table meaning intact.
