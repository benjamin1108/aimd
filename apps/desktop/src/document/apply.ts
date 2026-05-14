import { state } from "../core/state";
import { markdownEl } from "../core/dom";
import type { AimdAsset, AimdDocument, Mode } from "../core/types";
import {
  filePathToAssetURL, hasAimdImageReferences, hasExternalImageReferences,
  resolveLocalAssetPath, sanitizeDisplayURL,
} from "./assets";
import { applyHTML } from "../ui/outline";
import { setMode } from "../ui/mode";
import { updateChrome } from "../ui/chrome";
import { refreshSourceHighlight } from "../editor/source-highlight";
import { createSourceModel } from "../editor/source-preserve";

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
  const format = inferFormat(doc);
  const assets = normalizeAssets(doc.assets);
  const externalImages = hasExternalImageReferences(doc.markdown);
  const requiresAimdSave = format === "markdown"
    ? Boolean(doc.requiresAimdSave || hasAimdImageReferences(doc.markdown) || assets.length > 0)
    : false;
  return {
    ...doc,
    format,
    assets,
    hasExternalImageReferences: externalImages,
    requiresAimdSave,
    needsAimdSave: requiresAimdSave,
    hasGitConflicts: hasGitConflictMarkers(doc.markdown) || hasGitConflictMarkers(doc.html || ""),
  };
}

export function hasGitConflictMarkers(markdown: string): boolean {
  return markdown.includes("<<<<<<<") && markdown.includes("=======") && markdown.includes(">>>>>>>");
}

export function inferFormat(doc: AimdDocument): "aimd" | "markdown" {
  if (doc.format) return doc.format;
  if (!doc.path) return "aimd";
  const lower = doc.path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) return "markdown";
  return "aimd";
}

export function applyDocument(doc: AimdDocument, mode: Mode) {
  const normalized = normalizeDocument(doc);
  state.doc = normalized;
  state.sourceModel = createSourceModel(normalized.markdown);
  state.sourceDirtyRefs.clear();
  state.sourceStructuralDirty = false;
  state.mainView = "document";
  markdownEl().value = normalized.markdown;
  refreshSourceHighlight();
  applyHTML(normalized.html);
  setMode(mode);
  updateChrome();
  window.dispatchEvent(new CustomEvent("aimd-doc-applied"));
}
