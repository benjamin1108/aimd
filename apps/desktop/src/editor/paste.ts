import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { inlineEditorEl } from "../core/dom";
import type { AddedAsset } from "../core/types";
import { setStatus, updateChrome } from "../ui/chrome";
import { scheduleRender } from "../ui/outline";
import { ensureDraftPackage } from "../document/drafts";
import {
  compressImageBytes, normalizeAddedAsset,
  insertImageInline,
} from "./images";
import {
  sanitizePastedHTML,
  MAX_TITLE_LENGTH,
} from "./inline";
import { insertAtCursor } from "./inline";
import { closestBlock, runFormatCommand } from "./format-toolbar";

function isHeading(el: Element | null): boolean {
  return !!el && /^H[1-6]$/.test(el.tagName);
}

/** True when `range` is collapsed at the very first caret position of `block`,
 *  i.e. there is no text content between block-start and the caret. Walking
 *  the DOM is fragile (mixed text nodes, inline wrappers); using a probe
 *  range and asking for its toString length is robust to nested inlines. */
function isAtBlockStart(range: Range, block: Element): boolean {
  if (!range.collapsed) return false;
  const probe = document.createRange();
  try {
    probe.setStart(block, 0);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length === 0;
  } catch {
    return false;
  }
}

/** Lightweight printable-key check: a single-char `event.key` with no
 *  modifier and no IME composition. Used to gate the H1 length cap so that
 *  shortcuts (Ctrl+S etc.), arrows, and IME candidate selection still work. */
function isPrintableKey(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  return true;
}

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
      if (target === "edit") {
        insertImageInline(added);
      } else {
        insertAtCursor(`${added.markdown}\n`);
      }
      state.doc.assets = [...state.doc.assets, added.asset];
      state.doc.dirty = true;
      if (state.doc.format === "markdown") {
        state.doc.requiresAimdSave = true;
        state.doc.needsAimdSave = true;
      }
    }
    updateChrome();
    if (target === "source") scheduleRender();
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
  // Backspace at the very start of a block must not merge it into an H1-H6
  // sibling above. The default contenteditable Backspace would absorb the
  // body paragraph into the heading, growing the title without bound — the
  // workspace-head doc-title and the H1 in the editor then push every other
  // header control off-screen, and the user has no good way to recover.
  if (
    event.key === "Backspace" &&
    !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
  ) {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const block = closestBlock(range.startContainer);
      if (block && isAtBlockStart(range, block) && isHeading(block.previousElementSibling)) {
        event.preventDefault();
        return;
      }
    }
  }

  // Hard cap on H1 (the document title) length. Block printable input once
  // the limit is hit. inline.ts#enforceTitleLength is the safety net for
  // paste / IME commit / dictation paths that bypass keydown.
  if (isPrintableKey(event)) {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const block = closestBlock(sel.getRangeAt(0).startContainer);
      if (block && block.tagName === "H1" && (block.textContent?.length ?? 0) >= MAX_TITLE_LENGTH) {
        event.preventDefault();
        return;
      }
    }
  }

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
