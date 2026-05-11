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
import { applyDocument } from "./apply";
import { triggerOptimizeOnOpen } from "./optimize";
import { saveDocument } from "./persist";
import { deleteDocumentDraft } from "./drafts";
import { clearSessionSnapshot, clearLastSessionPath } from "../session/snapshot";

export type OpenRouteResult = "opened" | "focused" | "current" | "cancelled" | "failed" | "unsupported";

export async function chooseAndOpen() {
  const path = await invoke<string | null>("choose_doc_file");
  if (path) await routeOpenedPath(path);
}

export async function openMarkdownDocument(markdownPath: string, opts?: { skipConfirm?: boolean }): Promise<OpenRouteResult> {
  if (!opts?.skipConfirm && !await ensureCanDiscardChanges("打开另一个文档")) return "cancelled";
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
      format: "markdown",
    };
    applyDocument(doc, "read");
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
  // 若该路径已在另一个窗口打开，聚焦那个窗口并结束
  try {
    const label = await invoke<string | null>("focus_doc_window", { path });
    if (label) return "focused";
  } catch {
    // Rust 命令不可用时（如 e2e mock 未注册）继续走正常流程
  }

  // 若当前窗口本身就持有该路径：避免重新加载丢失未保存内容，但要给用户反馈，
  // 并补登记一下窗口路径（会话恢复路径时不会自动登记，补一次让多窗口去重生效）。
  if (state.doc?.path && normPathsEqual(state.doc.path, path)) {
    try {
      await invoke("register_window_path", { path: state.doc.path });
    } catch { /* 命令不可用时忽略 */ }
    setStatus("已经是当前文档", "info");
    return "current";
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

function normPathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

export async function chooseAndImportMarkdown() {
  const markdownPath = await invoke<string | null>("choose_markdown_file");
  if (!markdownPath) return;
  await openMarkdownDocument(markdownPath);
}

export async function newDocument() {
  if (!await ensureCanDiscardChanges("新建文档")) return;
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
  state.doc = doc;
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
  if (!options.skipConfirm && !await ensureCanDiscardChanges("打开另一个文档")) return "cancelled";
  setStatus("正在打开", "loading");
  try {
    const doc = await invoke<AimdDocument>("open_aimd", { path });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false }, "read");
    rememberOpenedPath(doc.path);
    setStatus("已打开", "success");
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
  if (!await ensureCanDiscardChanges("关闭当前文档")) return;
  await deleteDocumentDraft(state.doc);
  state.doc = null;
  state.outline = [];
  state.inlineDirty = false;
  markdownEl().value = "";
  inlineEditorEl().innerHTML = "";
  previewEl().innerHTML = "";
  readerEl().innerHTML = "";
  clearSessionSnapshot();
  clearLastSessionPath();
  // 必须摘掉 OpenedWindows 表里当前窗口的路径条目，否则下次点 recents "继续" 时
  // focus_doc_window 会命中残留条目，误判"已有窗口承载"，导致文档再也打不开。
  try {
    await invoke("unregister_current_window_path");
  } catch { /* 命令不可用时静默忽略 */ }
  setMode("read");
  updateChrome();
  setStatus("已关闭文档", "info");
}

// Tauri 2 webview 默认吞掉 window.confirm()（无 UI、悄悄返回 false），
// 所以"丢弃未保存内容前的确认"必须走 Rust 端的原生对话框。
// 三按钮："保存" → 先 saveDocument 再继续；"不保存" → 直接放弃；"取消" → 留在原文档。
export async function ensureCanDiscardChanges(action: string): Promise<boolean> {
  if (!state.doc?.dirty) return true;
  let choice: "save" | "discard" | "cancel";
  try {
    choice = await invoke<"save" | "discard" | "cancel">("confirm_discard_changes", {
      message: `当前文档有未保存的修改，仍要${action}吗？`,
    });
  } catch {
    // 退化到 window.confirm，仅用于 vite-only 开发态 / e2e 兜底（不希望在 Tauri 实跑里走到这里）
    choice = window.confirm(`当前文档有未保存的修改，仍要${action}吗？`) ? "discard" : "cancel";
  }
  if (choice === "save") {
    await saveDocument();
    // saveDocument 内部走 saveDocumentAs；若用户在 file picker 里取消、文档仍是 draft / 仍 dirty，则视为放弃此次离开。
    return !(state.doc?.dirty ?? false);
  }
  if (choice === "discard") {
    await deleteDocumentDraft(state.doc);
    return true;
  }
  return false;
}
