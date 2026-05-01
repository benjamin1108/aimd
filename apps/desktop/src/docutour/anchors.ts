import type { DocuTourAnchor } from "../core/types";

const TARGET_SELECTOR = "h1, h2, h3, h4, table, img, blockquote, pre";

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
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
    .map((el) => ({
      id: el.id,
      kind: kindFor(el),
      text: textFor(el),
    }))
    .filter((anchor) => anchor.id && anchor.text);
}
