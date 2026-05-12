import { originalImageURL } from "./injector-images";

export function fallbackExtractArticle(
  pageTitle: string,
  extractPageTitle: () => string,
): { title: string; content: string } | null {
  const root = document.querySelector("article")
    || document.querySelector("main")
    || document.querySelector('[role="main"]')
    || document.body;
  if (!root) return null;

  const blocks: string[] = [];
  const seen = new Set<string>();
  const selector = "h1,h2,h3,h4,p,li,blockquote,pre,img";
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (isNoiseElement(el)) return;
    if (el.tagName === "IMG") {
      const src = originalImageURL(el.getAttribute("src"))
        || originalImageURL(el.getAttribute("data-src"))
        || originalImageURL(el.getAttribute("data-aimd-original-src"));
      if (!src || seen.has(`img:${src}`)) return;
      seen.add(`img:${src}`);
      const alt = normalizeText(el.getAttribute("alt") || "");
      blocks.push(`<p><img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}"></p>`);
      return;
    }

    const text = normalizeText(el.textContent || "");
    if (text.length < 2) return;
    if (seen.has(text)) return;
    seen.add(text);
    if (looksLikeNoiseText(text)) return;

    const tag = el.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      const level = tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3";
      blocks.push(`<${level}>${escapeHTML(text)}</${level}>`);
    } else if (tag === "li") {
      blocks.push(`<ul><li>${escapeHTML(text)}</li></ul>`);
    } else if (tag === "blockquote") {
      blocks.push(`<blockquote><p>${escapeHTML(text)}</p></blockquote>`);
    } else if (tag === "pre") {
      blocks.push(`<pre><code>${escapeHTML(el.textContent || "")}</code></pre>`);
    } else {
      blocks.push(`<p>${escapeHTML(text)}</p>`);
    }
  });

  const title = pageTitle || extractPageTitle() || document.title || "网页草稿";
  const content = [`<h1>${escapeHTML(title)}</h1>`, ...blocks].join("\n");
  return normalizeText(blocks.join("")).length > 80 ? { title, content } : null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNoiseElement(el: Element): boolean {
  return Boolean(el.closest(
    ".aimd-clip-shell,nav,header,footer,aside,form,dialog,script,style,noscript,template,iframe,button,input,textarea,select,[role='navigation'],[role='banner'],[role='contentinfo'],[role='search'],[hidden],[aria-hidden='true']",
  ));
}

function looksLikeNoiseText(text: string): boolean {
  return /^(share|subscribe|sign in|sign up|read more|learn more|cookie|privacy|terms|all rights reserved)$/i.test(text)
    || /^\d+\s*(min|minutes?)\s+read$/i.test(text)
    || /^\d{1,2}:\d{2}$/.test(text);
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
