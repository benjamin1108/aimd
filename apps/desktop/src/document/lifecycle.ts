import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  markdownEl, inlineEditorEl, previewEl, readerEl,
} from "../core/dom";
import type { AimdDocument, MarkdownDraft, RenderResult } from "../core/types";
import { setStatus, updateChrome } from "../ui/chrome";
import { setMode } from "../ui/mode";
import { applyHTML } from "../ui/outline";
import { rememberOpenedPath } from "../ui/recents";
import { fileStem } from "../util/path";
import { activateDocumentTab, applyDocumentAsNewTab, applyDocumentToTab } from "./apply";
import { hasExternalImageReferences } from "./assets";
import { triggerOptimizeOnOpen } from "./optimize";
import { saveDocument } from "./persist";
import { deleteDocumentDraft } from "./drafts";
import { clearSessionSnapshot, clearLastSessionPath } from "../session/snapshot";
import {
  activeTab,
  dirtyTabs,
  displayTabTitle,
  findTab,
  findTabByPath,
  nextTabIdAfterClose,
  removeTab,
  syncActiveTabFromFacade,
} from "./open-document-state";
import { refreshTabFingerprint } from "./fingerprint";

export type OpenRouteResult = "opened" | "focused" | "current" | "cancelled" | "failed" | "unsupported";

export async function chooseAndOpen() {
  const path = await invoke<string | null>("choose_doc_file");
  if (path) await routeOpenedPath(path);
}

export async function openMarkdownDocument(markdownPath: string, opts?: { skipConfirm?: boolean }): Promise<OpenRouteResult> {
  void opts;
  setStatus("正在打开", "loading");
  try {
    const draft = await invoke<MarkdownDraft>("convert_md_to_draft", { markdownPath });
    const stem = fileStem(markdownPath) || "未命名文档";
    const doc: AimdDocument = {
      path: markdownPath,
      title: draft.title || stem,
      markdown: draft.markdown,
      html: draft.html,
      assets: [],
      dirty: false,
      isDraft: false,
      hasExternalImageReferences: hasExternalImageReferences(draft.markdown),
      requiresAimdSave: false,
      needsAimdSave: false,
      format: "markdown",
    };
    await applyDocumentAsNewTab(doc, "read");
    const tab = activeTab();
    if (tab?.doc.path) void refreshTabFingerprint(tab.id, tab.doc.path);
    rememberOpenedPath(markdownPath);
    setStatus("已打开（Markdown）", "success");
    try {
      await invoke("register_window_path", { path: markdownPath });
    } catch { /* 命令不存在时静默忽略 */ }
    return "opened";
  } catch (err) {
    console.error(err);
    setStatus(`打开失败: ${err instanceof Error ? err.message : String(err)}`, "warn");
    return "failed";
  }
}

export async function routeOpenedPath(path: string, opts?: { skipConfirm?: boolean }): Promise<OpenRouteResult> {
  const existing = findTabByPath(path);
  if (existing) {
    await activateDocumentTab(existing.id);
    try {
      await invoke("register_window_path", { path: existing.doc.path });
    } catch {}
    setStatus("已切换到已打开标签页", "info");
    return "current";
  }
  // 若该路径已在另一个窗口打开，聚焦那个窗口并结束
  try {
    const label = await invoke<string | null>("focus_doc_window", { path });
    if (label) return "focused";
  } catch {
    // Rust 命令不可用时（如 e2e mock 未注册）继续走正常流程
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".aimd")) {
    return await openDocument(path, { skipConfirm: opts?.skipConfirm });
  } else if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    return await openMarkdownDocument(path, opts);
  } else {
    setStatus("不支持的文件类型", "warn");
    return "unsupported";
  }
}

export async function chooseAndImportMarkdown() {
  const markdownPath = await invoke<string | null>("choose_markdown_file");
  if (!markdownPath) return;
  await routeOpenedPath(markdownPath);
}

export async function chooseAndImportMarkdownProject() {
  const markdownPath = await invoke<string | null>("choose_markdown_project_path");
  if (!markdownPath) return;
  const suggestedName = `${fileStem(markdownPath) || "markdown-project"}.aimd`;
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) return;
  setStatus("正在导入 Markdown 项目", "loading");
  try {
    const doc = await invoke<AimdDocument>("import_markdown", { markdownPath, savePath });
    await applyDocumentAsNewTab({ ...doc, isDraft: false, format: "aimd", dirty: false }, "read");
    const tab = activeTab();
    if (tab?.doc.path) void refreshTabFingerprint(tab.id, tab.doc.path);
    rememberOpenedPath(doc.path);
    setStatus("Markdown 项目已导入", "success");
    try {
      await invoke("register_window_path", { path: doc.path });
    } catch {}
  } catch (err) {
    console.error(err);
    setStatus(`导入失败: ${err instanceof Error ? err.message : String(err)}`, "warn");
  }
}

