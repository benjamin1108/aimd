import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  readerEl, inlineEditorEl, previewEl,
  outlineSectionEl, outlineListEl,
} from "../core/dom";
import type { AimdAsset, Mode, OutlineNode, RenderResult } from "../core/types";
import { hydrateMarkdownLocalImages, rewriteAssetURLs, rewriteMarkdownLocalImageURLs } from "../document/assets";
import { escapeAttr, escapeHTML } from "../util/escape";
import { setStatus } from "./chrome";
import { persistSessionSnapshot } from "../session/snapshot";
import { enhanceRenderedDocument } from "../editor/interactive";
import { renderDocPanelTabs } from "./doc-panel";
import { annotateSourceBlocks, createSourceModel } from "../editor/source-preserve";

export function scheduleRender() {
  if (state.renderTimer) window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderPreview, 220);
}

export async function renderPreview() {
  if (!state.doc) return;
  try {
    const out = state.doc.path && !state.doc.isDraft && state.doc.format !== "markdown"
      ? await invoke<RenderResult>("render_markdown", {
        path: state.doc.path,
        markdown: state.doc.markdown,
      })
      : await invoke<RenderResult>("render_markdown_standalone", {
        markdown: state.doc.markdown,
      });
    applyHTML(out.html);
  } catch (err) {
    console.error(err);
    setStatus("预览更新失败", "warn");
  }
}

export function applyHTML(html: string) {
  if (state.doc && state.sourceModel?.markdown !== state.doc.markdown) {
    state.sourceModel = createSourceModel(state.doc.markdown);
    state.sourceDirtyRefs.clear();
    state.sourceStructuralDirty = false;
  }
  const shouldHydrateMarkdownImages = state.doc?.format === "markdown" && Boolean(state.doc.path);
  const withMarkdownImages = state.doc?.format === "markdown" && state.doc.path
    ? rewriteMarkdownLocalImageURLs(html, state.doc.path)
    : html;
  const renderedHTML = state.doc ? rewriteAssetURLs(withMarkdownImages, state.doc.assets) : withMarkdownImages;
  state.htmlVersion += 1;
  previewEl().innerHTML = renderedHTML;
  readerEl().innerHTML = renderedHTML;
  state.paintedVersion.read = state.htmlVersion;
  state.paintedVersion.source = state.htmlVersion;
  if (state.mode === "edit" && state.doc) {
    const tmp = document.createElement("div");
    tmp.innerHTML = renderedHTML;
    tmp.querySelectorAll(".aimd-frontmatter").forEach((el) => el.remove());
    inlineEditorEl().innerHTML = tmp.innerHTML;
    tagAssetImages(inlineEditorEl(), state.doc.assets);
    if (state.sourceModel) annotateSourceBlocks(inlineEditorEl(), state.sourceModel);
    state.paintedVersion.edit = state.htmlVersion;
    state.inlineDirty = false;
  }
  if (state.doc) {
    tagAssetImages(readerEl(), state.doc.assets);
    tagAssetImages(previewEl(), state.doc.assets);
    enhanceRenderedDocument(readerEl(), { codeCopy: true, taskToggle: true, linkOpen: "plain" });
    enhanceRenderedDocument(previewEl(), { codeCopy: true, taskToggle: true, linkOpen: "plain" });
    enhanceRenderedDocument(inlineEditorEl(), { taskToggle: true, linkOpen: "modifier" });
    if (shouldHydrateMarkdownImages) {
      void Promise.all([
        hydrateMarkdownLocalImages(readerEl()),
        hydrateMarkdownLocalImages(previewEl()),
        hydrateMarkdownLocalImages(inlineEditorEl()),
      ]).then(() => {
        if (state.doc) state.doc.html = readerEl().innerHTML;
      });
    }
  }
  state.outline = extractOutlineFromHTML(renderedHTML);
  if (state.doc) {
    state.doc.html = previewEl().innerHTML;
  }
  renderOutline();
  persistSessionSnapshot();
}

export function tagAssetImages(container: HTMLElement, assets: AimdAsset[]) {
  if (!assets.length) return;
  const map = new Map<string, string>();
  for (const a of assets) {
    if (a.url) map.set(a.url, a.id);
  }
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const id = map.get(src);
    if (id) img.dataset.assetId = id;
  });
}

