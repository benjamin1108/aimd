import { invoke } from "@tauri-apps/api/core";
import {
  editorWrapEl,
  emptyEl,
  formatToolbarEl,
  gitDiffContentEl,
  gitDiffViewEl,
  inlineEditorEl,
  readerEl,
} from "../core/dom";
import { state } from "../core/state";
import type { GitDiffTab, GitFileDiff, RenderResult } from "../core/types";
import { escapeHTML } from "../util/escape";
import { clearStatusOverride, setStatus, setStatusOverride, updateChrome } from "./chrome";
import { setMode } from "./mode";
import { renderDocPanelTabs } from "./doc-panel";
import { activateDocumentTab } from "../document/apply";
import { flushInline } from "../editor/inline";
import { captureActiveViewState } from "../document/view-state";
import { gitPathDirectoryLabel, splitGitPath } from "./git-path";
import {
  activeTab,
  bindFacadeFromTab,
  syncActiveTabFromFacade,
} from "../document/open-document-state";
import { clearRenderedSurfaceInteractionStatus } from "../rendered-surface/interactions";
import { openLightbox } from "./lightbox";
import { rewriteRenderedSurfaceAssets } from "../rendered-surface/assets";
import { normalizeRenderedHTML, paintRenderedSurface } from "../rendered-surface/pipeline";
import { gitDiffSurfaceProfile } from "../rendered-surface/profiles";
import type { RenderedSurfaceCallbacks } from "../rendered-surface/types";

const LINK_HINT_STATUS_ACTION = "link-hover-hint";

function root(): string | null {
  return state.workspace?.root || null;
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "git-diff-line is-hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "git-diff-line is-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "git-diff-line is-del";
  if (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("---")
    || line.startsWith("+++")
  ) {
    return "git-diff-line is-meta";
  }
  return "git-diff-line";
}

function renderLines(text: string): string {
  return text.split("\n")
    .map((line) => `<div class="${lineClass(line)}">${escapeHTML(line || " ")}</div>`)
    .join("");
}

function renderDiffBlock(title: string, text: string): string {
  return `
    <section class="git-diff-block">
      <div class="git-diff-block-title">${escapeHTML(title)}</div>
      <div class="git-diff-code">${text ? renderLines(text) : `<div class="git-diff-empty">没有 ${escapeHTML(title)}</div>`}</div>
    </section>`;
}

function renderRenderedDiffPreview(diff: GitFileDiff): string {
  if (!diff.renderedHtml) return "";
  return `
    <section class="git-diff-block git-diff-rendered-block">
      <div class="git-diff-block-title">Markdown 渲染预览</div>
      <div id="git-diff-rendered-surface" class="reader aimd git-diff-rendered-surface"></div>
    </section>`;
}

function gitDiffTabId(repoRoot: string, path: string): string {
  return `git-diff:${encodeURIComponent(repoRoot)}:${encodeURIComponent(path)}`;
}

export function activeGitDiffTab(): GitDiffTab | null {
  const id = state.openDocuments.activeTabId;
  return id ? state.git.diffTabs.find((tab) => tab.id === id) ?? null : null;
}

function findGitDiffTab(tabId: string): GitDiffTab | null {
  return state.git.diffTabs.find((tab) => tab.id === tabId) ?? null;
}

function findGitDiffTabByPath(repoRoot: string, path: string): GitDiffTab | null {
  return findGitDiffTab(gitDiffTabId(repoRoot, path));
}

function syncActiveGitDiffView(tab: GitDiffTab) {
  state.git.diffView = {
    path: tab.path,
    diff: tab.diff,
    loading: tab.loading,
    error: tab.error,
  };
}

export function isGitDiffTabId(tabId: string | null | undefined): boolean {
  return Boolean(tabId && state.git.diffTabs.some((tab) => tab.id === tabId));
}

export function captureActiveGitDiffScroll() {
  const tab = activeGitDiffTab();
  const scroller = document.querySelector<HTMLElement>("#git-diff-scroll");
  if (tab && scroller) tab.scroll = scroller.scrollTop;
}

export function firstGitDiffTabId(): string | null {
  return state.git.diffTabs[0]?.id ?? null;
}

