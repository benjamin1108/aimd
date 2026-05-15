import { invoke } from "@tauri-apps/api/core";
import {
  state,
  ICONS,
  STORAGE_WORKSPACE_EXPANDED,
  STORAGE_WORKSPACE_ROOT,
} from "../core/state";
import {
  workspaceCloseEl,
  workspaceNewDocEl,
  workspaceNewFolderEl,
  workspaceOpenEl,
  workspaceRefreshEl,
  workspaceRootLabelEl,
  workspaceTreeEl,
  markdownEl,
} from "../core/dom";
import type { WorkspaceRoot, WorkspaceTreeNode } from "../core/types";
import { escapeAttr, escapeHTML } from "../util/escape";
import { extractHeadingTitle, fileStem } from "../util/path";
import { closeDocument, ensureCanDiscardChanges, routeOpenedPath } from "../document/lifecycle";
import { setStatus, updateChrome } from "./chrome";
import { dismissContextMenu, showContextMenu } from "./context-menu";
import { rememberOpenedPath, saveRecentPaths } from "./recents";
import { confirmWorkspaceAction, promptWorkspaceText } from "./workspace-dialogs";
import { refreshGitStatus, resetGitState } from "./git";
import { showDocumentView } from "./git-diff";
import { applyWorkspaceCollapseState, bindWorkspaceCollapse } from "./sidebar-layout";

function samePath(a: string, b: string): boolean { return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase(); }

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return path;
  return path.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${name}`;
}

function updateDefaultHeadingAfterRename(oldPath: string, newPath: string) {
  if (!state.doc) return;
  const oldStem = fileStem(oldPath);
  const newStem = fileStem(newPath);
  if (!oldStem || !newStem || extractHeadingTitle(state.doc.markdown) !== oldStem) return;
  state.doc.markdown = state.doc.markdown.replace(/^# .*(\r?\n|$)/m, `# ${newStem}$1`);
  markdownEl().value = state.doc.markdown;
  state.doc.dirty = true;
}

