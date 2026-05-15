import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  readerEl, inlineEditorEl, previewEl, markdownEl,
  outlineSectionEl, outlineListEl,
} from "../core/dom";
import type { Mode, OpenDocumentTab, OutlineNode, RenderResult } from "../core/types";
import { escapeAttr, escapeHTML } from "../util/escape";
import { clearStatusOverride, setStatus, setStatusOverride, updateChrome } from "./chrome";
import { persistSessionSnapshot } from "../session/snapshot";
import { renderDocPanelTabs } from "./doc-panel";
import { createSourceModel } from "../editor/source-preserve";
import {
  activeTab,
  bindFacadeFromTab,
  findTab,
  syncActiveTabFromFacade,
  tabHTMLMatchesMarkdown,
} from "../document/open-document-state";
import { openLightbox } from "./lightbox";
import { rewriteRenderedSurfaceAssets } from "../rendered-surface/assets";
import { paintRenderedSurface, normalizeRenderedHTML } from "../rendered-surface/pipeline";
import {
  previewSurfaceProfile,
  readerSurfaceProfile,
  visualEditorSurfaceProfile,
} from "../rendered-surface/profiles";
import type { PaintRenderedSurfaceContext, RenderedSurfaceCallbacks, RenderedSurfaceProfile } from "../rendered-surface/types";
import { commitMarkdownChange } from "../document/markdown-mutation";

const LINK_HINT_STATUS_ACTION = "link-hover-hint";
const paintedSurfaceTabIds: Record<Mode, string | null> = { read: null, edit: null, source: null };

type RenderTask = {
  tabId: string;
  markdownVersion: number;
  markdown: string;
  path: string;
  format: "aimd" | "markdown";
  isDraft: boolean;
};

export function scheduleRender(tabId = state.openDocuments.activeTabId || "", options: { immediate?: boolean } = {}) {
  const tab = findTab(tabId);
  if (!tab) return;
  if (tab.renderTimer) window.clearTimeout(tab.renderTimer);
  const task = renderTaskForTab(tab);
  tab.pendingRenderVersion = task.markdownVersion;
  tab.renderErrorVersion = null;
  reflectRenderStateIfActive(tab);
  tab.renderTimer = window.setTimeout(() => {
    tab.renderTimer = null;
    reflectRenderStateIfActive(tab);
    void renderPreviewTask(task);
  }, options.immediate ? 0 : 220);
}

export async function renderPreview(tabId = state.openDocuments.activeTabId || ""): Promise<boolean> {
  const tab = findTab(tabId);
  if (!tab) return false;
  if (tab.renderTimer) {
    window.clearTimeout(tab.renderTimer);
    tab.renderTimer = null;
  }
  const task = renderTaskForTab(tab);
  tab.pendingRenderVersion = task.markdownVersion;
  tab.renderErrorVersion = null;
  reflectRenderStateIfActive(tab);
  return renderPreviewTask(task);
}

export async function ensureCanonicalHTMLForTab(tabId = state.openDocuments.activeTabId || ""): Promise<boolean> {
  const tab = findTab(tabId);
  if (!tab) return false;
  if (tabHTMLMatchesMarkdown(tab)) return true;
  return renderPreview(tab.id);
}

export function activeHTMLMatchesMarkdown(): boolean {
  const tab = activeTab();
  return Boolean(tab && tabHTMLMatchesMarkdown(tab));
}

function renderTaskForTab(tab: OpenDocumentTab): RenderTask {
  return {
    tabId: tab.id,
    markdownVersion: tab.markdownVersion,
    markdown: tab.doc.markdown,
    path: tab.doc.path,
    format: tab.doc.format,
    isDraft: Boolean(tab.doc.isDraft),
  };
}

async function renderPreviewTask(task: RenderTask): Promise<boolean> {
  try {
    const out = task.path && !task.isDraft && task.format !== "markdown"
      ? await invoke<RenderResult>("render_markdown", {
        path: task.path,
        markdown: task.markdown,
      })
      : await invoke<RenderResult>("render_markdown_standalone", {
        markdown: task.markdown,
      });
    const tab = findTab(task.tabId);
    if (!renderTaskStillCurrent(tab, task)) return false;
    applyHTMLToTab(tab, out.html, task.markdownVersion);
    return true;
  } catch (err) {
    const tab = findTab(task.tabId);
    if (!renderTaskStillCurrent(tab, task)) return false;
    tab.pendingRenderVersion = null;
    tab.renderErrorVersion = task.markdownVersion;
    reflectRenderStateIfActive(tab);
    console.error(err);
    if (state.openDocuments.activeTabId === tab.id) setStatus("预览更新失败", "warn");
    return false;
  }
}