function nextOpenTabIdAfterClose(tabId: string): string | null {
  const ids = [
    ...state.openDocuments.tabs.map((tab) => tab.id),
    ...state.git.diffTabs.map((tab) => tab.id),
  ];
  const index = ids.indexOf(tabId);
  if (index < 0) return state.openDocuments.activeTabId;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

async function prepareLeavingDocumentView(): Promise<boolean> {
  if (state.mainView !== "document") {
    captureActiveGitDiffScroll();
    return true;
  }
  if (state.mode === "edit" && state.inlineDirty) {
    const flushed = flushInline();
    if (!flushed.ok) return false;
  }
  captureActiveViewState();
  syncActiveTabFromFacade();
  return true;
}

export function showDocumentView() {
  clearRenderedSurfaceInteractionStatus();
  captureActiveGitDiffScroll();
  state.mainView = "document";
  gitDiffViewEl().hidden = true;
  if (!activeTab() && state.openDocuments.tabs[0]) {
    bindFacadeFromTab(state.openDocuments.tabs[0]);
  } else if (!state.openDocuments.tabs.length) {
    state.openDocuments.activeTabId = null;
  }
  renderDocPanelTabs();
  setMode(state.mode);
}

export function renderGitDiffView() {
  const tab = activeGitDiffTab();
  const view = tab
    ? { path: tab.path, diff: tab.diff, loading: tab.loading, error: tab.error }
    : state.git.diffView;
  const noLongerChanged = Boolean(
    view.path
    && state.git.status
    && !state.git.status.files.some((file) => file.path === view.path),
  );
  let body = "";
  if (view.loading) {
    body = `<div class="git-diff-message">正在读取 diff</div>`;
  } else if (view.error) {
    body = `<div class="git-diff-message is-error">${escapeHTML(view.error)}</div>`;
  } else if (!view.diff) {
    body = noLongerChanged
      ? `<div class="git-diff-message">该文件已无待 review 变更</div>`
      : `<div class="git-diff-message">选择 Git 文件查看 diff</div>`;
  } else if (view.diff.isBinary) {
    body = `<div class="git-diff-message">二进制文件无文本 diff</div>`;
  } else {
    const truncated = view.diff.truncated
      ? `<div class="git-diff-message">diff 过大，已截断</div>`
      : "";
    body = `
      ${truncated}
      ${renderRenderedDiffPreview(view.diff)}
      ${renderDiffBlock("已暂存差异", view.diff.stagedDiff)}
      ${renderDiffBlock("未暂存差异", view.diff.unstagedDiff)}`;
  }
  gitDiffContentEl().innerHTML = `
    <div id="git-diff-scroll" class="git-diff-scroll" data-select-all-scope>${body}</div>
  `;
  paintGitDiffRenderedSurface(view.diff);
  const scroller = document.querySelector<HTMLElement>("#git-diff-scroll");
  if (tab && scroller) {
    scroller.scrollTop = tab.scroll || 0;
    scroller.addEventListener("scroll", () => { tab.scroll = scroller.scrollTop; }, { passive: true });
  }
}

export async function openGitDiffView(path: string) {
  const repoRoot = root();
  if (!repoRoot) return;
  const pathParts = splitGitPath(path);
  let tab = findGitDiffTabByPath(repoRoot, path);
  if (!tab) {
    tab = {
      id: gitDiffTabId(repoRoot, path),
      repoRoot,
      path,
      title: pathParts.fileName || path,
      directory: gitPathDirectoryLabel(pathParts.directory),
      diff: null,
      loading: false,
      error: "",
      scroll: 0,
    };
    state.git.diffTabs.push(tab);
  }
  if (!await activateGitDiffTab(tab.id, { refresh: false })) return;
  await refreshGitDiffTab(tab.id);
}

export async function activateGitDiffTab(tabId: string, options: { refresh?: boolean } = {}): Promise<boolean> {
  const tab = findGitDiffTab(tabId);
  if (!tab) return false;
  if (!await prepareLeavingDocumentView()) return false;
  clearRenderedSurfaceInteractionStatus();
  state.openDocuments.activeTabId = tab.id;
  state.git.selectedPath = tab.path;
  state.mainView = "git-diff";
  syncActiveGitDiffView(tab);
  readerEl().hidden = true;
  inlineEditorEl().hidden = true;
  editorWrapEl().hidden = true;
  emptyEl().hidden = true;
  formatToolbarEl().hidden = true;
  gitDiffViewEl().hidden = false;
  renderDocPanelTabs();
  updateChrome();
  renderGitDiffView();
  if (options.refresh) await refreshGitDiffTab(tab.id);
  return true;
}

export async function closeGitDiffTab(tabId: string): Promise<boolean> {
  const tab = findGitDiffTab(tabId);
  if (!tab) return true;
  const wasActive = state.openDocuments.activeTabId === tab.id;
  const nextId = wasActive ? nextOpenTabIdAfterClose(tab.id) : state.openDocuments.activeTabId;
  if (wasActive) captureActiveGitDiffScroll();
  state.git.diffTabs = state.git.diffTabs.filter((item) => item.id !== tab.id);
  if (wasActive && nextId) {
    if (isGitDiffTabId(nextId)) await activateGitDiffTab(nextId);
    else await activateDocumentTab(nextId);
  } else if (wasActive) {
    state.openDocuments.activeTabId = null;
    state.git.diffView = { path: "", diff: null, loading: false, error: "" };
    showDocumentView();
  } else {
    updateChrome();
  }
  renderDocPanelTabs();
  return true;
}

async function refreshGitDiffTab(tabId: string) {
  const tab = findGitDiffTab(tabId);
  if (!tab) return;
  tab.loading = true;
  tab.error = "";
  if (state.openDocuments.activeTabId === tab.id) {
    syncActiveGitDiffView(tab);
    renderGitDiffView();
    updateChrome();
  }
  try {
    const diff = await invoke<GitFileDiff>("get_git_file_diff", { root: tab.repoRoot, path: tab.path });
    tab.diff = await renderMarkdownPreviewForDiff(diff);
  } catch (err) {
    tab.error = err instanceof Error ? err.message : String(err);
  } finally {
    tab.loading = false;
    if (state.openDocuments.activeTabId === tab.id) {
      syncActiveGitDiffView(tab);
      renderGitDiffView();
      updateChrome();
    }
  }
}

async function renderMarkdownPreviewForDiff(diff: GitFileDiff): Promise<GitFileDiff> {
  if (diff.isBinary || !isMarkdownLikePath(diff.path)) return diff;
  const markdown = addedMarkdownFromDiff(diff.stagedDiff, diff.unstagedDiff);
  if (!markdown.trim()) return diff;
  try {
    const out = await invoke<RenderResult>("render_markdown_standalone", { markdown });
    return {
      ...diff,
      renderedMarkdown: markdown,
      renderedHtml: normalizeRenderedHTML(out.html).html,
    };
  } catch (err) {
    console.warn("render git diff markdown preview failed", err);
    return diff;
  }
}

function paintGitDiffRenderedSurface(diff: GitFileDiff | null | undefined) {
  const rootEl = document.querySelector<HTMLElement>("#git-diff-rendered-surface");
  if (!rootEl || !diff?.renderedHtml) return;
  const markdownPath = markdownPathForDiff(diff.path);
  const rendered = rewriteRenderedSurfaceAssets(diff.renderedHtml, {
    assets: [],
    markdownPath,
  });
  paintRenderedSurface(gitDiffSurfaceProfile(rootEl), normalizeRenderedHTML(rendered).html, {
    assets: [],
    callbacks: gitDiffSurfaceCallbacks(),
    markdownPath,
  });
}

function isMarkdownLikePath(path: string): boolean {
  return /\.(aimd|md|markdown|mdx)$/i.test(path);
}

function markdownPathForDiff(path: string): string | undefined {
  const repoRoot = activeGitDiffTab()?.repoRoot || root();
  return repoRoot && isMarkdownLikePath(path) ? `${repoRoot}/${path}` : undefined;
}

function addedMarkdownFromDiff(...texts: string[]): string {
  return texts
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function gitDiffSurfaceCallbacks(): RenderedSurfaceCallbacks {
  return {
    openExternalUrl,
    openImage: openLightbox,
    toggleTask: () => {},
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

export async function refreshCurrentGitDiff() {
  const tab = activeGitDiffTab();
  if (state.mainView !== "git-diff" || !tab) return;
  const exists = state.git.status?.files.some((file) => file.path === tab.path);
  if (!exists) {
    tab.diff = null;
    tab.loading = false;
    tab.error = "";
    syncActiveGitDiffView(tab);
    renderGitDiffView();
    updateChrome();
    return;
  }
  await refreshGitDiffTab(tab.id);
}

export function bindGitDiffView() {
  renderGitDiffView();
}
