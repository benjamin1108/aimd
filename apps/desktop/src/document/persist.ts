import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  saveEl, saveAsEl,
  saveFormatPanelEl, saveFormatMarkdownEl, saveFormatAimdEl, saveFormatCancelXEl,
} from "../core/dom";
import type { AimdDocument } from "../core/types";
import { setStatus, displayDocTitle, updateChrome } from "../ui/chrome";
import { rememberOpenedPath } from "../ui/recents";
import { fileStem, suggestAimdFilename } from "../util/path";
import { applyDocument } from "./apply";
import { flushInline } from "../editor/inline";
import { deleteDraftFile } from "./drafts";
import { hasAimdImageReferences } from "./assets";
import { renderPreview } from "../ui/outline";

type SaveFormat = "markdown" | "aimd";

type MarkdownSaveResult = {
  path: string;
  markdown: string;
  assetsDir?: string | null;
  exportedAssets?: unknown[];
};

function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return `${fallback}: ${err.message}`;
  if (typeof err === "string" && err.trim()) return `${fallback}: ${err}`;
  return fallback;
}

export async function saveDocument() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  if (state.doc.isDraft || !state.doc.path) {
    await saveDocumentAs();
    return;
  }
  if (!state.doc.dirty) return;

  if (state.doc.format === "markdown") {
    if (state.doc.requiresAimdSave) {
      setStatus("当前 Markdown 包含内嵌资源，请选择保存格式", "info");
      await saveDocumentAs();
      return;
    }
    setStatus("正在保存", "loading");
    saveEl().disabled = true;
    try {
      await invoke("save_markdown", { path: state.doc.path, markdown: state.doc.markdown });
      state.doc.dirty = false;
      updateChrome();
      rememberOpenedPath(state.doc.path);
      setStatus("已保存（Markdown）", "success");
      window.dispatchEvent(new CustomEvent("aimd-doc-saved"));
    } catch (err) {
      console.error(err);
      setStatus(messageFromError(err, "保存失败"), "warn");
    } finally {
      updateChrome();
    }
    return;
  }

  setStatus("正在保存", "loading");
  saveEl().disabled = true;
  try {
    const doc = await invoke<AimdDocument>("save_aimd", {
      path: state.doc.path,
      markdown: state.doc.markdown,
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false }, state.mode);
    rememberOpenedPath(doc.path);
    window.dispatchEvent(new CustomEvent("aimd-doc-saved"));
    setStatus("已保存", "success");
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "保存失败"), "warn");
  } finally {
    updateChrome();
  }
}

function chooseSaveFormat(): Promise<SaveFormat | null> {
  return new Promise((resolve) => {
    const panel = saveFormatPanelEl();
    const cleanup = (value: SaveFormat | null) => {
      panel.hidden = true;
      saveFormatMarkdownEl().removeEventListener("click", onMarkdown);
      saveFormatAimdEl().removeEventListener("click", onAimd);
      saveFormatCancelXEl().removeEventListener("click", onCancel);
      resolve(value);
    };
    const onMarkdown = () => cleanup("markdown");
    const onAimd = () => cleanup("aimd");
    const onCancel = () => cleanup(null);
    saveFormatMarkdownEl().addEventListener("click", onMarkdown);
    saveFormatAimdEl().addEventListener("click", onAimd);
    saveFormatCancelXEl().addEventListener("click", onCancel);
    panel.hidden = false;
    saveFormatMarkdownEl().focus();
  });
}

function markdownSuggestedName(doc: AimdDocument): string {
  const stem = fileStem(doc.path || doc.draftSourcePath || displayDocTitle(doc)) || "untitled";
  return `${stem}.md`;
}

function aimdSuggestedName(doc: AimdDocument): string {
  if (doc.format === "markdown" && doc.path) return `${fileStem(doc.path)}.aimd`;
  return suggestAimdFilename(doc.path || `${displayDocTitle(doc)}.aimd`);
}

