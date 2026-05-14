import { invoke } from "@tauri-apps/api/core";
import { gitContentEl } from "../core/dom";
import { state } from "../core/state";
import type { GitChangedFile, GitFileKind, GitRepoStatus } from "../core/types";
import { escapeAttr, escapeHTML } from "../util/escape";
import { setStatus } from "./chrome";
import { renderDocPanelTabs } from "./doc-panel";
import { openGitDiffView, refreshCurrentGitDiff, showDocumentView } from "./git-diff";

let refreshTimer: number | null = null;

function root(): string | null {
  return state.workspace?.root || null;
}

const BADGES: Record<GitFileKind, [string, string]> = {
  modified: ["M", "已修改"],
  added: ["A", "已新增"],
  deleted: ["D", "已删除"],
  renamed: ["R", "已重命名"],
  untracked: ["NEW", "未跟踪文件"],
  conflicted: ["CONFLICT", "冲突文件"],
};

function fileBadge(file: GitChangedFile): [string, string] {
  return BADGES[file.kind] || ["M", "已修改"];
}

function hasStagedChanges(status: GitRepoStatus): boolean {
  return status.files.some((file) => file.staged !== "none" && file.kind !== "conflicted");
}

function summarize(status: GitRepoStatus): string {
  const counts = new Map<string, number>();
  status.files.forEach((file) => counts.set(file.kind, (counts.get(file.kind) || 0) + 1));
  return ["modified", "added", "deleted", "renamed", "untracked", "conflicted"]
    .filter((kind) => counts.has(kind))
    .map((kind) => `${kind} ${counts.get(kind)}`)
    .join(" · ");
}

function operationDisabled(status: GitRepoStatus | null): boolean {
  return !status || state.git.loading || state.git.action || status.conflicted;
}

function renderFile(file: GitChangedFile): string {
  const selected = state.git.selectedPath === file.path;
  const canStage = file.unstaged !== "none" || file.kind === "untracked";
  const canUnstage = file.staged !== "none";
  const [badge, label] = fileBadge(file);
  return `
    <div class="git-file-row ${selected ? "is-active" : ""} ${file.kind === "conflicted" ? "is-conflicted" : ""}">
      <button class="git-file-main" type="button" data-git-action="select" data-path="${escapeAttr(file.path)}" title="${escapeAttr(`${label}: ${file.path}`)}">
        <span class="git-file-badge" data-kind="${escapeAttr(file.kind)}">${escapeHTML(badge)}</span>
        <span class="git-file-path">${escapeHTML(file.path)}</span>
      </button>
      <div class="git-file-actions">
        <button class="git-mini-btn" type="button" data-git-action="stage-file" data-path="${escapeAttr(file.path)}" ${!canStage || state.git.action ? "disabled" : ""}>stage</button>
        <button class="git-mini-btn" type="button" data-git-action="unstage-file" data-path="${escapeAttr(file.path)}" ${!canUnstage || state.git.action ? "disabled" : ""}>unstage</button>
      </div>
    </div>`;
}

export function renderGitPanel() {
  const status = state.git.status;
  if (state.git.loading && !status) {
    gitContentEl().innerHTML = `<div class="git-empty">正在读取 Git 状态</div>`;
    return;
  }
  if (!state.git.isRepo || !status) {
    gitContentEl().innerHTML = "";
    return;
  }
  const upstream = status.upstream
    ? `${escapeHTML(status.upstream)} ↑${status.ahead || 0} ↓${status.behind || 0}`
    : "未设置 upstream";
  const disabled = operationDisabled(status);
  const canCommit = !disabled && hasStagedChanges(status);
  const canSync = !disabled && Boolean(status.upstream);
  gitContentEl().innerHTML = `
    <div class="git-toolbar">
      <div class="git-branch">
        <strong>${escapeHTML(status.branch || "HEAD")}</strong>
        <span>${status.clean ? "clean" : `${status.files.length} changes`}</span>
      </div>
      <button class="git-icon-btn" type="button" data-git-action="refresh" ${state.git.loading ? "disabled" : ""}>刷新</button>
    </div>
    <div class="git-meta">${upstream}</div>
    ${status.error ? `<div class="git-error">${escapeHTML(status.error)}</div>` : ""}
    ${state.git.error ? `<div class="git-error">${escapeHTML(state.git.error)}</div>` : ""}
    ${status.conflicted ? `<div class="git-warning">存在冲突文件，请先使用外部 Git 工具或命令行解决。</div>` : ""}
    <div class="git-sync-actions">
      <button class="git-action-btn" type="button" data-git-action="pull" ${!canSync ? "disabled" : ""}>Pull</button>
      <button class="git-action-btn" type="button" data-git-action="push" ${!canSync ? "disabled" : ""}>Push</button>
    </div>
    <div class="git-section-head">
      <span>Changes</span>
      <span>${escapeHTML(summarize(status) || "clean")}</span>
    </div>
    <div class="git-bulk-actions">
      <button class="git-action-btn" type="button" data-git-action="stage-all" ${disabled || status.clean ? "disabled" : ""}>Stage all</button>
      <button class="git-action-btn" type="button" data-git-action="unstage-all" ${disabled || !hasStagedChanges(status) ? "disabled" : ""}>Unstage all</button>
    </div>
    <div class="git-file-list">
      ${status.files.length ? status.files.map(renderFile).join("") : `<div class="git-empty">没有待提交修改</div>`}
    </div>
    <div class="git-section-head"><span>Commit</span></div>
    <div class="git-commit">
      <input id="git-commit-message" class="git-commit-input" type="text" placeholder="Commit message" autocomplete="off" ${canCommit ? "" : "disabled"} />
      <button id="git-commit-submit" class="git-action-btn" type="button" data-git-action="commit" disabled>Commit</button>
    </div>
  `;
  bindCommitInput(canCommit);
}

