import type { AimdAsset } from "../core/types";
import { hydrateMarkdownLocalImages, rewriteAssetURLs, rewriteMarkdownLocalImageURLs } from "../document/assets";

export function rewriteRenderedSurfaceAssets(
  html: string,
  context: { assets: AimdAsset[]; markdownPath?: string },
): string {
  const withMarkdownImages = context.markdownPath
    ? rewriteMarkdownLocalImageURLs(html, context.markdownPath)
    : html;
  return rewriteAssetURLs(withMarkdownImages, context.assets);
}

export function stripRenderedFrontmatter(html: string): string {
  if (!html.includes("aimd-frontmatter")) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll(".aimd-frontmatter").forEach((el) => el.remove());
  return template.innerHTML;
}

export function tagAssetImages(container: HTMLElement, assets: AimdAsset[]) {
  if (!assets.length) return;
  const map = new Map<string, string>();
  for (const asset of assets) {
    if (asset.url) map.set(asset.url, asset.id);
  }
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const id = map.get(src);
    if (id) img.dataset.assetId = id;
  });
}

export async function hydrateRenderedSurfaceImages(root: HTMLElement) {
  await hydrateMarkdownLocalImages(root);
}
