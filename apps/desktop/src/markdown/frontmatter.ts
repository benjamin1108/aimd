export type FrontmatterParts = {
  frontmatter: string;
  body: string;
};

export function splitFrontmatter(markdown: string): FrontmatterParts {
  const text = markdown.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { frontmatter: "", body: markdown };
  const end = lines.indexOf("---", 1);
  if (end < 1) return { frontmatter: "", body: markdown };
  const frontmatter = lines.slice(0, end + 1).join("\n");
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return { frontmatter, body };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  const fm = frontmatter.trim();
  const cleanBody = body.replace(/^\n+/, "");
  if (!fm) return cleanBody;
  return `${fm}\n\n${cleanBody}`;
}

export function hasFrontmatter(markdown: string): boolean {
  return Boolean(splitFrontmatter(markdown).frontmatter);
}