async function saveDocumentAsMarkdown(sourcePath: string | null, wasDraft: boolean, draftSourcePath: string) {
  if (!state.doc) return;
  const savePath = await invoke<string | null>("choose_save_markdown_file", {
    suggestedName: markdownSuggestedName(state.doc),
  });
  if (!savePath) return;
  setStatus(wasDraft ? "正在创建 Markdown" : "正在另存为 Markdown", "loading");
  saveAsEl().disabled = true;
  try {
    const result = await invoke<MarkdownSaveResult>("save_markdown_as", {
      sourcePath,
      savePath,
      markdown: state.doc.markdown,
    });
    state.doc.path = result.path;
    state.doc.markdown = result.markdown;
    state.doc.format = "markdown";
    state.doc.assets = [];
    state.doc.isDraft = false;
    state.doc.draftSourcePath = undefined;
    state.doc.dirty = false;
    state.doc.requiresAimdSave = hasAimdImageReferences(result.markdown);
    state.doc.needsAimdSave = state.doc.requiresAimdSave;
    await renderPreview();
    rememberOpenedPath(result.path);
    window.dispatchEvent(new CustomEvent("aimd-doc-saved"));
    if (draftSourcePath && draftSourcePath !== result.path) void deleteDraftFile(draftSourcePath);
    try {
      await invoke("update_window_path", { newPath: result.path });
    } catch {}
    setStatus(result.assetsDir ? "已保存 Markdown 和资源目录" : "已保存（Markdown）", "success");
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "另存为 Markdown 失败"), "warn");
  } finally {
    updateChrome();
  }
}

async function saveDocumentAsAimd(sourcePath: string | null, wasDraft: boolean, draftSourcePath: string) {
  if (!state.doc) return;
  const savePath = await invoke<string | null>("choose_save_aimd_file", {
    suggestedName: aimdSuggestedName(state.doc),
  });
  if (!savePath) return;
  setStatus(wasDraft ? "正在创建文件" : "正在另存为", "loading");
  saveAsEl().disabled = true;
  try {
    const doc = await invoke<AimdDocument>("save_aimd_as", {
      path: sourcePath,
      savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, state.mode);
    rememberOpenedPath(doc.path);
    setStatus(wasDraft ? "文件已创建" : "已另存为 AIMD", "success");
    window.dispatchEvent(new CustomEvent("aimd-doc-saved"));
    if (draftSourcePath && draftSourcePath !== doc.path) {
      void deleteDraftFile(draftSourcePath);
    }
    try {
      await invoke("update_window_path", { newPath: doc.path });
    } catch { /* 命令不存在时静默忽略 */ }
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "另存为失败"), "warn");
  } finally {
    updateChrome();
  }
}

export async function saveDocumentAs() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  const wasDraft = Boolean(state.doc.isDraft || !state.doc.path);
  const draftSourcePath = state.doc.draftSourcePath || "";
  const sourcePath = state.doc.format === "markdown"
    ? (draftSourcePath || state.doc.path || null)
    : (state.doc.path || draftSourcePath || null);
  const format = await chooseSaveFormat();
  if (!format) return;
  if (format === "markdown") {
    await saveDocumentAsMarkdown(sourcePath, wasDraft, draftSourcePath);
  } else {
    await saveDocumentAsAimd(sourcePath, wasDraft, draftSourcePath);
  }
}

export async function upgradeMarkdownToAimd(): Promise<boolean> {
  if (!state.doc || state.doc.format !== "markdown") return false;
  const stem = fileStem(state.doc.path) || displayDocTitle(state.doc);
  const suggestedName = `${stem}.aimd`;
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) {
    setStatus("升级取消", "info");
    return false;
  }
  try {
    const doc = await invoke<AimdDocument>("save_aimd_as", {
      path: state.doc.draftSourcePath || null,
      savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    const draftSourcePath = state.doc.draftSourcePath;
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, state.mode);
    rememberOpenedPath(savePath);
    window.dispatchEvent(new CustomEvent("aimd-doc-saved"));
    if (draftSourcePath && draftSourcePath !== savePath) void deleteDraftFile(draftSourcePath);
    setStatus("已升级为 .aimd", "success");
    return true;
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "升级失败"), "warn");
    return false;
  }
}
