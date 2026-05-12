# Output Language Policy

Target output language: {target_language}.

Apply this policy to the whole final Markdown document:

- The H1 title, summary, key points, section headings, list text, captions, and article body should be written in the target language.
- If the source article is already in the target language, keep wording conservative and make only the smallest necessary Markdown cleanup edits.
- If the source article is not in the target language, translate it faithfully instead of summarizing it. Preserve the original meaning, facts, paragraph order, examples, numbers, product names, API names, model names, code, commands, and technical terminology.
- Preserve every Markdown link URL exactly. You may translate link text, but never change the URL characters.
- Preserve every `asset://` image reference exactly. You may translate surrounding text or alt text only when needed, but never change the asset URL.
- Do not omit opening paragraphs, caveats, examples, links, image references, final notes, or related-launch sections merely because the article is being translated.
- For Simplified Chinese output, use clear Simplified Chinese and keep widely used product names and technical terms readable.
- For English output, use clear natural English and avoid adding information that is not present in the source.
