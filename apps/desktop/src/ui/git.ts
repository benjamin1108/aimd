import { invoke } from "@tauri-apps/api/core";
import { gitContentEl } from "../core/dom";
import { ICONS, state } from "../core/state";
import type { GitChangedFile, GitFileKind, GitRepoStatus } from "../core/types";
import { dirtyTabs } from "../document/open-document-state";
import { escapeAttr, escapeHTML } from "../util/escape";
import { setStatus } from "./chrome";
import { dismissContextMenu, showContextMenu } from "./context-menu";
import { renderDocPanelTabs } from "./doc-panel";
import { openGitDiffView, refreshCurrentGitDiff, showDocumentView } from "./git-diff";
import { gitPathDirectoryLabel, splitGitPath } from "./git-path";

let refreshTimer: number | null = null;
let refreshRequestId = 0;

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

const KIND_LABELS: Record<GitFileKind, string> = {
  modified: "修改",
  added: "新增",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
  conflicted: "冲突",
};

function fileBadge(file: GitChangedFile): [string, string] {
  return BADGES[file.kind] || ["M", "已修改"];
}

function hasStagedChanges(status: GitRepoStatus): boolean {
  return status.files.some((file) => file.staged !== "none" && file.kind !== "conflicted");
}

function hasDiscardableChanges(status: GitRepoStatus): boolean {
  return status.files.some((file) => file.kind !== "conflicted");
}

function canDiscardFile(file: GitChangedFile, canMutateIndex: boolean): boolean {
  return canMutateIndex && file.kind !== "conflicted";
}

function summarize(status: GitRepoStatus): string {
  const counts = new Map<string, number>();
  status.files.forEach((file) => counts.set(file.kind, (counts.get(file.kind) || 0) + 1));
  return ["modified", "added", "deleted", "renamed", "untracked", "conflicted"]
    .filter((kind) => counts.has(kind))
    .map((kind) => `${KIND_LABELS[kind as GitFileKind]} ${counts.get(kind)}`)
    .join(" · ");
}

function pullBlockedReason(status: GitRepoStatus, dirtyCount: number): string {
  if (dirtyCount) return `${dirtyCount} 未保存`;
  if (status.conflicted) return "冲突未解决";
  if (!status.upstream) return "无 upstream";
  if (!status.clean) return "需先提交";
  return "";
}

function pushBlockedReason(status: GitRepoStatus, dirtyCount: number): string {
  if (dirtyCount) return `${dirtyCount} 未保存`;
  if (status.conflicted) return "冲突未解决";
  if (!status.upstream) return "无 upstream";
  if ((status.behind || 0) > 0) return "先拉取";
  if ((status.ahead || 0) <= 0) return "无待推送";
  return "";
}

function discardAllBlockedReason(status: GitRepoStatus, dirtyCount: number): string {
  if (dirtyCount) return `${dirtyCount} 未保存`;
  if (status.conflicted) return "冲突未解决";
  if (!hasDiscardableChanges(status)) return "无可放弃改动";
  return "";
}

function operationDisabled(status: GitRepoStatus | null): boolean {
  return !status || state.git.loading || state.git.action || status.conflicted;
}

function dirtyDocumentMessage(action: string): string {
  const dirty = dirtyTabs();
  if (!dirty.length) return "";
  if (dirty.length === 1) {
    return `“${dirty[0].title}”有未保存修改，保存后再${action}`;
  }
  return `${dirty.length} 个文档有未保存修改，保存后再${action}`;
}

function blockIfDirty(action: string): boolean {
  const message = dirtyDocumentMessage(action);
  if (!message) return false;
  state.git.error = message;
  setStatus(message, "warn");
  renderGitPanel();
  return true;
}