function bindCommitInput(canCommit: boolean) {
  const input = document.querySelector<HTMLInputElement>("#git-commit-message");
  const button = document.querySelector<HTMLButtonElement>("#git-commit-submit");
  if (!input || !button) return;
  input.addEventListener("input", () => {
    button.disabled = !canCommit || !input.value.trim();
  });
}

export async function refreshGitStatus(silent = false) {
  const repoRoot = root();
  if (!repoRoot) {
    resetGitState();
    return;
  }
  state.git.loading = true;
  if (!silent) state.git.error = "";
  renderGitPanel();
  try {
    const status = await invoke<GitRepoStatus>("get_git_repo_status", { root: repoRoot });
    state.git.isRepo = status.isRepo;
    state.git.status = status.isRepo ? status : null;
    state.git.error = status.error || "";
    if (!status.isRepo) {
      state.sidebarDocTab = "outline";
      state.git.selectedPath = "";
      state.git.diffView = { path: "", diff: null, loading: false, error: "" };
      if (state.mainView === "git-diff") showDocumentView();
    } else if (!status.files.some((file) => file.path === state.git.selectedPath)) {
      state.git.selectedPath = status.files[0]?.path || "";
    }
  } catch (err) {
    state.git.isRepo = false;
    state.git.status = null;
    state.git.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.git.loading = false;
    renderDocPanelTabs();
    renderGitPanel();
  }
  await refreshCurrentGitDiff();
}

export function refreshGitAfterDocumentSave() {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (state.git.isRepo) void refreshGitStatus(true);
  }, 350);
}

export function resetGitState() {
  state.git = {
    isRepo: false,
    status: null,
    diffView: { path: "", diff: null, loading: false, error: "" },
    loading: false,
    action: false,
    error: "",
    selectedPath: "",
  };
  state.sidebarDocTab = "outline";
  if (state.mainView === "git-diff") showDocumentView();
  renderDocPanelTabs();
  renderGitPanel();
}

async function runGitAction(action: () => Promise<unknown>, success?: string) {
  state.git.action = true;
  state.git.error = "";
  renderGitPanel();
  try {
    await action();
    if (success) setStatus(success, "success");
  } catch (err) {
    state.git.error = err instanceof Error ? err.message : String(err);
    setStatus(state.git.error, "warn");
  } finally {
    state.git.action = false;
    await refreshGitStatus(true);
  }
}

function commandRoot(): string {
  const repoRoot = root();
  if (!repoRoot) throw new Error("未打开目录");
  return repoRoot;
}

export function bindGitPanel() {
  gitContentEl().addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-git-action]");
    if (!button) return;
    const action = button.dataset.gitAction || "";
    const path = button.dataset.path || "";
    if (action === "select") {
      state.git.selectedPath = path;
      renderGitPanel();
      void openGitDiffView(path);
      return;
    }
    if (action === "refresh") {
      void refreshGitStatus();
      return;
    }
    if (action === "commit") {
      const message = document.querySelector<HTMLInputElement>("#git-commit-message")?.value.trim() || "";
      void runGitAction(() => invoke("git_commit", { root: commandRoot(), message }), "已提交");
      return;
    }
    const args = path ? { root: commandRoot(), path } : { root: commandRoot() };
    const commands: Record<string, [string, string]> = {
      "stage-file": ["git_stage_file", "已 stage"],
      "unstage-file": ["git_unstage_file", "已 unstage"],
      "stage-all": ["git_stage_all", "已全部 stage"],
      "unstage-all": ["git_unstage_all", "已全部 unstage"],
      pull: ["git_pull", "Pull 完成"],
      push: ["git_push", "Push 完成"],
    };
    const command = commands[action];
    if (command) void runGitAction(() => invoke(command[0], args), command[1]);
  });
  window.addEventListener("aimd-doc-saved", refreshGitAfterDocumentSave);
}
