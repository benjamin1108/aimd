import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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

export function hasRemoteImageReferences(markdown: string): boolean {
  return /!\[[^\]]*]\(\s*https?:\/\/[^\s)]+/i.test(markdown)
    || /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+/i.test(markdown);
}

export function hasLocalImageReferences(markdown: string): boolean {
  return /!\[[^\]]*]\(\s*(?!https?:\/\/|data:|asset:\/\/)[^)]+/i.test(markdown)
    || /<img\b[^>]*\bsrc\s*=\s*["'](?!https?:\/\/|data:|asset:\/\/)[^"']+/i.test(markdown);
}

export function hasExternalImageReferences(markdown: string): boolean {
  return hasLocalImageReferences(markdown) || hasRemoteImageReferences(markdown);
}

export function hasAimdImageReferences(markdown: string): boolean {
  return /!\[[^\]]*]\(\s*asset:\/\/[^)]+/i.test(markdown)
    || /<img\b[^>]*\bsrc\s*=\s*["']asset:\/\/[^"']+/i.test(markdown);
}

export function filePathToAssetURL(filePath: string): string {
  try {
    return convertFileSrc(filePath);
  } catch {
    return filePath;
  }
}

function splitURLSuffix(value: string): { path: string; suffix: string } {
  const index = value.search(/[?#]/);
  if (index < 0) return { path: value, suffix: "" };
  return { path: value.slice(0, index), suffix: value.slice(index) };
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function normalizeLocalPath(path: string): string {
  const isWindows = /^[A-Za-z]:\//.test(path);
  const prefix = isWindows ? path.slice(0, 2) : (path.startsWith("/") ? "/" : "");
  const body = isWindows ? path.slice(2) : path;
  const parts: string[] = [];
  body.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return isWindows ? `${prefix}/${parts.join("/")}` : `${prefix}${parts.join("/")}`;
}

function resolveMarkdownImagePath(basePath: string, src: string): string {
  const { path } = splitURLSuffix(src);
  return resolveMarkdownImageFilePath(basePath, path);
}

function resolveMarkdownImageFilePath(basePath: string, src: string): string {
  const decoded = decodeURIComponent(src);
  return looksLikeLocalPath(decoded)
    ? decoded
    : normalizeLocalPath(`${parentDir(basePath)}/${decoded}`);
}

function imageMimeByPath(path: string): string {
  const lower = path.toLowerCase().split(/[?#]/, 1)[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/png";
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

export function rewriteMarkdownLocalImageURLs(html: string, markdownPath: string): string {
  if (!markdownPath || !html.includes("<img")) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith(ASSET_URI_PREFIX) || src.startsWith("data:") || /^https?:\/\//i.test(src)) return;
    const { suffix } = splitURLSuffix(src);
    const localPath = resolveMarkdownImagePath(markdownPath, src);
    img.dataset.aimdLocalImagePath = localPath;
    img.dataset.aimdLocalImageSuffix = suffix;
    img.src = filePathToAssetURL(localPath) + suffix;
  });
  return tpl.innerHTML;
}

const localImageObjectURLs = new Map<string, string>();

export async function hydrateMarkdownLocalImages(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img[data-aimd-local-image-path]"));
  await Promise.all(images.map(async (img) => {
    const imagePath = img.dataset.aimdLocalImagePath || "";
    if (!imagePath) return;
    try {
      let objectURL = localImageObjectURLs.get(imagePath);
      if (!objectURL) {
        const bytes = await invoke<number[]>("read_image_bytes", { imagePath });
        const blob = new Blob([new Uint8Array(bytes)], { type: imageMimeByPath(imagePath) });
        objectURL = URL.createObjectURL(blob);
        localImageObjectURLs.set(imagePath, objectURL);
      }
      img.src = objectURL + (img.dataset.aimdLocalImageSuffix || "");
    } catch (err) {
      console.warn("hydrate markdown image failed", imagePath, err);
    }
  }));
}
