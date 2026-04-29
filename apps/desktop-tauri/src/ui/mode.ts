import { state } from "../core/state";
import {
  emptyEl, readerEl, inlineEditorEl, editorWrapEl, formatToolbarEl,
  modeReadEl, modeEditEl, modeSourceEl,
} from "../core/dom";
import type { Mode } from "../core/types";
import { paintPaneIfStale } from "./outline";
import { updateChrome } from "./chrome";
import { flushInline } from "../editor/inline";

export function setMode(mode: Mode) {
  // Flush from the mode we are leaving.
  if (state.mode === "edit" && mode !== "edit") flushInline();

  state.mode = mode;
  const hasDoc = Boolean(state.doc);

  emptyEl().hidden = hasDoc;
  readerEl().hidden = !hasDoc || mode !== "read";
  inlineEditorEl().hidden = !hasDoc || mode !== "edit";
  editorWrapEl().hidden = !hasDoc || mode !== "source";
  formatToolbarEl().hidden = !hasDoc || mode !== "edit";

  // Bring the destination pane in sync with state.doc.html, but only when
  // its painted version trails the current html version. flushInline keeps
  // state.doc.html updated while editing, and applyHTML keeps reader/preview
  // in sync on open / save / source-mode render — so most mode hops have
  // nothing to repaint and stay snappy on long documents.
  if (hasDoc) paintPaneIfStale(mode);

  for (const [el, m] of [[modeReadEl(), "read"], [modeEditEl(), "edit"], [modeSourceEl(), "source"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }
  updateChrome();
}
