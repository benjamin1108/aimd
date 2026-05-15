import { state } from "../core/state";
import type {
  AimdAsset,
  AimdDocument,
  MarkdownSourceModel,
  Mode,
  OpenDocumentId,
  OpenDocumentTab,
} from "../core/types";
import { fileStem, extractHeadingTitle } from "../util/path";
import {
  filePathToAssetURL,
  hasAimdImageReferences,
  hasExternalImageReferences,
  resolveLocalAssetPath,
  sanitizeDisplayURL,
} from "./assets";
import { createSourceModel } from "../editor/source-preserve";

export type DocumentOperationTarget = {
  tabId: string;
  operationVersion: number;
  pathKey?: string | null;
};

let draftCounter = 0;

export function normalizePathKey(path: string | null | undefined): string | null {
  const value = (path || "").trim();
  if (!value) return null;
  return value.replace(/\\/g, "/").toLowerCase();
}

export function normalizeAssets(assets: AimdAsset[]): AimdAsset[] {
  return assets.map((asset) => {
    const localPath = resolveLocalAssetPath(asset);
    const url = localPath ? filePathToAssetURL(localPath) : sanitizeDisplayURL(asset.url);
    return { ...asset, localPath: localPath || undefined, url };
  });
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

export function displayTabTitle(doc: AimdDocument): string {
  return extractHeadingTitle(doc.markdown) || doc.title || fileStem(doc.path) || "未命名文档";
}

export function activeTab(): OpenDocumentTab | null {
  const id = state.openDocuments.activeTabId;
  return id ? state.openDocuments.tabs.find((tab) => tab.id === id) ?? null : null;
}

export function findTab(tabId: OpenDocumentId | null | undefined): OpenDocumentTab | null {
  return tabId ? state.openDocuments.tabs.find((tab) => tab.id === tabId) ?? null : null;
}

export function findTabByPath(path: string): OpenDocumentTab | null {
  const key = normalizePathKey(path);
  return key ? state.openDocuments.tabs.find((tab) => tab.pathKey === key) ?? null : null;
}

export function createOpenDocumentTab(
  doc: AimdDocument,
  mode: Mode,
  options: { id?: string; forceDraft?: boolean } = {},
): OpenDocumentTab {
  const normalized = normalizeDocument(doc);
  const pathKey = options.forceDraft || normalized.isDraft ? null : normalizePathKey(normalized.path);
  const id = options.id || pathKey || `draft-${Date.now().toString(36)}-${++draftCounter}`;
  return {
    id,
    pathKey,
    title: displayTabTitle(normalized),
    doc: normalized,
    sourceModel: createSourceModel(normalized.markdown),
    sourceDirtyRefs: new Set(),
    sourceStructuralDirty: false,
    inlineDirty: false,
    htmlVersion: 0,
    paintedVersion: { read: -1, edit: -1, source: -1 },
    operationVersion: 0,
    mode,
    scroll: { read: 0, edit: 0, source: 0 },
    sourceSelection: { start: 0, end: 0, direction: "none" },
    baseFileFingerprint: null,
    recoveryState: null,
    healthReport: null,
  };
}

export function bindFacadeFromTab(tab: OpenDocumentTab) {
  state.openDocuments.activeTabId = tab.id;
  state.doc = tab.doc;
  state.mode = tab.mode;
  state.sourceModel = tab.sourceModel;
  state.sourceDirtyRefs = tab.sourceDirtyRefs;
  state.sourceStructuralDirty = tab.sourceStructuralDirty;
  state.inlineDirty = tab.inlineDirty;
  state.htmlVersion = tab.htmlVersion;
  state.paintedVersion = { ...tab.paintedVersion };
  state.mainView = "document";
}

export function syncActiveTabFromFacade() {
  const tab = activeTab();
  if (!tab || !state.doc) return;
  tab.doc = state.doc;
  tab.title = displayTabTitle(state.doc);
  tab.pathKey = state.doc.isDraft ? null : normalizePathKey(state.doc.path);
  tab.sourceModel = state.sourceModel as MarkdownSourceModel | null;
  tab.sourceDirtyRefs = state.sourceDirtyRefs;
  tab.sourceStructuralDirty = state.sourceStructuralDirty;
  tab.inlineDirty = state.inlineDirty;
  tab.htmlVersion = state.htmlVersion;
  tab.paintedVersion = { ...state.paintedVersion };
  tab.mode = state.mode;
}

export function addTabAndBind(tab: OpenDocumentTab) {
  syncActiveTabFromFacade();
  state.openDocuments.tabs.push(tab);
  bindFacadeFromTab(tab);
}

export function replaceActiveTabDocument(doc: AimdDocument, mode: Mode): OpenDocumentTab {
  const normalized = normalizeDocument(doc);
  let tab = activeTab();
  if (!tab) {
    tab = createOpenDocumentTab(normalized, mode);
    state.openDocuments.tabs.push(tab);
  } else {
    tab.doc = normalized;
    tab.title = displayTabTitle(normalized);
    tab.pathKey = normalized.isDraft ? null : normalizePathKey(normalized.path);
    tab.sourceModel = createSourceModel(normalized.markdown);
    tab.sourceDirtyRefs = new Set();
    tab.sourceStructuralDirty = false;
    tab.inlineDirty = false;
    tab.htmlVersion = 0;
    tab.paintedVersion = { read: -1, edit: -1, source: -1 };
    tab.operationVersion += 1;
    tab.mode = mode;
    tab.scroll = { read: 0, edit: 0, source: 0 };
    tab.sourceSelection = { start: 0, end: 0, direction: "none" };
    tab.recoveryState = null;
    tab.healthReport = null;
  }
  bindFacadeFromTab(tab);
  return tab;
}

export function replaceTabDocument(tabId: string, doc: AimdDocument, mode?: Mode): OpenDocumentTab | null {
  const tab = findTab(tabId);
  if (!tab) return null;
  const normalized = normalizeDocument(doc);
  tab.doc = normalized;
  tab.title = displayTabTitle(normalized);
  tab.pathKey = normalized.isDraft ? null : normalizePathKey(normalized.path);
  tab.sourceModel = createSourceModel(normalized.markdown);
  tab.sourceDirtyRefs = new Set();
  tab.sourceStructuralDirty = false;
  tab.inlineDirty = false;
  tab.htmlVersion = 0;
  tab.paintedVersion = { read: -1, edit: -1, source: -1 };
  if (mode) tab.mode = mode;
  tab.recoveryState = null;
  tab.healthReport = null;
  if (state.openDocuments.activeTabId === tab.id) bindFacadeFromTab(tab);
  return tab;
}

export function removeTab(tabId: string): OpenDocumentTab | null {
  const index = state.openDocuments.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return null;
  return state.openDocuments.tabs.splice(index, 1)[0] ?? null;
}

export function nextTabIdAfterClose(tabId: string): string | null {
  const tabs = state.openDocuments.tabs;
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state.openDocuments.activeTabId;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
}

export function beginTabOperation(tabId = state.openDocuments.activeTabId): DocumentOperationTarget | null {
  const tab = findTab(tabId);
  if (!tab) return null;
  tab.operationVersion += 1;
  return { tabId: tab.id, operationVersion: tab.operationVersion, pathKey: tab.pathKey };
}

export function isOperationCurrent(target: DocumentOperationTarget | null): boolean {
  if (!target) return false;
  const tab = findTab(target.tabId);
  return Boolean(tab && tab.operationVersion === target.operationVersion);
}

export function isActiveOperationCurrent(target: DocumentOperationTarget | null): boolean {
  return isOperationCurrent(target) && state.openDocuments.activeTabId === target?.tabId;
}

export function updateOpenTabPath(oldPath: string, newPath: string, nextTitle?: string): boolean {
  const tab = findTabByPath(oldPath);
  if (!tab) return false;
  tab.doc.path = newPath;
  tab.doc.title = nextTitle || fileStem(newPath) || tab.doc.title;
  tab.pathKey = normalizePathKey(newPath);
  tab.title = displayTabTitle(tab.doc);
  if (state.openDocuments.activeTabId === tab.id) bindFacadeFromTab(tab);
  return true;
}

export function dirtyTabs(): OpenDocumentTab[] {
  syncActiveTabFromFacade();
  return state.openDocuments.tabs.filter((tab) => tab.doc.dirty);
}