function findNode(node: WorkspaceTreeNode, path: string): WorkspaceTreeNode | null {
  if (samePath(node.path, path)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function selectedParentPath(): string | null {
  if (!state.workspace) return null;
  if (!state.workspaceSelectedPath) return state.workspace.root;
  const node = findNode(state.workspace.tree, state.workspaceSelectedPath);
  if (!node) return state.workspace.root;
  return node.kind === "folder" ? node.path : parentPath(node.path);
}

function persistWorkspaceState() {
  if (state.workspace?.root) {
    window.localStorage.setItem(STORAGE_WORKSPACE_ROOT, state.workspace.root);
  }
  window.localStorage.setItem(STORAGE_WORKSPACE_EXPANDED, JSON.stringify([...state.workspaceExpanded]));
}

function loadExpandedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_WORKSPACE_EXPANDED);
    const values = raw ? JSON.parse(raw) : [];
    if (Array.isArray(values)) {
      state.workspaceExpanded = new Set(values.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    state.workspaceExpanded = new Set();
  }
}

function applyWorkspace(workspace: WorkspaceRoot) {
  state.workspace = workspace;
  state.workspaceError = "";
  state.workspaceExpanded.add(workspace.root);
  persistWorkspaceState();
  updateChrome();
  renderWorkspaceTree();
  void refreshGitStatus(true);
}

function workspaceIcon(node: WorkspaceTreeNode): string { return node.kind === "folder" ? ICONS.folder : ICONS.document; }

function renderNode(node: WorkspaceTreeNode, depth: number): string {
  const expanded = state.workspaceExpanded.has(node.path);
  const active = Boolean(state.doc?.path && samePath(state.doc.path, node.path));
  const hasChildren = node.kind === "folder" && (node.children?.length || 0) > 0;
  const row = `
    <button class="workspace-row ${node.kind === "folder" ? "is-folder" : "is-document"} ${expanded ? "is-expanded" : ""} ${active ? "is-active" : ""}"
            style="padding-left:${8 + depth * 14}px"
            data-workspace-path="${escapeAttr(node.path)}"
            data-workspace-kind="${escapeAttr(node.kind)}"
            data-file-item="true"
            title="${escapeAttr(node.path)}"
            type="button">
      ${hasChildren ? `<span class="workspace-twist">${ICONS.chevron}</span>` : `<span class="workspace-row-spacer"></span>`}
      <span class="workspace-node-icon">${workspaceIcon(node)}</span>
      <span class="workspace-name">${escapeHTML(node.name)}</span>
    </button>
    ${node.error ? `<div class="workspace-node-error">${escapeHTML(node.error)}</div>` : ""}
  `;
  if (node.kind !== "folder" || !expanded) return row;
  return row + (node.children || []).map((child) => renderNode(child, depth + 1)).join("");
}

export function renderWorkspaceTree() {
  applyWorkspaceCollapseState();
  workspaceRefreshEl().disabled = !state.workspace || state.workspaceLoading;
  workspaceNewDocEl().disabled = !state.workspace || state.workspaceLoading;
  workspaceNewFolderEl().disabled = !state.workspace || state.workspaceLoading;
  workspaceCloseEl().disabled = !state.workspace || state.workspaceLoading;

  if (state.workspaceLoading) {
    workspaceRootLabelEl().textContent = "目录";
    workspaceTreeEl().innerHTML = `<div class="workspace-empty">正在读取目录</div>`;
    return;
  }

  if (state.workspaceError) {
    workspaceRootLabelEl().textContent = "目录";
    workspaceTreeEl().innerHTML = `<div class="workspace-error">${escapeHTML(state.workspaceError)}</div>`;
    return;
  }

  if (!state.workspace) {
    const lastRoot = window.localStorage.getItem(STORAGE_WORKSPACE_ROOT);
    workspaceRootLabelEl().textContent = "目录";
    workspaceTreeEl().innerHTML = lastRoot
      ? `<button class="workspace-row is-folder" id="workspace-restore-last" type="button" title="${escapeAttr(lastRoot)}">
          <span class="workspace-row-spacer"></span>
          <span class="workspace-node-icon">${ICONS.folder}</span>
          <span class="workspace-name">继续上次目录</span>
        </button>`
      : `<div class="workspace-empty">打开目录</div>`;
    document.querySelector<HTMLButtonElement>("#workspace-restore-last")?.addEventListener("click", () => {
      void openStoredWorkspace();
    });
    return;
  }

  workspaceRootLabelEl().textContent = state.workspace.tree.name || "目录";
  workspaceRootLabelEl().title = state.workspace.root;
  workspaceTreeEl().innerHTML = renderNode(state.workspace.tree, 0);
  bindWorkspaceRows();
}

function bindWorkspaceRows() {
  workspaceTreeEl().querySelectorAll<HTMLButtonElement>(".workspace-row[data-workspace-path]").forEach((row) => {
    row.addEventListener("click", () => {
      const path = row.dataset.workspacePath || "";
      const kind = row.dataset.workspaceKind;
      if (!path) return;
      state.workspaceSelectedPath = path;
      if (kind === "folder") {
        if (state.workspaceExpanded.has(path)) state.workspaceExpanded.delete(path);
        else state.workspaceExpanded.add(path);
        persistWorkspaceState();
        renderWorkspaceTree();
      } else {
        void openWorkspaceDocument(path);
      }
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const path = row.dataset.workspacePath || "";
      if (!path || !state.workspace) return;
      state.workspaceSelectedPath = path;
      const node = findNode(state.workspace.tree, path);
      if (node) showWorkspaceContextMenu(event.clientX, event.clientY, node);
    });
  });
}

async function openWorkspaceDocument(path: string) {
  const result = await routeOpenedPath(path);
  if (result === "opened" || result === "current") {
    showDocumentView();
    state.workspaceSelectedPath = path;
    renderWorkspaceTree();
  } else if (result === "failed" || result === "unsupported") {
    await refreshWorkspace("文件不可用，已刷新目录");
  }
}

async function runWorkspaceOperation(operation: () => Promise<WorkspaceRoot>, success: string) {
  if (!state.workspace) return;
  state.workspaceLoading = true;
  renderWorkspaceTree();
  try {
    const workspace = await operation();
    applyWorkspace(workspace);
    setStatus(success, "success");
  } catch (err) {
    console.error(err);
    state.workspaceError = err instanceof Error ? err.message : String(err);
    setStatus(state.workspaceError, "warn");
    renderWorkspaceTree();
  } finally {
    state.workspaceLoading = false;
    renderWorkspaceTree();
  }
}

async function createDocument(parent: string | null, preferredKind?: "aimd" | "markdown") {
  if (!state.workspace) return;
  const targetParent = parent || selectedParentPath() || state.workspace.root;
  const fallback = preferredKind === "markdown" ? "未命名文档.md" : "未命名文档.aimd";
  const name = await promptWorkspaceText("新建文档", fallback);
  if (!name) return;
  const lower = name.toLowerCase();
  const kind = preferredKind || (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx") ? "markdown" : "aimd");
  const finalName = kind === "aimd" && !lower.endsWith(".aimd") ? `${name}.aimd` : name;
  await runWorkspaceOperation(async () => {
    const workspace = await invoke<WorkspaceRoot>("create_workspace_file", {
      root: state.workspace!.root,
      parent: targetParent,
      name: finalName,
      kind,
    });
    state.workspaceSelectedPath = joinPath(targetParent, finalName);
    return workspace;
  }, "文档已创建");
  if (state.workspaceSelectedPath) {
    void openWorkspaceDocument(state.workspaceSelectedPath);
  }
}

async function createFolder(parent: string | null) {
  if (!state.workspace) return;
  const targetParent = parent || selectedParentPath() || state.workspace.root;
  const name = await promptWorkspaceText("新建文件夹", "新建文件夹");
  if (!name) return;
  await runWorkspaceOperation(async () => {
    const workspace = await invoke<WorkspaceRoot>("create_workspace_folder", {
      root: state.workspace!.root,
      parent: targetParent,
      name,
    });
    const folderPath = joinPath(targetParent, name);
    state.workspaceSelectedPath = folderPath;
    state.workspaceExpanded.add(folderPath);
    return workspace;
  }, "文件夹已创建");
}

async function renameEntry(node: WorkspaceTreeNode) {
  if (!state.workspace) return;
  const nextName = await promptWorkspaceText("重命名", node.name);
  if (!nextName || nextName === node.name) return;
  const oldPath = node.path;
  const newPath = joinPath(parentPath(oldPath), nextName);
  await runWorkspaceOperation(async () => {
    const workspace = await invoke<WorkspaceRoot>("rename_workspace_entry", {
      root: state.workspace!.root,
      path: oldPath,
      newName: nextName,
    });
    state.workspaceSelectedPath = newPath;
    if (state.doc?.path && samePath(state.doc.path, oldPath)) {
      updateDefaultHeadingAfterRename(oldPath, newPath);
      state.doc.path = newPath;
      state.doc.title = fileStem(newPath) || state.doc.title;
      state.recentPaths = [newPath, ...state.recentPaths.filter((path) => !samePath(path, oldPath) && !samePath(path, newPath))];
      saveRecentPaths();
      rememberOpenedPath(newPath);
      void invoke("update_window_path", { newPath }).catch(() => {});
      updateChrome();
    }
    return workspace;
  }, "已重命名");
}

async function moveEntry(node: WorkspaceTreeNode) {
  if (!state.workspace) return;
  const target = await promptWorkspaceText("移动到文件夹路径", state.workspace.root);
  if (!target) return;
  const newPath = joinPath(target, node.name);
  await runWorkspaceOperation(async () => {
    const workspace = await invoke<WorkspaceRoot>("move_workspace_entry", {
      root: state.workspace!.root,
      from: node.path,
      toParent: target,
    });
    state.workspaceSelectedPath = newPath;
    if (state.doc?.path && samePath(state.doc.path, node.path)) {
      state.doc.path = newPath;
      state.recentPaths = [newPath, ...state.recentPaths.filter((path) => !samePath(path, node.path) && !samePath(path, newPath))];
      saveRecentPaths();
      rememberOpenedPath(newPath);
      void invoke("update_window_path", { newPath }).catch(() => {});
      updateChrome();
    }
    return workspace;
  }, "已移动");
}

async function trashEntry(node: WorkspaceTreeNode) {
  if (!state.workspace) return;
  const isCurrent = Boolean(state.doc?.path && samePath(state.doc.path, node.path));
  if (isCurrent && !await ensureCanDiscardChanges("删除当前文档")) return;
  const ok = await confirmWorkspaceAction(`确定要移到废纸篓/删除“${node.name}”吗？`);
  if (!ok) return;
  await runWorkspaceOperation(async () => {
    const workspace = await invoke<WorkspaceRoot>("trash_workspace_entry", {
      root: state.workspace!.root,
      path: node.path,
    });
    if (isCurrent) {
      if (state.doc) state.doc.dirty = false;
      await closeDocument();
    }
    state.workspaceSelectedPath = "";
    return workspace;
  }, "已删除");
}

function showWorkspaceContextMenu(x: number, y: number, node: WorkspaceTreeNode) {
  const isRoot = Boolean(state.workspace && samePath(node.path, state.workspace.root));
  showContextMenu(x, y, [
    {
      label: node.kind === "document" ? "打开" : "展开/收起",
      action: () => {
        dismissContextMenu();
        if (node.kind === "document") void openWorkspaceDocument(node.path);
        else {
          if (state.workspaceExpanded.has(node.path)) state.workspaceExpanded.delete(node.path);
          else state.workspaceExpanded.add(node.path);
          persistWorkspaceState();
          renderWorkspaceTree();
        }
      },
    },
    {
      label: "在新窗口打开",
      disabled: node.kind !== "document",
      action: () => {
        dismissContextMenu();
        void invoke("open_in_new_window", { path: node.path });
      },
    },
    {
      label: "新建 AIMD 文档",
      action: () => {
        dismissContextMenu();
        void createDocument(node.kind === "folder" ? node.path : parentPath(node.path), "aimd");
      },
    },
    {
      label: "新建 Markdown 文档",
      action: () => {
        dismissContextMenu();
        void createDocument(node.kind === "folder" ? node.path : parentPath(node.path), "markdown");
      },
    },
    {
      label: "新建文件夹",
      action: () => {
        dismissContextMenu();
        void createFolder(node.kind === "folder" ? node.path : parentPath(node.path));
      },
    },
    {
      label: "重命名",
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        void renameEntry(node);
      },
    },
    {
      label: "移动到...",
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        void moveEntry(node);
      },
    },
    {
      label: "移到废纸篓/删除",
      danger: true,
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        void trashEntry(node);
      },
    },
  ]);
}

