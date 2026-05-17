import { invoke } from "@tauri-apps/api/core";
import { state, STORAGE_SESSION } from "../core/state";
import type { AimdDocument, EditPaneOrder, Mode, OpenDocumentTab, SessionSnapshot } from "../core/types";
import { paintActiveDocument } from "../document/apply";
import { readFileFingerprint } from "../document/fingerprint";
import {
  bindFacadeFromTab,
  createOpenDocumentTab,
  findTab,
  findTabByPath,
  syncActiveTabFromFacade,
} from "../document/open-document-state";
import { captureActiveViewState, restoreActiveViewState } from "../document/view-state";
import { setStatus } from "../ui/chrome";
import { rememberOpenedPath } from "../ui/recents";
import { renderSnapshotHTML } from "./render";

type PersistedOpenTabV2 = {
  kind: "path" | "draft";
  id: string;
  path?: string;
  draftId?: string;
  title: string;
  format: "aimd" | "markdown";
  mode: Mode;
  editPaneOrder?: EditPaneOrder;
  scroll?: { read?: number; edit?: number; source?: number };
  sourceSelection?: { start?: number; end?: number; direction?: "forward" | "backward" | "none" };
  dirtyWorkingCopy?: {
    markdown: string;
    baseFileMtime?: number;
    baseFileSize?: number;
    requiresAimdSave?: boolean;
    hasExternalImageReferences?: boolean;
  };
};

type PersistedOpenDocumentsSessionV2 = {
  schemaVersion: 2;
  activeTabId: string | null;
  tabs: PersistedOpenTabV2[];
  drafts: Array<{
    id: string;
    title: string;
    markdown: string;
    format: "aimd" | "markdown";
    draftSourcePath?: string;
    requiresAimdSave?: boolean;
    hasExternalImageReferences?: boolean;
  }>;
};

export function buildOpenDocumentsSessionSnapshot(): {
  snapshot: PersistedOpenDocumentsSessionV2;
  activePath: string;
} | null {
  captureActiveViewState();
  syncActiveTabFromFacade();
  const tabs = state.openDocuments.tabs;
  if (tabs.length === 0) return null;
  const activeDocumentId = tabs.some((tab) => tab.id === state.openDocuments.activeTabId)
    ? state.openDocuments.activeTabId
    : tabs[0]?.id ?? null;

  const drafts: PersistedOpenDocumentsSessionV2["drafts"] = [];
  const snapshot: PersistedOpenDocumentsSessionV2 = {
    schemaVersion: 2,
    activeTabId: activeDocumentId,
    tabs: tabs.map((tab) => {
      const scroll = { ...tab.scroll };
      const sourceSelection = { ...tab.sourceSelection };
      if (tab.doc.path && !tab.doc.isDraft) {
        return {
          kind: "path",
          id: tab.id,
          path: tab.doc.path,
          title: tab.title || tab.doc.title,
          format: tab.doc.format,
          mode: tab.mode,
          editPaneOrder: tab.editPaneOrder,
          scroll,
          sourceSelection,
          dirtyWorkingCopy: tab.doc.dirty
            ? {
              markdown: tab.doc.markdown,
              baseFileMtime: tab.baseFileFingerprint?.mtimeMs,
              baseFileSize: tab.baseFileFingerprint?.size,
              requiresAimdSave: Boolean(tab.doc.requiresAimdSave),
              hasExternalImageReferences: Boolean(tab.doc.hasExternalImageReferences),
            }
            : undefined,
        };
      }
      drafts.push({
        id: tab.id,
        title: tab.title || tab.doc.title,
        markdown: tab.doc.markdown,
        format: tab.doc.format,
        draftSourcePath: tab.doc.draftSourcePath,
        requiresAimdSave: Boolean(tab.doc.requiresAimdSave),
        hasExternalImageReferences: Boolean(tab.doc.hasExternalImageReferences),
      });
      return {
        kind: "draft",
        id: tab.id,
        draftId: tab.id,
        title: tab.title || tab.doc.title,
        format: tab.doc.format,
        mode: tab.mode,
        editPaneOrder: tab.editPaneOrder,
        scroll,
        sourceSelection,
      };
    }),
    drafts,
  };
  const activePath = tabs.find((tab) => tab.id === activeDocumentId)?.doc.path
    || tabs.find((tab) => tab.doc.path)?.doc.path
    || "";
  return { snapshot, activePath };
}

