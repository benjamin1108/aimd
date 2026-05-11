import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { saveEl, saveAsEl } from "../core/dom";
import type { AimdDocument } from "../core/types";
import { setStatus, displayDocTitle, updateChrome } from "../ui/chrome";
import { rememberOpenedPath } from "../ui/recents";
import { fileStem, suggestAimdFilename } from "../util/path";
import { applyDocument } from "./apply";
import { flushInline } from "../editor/inline";
import { deleteDraftFile } from "./drafts";

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
    if (state.doc.needsAimdSave || state.doc.assets.length > 0) {
      setStatus("当前 Markdown 包含本地图片，请另存为 .aimd", "info");
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
    setStatus("已保存", "success");
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "保存失败"), "warn");
  } finally {
    updateChrome();
  }
}

export async function saveDocumentAs() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  const isMarkdownDoc = state.doc.format === "markdown" && Boolean(state.doc.path);
  const wasDraft = Boolean(state.doc.isDraft || !state.doc.path);
  const draftSourcePath = state.doc.draftSourcePath || "";
  const sourcePath = state.doc.format === "markdown"
    ? (draftSourcePath || null)
    : (state.doc.path || draftSourcePath || null);
  const suggestedName = isMarkdownDoc
    ? `${fileStem(state.doc.path)}.aimd`
    : suggestAimdFilename(state.doc.path || `${displayDocTitle(state.doc)}.aimd`);
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
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
    if (isMarkdownDoc) {
      applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus("已转换为 .aimd", "success");
    } else {
      applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus(wasDraft ? "文件已创建" : "已另存为", "success");
    }
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
    if (draftSourcePath && draftSourcePath !== savePath) void deleteDraftFile(draftSourcePath);
    setStatus("已升级为 .aimd", "success");
    return true;
  } catch (err) {
    console.error(err);
    setStatus(messageFromError(err, "升级失败"), "warn");
    return false;
  }
}
