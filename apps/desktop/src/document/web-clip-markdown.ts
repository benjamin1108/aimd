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

export function shouldAcceptRefinedMarkdown(
  raw: string,
  refined: string,
): { ok: true } | { ok: false; reason: string } {
  const rawChars = raw.trim().length;
  const refinedChars = refined.trim().length;
  const rawImages = countMarkdownImages(raw);
  const refinedImages = countMarkdownImages(refined);

  if (!refinedChars) {
    return { ok: false, reason: "模型返回空内容" };
  }
  if (rawImages > 0 && refinedImages === 0) {
    return { ok: false, reason: `模型删除了全部图片引用 (${rawImages} -> 0)` };
  }
  if (rawChars >= 3000 && refinedChars < Math.round(rawChars * 0.55)) {
    return { ok: false, reason: `模型输出疑似摘要化 (${rawChars} -> ${refinedChars} chars)` };
  }
  if (!hasAssistiveBlock(refined, "摘要")) {
    return { ok: false, reason: "缺少引用块摘要" };
  }
  if (!hasAssistiveBlock(refined, "核心观点")) {
    return { ok: false, reason: "缺少引用块核心观点" };
  }

  const bodyChars = countBodyChars(refined);
  const minBodyChars = rawChars >= 1200 ? Math.min(600, Math.round(rawChars * 0.25)) : 80;
  if (bodyChars < minBodyChars) {
    return { ok: false, reason: "正文不足，疑似只输出摘要和观点" };
  }

  const headingReasons = analyzeHeadingStructure(refined, raw);
  if (headingReasons.length > 0) {
    return { ok: false, reason: headingReasons[0] };
  }

  return { ok: true };
}

export function markUnfinishedSmartSections(markdown: string): string {
  const lines = markdown.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  const marker = [
    "",
    "> **未完成智能分章**",
    "> 智能排版结果未通过结构检查，已保留基础提取正文。",
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

function hasAssistiveBlock(markdown: string, label: "摘要" | "核心观点"): boolean {
  const pattern = new RegExp(`^>\\s*\\*\\*${label}\\*\\*`, "m");
  return pattern.test(markdown);
}

function countBodyChars(markdown: string): number {
  return stripCodeFences(markdown)
    .filter((line) => !/^\s*>/.test(line) && !/^#{1,6}\s+/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\s+/g, "")
    .length;
}

function markdownBodyText(markdown: string, options: { skipBlockquotes?: boolean } = {}): string {
  return stripCodeFences(markdown)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !options.skipBlockquotes || !/^\s*>/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]*]\([^)]+\)/g, "")
    .replace(/[>*_`#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyTextBeforeFirstH2(markdown: string, options: { skipBlockquotes?: boolean } = {}): string {
  const lines = stripCodeFences(markdown);
  const headings = markdownHeadings(markdown);
  const firstH1 = headings.find((heading) => heading.level === 1);
  const firstH2 = headings.find((heading) => heading.level === 2);
  const start = firstH1 ? firstH1.line + 1 : 0;
  const end = firstH2 ? firstH2.line : lines.length;
  return markdownBodyText(lines.slice(start, end).join("\n"), options);
}

function compactHeadingKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function headingsEquivalent(left: string, right: string): boolean {
  const a = compactHeadingKey(left);
  const b = compactHeadingKey(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
}

function analyzeHeadingStructure(markdown: string, raw: string): string[] {
  const headings = markdownHeadings(markdown);
  const rawHeadings = markdownHeadings(raw);
  const reasons: string[] = [];
  const h1Count = headings.filter((heading) => heading.level === 1).length;
  const h2Count = headings.filter((heading) => heading.level === 2).length;
  const genericTitles = new Set(["介绍", "背景", "总结", "概述", "正文", "主要内容"]);

  if (h1Count !== 1) reasons.push(`H1 数量应为 1，实际为 ${h1Count}`);
  if (raw.trim().length >= 1200 && h2Count < 1) reasons.push("缺少 H2 分章标题");
  if (raw.trim().length >= 3000 && h2Count < 2) reasons.push("长文需要多个 H2 分章");

  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1];
    const current = headings[i];
    if (current.level > prev.level + 1) {
      reasons.push(`标题层级跳跃: H${prev.level} 到 H${current.level}`);
      break;
    }
  }

  const firstH1 = headings.find((heading) => heading.level === 1);
  const firstH2 = headings.find((heading) => heading.level === 2);
  const rawFirstH2 = rawHeadings.find((heading) => heading.level === 2);
  if (firstH1 && firstH2 && firstH2.line > firstH1.line) {
    const refinedLeadChars = bodyTextBeforeFirstH2(markdown, { skipBlockquotes: true }).replace(/\s+/g, "").length;
    const rawLeadChars = bodyTextBeforeFirstH2(raw).replace(/\s+/g, "").length;
    if (refinedLeadChars > 900 && rawLeadChars < 300) reasons.push("H1 后存在过长正文且没有 H2 分章");
    if (
      rawLeadChars >= 300
      && refinedLeadChars < Math.min(240, Math.round(rawLeadChars * 0.35))
      && rawFirstH2
      && headingsEquivalent(rawFirstH2.text, firstH2.text)
    ) {
      reasons.push("原文第一个分章前的导语正文被删除");
    }
  }

  for (const heading of headings.filter((item) => item.level === 2 || item.level === 3)) {
    if (heading.text.length > 64) {
      reasons.push(`标题过长: ${heading.text.slice(0, 24)}`);
      break;
    }
    if (genericTitles.has(heading.text)) {
      reasons.push(`标题过于空泛: ${heading.text}`);
      break;
    }
  }

  return reasons;
}