export async function openWorkspacePicker() {
  state.workspaceLoading = true;
  renderWorkspaceTree();
  try {
    const workspace = await invoke<WorkspaceRoot | null>("open_workspace_dir");
    if (!workspace) {
      state.workspaceLoading = false;
      renderWorkspaceTree();
      return;
    }
    applyWorkspace(workspace);
    setStatus("目录已打开", "success");
  } catch (err) {
    console.error(err);
    state.workspaceError = err instanceof Error ? err.message : String(err);
    setStatus(state.workspaceError, "warn");
    resetGitState();
  } finally {
    state.workspaceLoading = false;
    renderWorkspaceTree();
  }
}

export async function openStoredWorkspace() {
  const root = window.localStorage.getItem(STORAGE_WORKSPACE_ROOT);
  if (!root) return;
  state.workspaceLoading = true;
  renderWorkspaceTree();
  try {
    const workspace = await invoke<WorkspaceRoot>("read_workspace_tree", { root });
    applyWorkspace(workspace);
    setStatus("目录已恢复", "success");
  } catch (err) {
    console.error(err);
    state.workspace = null;
    state.workspaceError = err instanceof Error ? err.message : String(err);
    setStatus(state.workspaceError, "warn");
    resetGitState();
  } finally {
    state.workspaceLoading = false;
    renderWorkspaceTree();
  }
}

