import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { AddedAsset } from "../core/types";
import { setStatus, updateChrome } from "../ui/chrome";
import { ensureDraftPackage } from "../document/drafts";
import {
  compressImageBytes, normalizeAddedAsset,
} from "./images";
import { htmlToMarkdown } from "./markdown";
import { insertMarkdownAtSelection } from "./textarea";
import { runFormatCommand } from "./format-toolbar";

export function collectClipboardImages(data: DataTransfer): File[] {
  const out: File[] = [];
  const files = data.files;
  if (files && files.length) {
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f && f.type.startsWith("image/")) out.push(f);
    }
  }
  // Some platforms expose images only via items[] (e.g. Finder copy of an image),
  // so fall back to that channel when the FileList came up empty.
  if (out.length === 0 && data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const it = data.items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

export function guessImageExt(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/gif":  return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}

export async function pasteImageFiles(files: File[]) {
  if (!state.doc) return;
  setStatus("正在加入粘贴的图片", "loading");
  try {
    const targetPath = await ensureDraftPackage();
    if (!targetPath || !state.doc) return;
    for (const file of files) {
      const rawBuf = await file.arrayBuffer();
      const baseName = (file.name && file.name.length > 0)
        ? file.name
        : `pasted-${Date.now()}.${guessImageExt(file.type)}`;
      const compressed = await compressImageBytes(rawBuf, file.type, baseName);
      const added = normalizeAddedAsset(await invoke<AddedAsset>("add_image_bytes", {
        path: targetPath,
        filename: compressed.filename,
        data: Array.from(compressed.data),
      }));
      state.doc.assets = [...state.doc.assets, added.asset];
      insertMarkdownAtSelection(`${added.markdown}\n`);
      state.doc.dirty = true;
      if (state.doc.format === "markdown") {
        state.doc.requiresAimdSave = true;
        state.doc.needsAimdSave = true;
      }
    }
    updateChrome();
    setStatus(
      state.doc.format === "markdown"
        ? "图片已粘贴，保存时需转换为 AIMD"
        : "已粘贴图片",
      "success",
    );
  } catch (err) {
    console.error(err);
    setStatus("粘贴图片失败", "warn");
  }
}

export function onMarkdownPaste(event: ClipboardEvent) {
  if (!event.clipboardData) return;

  const imageFiles = collectClipboardImages(event.clipboardData);
  if (imageFiles.length > 0) {
    event.preventDefault();
    void pasteImageFiles(imageFiles);
    return;
  }

  // Prefer plain text to avoid pasting external styles.
  const html = event.clipboardData.getData("text/html");
  const text = event.clipboardData.getData("text/plain");
  if (!html && !text) return;
  if (!html) return;
  event.preventDefault();
  const markdown = pastedMarkdown(html, text);
  if (!markdown.trim()) return;
  insertMarkdownAtSelection(markdown);
}

function pastedMarkdown(html: string, text: string) {
  if (!html) return text;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("style, script, link, meta, iframe, object, embed, frame, frameset").forEach((node) => node.remove());
  template.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.removeAttribute("style");
    el.removeAttribute("class");
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
    });
  });
  return htmlToMarkdown(template.innerHTML).trim();
}

export function onMarkdownKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    runFormatCommand("bold");
  }
  if (key === "i") {
    event.preventDefault();
    runFormatCommand("italic");
  }
  if (key === "k") {
    event.preventDefault();
    runFormatCommand("link");
  }
}