function renderFile(file: GitChangedFile, canMutateIndex: boolean): string {
  const selected = state.git.selectedPath === file.path;
  const canStage = canMutateIndex && (file.unstaged !== "none" || file.kind === "untracked");
  const canUnstage = file.staged !== "none";
  const [badge, label] = fileBadge(file);
  const path = splitGitPath(file.path);
  const originalPath = file.originalPath ? splitGitPath(file.originalPath) : null;
  const directory = gitPathDirectoryLabel(path.directory);
  const meta = originalPath
    ? `${gitPathDirectoryLabel(originalPath.directory)}/${originalPath.fileName} → ${directory}`
    : directory;
  return `
    <div class="git-file-row ${selected ? "is-active" : ""} ${file.kind === "conflicted" ? "is-conflicted" : ""}" data-path="${escapeAttr(file.path)}">
      <div class="git-file-status">
        <span class="git-file-badge" data-kind="${escapeAttr(file.kind)}">${escapeHTML(badge)}</span>
        <button class="git-mini-btn" type="button" data-git-action="stage-file" data-path="${escapeAttr(file.path)}" title="暂存" aria-label="暂存 ${escapeAttr(file.path)}" ${!canStage || state.git.action ? "disabled" : ""}>S</button>
        <button class="git-mini-btn" type="button" data-git-action="unstage-file" data-path="${escapeAttr(file.path)}" title="取消暂存" aria-label="取消暂存 ${escapeAttr(file.path)}" ${!canUnstage || state.git.action ? "disabled" : ""}>u</button>
      </div>
      <button class="git-file-main" type="button" data-git-action="select" data-path="${escapeAttr(file.path)}" title="${escapeAttr(`${label}: ${file.path}`)}">
        <span class="git-file-text">
          <span class="git-file-name">${escapeHTML(path.fileName)}</span>
          <span class="git-file-dir">${escapeHTML(meta)}</span>
        </span>
      </button>
    </div>`;
}

function gitActionButton(action: string, label: string, enabled: boolean, disabledReason: string, extraClass = ""): string {
  const reason = enabled ? "" : disabledReason;
  return `
    <span class="git-tooltip-host" ${reason ? `data-tip="${escapeAttr(reason)}"` : ""}>
      <button class="git-action-btn ${escapeAttr(extraClass)}" type="button" data-git-action="${escapeAttr(action)}" title="${escapeAttr(enabled ? label : reason)}" ${enabled ? "" : "disabled"}>${escapeHTML(label)}</button>
    </span>
  `;
}