export function extractOutlineFromHTML(html: string): OutlineNode[] {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const nodes: OutlineNode[] = [];
  const headings = tmp.querySelectorAll("h1, h2, h3, h4");
  let counter = 0;
  headings.forEach((h) => {
    const tag = h.tagName.toLowerCase();
    const level = Number(tag.slice(1));
    const text = (h.textContent || "").trim();
    if (!text) return;
    const id = h.id || `aimd-heading-${counter++}`;
    if (!h.id) h.id = id;
    nodes.push({ id, text, level });
  });
  syncHeadingIds(readerEl(), tmp);
  syncHeadingIds(previewEl(), tmp);
  syncHeadingIds(inlineEditorEl(), tmp);
  return nodes;
}

export function syncHeadingIds(target: HTMLElement, source: HTMLElement) {
  const targetH = target.querySelectorAll("h1, h2, h3, h4");
  const sourceH = source.querySelectorAll("h1, h2, h3, h4");
  targetH.forEach((node, i) => {
    const id = sourceH[i]?.id;
    if (id) (node as HTMLElement).id = id;
  });
}

export function renderOutline() {
  if (!state.doc) {
    outlineListEl().innerHTML = `<div class="empty-list">未打开文档</div>`;
    renderDocPanelTabs();
    return;
  }
  outlineSectionEl().hidden = false;
  if (!state.outline.length) {
    outlineListEl().innerHTML = `<div class="empty-list">未发现标题</div>`;
    renderDocPanelTabs();
    return;
  }
  const minLevel = Math.min(...state.outline.map((n) => n.level));
  outlineListEl().innerHTML = state.outline
    .map((node) => {
      const indent = node.level - minLevel;
      return `<button class="outline-item" data-id="${escapeAttr(node.id)}" data-indent="${indent}" type="button" title="${escapeAttr(node.text)}"><span class="outline-bullet"></span><span class="outline-text">${escapeHTML(node.text)}</span></button>`;
    })
    .join("");
  outlineListEl().querySelectorAll<HTMLButtonElement>(".outline-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const target = currentScrollPane().querySelector(`#${CSS.escape(id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  renderDocPanelTabs();
}

export function currentScrollPane(): HTMLElement {
  if (state.mode === "edit") return inlineEditorEl();
  if (state.mode === "source") return previewEl();
  return readerEl();
}

export function paintPaneIfStale(mode: Mode) {
  if (!state.doc) return;
  if (state.paintedVersion[mode] === state.htmlVersion) return;
  if (mode === "edit") {
    const tmpEdit = document.createElement("div");
    tmpEdit.innerHTML = state.doc.html;
    tmpEdit.querySelectorAll(".aimd-frontmatter").forEach((el) => el.remove());
    inlineEditorEl().innerHTML = tmpEdit.innerHTML;
    tagAssetImages(inlineEditorEl(), state.doc.assets);
    if (state.sourceModel) annotateSourceBlocks(inlineEditorEl(), state.sourceModel);
    enhanceRenderedDocument(inlineEditorEl(), { taskToggle: true, linkOpen: "modifier" });
    if (state.doc.format === "markdown") void hydrateMarkdownLocalImages(inlineEditorEl());
    state.inlineDirty = false;
  } else if (mode === "read") {
    readerEl().innerHTML = state.doc.html;
    tagAssetImages(readerEl(), state.doc.assets);
    enhanceRenderedDocument(readerEl(), { codeCopy: true, taskToggle: true, linkOpen: "plain" });
    if (state.doc.format === "markdown") void hydrateMarkdownLocalImages(readerEl());
  } else {
    previewEl().innerHTML = state.doc.html;
    tagAssetImages(previewEl(), state.doc.assets);
    enhanceRenderedDocument(previewEl(), { codeCopy: true, taskToggle: true, linkOpen: "plain" });
    if (state.doc.format === "markdown") void hydrateMarkdownLocalImages(previewEl());
  }
  state.paintedVersion[mode] = state.htmlVersion;
}
