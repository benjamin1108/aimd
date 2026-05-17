import { state } from "../core/state";
import {
  emptyEl, readerEl, editorWrapEl,
  gitDiffViewEl,
  modeReadEl, modeEditEl,
  sourceBannerEl, sourceBannerTextEl,
} from "../core/dom";
import type { Mode } from "../core/types";
import { paintPaneIfStale } from "./outline";
import { updateChrome } from "./chrome";
import { captureActiveViewState, restoreActiveViewState } from "../document/view-state";
import { clearRenderedSurfaceInteractionStatus } from "../rendered-surface/interactions";
import { refreshSourceHighlight } from "../editor/source-highlight";
import { refreshFormatToolbarVisibility } from "../editor/toolbar-visibility";

export function refreshSourceBanner() {
  const banner = sourceBannerEl();
  if (!state.doc || state.mode !== "edit") {
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

export function refreshEditPaneOrder() {
  editorWrapEl().dataset.editPaneOrder = state.editPaneOrder;
}

export function setMode(mode: Mode, options: { skipCapture?: boolean } = {}): boolean {
  clearRenderedSurfaceInteractionStatus();
  if (!options.skipCapture) captureActiveViewState();

  state.mode = mode;
  const hasDoc = Boolean(state.doc);
  if (state.mainView === "git-diff") {
    emptyEl().hidden = true;
    readerEl().hidden = true;
    editorWrapEl().hidden = true;
    gitDiffViewEl().hidden = false;
    refreshFormatToolbarVisibility();
    updateChrome();
    return true;
  }

  emptyEl().hidden = hasDoc;
  gitDiffViewEl().hidden = true;
  readerEl().hidden = !hasDoc || mode !== "read";
  editorWrapEl().hidden = !hasDoc || mode !== "edit";
  refreshEditPaneOrder();
  refreshFormatToolbarVisibility();

  // Bring the destination pane in sync with state.doc.html only when its
  // painted version trails the current html version.
  if (hasDoc) {
    paintPaneIfStale(mode);
    if (mode === "edit") {
      refreshSourceHighlight();
      refreshSourceBanner();
    }
    restoreActiveViewState(mode);
  }

  for (const [el, m] of [[modeReadEl(), "read"], [modeEditEl(), "edit"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }

  updateChrome();
  return true;
}
