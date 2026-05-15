import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  readerEl, inlineEditorEl, previewEl, markdownEl,
  outlineSectionEl, outlineListEl,
} from "../core/dom";
import type { Mode, OutlineNode, RenderResult } from "../core/types";
import { escapeAttr, escapeHTML } from "../util/escape";
import { clearStatusOverride, setStatus, setStatusOverride, updateChrome } from "./chrome";
import { persistSessionSnapshot } from "../session/snapshot";
import { renderDocPanelTabs } from "./doc-panel";
import { createSourceModel } from "../editor/source-preserve";
import { beginTabOperation, isActiveOperationCurrent, syncActiveTabFromFacade } from "../document/open-document-state";
import { openLightbox } from "./lightbox";
import { rewriteRenderedSurfaceAssets } from "../rendered-surface/assets";
import { paintRenderedSurface, normalizeRenderedHTML } from "../rendered-surface/pipeline";
import {
  previewSurfaceProfile,
  readerSurfaceProfile,
  visualEditorSurfaceProfile,
} from "../rendered-surface/profiles";
import type { PaintRenderedSurfaceContext, RenderedSurfaceCallbacks, RenderedSurfaceProfile } from "../rendered-surface/types";

const LINK_HINT_STATUS_ACTION = "link-hover-hint";

export function scheduleRender() {
  if (state.renderTimer) window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderPreview, 220);
}

export async function renderPreview() {
  if (!state.doc) return;
  const target = beginTabOperation();
  try {
    const out = state.doc.path && !state.doc.isDraft && state.doc.format !== "markdown"
      ? await invoke<RenderResult>("render_markdown", {
        path: state.doc.path,
        markdown: state.doc.markdown,
      })
      : await invoke<RenderResult>("render_markdown_standalone", {
        markdown: state.doc.markdown,
      });
    if (!isActiveOperationCurrent(target)) return;
    applyHTML(out.html);
  } catch (err) {
    if (!isActiveOperationCurrent(target)) return;
    console.error(err);
    setStatus("预览更新失败", "warn");
  }
}

export function applyHTML(html: string) {
  if (!state.doc) return;
  if (!state.sourceModel || state.sourceModel.markdown !== state.doc.markdown) {
    state.sourceModel = createSourceModel(state.doc.markdown);
    state.sourceDirtyRefs.clear();
    state.sourceStructuralDirty = false;
  }
  const rendered = rewriteRenderedSurfaceAssets(html, {
    assets: state.doc.assets,
    markdownPath: activeMarkdownPath(),
  });
  const canonical = normalizeRenderedHTML(rendered);
  state.htmlVersion += 1;
  state.doc.html = canonical.html;
  state.outline = canonical.outline;
  paintDocumentSurface(readerSurfaceProfile(), state.htmlVersion);
  paintDocumentSurface(previewSurfaceProfile(), state.htmlVersion);
  if (state.mode === "edit") paintDocumentSurface(visualEditorSurfaceProfile(), state.htmlVersion);
  renderOutline();
  syncActiveTabFromFacade();
  persistSessionSnapshot();
}

export function extractOutlineFromHTML(html: string): OutlineNode[] {
  return normalizeRenderedHTML(html).outline;
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
  const profile = mode === "edit"
    ? visualEditorSurfaceProfile()
    : (mode === "source" ? previewSurfaceProfile() : readerSurfaceProfile());
  paintDocumentSurface(profile, state.htmlVersion);
}

function paintDocumentSurface(profile: RenderedSurfaceProfile, version: number) {
  if (!state.doc) return;
  paintRenderedSurface(profile, state.doc.html, renderedSurfaceContext(version));
}

function renderedSurfaceContext(version: number): PaintRenderedSurfaceContext {
  const tabId = state.openDocuments.activeTabId;
  return {
    assets: state.doc?.assets ?? [],
    callbacks: documentSurfaceCallbacks(),
    htmlVersion: version,
    markdownPath: activeMarkdownPath(),
    sourceModel: state.sourceModel,
    tabId,
    onPainted: (profile) => {
      if (profile.paintVersionKey) state.paintedVersion[profile.paintVersionKey] = version;
      if (profile.kind === "visual-editor") state.inlineDirty = false;
    },
    onHydrated: () => {
      if (state.doc && state.openDocuments.activeTabId === tabId && state.htmlVersion === version) {
        syncActiveTabFromFacade();
      }
    },
    isHydrationCurrent: () => Boolean(
      state.doc
      && state.openDocuments.activeTabId === tabId
      && state.htmlVersion === version,
    ),
  };
}

function activeMarkdownPath(): string | undefined {
  return state.doc?.format === "markdown" && state.doc.path ? state.doc.path : undefined;
}

function documentSurfaceCallbacks(): RenderedSurfaceCallbacks {
  return {
    openExternalUrl,
    openImage: openLightbox,
    toggleTask: toggleTaskMarkdown,
    showLinkHint: () => setStatusOverride("按 Ctrl/⌘ 点击打开链接", "info", LINK_HINT_STATUS_ACTION, true),
    clearLinkHint: () => clearStatusOverride(LINK_HINT_STATUS_ACTION, true),
    setStatus,
  };
}

async function openExternalUrl(url: string) {
  try {
    await invoke("open_external_url", { url });
  } catch (err) {
    setStatus(`打开链接失败: ${String(err)}`, "warn");
  }
}

function toggleTaskMarkdown(index: number) {
  if (!state.doc || index < 0) return;
  const re = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+.*)$/gm;
  let seen = -1;
  const next = state.doc.markdown.replace(re, (full, start: string, mark: string, end: string) => {
    seen += 1;
    if (seen !== index) return full;
    return `${start}${mark.toLowerCase() === "x" ? " " : "x"}${end}`;
  });
  if (next === state.doc.markdown) return;
  state.doc.markdown = next;
  state.doc.dirty = true;
  markdownEl().value = next;
  updateChrome();
  scheduleRender();
}
