import {
  editPaneSwapEl,
  formatToolbarEl,
  markdownEl,
  modeToolSlotEl,
  viewportWidthClusterEl,
  viewportWidthToggleEl,
} from "../core/dom";
import { state } from "../core/state";
import { closeWidthPopover } from "../ui/width";

let toolbarPointerActive = false;

function isEditingDocument() {
  return Boolean(state.doc) && state.mode === "edit" && state.mainView !== "git-diff";
}

function isReadingDocument() {
  return Boolean(state.doc) && state.mode === "read" && state.mainView !== "git-diff";
}

function isSourceOrToolbarFocused() {
  const active = document.activeElement;
  return toolbarPointerActive || active === markdownEl() || formatToolbarEl().contains(active);
}

export function refreshFormatToolbarVisibility() {
  const editing = isEditingDocument();
  const toolbar = formatToolbarEl();
  toolbar.hidden = !(editing && isSourceOrToolbarFocused());

  const swap = editPaneSwapEl();
  const reading = isReadingDocument();
  const widthCluster = viewportWidthClusterEl();
  const widthToggle = viewportWidthToggleEl();
  const slot = modeToolSlotEl();
  slot.dataset.toolMode = editing ? "edit" : reading ? "read" : "none";
  slot.hidden = !(editing || reading);
  swap.dataset.visible = editing ? "true" : "false";
  swap.setAttribute("aria-hidden", editing ? "false" : "true");
  swap.hidden = !editing;
  swap.disabled = !editing;
  widthCluster.hidden = !reading;
  widthCluster.setAttribute("aria-hidden", reading ? "false" : "true");
  widthToggle.disabled = !reading;
  if (!reading) closeWidthPopover();
}

export function bindFormatToolbarVisibility() {
  const refreshSoon = () => window.setTimeout(refreshFormatToolbarVisibility, 0);
  markdownEl().addEventListener("focus", refreshFormatToolbarVisibility);
  markdownEl().addEventListener("blur", refreshSoon);
  formatToolbarEl().addEventListener("pointerdown", () => {
    toolbarPointerActive = true;
    refreshFormatToolbarVisibility();
  }, true);
  const clearToolbarPointer = () => {
    if (!toolbarPointerActive) return;
    toolbarPointerActive = false;
    refreshSoon();
  };
  document.addEventListener("pointerup", clearToolbarPointer, true);
  document.addEventListener("pointercancel", clearToolbarPointer, true);
  formatToolbarEl().addEventListener("focusin", refreshFormatToolbarVisibility);
  formatToolbarEl().addEventListener("focusout", refreshSoon);
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === markdownEl() || formatToolbarEl().contains(target)) return;
    refreshSoon();
  });
  refreshFormatToolbarVisibility();
}
