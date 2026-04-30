import { turndown } from "../markdown/turndown";

export function htmlToMarkdown(html: string): string {
  // Wrap in a div so turndown can iterate freely.
  const md = turndown.turndown(html.trim());
  // Normalize 3+ consecutive blank lines down to 2.
  return md.replace(/\n{3,}/g, "\n\n");
}
