import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceTreeNode } from "../core/types";
import { dismissContextMenu, showContextMenu } from "./context-menu";

export type WorkspaceContextActions = {
  openDocument: (path: string) => void;
  toggleFolder: (path: string) => void;
  createDocument: (parent: string | null, preferredKind: "aimd" | "markdown") => void;
  createFolder: (parent: string | null) => void;
  renameEntry: (node: WorkspaceTreeNode) => void;
  moveEntry: (node: WorkspaceTreeNode) => void;
  trashEntry: (node: WorkspaceTreeNode) => void;
};

export function showWorkspaceNodeContextMenu(
  x: number,
  y: number,
  node: WorkspaceTreeNode,
  isRoot: boolean,
  parentPath: string,
  actions: WorkspaceContextActions,
) {
  const parent = node.kind === "folder" ? node.path : parentPath;
  showContextMenu(x, y, [
    {
      label: node.kind === "document" ? "打开" : "展开/收起",
      action: () => {
        dismissContextMenu();
        if (node.kind === "document") actions.openDocument(node.path);
        else actions.toggleFolder(node.path);
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
        actions.createDocument(parent, "aimd");
      },
    },
    {
      label: "新建 Markdown 文档",
      action: () => {
        dismissContextMenu();
        actions.createDocument(parent, "markdown");
      },
    },
    {
      label: "新建文件夹",
      action: () => {
        dismissContextMenu();
        actions.createFolder(parent);
      },
    },
    {
      label: "重命名",
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        actions.renameEntry(node);
      },
    },
    {
      label: "移动到...",
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        actions.moveEntry(node);
      },
    },
    {
      label: "移到废纸篓/删除",
      danger: true,
      disabled: isRoot,
      action: () => {
        dismissContextMenu();
        actions.trashEntry(node);
      },
    },
  ]);
}
