export function countMarkdownImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
}

export function normalizeMarkdownTitle(markdown: string, title: string): string {
  const cleanTitle = normalizeHeadingText(title) || "网页草稿";
  const lines = markdown.replace(/\r\n/g, "\n").trim().split("\n");
  let inFence = false;
  let seenH1 = false;
  let hasHeading = false;
  const nextLines = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return line;
    hasHeading = true;
    const text = normalizeHeadingText(match[2]);
    if (match[1].length !== 1) return line;
    if (!seenH1) {
      seenH1 = true;
      return `# ${text || cleanTitle}`;
    }
    return `## ${text || cleanTitle}`;
  });

  const normalized = nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (hasHeading && seenH1) return normalized;
  return `# ${cleanTitle}\n\n${normalized}`.trim();
}

export function cleanBasicMarkdown(markdown: string, title: string): string {
  return ensureBasicSections(normalizeMarkdownTitle(markdown, title))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markUnfinishedSmartSections(markdown: string): string {
  const lines = markdown.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  const marker = [
    "",
    "> **未完成智能分章**",
    "> 智能排版未完成，已保留基础提取正文。",
  ];
  if (h1Index >= 0) {
    lines.splice(h1Index + 1, 0, ...marker);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return [...marker, "", markdown].join("\n").trim();
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+#*$/, "");
}

function stripCodeFences(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

function markdownHeadings(markdown: string): Array<{ level: number; text: string; line: number }> {
  const lines = stripCodeFences(markdown);
  const headings: Array<{ level: number; text: string; line: number }> = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    headings.push({ level: match[1].length, text: normalizeHeadingText(match[2]), line: index });
  });
  return headings;
}

function ensureBasicSections(markdown: string): string {
  const headings = markdownHeadings(markdown);
  if (headings.some((heading) => heading.level === 2)) return markdown;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstH1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (firstH1Index < 0) return markdown;
  const body = lines.slice(firstH1Index + 1).join("\n").trim();
  if (!body) return markdown;
  lines.splice(firstH1Index + 1, 0, "", "## 正文");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
