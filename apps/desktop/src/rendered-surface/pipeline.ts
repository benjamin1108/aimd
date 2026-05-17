import type { OutlineNode } from "../core/types";
import {
  hydrateRenderedSurfaceImages,
  stripRenderedFrontmatter,
  tagAssetImages,
} from "./assets";
import {
  bindRenderedSurfaceInteractions,
  prepareRenderedSurfaceInteractions,
} from "./interactions";
import type { PaintRenderedSurfaceContext, RenderedSurfaceProfile } from "./types";

const surfaceCleanups = new WeakMap<HTMLElement, () => void>();

export function paintRenderedSurface(
  profile: RenderedSurfaceProfile,
  renderedHtml: string,
  context: PaintRenderedSurfaceContext,
) {
  const root = profile.root;
  surfaceCleanups.get(root)?.();
  surfaceCleanups.delete(root);

  root.dataset.renderedSurface = profile.kind;
  root.innerHTML = profile.stripFrontmatter
    ? stripRenderedFrontmatter(renderedHtml)
    : renderedHtml;
  normalizeRenderedSurfaceDOM(root);

  tagAssetImages(root, context.assets);
  prepareRenderedSurfaceInteractions(root, profile, context.callbacks);

  const cleanup = bindRenderedSurfaceInteractions(root, profile, context.callbacks);
  surfaceCleanups.set(root, cleanup);
  context.onPainted?.(profile);

  if (profile.hydrateMarkdownImages && context.markdownPath) {
    void hydrateRenderedSurfaceImages(root).then(() => {
      if (context.isHydrationCurrent && !context.isHydrationCurrent(profile)) return;
      context.onHydrated?.(profile);
    });
  }
}

export function normalizeRenderedHTML(html: string): { html: string; outline: OutlineNode[] } {
  const template = document.createElement("template");
  template.innerHTML = html;
  const outline: OutlineNode[] = [];
  let counter = 0;
  template.content.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach((heading) => {
    const level = Number(heading.tagName.slice(1));
    const text = (heading.textContent || "").trim();
    if (!text) return;
    const id = heading.id || `aimd-heading-${counter++}`;
    heading.id = id;
    outline.push({ id, text, level });
  });
  return { html: template.innerHTML, outline };
}

function normalizeRenderedSurfaceDOM(root: HTMLElement) {
  stripInterBlockWhitespaceText(root);
}

function stripInterBlockWhitespaceText(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const removable: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || node.data.trim()) continue;
    const parent = node.parentElement;
    if (!parent || !shouldStripWhitespaceText(parent)) continue;
    removable.push(node);
  }
  removable.forEach((node) => node.remove());
}

function shouldStripWhitespaceText(parent: HTMLElement): boolean {
  return !parent.closest("p,li,h1,h2,h3,h4,h5,h6,td,th,pre,code,kbd,samp");
}
