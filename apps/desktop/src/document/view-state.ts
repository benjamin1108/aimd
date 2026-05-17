import { state } from "../core/state";
import {
  markdownEl,
  previewEl,
  readerEl,
} from "../core/dom";
import type { Mode } from "../core/types";
import { activeTab } from "./open-document-state";
import { refreshEditScrollSync } from "../editor/scroll-sync";

function paneFor(mode: Mode): HTMLElement {
  if (mode === "edit") return previewEl();
  return readerEl();
}

export function captureActiveViewState() {
  const tab = activeTab();
  if (!tab) return;
  tab.mode = state.mode;
  tab.scroll.read = readerEl().scrollTop;
  tab.scroll.edit = previewEl().scrollTop;
  tab.scroll.source = markdownEl().scrollTop;
  tab.sourceSelection = {
    start: markdownEl().selectionStart ?? 0,
    end: markdownEl().selectionEnd ?? 0,
    direction: markdownEl().selectionDirection || "none",
  };
}

export function restoreActiveViewState(mode = state.mode) {
  const tab = activeTab();
  if (!tab) return;
  const tabId = tab.id;
  const scroll = { ...tab.scroll };
  const selection = { ...tab.sourceSelection };
  const apply = () => {
    const current = activeTab();
    if (!current || current.id !== tabId) return;
    if (mode === "edit") {
      markdownEl().scrollTop = scroll.source || scroll.edit || 0;
      previewEl().scrollTop = scroll.edit || 0;
      refreshEditScrollSync("source");
      markdownEl().setSelectionRange(selection.start, selection.end, selection.direction);
      current.sourceSelection = selection;
      current.scroll.source = markdownEl().scrollTop;
      current.scroll.edit = previewEl().scrollTop;
      return;
    }
    paneFor(mode).scrollTop = scroll[mode] || 0;
    current.scroll[mode] = scroll[mode] || 0;
  };
  apply();
  window.requestAnimationFrame(apply);
}
