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
import type { GitFileDiff } from "../core/types";
import { escapeAttr, escapeHTML } from "../util/escape";
import { updateChrome } from "./chrome";
import { setMode } from "./mode";
import { displayTabTitle } from "../document/open-document-state";
import { captureActiveViewState } from "../document/view-state";

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

export function showDocumentView() {
  state.mainView = "document";
  gitDiffViewEl().hidden = true;
  setMode(state.mode);
}

export function renderGitDiffView() {
  const view = state.git.diffView;
  const canReturn = Boolean(state.doc);
  const activeDocTitle = state.doc ? displayTabTitle(state.doc) : "";
  const title = view.path || "Git 差异";
  let body = "";
  if (view.loading) {
    body = `<div class="git-diff-message">正在读取 diff</div>`;
  } else if (view.error) {
    body = `<div class="git-diff-message is-error">${escapeHTML(view.error)}</div>`;
  } else if (!view.diff) {
    body = `<div class="git-diff-message">选择 Git 文件查看 diff</div>`;
  } else if (view.diff.isBinary) {
    body = `<div class="git-diff-message">二进制文件无文本 diff</div>`;
  } else {
    const truncated = view.diff.truncated
      ? `<div class="git-diff-message">diff 过大，已截断</div>`
      : "";
    body = `
      ${truncated}
      ${renderDiffBlock("已暂存差异", view.diff.stagedDiff)}
      ${renderDiffBlock("未暂存差异", view.diff.unstagedDiff)}`;
  }
  gitDiffContentEl().innerHTML = `
    <header class="git-diff-head">
      <button id="git-diff-back" class="secondary-btn sm" type="button" ${canReturn ? "" : "disabled"}>${activeDocTitle ? `返回当前文档：${escapeHTML(activeDocTitle)}` : "返回当前文档"}</button>
      <div>
        <div class="git-diff-scope">Git review · 项目变更</div>
        <div class="git-diff-title" title="${escapeAttr(title)}">${escapeHTML(title)}</div>
      </div>
    </header>
    <div id="git-diff-scroll" class="git-diff-scroll" data-select-all-scope>${body}</div>
  `;
  document.querySelector<HTMLButtonElement>("#git-diff-back")?.addEventListener("click", showDocumentView);
}

export async function openGitDiffView(path: string) {
  const repoRoot = root();
  if (!repoRoot) return;
  captureActiveViewState();
  state.mainView = "git-diff";
  state.git.diffView = { path, diff: null, loading: true, error: "" };
  readerEl().hidden = true;
  inlineEditorEl().hidden = true;
  editorWrapEl().hidden = true;
  emptyEl().hidden = true;
  formatToolbarEl().hidden = true;
  gitDiffViewEl().hidden = false;
  updateChrome();
  renderGitDiffView();
  try {
    state.git.diffView.diff = await invoke<GitFileDiff>("get_git_file_diff", { root: repoRoot, path });
  } catch (err) {
    state.git.diffView.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.git.diffView.loading = false;
    renderGitDiffView();
  }
}

export async function refreshCurrentGitDiff() {
  if (state.mainView !== "git-diff" || !state.git.diffView.path) return;
  const exists = state.git.status?.files.some((file) => file.path === state.git.diffView.path);
  if (!exists) {
    state.git.diffView = { path: "", diff: null, loading: false, error: "" };
    showDocumentView();
    return;
  }
  await openGitDiffView(state.git.diffView.path);
}

export function bindGitDiffView() {
  renderGitDiffView();
}