export function renderGitPanel() {
  const status = state.git.status;
  if (state.git.loading && !status) {
    gitContentEl().innerHTML = `<div class="git-empty">正在读取 Git 状态</div>`;
    return;
  }
  if (!state.git.isRepo || !status) {
    gitContentEl().innerHTML = `
      <div class="git-empty">
        ${root() ? "当前项目不是 Git 仓库" : "未打开项目目录"}
      </div>
    `;
    return;
  }
  const upstream = status.upstream
    ? `${escapeHTML(status.upstream)} ↑${status.ahead || 0} ↓${status.behind || 0}`
    : "未设置 upstream";
  const dirtyCount = dirtyTabs().length;
  if (!dirtyCount && state.git.error.includes("未保存修改")) state.git.error = "";
  const disabled = operationDisabled(status);
  const canMutateIndex = !disabled && dirtyCount === 0;
  const canCommit = canMutateIndex && hasStagedChanges(status);
  const canSync = !disabled && Boolean(status.upstream);
  const pullReason = pullBlockedReason(status, dirtyCount);
  const pushReason = pushBlockedReason(status, dirtyCount);
  const discardAllReason = discardAllBlockedReason(status, dirtyCount);
  const canPull = canSync && !pullReason;
  const canPush = canSync && !pushReason;
  const canDiscardAll = !disabled && !discardAllReason;
  const summary = summarize(status) || "干净";
  const syncReason = pullReason === pushReason ? pullReason : pullReason || pushReason;
  const notices = [
    status.error ? `<div class="git-error">${escapeHTML(status.error)}</div>` : "",
    state.git.error ? `<div class="git-error">${escapeHTML(state.git.error)}</div>` : "",
    status.aimdDriverWarning ? `<div class="git-warning">${escapeHTML(status.aimdDriverWarning)}</div>` : "",
    status.conflicted ? `<div class="git-warning">存在冲突文件，请先使用外部 Git 工具或命令行解决。</div>` : "",
    dirtyCount ? `<div class="git-warning">打开的文档有未保存修改，Git 提交、暂存、放弃和同步会先阻断。</div>` : "",
  ].filter(Boolean).join("");
  gitContentEl().innerHTML = `
    <div class="git-summary">
      <div class="git-branch" title="${escapeAttr(status.branch || "HEAD")}">
        <strong>${escapeHTML(status.branch || "HEAD")}</strong>
        <span>${status.clean ? "干净" : `${status.files.length} 个变更`} · <span class="git-meta">${upstream}</span></span>
      </div>
      <button class="git-icon-btn" type="button" data-git-action="refresh" title="刷新" aria-label="刷新 Git 状态" ${state.git.loading ? "disabled" : ""}>${ICONS.refresh}</button>
    </div>
    <div class="git-sync-actions">
      <div class="git-sync-buttons">
        ${gitActionButton("pull", "拉取", canPull, pullReason || syncReason)}
        ${gitActionButton("push", "推送", canPush, pushReason || syncReason)}
      </div>
    </div>
    ${notices ? `<div class="git-notices">${notices}</div>` : ""}
    <div class="git-stage-row">
      <span title="${escapeAttr(summary)}">${escapeHTML(summary)}</span>
      <div class="git-bulk-actions">
        <button class="git-action-btn" type="button" data-git-action="stage-all" ${!canMutateIndex || status.clean ? "disabled" : ""}>全部暂存</button>
        <button class="git-action-btn" type="button" data-git-action="unstage-all" ${disabled || !hasStagedChanges(status) ? "disabled" : ""}>全部取消</button>
        ${gitActionButton("discard-all", "全部放弃", canDiscardAll, discardAllReason, "git-action-btn--danger")}
      </div>
    </div>
    <div class="git-commit">
      <input id="git-commit-message" class="git-commit-input" type="text" placeholder="提交说明" autocomplete="off" ${canCommit ? "" : "disabled"} />
      <button id="git-commit-submit" class="git-action-btn" type="button" data-git-action="commit" disabled>提交</button>
    </div>
    <div class="git-file-list">
      ${status.files.length ? status.files.map((file) => renderFile(file, canMutateIndex)).join("") : `<div class="git-empty">没有待提交修改</div>`}
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
  const requestId = ++refreshRequestId;
  state.git.loading = true;
  if (!silent) state.git.error = "";
  renderGitPanel();
  try {
    const status = await invoke<GitRepoStatus>("get_git_repo_status", { root: repoRoot });
    if (requestId !== refreshRequestId) return;
    state.git.isRepo = status.isRepo;
    state.git.status = status.isRepo ? status : null;
    state.git.error = status.error || "";
    if (!status.isRepo) {
      state.git.selectedPath = "";
      state.git.diffTabs = [];
      state.git.diffView = { path: "", diff: null, loading: false, error: "" };
      if (state.mainView === "git-diff") showDocumentView();
    } else if (!status.files.some((file) => file.path === state.git.selectedPath)) {
      state.git.selectedPath = status.files[0]?.path || "";
    }
  } catch (err) {
    if (requestId !== refreshRequestId) return;
    state.git.isRepo = false;
    state.git.status = null;
    state.git.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (requestId === refreshRequestId) {
      state.git.loading = false;
      renderDocPanelTabs();
      renderGitPanel();
    }
  }
  if (requestId === refreshRequestId) await refreshCurrentGitDiff();
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
    diffTabs: [],
    diffView: { path: "", diff: null, loading: false, error: "" },
    loading: false,
    action: false,
    error: "",
    selectedPath: "",
  };
  if (state.mainView === "git-diff") showDocumentView();
  renderDocPanelTabs();
  renderGitPanel();
}

async function runGitAction(action: () => Promise<unknown>, success?: string, pending = "正在执行 Git 操作") {
  state.git.action = true;
  state.git.error = "";
  setStatus(pending, "loading");
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
  const repoRoot = state.git.status?.root || root();
  if (!repoRoot) throw new Error("未打开项目");
  return repoRoot;
}

function confirmDiscard(path: string): boolean {
  const file = state.git.status?.files.find((item) => item.path === path);
  const action = file?.kind === "untracked" ? "删除这个未跟踪文件" : "放弃这个文件的全部改动";
  return window.confirm(`${action}？\n\n${path}\n\n此操作不可撤销。`);
}

function confirmDiscardAll(): boolean {
  return window.confirm("放弃全部工作区改动？\n\n包括已暂存、未暂存和未跟踪文件。此操作不可撤销。");
}

function showGitFileContextMenu(event: MouseEvent, row: HTMLElement) {
  const path = row.dataset.path || "";
  const status = state.git.status;
  const file = status?.files.find((item) => item.path === path);
  if (!status || !file) return;
  event.preventDefault();
  event.stopPropagation();
  state.git.selectedPath = path;
  renderGitPanel();
  const dirtyCount = dirtyTabs().length;
  const canMutateIndex = !operationDisabled(status) && dirtyCount === 0;
  const discardDisabled = !canDiscardFile(file, canMutateIndex);
  showContextMenu(event.clientX, event.clientY, [
    {
      label: "打开 Diff",
      action: () => {
        dismissContextMenu();
        void openGitDiffView(path);
      },
    },
    {
      label: file.kind === "untracked" ? "删除未跟踪文件" : "放弃文件改动",
      danger: true,
      disabled: discardDisabled,
      action: () => {
        dismissContextMenu();
        if (blockIfDirty("放弃改动")) return;
        if (!confirmDiscard(path)) return;
        void runGitAction(() => invoke("git_discard_file", { root: commandRoot(), path }), "已放弃改动", "正在放弃改动");
      },
    },
  ]);
}

export function bindGitPanel() {
  gitContentEl().addEventListener("contextmenu", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".git-file-row[data-path]");
    if (row) showGitFileContextMenu(event, row);
  });
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
      if (blockIfDirty("提交")) return;
      const message = document.querySelector<HTMLInputElement>("#git-commit-message")?.value.trim() || "";
      void runGitAction(() => invoke("git_commit", { root: commandRoot(), message }), "已提交", "正在提交");
      return;
    }
    if (action === "discard-all") {
      if (blockIfDirty("放弃全部改动")) return;
      if (!confirmDiscardAll()) return;
      void runGitAction(() => invoke("git_discard_all", { root: commandRoot() }), "已全部放弃", "正在放弃全部改动");
      return;
    }
    const args = path ? { root: commandRoot(), path } : { root: commandRoot() };
    const commands: Record<string, [string, string, string]> = {
      "stage-file": ["git_stage_file", "已暂存", "正在暂存"],
      "unstage-file": ["git_unstage_file", "已取消暂存", "正在取消暂存"],
      "stage-all": ["git_stage_all", "已全部暂存", "正在暂存全部"],
      "unstage-all": ["git_unstage_all", "已全部取消暂存", "正在取消暂存"],
      pull: ["git_pull", "拉取完成", "正在拉取"],
      push: ["git_push", "推送完成", "正在推送"],
    };
    const command = commands[action];
    const dirtyGuard: Record<string, string> = {
      "stage-file": "暂存",
      "stage-all": "暂存全部",
      pull: "拉取",
      push: "推送",
    };
    if (command) {
      if (dirtyGuard[action] && blockIfDirty(dirtyGuard[action])) return;
      void runGitAction(() => invoke(command[0], args), command[1], command[2]);
    }
  });
  window.addEventListener("aimd-doc-saved", refreshGitAfterDocumentSave);
}
