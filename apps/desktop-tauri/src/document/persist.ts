import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { saveEl, saveAsEl } from "../core/dom";
import type { AimdDocument } from "../core/types";
import { setStatus, displayDocTitle, updateChrome } from "../ui/chrome";
import { rememberOpenedPath } from "../ui/recents";
import { fileStem, suggestAimdFilename } from "../util/path";
import { applyDocument } from "./apply";
import { flushInline } from "../editor/inline";

export async function saveDocument() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  if (state.doc.isDraft || !state.doc.path) {
    await saveDocumentAs();
    return;
  }
  if (!state.doc.dirty) return;

  if (state.doc.format === "markdown") {
    if (state.doc.assets.length > 0) {
      await upgradeMarkdownToAimd();
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
      setStatus("保存失败", "warn");
    } finally {
      saveEl().disabled = false;
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
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
    rememberOpenedPath(doc.path);
    setStatus("已保存", "success");
  } catch (err) {
    console.error(err);
    setStatus("保存失败", "warn");
  } finally {
    saveEl().disabled = false;
  }
}

export async function saveDocumentAs() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  const isMarkdownDoc = state.doc.format === "markdown" && Boolean(state.doc.path);
  const wasDraft = Boolean(state.doc.isDraft || !state.doc.path);
  const suggestedName = isMarkdownDoc
    ? `${fileStem(state.doc.path)}.aimd`
    : suggestAimdFilename(state.doc.path || `${displayDocTitle(state.doc)}.aimd`);
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) return;
  setStatus(wasDraft ? "正在创建文件" : "正在另存为", "loading");
  saveAsEl().disabled = true;
  try {
    const doc = await invoke<AimdDocument>("save_aimd_as", {
      path: state.doc.path || null,
      savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    if (isMarkdownDoc) {
      applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus("已转换为 .aimd", "success");
    } else {
      applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus(wasDraft ? "文件已创建" : "已另存为", "success");
    }
  } catch (err) {
    console.error(err);
    setStatus("另存为失败", "warn");
  } finally {
    saveAsEl().disabled = false;
  }
}

export async function upgradeMarkdownToAimd(): Promise<boolean> {
  if (!state.doc || state.doc.format !== "markdown") return false;
  let confirmed = false;
  try {
    confirmed = await invoke<boolean>("confirm_upgrade_to_aimd", {
      message: "文档包含图片资源，需要升级为 .aimd 格式才能保存。是否现在升级？",
    });
  } catch {
    confirmed = window.confirm("文档包含图片资源，需要升级为 .aimd 格式才能保存。是否现在升级？");
  }
  if (!confirmed) {
    setStatus("升级取消", "info");
    return false;
  }
  const stem = fileStem(state.doc.path) || displayDocTitle(state.doc);
  const suggestedName = `${stem}.aimd`;
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) {
    setStatus("升级取消", "info");
    return false;
  }
  try {
    const doc = await invoke<AimdDocument>("create_aimd", {
      path: savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
    rememberOpenedPath(savePath);
    setStatus("已升级为 .aimd", "success");
    return true;
  } catch (err) {
    console.error(err);
    setStatus("升级失败", "warn");
    return false;
  }
}