export async function newDocument() {
  const markdown = "# 未命名文档\n\n";
  const doc: AimdDocument = {
    path: "",
    title: "未命名文档",
    markdown,
    html: "",
    assets: [],
    dirty: true,
    isDraft: true,
    format: "aimd",
  };
  await applyDocumentAsNewTab(doc, "edit", { forceDraft: true });
  markdownEl().value = markdown;
  try {
    const out = await invoke<RenderResult>("render_markdown_standalone", { markdown });
    applyHTML(out.html);
  } catch {
    applyHTML("<h1>未命名文档</h1>");
  }
  setMode("edit");
  updateChrome();
  setStatus("已创建草稿，先保存为 .aimd 文件", "info");
  // BUG-008: 显式将焦点和光标设到编辑区第一个可编辑节点开头
  inlineEditorEl().focus();
  const firstBlock = inlineEditorEl().firstElementChild;
  if (firstBlock) {
    const r = document.createRange();
    r.setStart(firstBlock, 0);
    r.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
}

export async function openDocument(path: string, options: { skipConfirm?: boolean } = {}): Promise<OpenRouteResult> {
  void options;
  setStatus("正在打开", "loading");
  try {
    const doc = await invoke<AimdDocument>("open_aimd", { path });
    await applyDocumentAsNewTab({ ...doc, isDraft: false, format: "aimd", dirty: false }, "read");
    const tab = activeTab();
    if (tab?.doc.path) void refreshTabFingerprint(tab.id, tab.doc.path);
    rememberOpenedPath(doc.path);
    if (state.doc?.hasGitConflicts) {
      setStatus("文档包含 Git 冲突，请解决后保存", "warn");
    } else {
      setStatus("已打开", "success");
    }
    try {
      await invoke("register_window_path", { path: doc.path });
    } catch { /* 命令不存在（旧版 / e2e mock）时静默忽略 */ }
    void triggerOptimizeOnOpen(doc.path);
    return "opened";
  } catch (err) {
    console.error(err);
    setStatus(`打开失败: ${err instanceof Error ? err.message : String(err)}`, "warn");
    return "failed";
  }
}

export async function closeDocument() {
  const tab = activeTab();
  if (!tab) return;
  await closeDocumentTab(tab.id);
}

function clearDocumentSurface() {
  state.doc = null;
  state.openDocuments.activeTabId = null;
  state.outline = [];
  state.inlineDirty = false;
  state.sourceModel = null;
  state.sourceDirtyRefs.clear();
  state.sourceStructuralDirty = false;
  markdownEl().value = "";
  inlineEditorEl().innerHTML = "";
  previewEl().innerHTML = "";
  readerEl().innerHTML = "";
  clearSessionSnapshot();
  clearLastSessionPath();
  setMode("read");
  updateChrome();
}

export async function closeDocumentTab(tabId: string): Promise<boolean> {
  const tab = findTab(tabId);
  if (!tab) return true;
  const wasActive = state.openDocuments.activeTabId === tab.id;
  const nextId = wasActive ? nextTabIdAfterClose(tab.id) : state.openDocuments.activeTabId;
  if (!await ensureCanCloseTab(tab.id, "关闭当前标签页")) return false;
  await deleteDocumentDraft(tab.doc);
  if (tab.doc.path) {
    try {
      await invoke("unregister_window_path", { path: tab.doc.path });
    } catch {}
  }
  removeTab(tab.id);
  if (nextId) {
    await activateDocumentTab(nextId);
  } else {
    clearDocumentSurface();
    clearSessionSnapshot();
    clearLastSessionPath();
  }
  updateChrome();
  setStatus("已关闭标签页", "info");
  return true;
}

// Tauri 2 webview 默认吞掉 window.confirm()（无 UI、悄悄返回 false），
// 所以"丢弃未保存内容前的确认"必须走 Rust 端的原生对话框。
// 三按钮："保存" → 先 saveDocument 再继续；"不保存" → 直接放弃；"取消" → 留在原文档。
export async function ensureCanDiscardChanges(action: string): Promise<boolean> {
  const tab = activeTab();
  return tab ? ensureCanCloseTab(tab.id, action) : true;
}

async function saveTabBeforeLeaving(tabId: string): Promise<boolean> {
  const tab = findTab(tabId);
  if (!tab) return true;
  if (!tab.doc.dirty) return true;
  if (state.openDocuments.activeTabId === tab.id) {
    await saveDocument();
    syncActiveTabFromFacade();
    return !tab.doc.dirty;
  }
  if (tab.doc.isDraft || !tab.doc.path || (tab.doc.format === "markdown" && tab.doc.requiresAimdSave)) {
    if (!await activateDocumentTab(tab.id)) return false;
    await saveDocument();
    syncActiveTabFromFacade();
    return !tab.doc.dirty;
  }
  try {
    if (tab.doc.format === "markdown") {
      await invoke("save_markdown", { path: tab.doc.path, markdown: tab.doc.markdown });
      tab.doc.dirty = false;
    } else {
      const doc = await invoke<AimdDocument>("save_aimd", { path: tab.doc.path, markdown: tab.doc.markdown });
      applyDocumentToTab(tab.id, { ...doc, isDraft: false, format: "aimd", dirty: false }, tab.mode);
    }
    return true;
  } catch (err) {
    console.error(err);
    setStatus(`保存失败: ${err instanceof Error ? err.message : String(err)}`, "warn");
    return false;
  }
}

export async function ensureCanCloseTab(tabId: string, action: string): Promise<boolean> {
  const tab = findTab(tabId);
  if (!tab?.doc.dirty) return true;
  const label = displayTabTitle(tab.doc);
  let choice: "save" | "discard" | "cancel";
  try {
    choice = await invoke<"save" | "discard" | "cancel">("confirm_discard_changes", {
      message: `“${label}”有未保存的修改，仍要${action}吗？`,
    });
  } catch {
    // 退化到 window.confirm，仅用于 vite-only 开发态 / e2e 兜底（不希望在 Tauri 实跑里走到这里）
    choice = window.confirm(`“${label}”有未保存的修改，仍要${action}吗？`) ? "discard" : "cancel";
  }
  if (choice === "save") {
    return saveTabBeforeLeaving(tab.id);
  }
  if (choice === "discard") {
    await deleteDocumentDraft(tab.doc);
    tab.doc.dirty = false;
    return true;
  }
  return false;
}

export async function confirmAllDirtyTabsForWindowClose(): Promise<boolean> {
  for (const tab of dirtyTabs()) {
    if (!await ensureCanCloseTab(tab.id, "关闭窗口")) return false;
  }
  return true;
}
