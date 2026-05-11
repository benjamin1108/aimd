import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { AimdDocument, AssetEntry } from "../core/types";
import { setStatus } from "../ui/chrome";
import { applyDocument } from "./apply";
import {
  compressImageBytes, IMG_COMPRESS_THRESHOLD,
} from "../editor/images";

const OPTIMIZE_MIN_SAVING_RATIO = 0.10;
const OPTIMIZE_MIN_SAVING_BYTES = 50 * 1024;
const OPTIMIZE_TOAST_THRESHOLD = 100 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function triggerOptimizeOnOpen(docPath: string) {
  if ((window as any).__aimd_e2e_disable_auto_optimize) return;
  try {
    setStatus("正在检查图片优化空间", "loading");
    const startedDocPath = docPath;
    const result = await optimizeDocumentAssets(docPath, startedDocPath);
    if (result.optimized === 0) {
      setStatus("就绪", "idle");
      return;
    }
    if (!state.doc || state.doc.path !== docPath) return;
    if (!state.doc.dirty) {
      const refreshed = await invoke<AimdDocument>("open_aimd", { path: docPath });
      if (state.doc?.path === docPath && !state.doc.dirty) {
        applyDocument({ ...refreshed, isDraft: false, format: "aimd", dirty: false }, state.mode);
      }
    }
    if (result.savedBytes >= OPTIMIZE_TOAST_THRESHOLD) {
      setStatus(`已自动压缩 ${result.optimized} 张图片，节省 ${formatBytes(result.savedBytes)}`, "success");
    } else {
      setStatus("就绪", "idle");
    }
  } catch (err) {
    console.error("optimizeDocumentAssets:", err);
    setStatus("就绪", "idle");
  }
}

export async function optimizeDocumentAssets(
  path: string,
  guardPath?: string,
): Promise<{ optimized: number; savedBytes: number }> {
  const skipTypes = ["image/gif", "image/svg+xml", "image/webp", "image/jpeg"];
  const entries = await invoke<AssetEntry[]>("list_aimd_assets", { path });
  let optimized = 0;
  let savedBytes = 0;

  for (const entry of entries) {
    if (!entry.mime.startsWith("image/")) continue;
    if (skipTypes.includes(entry.mime)) continue;
    if (entry.size < IMG_COMPRESS_THRESHOLD) continue;

    if (guardPath !== undefined && state.doc?.path !== guardPath) break;

    try {
      const rawBytes = await invoke<number[]>("read_aimd_asset", { path, assetName: entry.name });
      const rawBuf = new Uint8Array(rawBytes).buffer;
      const baseName = entry.name.split("/").pop() ?? entry.name;
      const compressed = await compressImageBytes(rawBuf, entry.mime, baseName);
      const saving = rawBuf.byteLength - compressed.data.byteLength;
      if (saving < OPTIMIZE_MIN_SAVING_BYTES) continue;
      if (saving / rawBuf.byteLength < OPTIMIZE_MIN_SAVING_RATIO) continue;

      if (guardPath !== undefined && state.doc?.path !== guardPath) break;

      await invoke("replace_aimd_asset", {
        path,
        oldName: baseName,
        newName: baseName,
        bytes: Array.from(compressed.data),
      });

      savedBytes += saving;
      optimized += 1;
    } catch (err) {
      console.error(`optimizeDocumentAssets skip ${entry.name}:`, err);
    }
  }

  return { optimized, savedBytes };
}
