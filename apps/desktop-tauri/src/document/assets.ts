import { convertFileSrc } from "@tauri-apps/api/core";
import { ASSET_URI_PREFIX } from "../core/state";
import type { AimdAsset } from "../core/types";

export function resolveLocalAssetPath(asset: Pick<AimdAsset, "localPath" | "url">): string {
  if (typeof asset.localPath === "string" && asset.localPath.length > 0) return asset.localPath;
  if (typeof asset.url === "string" && looksLikeLocalPath(asset.url)) return asset.url;
  return "";
}

export function sanitizeDisplayURL(value?: string): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.startsWith("data:") ? "" : value;
}

export function looksLikeLocalPath(value: string): boolean {
  if (!value || value.startsWith("data:")) return false;
  if (value.startsWith("/") || value.startsWith("\\\\")) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
}

export function filePathToAssetURL(filePath: string): string {
  try {
    return convertFileSrc(filePath);
  } catch {
    return filePath;
  }
}

export function assetIDFromURL(value: string): string {
  if (!value.startsWith(ASSET_URI_PREFIX)) return "";
  const rest = value.slice(ASSET_URI_PREFIX.length);
  const end = rest.search(/[?#]/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

export function rewriteAssetURLs(html: string, assets: AimdAsset[]): string {
  if (!assets.length || !html.includes(ASSET_URI_PREFIX)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const byID = new Map(assets.map((asset) => [asset.id, asset]));
  tpl.content.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const source = img.getAttribute("src") || "";
    const id = img.getAttribute("data-asset-id") || assetIDFromURL(source);
    if (!id) return;
    const asset = byID.get(id);
    if (!asset?.url) return;
    img.dataset.assetId = id;
    img.src = asset.url;
  });
  return tpl.innerHTML;
}