export function loadOpenDocumentsSessionV2(): PersistedOpenDocumentsSessionV2 | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs
      .filter((tab: any) => tab && typeof tab.id === "string" && (tab.kind === "path" || tab.kind === "draft"))
      .map((tab: any): PersistedOpenTabV2 => ({
        kind: tab.kind,
        id: tab.id,
        path: typeof tab.path === "string" ? tab.path : undefined,
        draftId: typeof tab.draftId === "string" ? tab.draftId : undefined,
        title: typeof tab.title === "string" ? tab.title : "",
        format: asFormat(tab.format),
        mode: asMode(tab.mode),
        editPaneOrder: asEditPaneOrder(tab.editPaneOrder),
        scroll: tab.scroll && typeof tab.scroll === "object" ? tab.scroll : {},
        sourceSelection: tab.sourceSelection && typeof tab.sourceSelection === "object" ? tab.sourceSelection : undefined,
        dirtyWorkingCopy: tab.dirtyWorkingCopy && typeof tab.dirtyWorkingCopy.markdown === "string"
          ? {
            markdown: tab.dirtyWorkingCopy.markdown,
            baseFileMtime: Number.isFinite(tab.dirtyWorkingCopy.baseFileMtime) ? Number(tab.dirtyWorkingCopy.baseFileMtime) : undefined,
            baseFileSize: Number.isFinite(tab.dirtyWorkingCopy.baseFileSize) ? Number(tab.dirtyWorkingCopy.baseFileSize) : undefined,
            requiresAimdSave: Boolean(tab.dirtyWorkingCopy.requiresAimdSave),
            hasExternalImageReferences: Boolean(tab.dirtyWorkingCopy.hasExternalImageReferences),
          }
          : undefined,
      }));
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts.filter((draft: any) => draft && typeof draft.id === "string" && typeof draft.markdown === "string").map((draft: any) => ({
        id: draft.id,
        title: typeof draft.title === "string" ? draft.title : "未命名文档",
        markdown: draft.markdown,
        format: asFormat(draft.format),
        draftSourcePath: typeof draft.draftSourcePath === "string" ? draft.draftSourcePath : undefined,
        requiresAimdSave: Boolean(draft.requiresAimdSave),
        hasExternalImageReferences: Boolean(draft.hasExternalImageReferences),
      }))
      : [];
    return {
      schemaVersion: 2,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      tabs,
      drafts,
    };
  } catch {
    return null;
  }
}

export async function restoreOpenDocumentsSession(session: PersistedOpenDocumentsSessionV2): Promise<boolean> {
  const drafts = new Map(session.drafts.map((draft) => [draft.id, draft]));
  let skipped = 0;
  let conflict = false;

  for (const item of session.tabs) {
    if (findTab(item.id)) continue;
    if (item.kind === "path") {
      const path = item.path || "";
      if (!path || findTabByPath(path)) continue;
      const restored = await restorePathTab(item);
      if (!restored) {
        skipped += 1;
        continue;
      }
      const tab = createOpenDocumentTab(restored.doc, item.mode, { id: item.id });
      tab.editPaneOrder = item.editPaneOrder || "source-first";
      applyPersistedViewState(tab, item);
      tab.baseFileFingerprint = restored.fingerprint;
      tab.recoveryState = restored.recoveryState;
      if (tab.recoveryState === "disk-changed") conflict = true;
      state.openDocuments.tabs.push(tab);
      rememberOpenedPath(restored.doc.path);
      void registerRestoredPath(restored.doc.path);
      continue;
    }

    const draft = drafts.get(item.draftId || item.id);
    if (!draft) continue;
    const html = await renderSnapshotHTML({
      path: "",
      title: draft.title,
      markdown: draft.markdown,
      html: "",
      assets: [],
      dirty: true,
      isDraft: true,
      draftSourcePath: draft.draftSourcePath,
      requiresAimdSave: draft.requiresAimdSave,
      hasExternalImageReferences: draft.hasExternalImageReferences,
      format: draft.format,
      mode: item.mode,
      editPaneOrder: item.editPaneOrder,
    });
    const doc: AimdDocument = {
      path: "",
      title: draft.title,
      markdown: draft.markdown,
      html,
      assets: [],
      dirty: true,
      isDraft: true,
      draftSourcePath: draft.draftSourcePath,
      requiresAimdSave: draft.requiresAimdSave,
      needsAimdSave: draft.requiresAimdSave,
      hasExternalImageReferences: draft.hasExternalImageReferences,
      format: draft.format,
    };
    const tab = createOpenDocumentTab(doc, item.mode, { id: item.id, forceDraft: true });
    tab.editPaneOrder = item.editPaneOrder || "source-first";
    applyPersistedViewState(tab, item);
    state.openDocuments.tabs.push(tab);
  }

  if (state.openDocuments.tabs.length === 0) {
    if (skipped > 0) setStatus("上次会话中的文件不可用，已跳过恢复", "warn");
    return skipped > 0;
  }
  const active = findTab(session.activeTabId) || state.openDocuments.tabs[0];
  if (active) {
    bindFacadeFromTab(active);
    paintActiveDocument(active.mode);
    restoreActiveViewState(active.mode);
  }
  if (conflict) setStatus("已恢复工作副本；部分磁盘文件已变化，请检查后保存", "warn");
  else if (skipped > 0) setStatus("已恢复可用标签页，部分文件不可用已跳过", "info");
  else setStatus("已恢复上次标签页", "info");
  return true;
}

