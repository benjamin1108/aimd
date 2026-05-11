import { markdownEl, markdownHighlightEl } from "../core/dom";
import { escapeHTML } from "../util/escape";

export function bindSourceHighlight() {
  markdownEl().addEventListener("input", refreshSourceHighlight);
  markdownEl().addEventListener("scroll", syncSourceHighlightScroll);
  refreshSourceHighlight();
}

export function refreshSourceHighlight() {
  const value = markdownEl().value;
  markdownHighlightEl().innerHTML = highlightMarkdown(value);
  syncSourceHighlightScroll();
}

function syncSourceHighlightScroll() {
  const src = markdownEl();
  const dst = markdownHighlightEl();
  dst.scrollTop = src.scrollTop;
  dst.scrollLeft = src.scrollLeft;
}

function highlightMarkdown(value: string): string {
  const lines = value.split("\n");
  let inCode = false;
  const html = lines.map((line) => {
    const escaped = escapeHTML(line) || " ";
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return `<span class="md-code-fence">${escaped}</span>`;
    }
    if (inCode) return `<span class="md-code">${escaped}</span>`;
    if (/^\s{0,3}#{1,6}\s/.test(line)) return `<span class="md-heading">${escaped}</span>`;
    if (/^\s{0,3}>\s?/.test(line)) return `<span class="md-quote">${escaped}</span>`;
    if (/^\s{0,3}([-*+]|\d+\.)\s/.test(line)) return `<span class="md-list">${escaped}</span>`;
    if (/^\s*\|.*\|\s*$/.test(line)) return `<span class="md-table">${escaped}</span>`;
    if (/!\[[^\]]*\]\([^)]+\)/.test(line)) return `<span class="md-image">${escaped}</span>`;
    return escaped;
  }).join("\n");
  return `${html}\n`;
}
