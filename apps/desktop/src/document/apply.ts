import { state } from "../core/state";
import { markdownEl } from "../core/dom";
import type { AimdAsset, AimdDocument, Mode } from "../core/types";
import {
  filePathToAssetURL, resolveLocalAssetPath, sanitizeDisplayURL,
} from "./assets";
import { applyHTML } from "../ui/outline";
import { setMode } from "../ui/mode";
import { updateChrome } from "../ui/chrome";
import { refreshSourceHighlight } from "../editor/source-highlight";

export function normalizeAssets(assets: AimdAsset[]): AimdAsset[] {
  return assets.map((asset) => {
    const localPath = resolveLocalAssetPath(asset);
    const url = localPath ? filePathToAssetURL(localPath) : sanitizeDisplayURL(asset.url);
    return {
      ...asset,
      localPath: localPath || undefined,
      url,
    };
  });
}

export function normalizeDocument(doc: AimdDocument): AimdDocument {
  return {
    ...doc,
    assets: normalizeAssets(doc.assets),
  };
}

export function inferFormat(doc: AimdDocument): "aimd" | "markdown" {
  if (doc.format) return doc.format;
  if (!doc.path) return "aimd";
  const lower = doc.path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) return "markdown";
  return "aimd";
}

export function applyDocument(doc: AimdDocument, mode: Mode) {
  const withFormat: AimdDocument = { ...doc, format: inferFormat(doc) };
  const normalized = normalizeDocument(withFormat);
  state.doc = normalized;
  markdownEl().value = normalized.markdown;
  refreshSourceHighlight();
  applyHTML(normalized.html);
  setMode(mode);
  updateChrome();
}
