export type MarkdownCommand =
  | "bold"
  | "italic"
  | "strike"
  | "h1"
  | "h2"
  | "h3"
  | "paragraph"
  | "ul"
  | "ol"
  | "quote"
  | "code"
  | "codeblock"
  | "table"
  | "task";

export type MarkdownCommandInput = {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
};

export type MarkdownCommandResult = {
  markdown: string;
  replaceStart: number;
  replaceEnd: number;
  replacement: string;
  selectionStart: number;
  selectionEnd: number;
  status?: string;
};

type LineRange = {
  start: number;
  end: number;
  text: string;
};

function clampSelection(input: MarkdownCommandInput): MarkdownCommandInput {
  const max = input.markdown.length;
  const start = Math.max(0, Math.min(input.selectionStart, max));
  const end = Math.max(0, Math.min(input.selectionEnd, max));
  return {
    markdown: input.markdown,
    selectionStart: Math.min(start, end),
    selectionEnd: Math.max(start, end),
  };
}

function editResult(
  input: MarkdownCommandInput,
  replaceStart: number,
  replaceEnd: number,
  replacement: string,
  selectionStart: number,
  selectionEnd: number,
  status?: string,
): MarkdownCommandResult {
  const markdown = input.markdown.slice(0, replaceStart) + replacement + input.markdown.slice(replaceEnd);
  return { markdown, replaceStart, replaceEnd, replacement, selectionStart, selectionEnd, status };
}

function selectedText(input: MarkdownCommandInput): string {
  return input.markdown.slice(input.selectionStart, input.selectionEnd);
}

function inlineWrap(input: MarkdownCommandInput, marker: string, placeholder: string): MarkdownCommandResult {
  const selected = selectedText(input);
  if (!selected) {
    const replacement = `${marker}${placeholder}${marker}`;
    const cursorStart = input.selectionStart + marker.length;
    return editResult(
      input,
      input.selectionStart,
      input.selectionEnd,
      replacement,
      cursorStart,
      cursorStart + placeholder.length,
    );
  }
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const replacement = selected.slice(marker.length, selected.length - marker.length);
    return editResult(
      input,
      input.selectionStart,
      input.selectionEnd,
      replacement,
      input.selectionStart,
      input.selectionStart + replacement.length,
    );
  }
  const replacement = `${marker}${selected}${marker}`;
  return editResult(
    input,
    input.selectionStart,
    input.selectionEnd,
    replacement,
    input.selectionStart + marker.length,
    input.selectionStart + marker.length + selected.length,
  );
}

function currentLineRange(input: MarkdownCommandInput): LineRange {
  const anchorEnd = input.selectionEnd > input.selectionStart && input.markdown[input.selectionEnd - 1] === "\n"
    ? input.selectionEnd - 1
    : input.selectionEnd;
  const start = input.markdown.lastIndexOf("\n", Math.max(0, input.selectionStart - 1)) + 1;
  const nextBreak = input.markdown.indexOf("\n", anchorEnd);
  const end = nextBreak === -1 ? input.markdown.length : nextBreak;
  return { start, end, text: input.markdown.slice(start, end) };
}

function stripBlockPrefix(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}\s+/, "$1")
    .replace(/^(\s*)>\s?/, "$1")
    .replace(/^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "$1");
}

function transformSelectedLines(
  input: MarkdownCommandInput,
  transform: (line: string, index: number) => string,
): MarkdownCommandResult {
  const range = currentLineRange(input);
  const lines = range.text.split("\n");
  const replacement = lines.map(transform).join("\n");
  const deltaStart = input.selectionStart - range.start;
  const deltaEnd = input.selectionEnd - range.start;
  return editResult(
    input,
    range.start,
    range.end,
    replacement,
    Math.min(range.start + deltaStart, range.start + replacement.length),
    Math.min(range.start + deltaEnd, range.start + replacement.length),
  );
}

function withBlockPrefix(input: MarkdownCommandInput, prefixForLine: (index: number) => string): MarkdownCommandResult {
  return transformSelectedLines(input, (line, index) => {
    const body = stripBlockPrefix(line);
    if (!body.trim()) return `${prefixForLine(index)}`;
    return `${body.match(/^\s*/)?.[0] ?? ""}${prefixForLine(index)}${body.trimStart()}`;
  });
}

function heading(input: MarkdownCommandInput, level: 1 | 2 | 3): MarkdownCommandResult {
  const prefix = `${"#".repeat(level)} `;
  return withBlockPrefix(input, () => prefix);
}

function paragraph(input: MarkdownCommandInput): MarkdownCommandResult {
  return transformSelectedLines(input, stripBlockPrefix);
}

function task(input: MarkdownCommandInput): MarkdownCommandResult {
  const range = currentLineRange(input);
  const lines = range.text.split("\n");
  const allTasks = lines.every((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line) || !line.trim());
  const replacement = lines.map((line) => {
    if (!line.trim()) return "- [ ] ";
    if (allTasks) {
      return line.replace(/^(\s*[-*+]\s+\[)( |x|X)(\]\s+)/, (_match, start: string, mark: string, end: string) =>
        `${start}${mark.toLowerCase() === "x" ? " " : "x"}${end}`,
      );
    }
    const body = stripBlockPrefix(line);
    return `${body.match(/^\s*/)?.[0] ?? ""}- [ ] ${body.trimStart()}`;
  }).join("\n");
  return editResult(input, range.start, range.end, replacement, range.start, range.start + replacement.length);
}

function codeBlock(input: MarkdownCommandInput): MarkdownCommandResult {
  const selected = selectedText(input);
  if (!selected) {
    const replacement = "```text\ncode\n```";
    const codeStart = input.selectionStart + "```text\n".length;
    return editResult(input, input.selectionStart, input.selectionEnd, replacement, codeStart, codeStart + 4);
  }
  const replacement = `\`\`\`text\n${selected.replace(/\n?$/, "\n")}\`\`\``;
  return editResult(
    input,
    input.selectionStart,
    input.selectionEnd,
    replacement,
    input.selectionStart + "```text\n".length,
    input.selectionStart + replacement.length - "\n```".length,
  );
}

function table(input: MarkdownCommandInput): MarkdownCommandResult {
  const replacement = [
    "| 列 1 | 列 2 | 列 3 |",
    "| --- | --- | --- |",
    "| 内容 | 内容 | 内容 |",
    "| 内容 | 内容 | 内容 |",
  ].join("\n");
  const cursor = input.selectionStart + replacement.length;
  return editResult(input, input.selectionStart, input.selectionEnd, replacement, cursor, cursor);
}

export function runMarkdownCommand(command: MarkdownCommand, rawInput: MarkdownCommandInput): MarkdownCommandResult {
  const input = clampSelection(rawInput);
  switch (command) {
    case "bold": return inlineWrap(input, "**", "text");
    case "italic": return inlineWrap(input, "*", "text");
    case "strike": return inlineWrap(input, "~~", "text");
    case "code": return inlineWrap(input, "`", "code");
    case "h1": return heading(input, 1);
    case "h2": return heading(input, 2);
    case "h3": return heading(input, 3);
    case "paragraph": return paragraph(input);
    case "ul": return withBlockPrefix(input, () => "- ");
    case "ol": return withBlockPrefix(input, (index) => `${index + 1}. `);
    case "quote": return withBlockPrefix(input, () => "> ");
    case "task": return task(input);
    case "codeblock": return codeBlock(input);
    case "table": return table(input);
  }
}
