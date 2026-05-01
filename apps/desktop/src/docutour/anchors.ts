import type { DocuTourAnchor } from "../core/types";

const TARGET_SELECTOR = "h1, h2, h3, h4, table, img, blockquote, pre";

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

function compactContext(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function kindFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-4]$/.test(tag)) return `heading-${tag.slice(1)}`;
  if (tag === "img") return "image";
  return tag;
}

function textFor(el: Element): string {
  if (el instanceof HTMLImageElement) {
    return compactText(el.alt || el.title || "image");
  }
  return compactText(el.textContent || kindFor(el));
}

function headingLevel(el: Element): number {
  const match = /^h([1-4])$/i.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}

function headingPathFor(el: HTMLElement): string[] {
  const headings = Array.from(
    el.ownerDocument.querySelectorAll<HTMLElement>("h1, h2, h3, h4")
  ).filter((heading) => !heading.closest(".aimd-frontmatter"));
  const path: HTMLElement[] = [];
  for (const heading of headings) {
    if (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) continue;
    if (heading === el || heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const level = headingLevel(heading);
      while (path.length && headingLevel(path[path.length - 1]) >= level) path.pop();
      path.push(heading);
    }
    if (heading === el) break;
  }
  return path.map((heading) => compactText(heading.textContent || "")).filter(Boolean);
}

function nearbyTextFor(el: HTMLElement): string {
  const chunks: string[] = [];
  let node = el.nextElementSibling;
  while (node && chunks.join(" ").length < 900) {
    if (/^h[1-4]$/i.test(node.tagName)) break;
    if (node.closest(".aimd-frontmatter")) {
      node = node.nextElementSibling;
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (tag === "p" || tag === "li" || tag === "blockquote" || tag === "pre") {
      const text = compactContext(node.textContent || "");
      if (text) chunks.push(text);
    } else if (tag === "table") {
      const headers = Array.from(node.querySelectorAll("th"))
        .slice(0, 8)
        .map((th) => compactText(th.textContent || ""))
        .filter(Boolean);
      chunks.push(headers.length ? `表格字段：${headers.join("、")}` : "包含一张表格");
    } else if (tag === "img" && node instanceof HTMLImageElement) {
      chunks.push(compactText(node.alt || node.title || "包含一张图片"));
    }
    node = node.nextElementSibling;
  }
  return compactContext(chunks.join(" "));
}

function signalsFor(el: HTMLElement) {
  const untilNextHeading: Element[] = [];
  let node = el.nextElementSibling;
  while (node) {
    if (/^h[1-4]$/i.test(node.tagName)) break;
    untilNextHeading.push(node);
    node = node.nextElementSibling;
  }
  return {
    hasTable: el.tagName.toLowerCase() === "table" || untilNextHeading.some((n) => n.tagName.toLowerCase() === "table"),
    hasImage: el.tagName.toLowerCase() === "img" || untilNextHeading.some((n) => n.tagName.toLowerCase() === "img"),
    hasCode: el.tagName.toLowerCase() === "pre" || untilNextHeading.some((n) => n.tagName.toLowerCase() === "pre"),
  };
}

export function assignDocuTourAnchors(container: HTMLElement) {
  let index = 0;
  container.querySelectorAll<HTMLElement>(TARGET_SELECTOR).forEach((el) => {
    if (el.closest(".aimd-frontmatter")) return;
    if (!el.id) {
      el.id = `aimd-tour-${kindFor(el).replace(/[^a-z0-9]+/g, "-")}-${index}`;
    }
    el.dataset.docutourTarget = "true";
    index += 1;
  });
}

export function collectDocuTourAnchors(container: HTMLElement): DocuTourAnchor[] {
  assignDocuTourAnchors(container);
  return Array.from(container.querySelectorAll<HTMLElement>("[data-docutour-target='true']"))
    .map((el, position) => ({
      id: el.id,
      kind: kindFor(el),
      text: textFor(el),
      path: headingPathFor(el),
      nearbyText: nearbyTextFor(el),
      position,
      signals: signalsFor(el),
    }))
    .filter((anchor) => anchor.id && anchor.text);
}
