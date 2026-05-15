import { state } from "../core/state";
import {
  emptyEl, readerEl, inlineEditorEl, editorWrapEl, formatToolbarEl,
  gitDiffViewEl,
  modeReadEl, modeEditEl, modeSourceEl,
  sourceBannerEl, sourceBannerTextEl,
} from "../core/dom";
import type { Mode } from "../core/types";
import { paintPaneIfStale } from "./outline";
import { updateChrome } from "./chrome";
import { flushInline } from "../editor/inline";
import { captureActiveViewState, restoreActiveViewState } from "../document/view-state";
import { clearRenderedSurfaceInteractionStatus } from "../rendered-surface/interactions";
import { refreshSourceHighlight } from "../editor/source-highlight";

export function refreshSourceBanner() {
  const banner = sourceBannerEl();
  if (!state.doc || state.mode !== "source") {
    banner.hidden = true;
    return;
  }
  if (state.doc.hasGitConflicts) {
    sourceBannerTextEl().innerHTML =
      "<strong>Git 冲突</strong>：文档包含 conflict markers，请在 Markdown 中搜索 <<<<<<< 并解决后保存。";
    banner.hidden = false;
    return;
  }
  banner.hidden = true;
}

export function setMode(mode: Mode, options: { skipCapture?: boolean } = {}): boolean {
  clearRenderedSurfaceInteractionStatus();
  if (!options.skipCapture) captureActiveViewState();
  // Flush from the mode we are leaving.
  if (state.mode === "edit" && mode !== "edit") {
    const flushed = flushInline();
    if (!flushed.ok) return false;
  }

  state.mode = mode;
  const hasDoc = Boolean(state.doc);
  if (state.mainView === "git-diff") {
    emptyEl().hidden = true;
    readerEl().hidden = true;
    inlineEditorEl().hidden = true;
    editorWrapEl().hidden = true;
    formatToolbarEl().hidden = true;
    gitDiffViewEl().hidden = false;
    updateChrome();
    return true;
  }

  emptyEl().hidden = hasDoc;
  gitDiffViewEl().hidden = true;
  readerEl().hidden = !hasDoc || mode !== "read";
  inlineEditorEl().hidden = !hasDoc || mode !== "edit";
  editorWrapEl().hidden = !hasDoc || mode !== "source";
  formatToolbarEl().hidden = !hasDoc || mode !== "edit";

  // Bring the destination pane in sync with state.doc.html, but only when
  // its painted version trails the current html version. flushInline keeps
  // state.doc.html updated while editing, and applyHTML keeps reader/preview
  // in sync on open / save / source-mode render — so most mode hops have
  // nothing to repaint and stay snappy on long documents.
  if (hasDoc) {
    paintPaneIfStale(mode);
    if (mode === "source") {
      refreshSourceHighlight();
      refreshSourceBanner();
    }
    restoreActiveViewState(mode);
  }

  for (const [el, m] of [[modeReadEl(), "read"], [modeEditEl(), "edit"], [modeSourceEl(), "source"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }

  updateChrome();
  return true;
}
