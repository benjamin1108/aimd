import { state } from "../core/state";
import { markdownEl } from "../core/dom";
import type { AimdDocument, Mode } from "../core/types";
import { applyHTML } from "../ui/outline";
import { setMode } from "../ui/mode";
import { updateChrome } from "../ui/chrome";
import { refreshSourceHighlight } from "../editor/source-highlight";
import { flushInline } from "../editor/inline";
import {
  activeTab,
  addTabAndBind,
  bindFacadeFromTab,
  createOpenDocumentTab,
  findTab,
  findTabByPath,
  hasGitConflictMarkers,
  normalizeDocument,
  replaceActiveTabDocument,
  replaceTabDocument,
  syncActiveTabFromFacade,
} from "./open-document-state";
import { captureActiveViewState, restoreActiveViewState } from "./view-state";

export { hasGitConflictMarkers, inferFormat, normalizeAssets, normalizeDocument } from "./open-document-state";

export function paintActiveDocument(mode: Mode) {
  if (!state.doc) return;
  const tab = activeTab();
  const viewState = tab
    ? { scroll: { ...tab.scroll }, sourceSelection: { ...tab.sourceSelection } }
    : null;
  markdownEl().value = state.doc.markdown;
  refreshSourceHighlight();
  applyHTML(state.doc.html);
  if (tab && viewState && activeTab()?.id === tab.id) {
    tab.scroll = viewState.scroll;
    tab.sourceSelection = viewState.sourceSelection;
  }
  setMode(mode, { skipCapture: true });
  restoreActiveViewState(mode);
  updateChrome();
  window.dispatchEvent(new CustomEvent("aimd-doc-applied"));
}

export function applyDocument(doc: AimdDocument, mode: Mode) {
  replaceActiveTabDocument(doc, mode);
  paintActiveDocument(mode);
}

export async function applyDocumentAsNewTab(
  doc: AimdDocument,
  mode: Mode,
  options: { forceDraft?: boolean } = {},
): Promise<"opened" | "activated"> {
  const normalized = normalizeDocument(doc);
  const existing = !options.forceDraft && normalized.path && !normalized.isDraft
    ? findTabByPath(normalized.path)
    : null;
  if (existing) {
    await activateDocumentTab(existing.id);
    return "activated";
  }
  const tab = createOpenDocumentTab(normalized, mode, { forceDraft: options.forceDraft });
  addTabAndBind(tab);
  paintActiveDocument(mode);
  return "opened";
}

export async function activateDocumentTab(tabId: string): Promise<boolean> {
  const current = activeTab();
  if (current?.id === tabId) {
    syncActiveTabFromFacade();
    updateChrome();
    return true;
  }
  if (state.mode === "edit" && state.inlineDirty) {
    flushInline();
    if (state.inlineDirty) return false;
  }
  captureActiveViewState();
  syncActiveTabFromFacade();
  const target = findTab(tabId);
  if (!target) return false;
  bindFacadeFromTab(target);
  paintActiveDocument(target.mode);
  return true;
}

export function applyDocumentToTab(tabId: string, doc: AimdDocument, mode?: Mode) {
  const tab = replaceTabDocument(tabId, doc, mode);
  if (!tab) return false;
  if (state.openDocuments.activeTabId === tab.id) {
    paintActiveDocument(tab.mode);
  } else {
    updateChrome();
  }
  return true;
}
