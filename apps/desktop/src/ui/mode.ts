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

export function refreshSourceBanner() {
  const banner = sourceBannerEl();
  if (!state.doc || state.mode !== "source") {
    banner.hidden = true;
    return;
  }
  const lines = state.doc.markdown.split("\n");
  if (lines[0] !== "---") {
    banner.hidden = true;
    return;
  }
  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    banner.hidden = true;
    return;
  }
  sourceBannerTextEl().innerHTML =
    `<strong>源码视图</strong>：开头 ${endIndex + 1} 行是 Front-matter。这些通常由阅读 / 编辑模式自动维护，可手改但建议从顶部菜单操作。`;
  banner.hidden = false;
}

export function setMode(mode: Mode) {
  // Flush from the mode we are leaving.
  if (state.mode === "edit" && mode !== "edit") flushInline();

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
    return;
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
    if (mode === "source") refreshSourceBanner();
  }

  for (const [el, m] of [[modeReadEl(), "read"], [modeEditEl(), "edit"], [modeSourceEl(), "source"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }

  updateChrome();
}
