import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { inlineEditorEl } from "../core/dom";
import type { AddedAsset } from "../core/types";
import { setStatus } from "../ui/chrome";
import { updateChrome } from "../ui/chrome";
import { scheduleRender } from "../ui/outline";
import { normalizeAssets } from "../document/apply";
import { ensureDraftPackage } from "../document/drafts";
import { insertAtCursor } from "./inline";

export const IMG_COMPRESS_MAX_SIDE = 2560;
export const IMG_COMPRESS_THRESHOLD = 300 * 1024;
export const IMG_COMPRESS_QUALITY = 0.82;

export async function compressImageBytes(
  buf: ArrayBuffer,
  originalMime: string,
  originalName: string,
): Promise<{ data: Uint8Array; filename: string; mime: string }> {
  const skipTypes = ["image/gif", "image/svg+xml", "image/webp"];
  if (skipTypes.includes(originalMime) || buf.byteLength < IMG_COMPRESS_THRESHOLD) {
    return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
  }

  const blob = new Blob([buf], { type: originalMime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) {
      return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
    }

    let { naturalWidth: w, naturalHeight: h } = img;
    if (w > IMG_COMPRESS_MAX_SIDE || h > IMG_COMPRESS_MAX_SIDE) {
      if (w >= h) {
        h = Math.round((h / w) * IMG_COMPRESS_MAX_SIDE);
        w = IMG_COMPRESS_MAX_SIDE;
      } else {
        w = Math.round((w / h) * IMG_COMPRESS_MAX_SIDE);
        h = IMG_COMPRESS_MAX_SIDE;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);

    const outMime = "image/jpeg";
    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outMime, IMG_COMPRESS_QUALITY);
    });
    if (!compressed || compressed.size >= buf.byteLength) {
      return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
    }

    const outName = originalName.replace(/\.[^.]+$/, ".jpg");
    return { data: new Uint8Array(await compressed.arrayBuffer()), filename: outName, mime: outMime };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function normalizeAddedAsset(added: AddedAsset): AddedAsset {
  return {
    ...added,
    asset: normalizeAssets([added.asset])[0],
  };
}

export function buildAssetImage(added: AddedAsset): HTMLImageElement {
  const img = document.createElement("img");
  img.src = added.asset.url || "";
  img.alt = added.asset.id;
  img.dataset.assetId = added.asset.id;
  return img;
}

export function insertImageInline(added: AddedAsset) {
  inlineEditorEl().focus();
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    inlineEditorEl().appendChild(buildAssetImage(added));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const figure = buildAssetImage(added);
  range.insertNode(figure);
  // Move caret after the inserted image
  range.setStartAfter(figure);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  inlineEditorEl().dispatchEvent(new Event("input"));
}

export async function insertImage() {
  if (!state.doc) return;
  const imagePath = await invoke<string | null>("choose_image_file");
  if (!imagePath) return;
  setStatus("正在加入图片", "loading");
  try {
    const targetPath = await ensureDraftPackage();
    if (!targetPath || !state.doc) return;
    const rawBytes = await invoke<number[]>("read_image_bytes", { imagePath });
    const rawBuf = new Uint8Array(rawBytes).buffer;
    const ext = imagePath.split(".").pop()?.toLowerCase() ?? "png";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    };
    const mime = mimeMap[ext] ?? "image/png";
    const baseName = imagePath.split(/[\\/]/).pop() ?? `image.${ext}`;
    const compressed = await compressImageBytes(rawBuf, mime, baseName);
    const added = normalizeAddedAsset(await invoke<AddedAsset>("add_image_bytes", {
      path: targetPath,
      filename: compressed.filename,
      data: Array.from(compressed.data),
    }));
    if (state.mode === "edit") {
      insertImageInline(added);
    } else if (state.mode === "source") {
      insertAtCursor(`${added.markdown}\n`);
    } else {
      // In read mode, just append to markdown source for next save.
      state.doc.markdown += `\n${added.markdown}\n`;
    }
    state.doc.assets = [...state.doc.assets, added.asset];
    state.doc.dirty = true;
    if (state.doc.format === "markdown") {
      state.doc.requiresAimdSave = true;
      state.doc.needsAimdSave = true;
    }
    updateChrome();
    if (state.mode === "source") scheduleRender();
    setStatus(
      state.doc.format === "markdown"
        ? "图片已加入，保存时需转换为 AIMD"
        : "图片已就绪，保存后写入正文",
      "info",
    );
  } catch (err) {
    console.error(err);
    setStatus("插入图片失败", "warn");
  }
}