function renderTaskStillCurrent(tab: OpenDocumentTab | null, task: RenderTask): tab is OpenDocumentTab {
  return Boolean(
    tab
    && tab.markdownVersion === task.markdownVersion
    && tab.doc.markdown === task.markdown
    && tab.doc.path === task.path
    && tab.doc.format === task.format
    && Boolean(tab.doc.isDraft) === task.isDraft,
  );
}

export function applyHTML(html: string, markdownVersion = activeTab()?.markdownVersion ?? 0) {
  const tab = activeTab();
  if (!tab) return;
  applyHTMLToTab(tab, html, markdownVersion);
}

function applyHTMLToTab(tab: OpenDocumentTab, html: string, markdownVersion: number) {
  if (!tab.sourceModel || tab.sourceModel.markdown !== tab.doc.markdown) {
    tab.sourceModel = createSourceModel(tab.doc.markdown);
    tab.sourceDirtyRefs.clear();
    tab.sourceStructuralDirty = false;
  }
  const rendered = rewriteRenderedSurfaceAssets(html, {
    assets: tab.doc.assets,
    markdownPath: markdownPathForTab(tab),
  });
  const canonical = normalizeRenderedHTML(rendered);
  tab.htmlVersion += 1;
  tab.doc.html = canonical.html;
  tab.outline = canonical.outline;
  tab.htmlMarkdownVersion = markdownVersion;
  if (tab.pendingRenderVersion === markdownVersion) tab.pendingRenderVersion = null;
  tab.renderErrorVersion = null;

  if (state.openDocuments.activeTabId === tab.id) {
    bindFacadeFromTab(tab);
    paintCurrentModeSurface(state.htmlVersion);
    renderOutline();
    syncActiveTabFromFacade();
  }
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

function profileForMode(mode: Mode): RenderedSurfaceProfile {
  if (mode === "edit") return visualEditorSurfaceProfile();
  if (mode === "source") return previewSurfaceProfile();
  return readerSurfaceProfile();
}

function paintCurrentModeSurface(version: number) {
  if (state.mode === "edit" && state.inlineDirty) return;
  if (state.mode === "source") {
    paintDocumentSurface(previewSurfaceProfile(), version);
    paintDocumentSurface(readerSurfaceProfile(), version);
    return;
  }
  paintDocumentSurface(profileForMode(state.mode), version);
}

export function paintPaneIfStale(mode: Mode) {
  if (!state.doc) return;
  if (!activeHTMLMatchesMarkdown()) {
    paintSyncPlaceholder(mode);
    scheduleRender(state.openDocuments.activeTabId || "", { immediate: true });
    return;
  }
  if (mode === "edit" && state.inlineDirty) return;
  if (
    state.paintedVersion[mode] === state.htmlVersion
    && paintedSurfaceTabIds[mode] === state.openDocuments.activeTabId
  ) return;
  paintDocumentSurface(profileForMode(mode), state.htmlVersion);
}

function paintSyncPlaceholder(mode: Mode) {
  state.paintedVersion[mode] = -1;
  paintedSurfaceTabIds[mode] = null;
  const root = mode === "edit"
    ? inlineEditorEl()
    : (mode === "source" ? previewEl() : readerEl());
  root.contentEditable = "false";
  root.dataset.renderedSurface = mode === "edit" ? "visual-editor" : (mode === "source" ? "preview" : "reader");
  root.setAttribute("aria-busy", "true");
  root.innerHTML = `<div class="surface-sync-placeholder">正在同步最新内容…</div>`;
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
      if (profile.paintVersionKey) paintedSurfaceTabIds[profile.paintVersionKey] = tabId;
      if (profile.kind === "visual-editor" && !state.inlineDirty) state.inlineDirty = false;
      profile.root.removeAttribute("aria-busy");
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
  const tab = activeTab();
  return tab ? markdownPathForTab(tab) : undefined;
}

function markdownPathForTab(tab: OpenDocumentTab): string | undefined {
  return tab.doc.format === "markdown" && tab.doc.path ? tab.doc.path : undefined;
}

function reflectRenderStateIfActive(tab: OpenDocumentTab) {
  if (state.openDocuments.activeTabId !== tab.id) return;
  state.pendingRenderVersion = tab.pendingRenderVersion;
  state.renderErrorVersion = tab.renderErrorVersion;
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
  commitMarkdownChange({
    markdown: next,
    origin: "task-toggle",
    updateSourceTextarea: true,
  });
  markdownEl().value = next;
  updateChrome();
}
