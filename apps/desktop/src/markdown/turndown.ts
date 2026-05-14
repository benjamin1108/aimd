import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndown.use(gfm);

const UI_ONLY_LINK_TITLES = new Set(["打开链接", "按住 Ctrl/⌘ 点击打开链接"]);

turndown.addRule("linkWithoutUiTitle", {
  filter: "a",
  replacement(content, node) {
    const anchor = node as Element;
    const href = anchor.getAttribute("href");
    if (!href) return content;
    const title = anchor.getAttribute("title") || "";
    const titleSuffix = title && !UI_ONLY_LINK_TITLES.has(title)
      ? ` "${title.replace(/"/g, '\\"')}"`
      : "";
    return `[${content}](${href}${titleSuffix})`;
  },
});

turndown.addRule("aimdImage", {
  filter: "img",
  replacement(_content, node) {
    const img = node as Element;
    const alt = img.getAttribute("alt") || "";
    const cid = img.getAttribute("data-asset-id");
    const markdownSrc = img.getAttribute("data-aimd-markdown-src");
    const localPath = img.getAttribute("data-aimd-local-image-path");
    const localSuffix = img.getAttribute("data-aimd-local-image-suffix") || "";
    const renderedSrc = img.getAttribute("src") || "";
    const src = cid
      ? `asset://${cid}`
      : (markdownSrc || (renderedSrc.startsWith("blob:") && localPath ? `${localPath}${localSuffix}` : renderedSrc));
    return `![${alt}](${src})`;
  },
});

turndown.addRule("strikethrough", {
  filter: ["s", "del", "strike"] as any,
  replacement: (content) => `~~${content}~~`,
});