export async function registerRestoredPath(path: string) {
  try {
    await invoke("register_window_path", { path });
  } catch {
    // Older builds / e2e mocks may not expose the command.
  }
}

function asMode(value: unknown): Mode {
  return value === "edit" || value === "source" ? "edit" : "read";
}

function asEditPaneOrder(value: unknown): EditPaneOrder {
  return value === "preview-first" ? "preview-first" : "source-first";
}

function asFormat(value: unknown): "aimd" | "markdown" {
  return value === "markdown" ? "markdown" : "aimd";
}

function applyPersistedViewState(tab: OpenDocumentTab, data: PersistedOpenTabV2) {
  tab.scroll = {
    read: Number(data.scroll?.read || 0),
    edit: Number(data.scroll?.edit ?? data.scroll?.source ?? 0),
  };
  tab.editPaneOrder = data.editPaneOrder || "source-first";
  tab.sourceSelection = {
    start: Number(data.sourceSelection?.start || 0),
    end: Number(data.sourceSelection?.end || 0),
    direction: data.sourceSelection?.direction || "none",
  };
}

async function restorePathTab(item: PersistedOpenTabV2): Promise<{
  doc: AimdDocument;
  fingerprint: { mtimeMs: number; size: number } | null;
  recoveryState: "disk-changed" | null;
} | null> {
  const path = item.path || "";
  const fingerprint = await readFileFingerprint(path);
  let diskDoc: AimdDocument | null = null;
  try {
    if (item.format === "markdown") {
      const draft = await invoke<{ markdown: string; title: string; html: string }>("convert_md_to_draft", { markdownPath: path });
      diskDoc = {
        path,
        title: draft.title || item.title,
        markdown: draft.markdown,
        html: draft.html,
        assets: [],
        dirty: false,
        isDraft: false,
        format: "markdown",
      };
    } else {
      diskDoc = { ...(await invoke<AimdDocument>("open_aimd", { path })), isDraft: false, format: "aimd", dirty: false };
    }
  } catch {
    if (!item.dirtyWorkingCopy) return null;
  }

  const dirty = item.dirtyWorkingCopy;
  if (!dirty) return diskDoc ? { doc: diskDoc, fingerprint, recoveryState: null } : null;

  const baseMatches = fingerprint
    && dirty.baseFileMtime !== undefined
    && dirty.baseFileSize !== undefined
    && fingerprint.mtimeMs === dirty.baseFileMtime
    && fingerprint.size === dirty.baseFileSize;
  const recoveryState = baseMatches || !fingerprint ? null : "disk-changed";
  const html = await renderSnapshotHTML({
    path,
    title: item.title || diskDoc?.title || "",
    markdown: dirty.markdown,
    html: diskDoc?.html || "",
    assets: diskDoc?.assets || [],
    dirty: true,
    isDraft: false,
    requiresAimdSave: dirty.requiresAimdSave,
    hasExternalImageReferences: dirty.hasExternalImageReferences,
    format: item.format,
    mode: item.mode,
    editPaneOrder: item.editPaneOrder,
  });
  return {
    doc: {
      ...(diskDoc || {
        path,
        title: item.title || "恢复的文档",
        assets: [],
        format: item.format,
      }),
      path,
      title: item.title || diskDoc?.title || "恢复的文档",
      markdown: dirty.markdown,
      html,
      dirty: true,
      isDraft: false,
      requiresAimdSave: dirty.requiresAimdSave,
      needsAimdSave: dirty.requiresAimdSave,
      hasExternalImageReferences: dirty.hasExternalImageReferences,
      format: item.format,
    },
    fingerprint,
    recoveryState,
  };
}
