import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { inlineEditorEl } from "../core/dom";
import type { AddedAsset } from "../core/types";
import { setStatus, updateChrome } from "../ui/chrome";
import { scheduleRender } from "../ui/outline";
import { upgradeMarkdownToAimd, saveDocumentAs } from "../document/persist";
import {
  compressImageBytes, normalizeAddedAsset,
  insertImageInline,
} from "./images";
import {
  sanitizePastedHTML,
} from "./inline";
import { insertAtCursor } from "./inline";
import { closestBlock, runFormatCommand } from "./format-toolbar";

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

export async function pasteImageFiles(files: File[], target: "edit" | "source") {
  if (!state.doc) return;
  if (state.doc.format === "markdown") {
    const upgraded = await upgradeMarkdownToAimd();
    if (!upgraded) return;
  }
  if (state.doc.isDraft || !state.doc.path) {
    const confirmed = window.confirm(
      "图片需要先保存到文件系统，是否现在创建 .aimd 文件？\n取消后可继续编辑，图片将在保存后再粘贴。",
    );
    if (!confirmed) return;
    await saveDocumentAs();
    if (!state.doc?.path) return;
  }
  setStatus("正在加入粘贴的图片", "loading");
  try {
    for (const file of files) {
      const rawBuf = await file.arrayBuffer();
      const baseName = (file.name && file.name.length > 0)
        ? file.name
        : `pasted-${Date.now()}.${guessImageExt(file.type)}`;
      const compressed = await compressImageBytes(rawBuf, file.type, baseName);
      const added = normalizeAddedAsset(await invoke<AddedAsset>("add_image_bytes", {
        path: state.doc.path,
        filename: compressed.filename,
        data: Array.from(compressed.data),
      }));
      if (target === "edit") {
        insertImageInline(added);
      } else {
        insertAtCursor(`${added.markdown}\n`);
      }
      state.doc.assets = [...state.doc.assets, added.asset];
      state.doc.dirty = true;
    }
    updateChrome();
    if (target === "source") scheduleRender();
    setStatus("已粘贴图片", "success");
  } catch (err) {
    console.error(err);
    setStatus("粘贴图片失败", "warn");
  }
}

export function onInlinePaste(event: ClipboardEvent) {
  if (!event.clipboardData) return;

  const imageFiles = collectClipboardImages(event.clipboardData);
  if (imageFiles.length > 0) {
    event.preventDefault();
    void pasteImageFiles(imageFiles, "edit");
    return;
  }

  // Prefer plain text to avoid pasting external styles.
  const html = event.clipboardData.getData("text/html");
  const text = event.clipboardData.getData("text/plain");
  if (!html && !text) return;
  event.preventDefault();
  const fragment = html ? sanitizePastedHTML(html) : document.createTextNode(text);
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    inlineEditorEl().appendChild(fragment);
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
  }
  inlineEditorEl().dispatchEvent(new Event("input"));
}

export function onInlineKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const block = closestBlock(range.startContainer);
      if (block && /^H[1-6]$/.test(block.tagName)) {
        event.preventDefault();
        // Extract content from cursor to end of heading into the new paragraph.
        const afterRange = range.cloneRange();
        afterRange.setEnd(block, block.childNodes.length);
        const fragment = afterRange.extractContents();
        const p = document.createElement("p");
        if (fragment.textContent && fragment.textContent.length > 0) {
          p.appendChild(fragment);
        } else {
          p.appendChild(document.createElement("br"));
        }
        block.after(p);
        const r = document.createRange();
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        inlineEditorEl().dispatchEvent(new Event("input"));
      }
    }
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === "b") { event.preventDefault(); runFormatCommand("bold"); }
    if (key === "i") { event.preventDefault(); runFormatCommand("italic"); }
    if (key === "k") { event.preventDefault(); runFormatCommand("link"); }
  }
}