export async function refreshWorkspace(message = "目录已刷新") {
  if (!state.workspace) return;
  const root = state.workspace.root;
  state.workspaceLoading = true;
  renderWorkspaceTree();
  try {
    const workspace = await invoke<WorkspaceRoot>("read_workspace_tree", { root });
    applyWorkspace(workspace);
    setStatus(message, "success");
  } catch (err) {
    console.error(err);
    state.workspaceError = err instanceof Error ? err.message : String(err);
    setStatus(state.workspaceError, "warn");
  } finally {
    state.workspaceLoading = false;
    renderWorkspaceTree();
  }
}

export function closeWorkspace() {
  if (!state.workspace && !state.workspaceError) return;
  dismissContextMenu();
  state.workspace = null;
  state.workspaceError = "";
  state.workspaceLoading = false;
  state.workspaceSelectedPath = "";
  state.workspaceExpanded = new Set();
  window.localStorage.removeItem(STORAGE_WORKSPACE_ROOT);
  window.localStorage.removeItem(STORAGE_WORKSPACE_EXPANDED);
  resetGitState();
  showDocumentView();
  updateChrome();
  renderWorkspaceTree();
  setStatus("目录已关闭", "success");
}

export function bindWorkspacePanel() {
  loadExpandedState();
  bindWorkspaceCollapse(renderWorkspaceTree);
  workspaceOpenEl().addEventListener("click", () => { void openWorkspacePicker(); });
  workspaceRefreshEl().addEventListener("click", () => { void refreshWorkspace(); });
  workspaceNewDocEl().addEventListener("click", () => { void createDocument(null); });
  workspaceNewFolderEl().addEventListener("click", () => { void createFolder(null); });
  workspaceCloseEl().addEventListener("click", closeWorkspace);
  window.addEventListener("aimd-doc-applied", () => {
    if (state.doc?.path) state.workspaceSelectedPath = state.doc.path;
    renderWorkspaceTree();
  });
  renderWorkspaceTree();
}
