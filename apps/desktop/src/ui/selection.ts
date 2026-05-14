import { state } from "../core/state";

type SelectAllContext = "main" | "settings";

let lastSelectableRoot: HTMLElement | null = null;

function elementFromTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

export function isNativeFormTarget(target: EventTarget | null): boolean {
  const element = elementFromTarget(target);
  return Boolean(element?.closest("input, textarea, select"));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = elementFromTarget(target);
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

export function selectElementContents(element: HTMLElement): boolean {
  if (!isVisible(element) || !element.textContent?.length) return false;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function selectionInside(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean(anchor && focus && root.contains(anchor) && root.contains(focus));
}

function selectTextarea(textarea: HTMLTextAreaElement): boolean {
  if (!isVisible(textarea)) return false;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(0, textarea.value.length);
  return true;
}

function nativeFormElement(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const element = elementFromTarget(target);
  return element?.closest<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select") || null;
}

function handleNativeControlSelectAll(event: KeyboardEvent): boolean {
  const control = nativeFormElement(event.target) || nativeFormElement(document.activeElement);
  if (!control) return false;
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    event.preventDefault();
    event.stopPropagation();
    control.focus({ preventScroll: true });
    control.select();
    return true;
  }
  event.preventDefault();
  event.stopPropagation();
  window.getSelection()?.removeAllRanges();
  return true;
}

function visibleById<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id) as T | null;
  return element && isVisible(element) ? element : null;
}

function overlaySelectAllRoot(): HTMLElement | "block" | null {
  for (const id of ["format-preview-panel", "health-panel"]) {
    const panel = visibleById(id);
    if (!panel) continue;
    const content = panel.querySelector<HTMLElement>("[data-select-all-scope], pre, .health-list");
    return content && isVisible(content) ? content : null;
  }
  for (const id of ["save-format-panel", "web-clip-panel", "link-popover", "image-alt-popover"]) {
    if (visibleById(id)) return "block";
  }
  return null;
}

function mainSelectAllRoot(): HTMLElement | HTMLTextAreaElement | null {
  const overlayRoot = overlaySelectAllRoot();
  if (overlayRoot === "block") return null;
  if (overlayRoot) return overlayRoot;

  if (state.mainView === "git-diff") {
    return visibleById("git-diff-scroll") || visibleById("git-diff-content");
  }

  const inlineEditor = visibleById("inline-editor");
  if (inlineEditor && (document.activeElement === inlineEditor || selectionInside(inlineEditor))) {
    return inlineEditor;
  }

  if (lastSelectableRoot && isVisible(lastSelectableRoot)) {
    if (lastSelectableRoot.id === "git-diff-scroll" || lastSelectableRoot.id === "git-diff-content") return lastSelectableRoot;
    if (lastSelectableRoot.closest("#reader, #inline-editor, #preview, #format-preview-text, #health-list, .debug-list")) {
      return lastSelectableRoot;
    }
  }

  if (state.mode === "source") return visibleById<HTMLTextAreaElement>("markdown");
  if (state.mode === "edit") return visibleById("inline-editor");
  return visibleById("reader");
}

function selectRoot(root: HTMLElement | HTMLTextAreaElement | null): boolean {
  if (!root) return false;
  if (root instanceof HTMLTextAreaElement) return selectTextarea(root);
  return selectElementContents(root);
}

export function handleSelectAllShortcut(event: KeyboardEvent, context: SelectAllContext = "main"): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "a") {
    return false;
  }

  if (isNativeFormTarget(event.target) || isNativeFormTarget(document.activeElement)) {
    return handleNativeControlSelectAll(event);
  }

  event.preventDefault();
  event.stopPropagation();

  if (context === "settings") {
    window.getSelection()?.removeAllRanges();
    return true;
  }

  if (selectRoot(mainSelectAllRoot())) return true;
  window.getSelection()?.removeAllRanges();
  return true;
}

export function bindSelectionBoundary(context: SelectAllContext = "main") {
  document.addEventListener("keydown", (event) => {
    handleSelectAllShortcut(event, context);
  }, { capture: true });

  if (context !== "main") return;
  document.addEventListener("pointerdown", (event) => {
    const target = elementFromTarget(event.target);
    lastSelectableRoot = target?.closest<HTMLElement>(
      "#reader, #inline-editor, #git-diff-scroll, #preview, #format-preview-text, #health-list, .debug-list",
    ) || null;
  }, { capture: true });
}
