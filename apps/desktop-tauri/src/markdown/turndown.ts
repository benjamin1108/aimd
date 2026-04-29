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

turndown.addRule("aimdImage", {
  filter: "img",
  replacement(_content, node) {
    const img = node as Element;
    const alt = img.getAttribute("alt") || "";
    const cid = img.getAttribute("data-asset-id");
    const src = cid ? `asset://${cid}` : (img.getAttribute("src") || "");
    return `![${alt}](${src})`;
  },
});

turndown.addRule("strikethrough", {
  filter: ["s", "del", "strike"] as any,
  replacement: (content) => `~~${content}~~`,
});
