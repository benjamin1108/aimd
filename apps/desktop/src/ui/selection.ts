import { state } from "../core/state";

type SelectAllContext = "main" | "settings";

let lastSelectableRoot: HTMLElement | null = null;
let renderedSurfacePointerDown = false;
let renderedSurfaceSelectionHotUntil = 0;
let selectionTrimFrame = 0;
let isTrimmingRenderedSelection = false;

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
  return Boolean(element?.closest("input, textarea, select"));
}

export function selectElementContents(element: HTMLElement): boolean {
  if (!isVisible(element) || !element.textContent?.length) return false;
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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

  if (lastSelectableRoot && isVisible(lastSelectableRoot)) {
    if (lastSelectableRoot.id === "git-diff-scroll" || lastSelectableRoot.id === "git-diff-content") return lastSelectableRoot;
    if (lastSelectableRoot.closest("#reader, #preview, #format-preview-text, #health-list, .debug-list")) {
      return lastSelectableRoot;
    }
  }

  if (state.mode === "edit") return visibleById<HTMLTextAreaElement>("markdown");
  return visibleById("reader");
}

function selectRoot(root: HTMLElement | HTMLTextAreaElement | null): boolean {
  if (!root) return false;
  if (root instanceof HTMLTextAreaElement) return selectTextarea(root);
  return selectElementContents(root);
}

function renderedSurfaceRoot(target: EventTarget | Node | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target.closest<HTMLElement>("#reader, #preview");
  if (target instanceof Node) return target.parentElement?.closest<HTMLElement>("#reader, #preview") || null;
  return null;
}

function activeRenderedSelectionRoot(): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const anchorRoot = renderedSurfaceRoot(selection.anchorNode);
  const focusRoot = renderedSurfaceRoot(selection.focusNode);
  return anchorRoot && anchorRoot === focusRoot ? anchorRoot : null;
}

function scheduleTrimRenderedSelection() {
  if (selectionTrimFrame) window.cancelAnimationFrame(selectionTrimFrame);
  selectionTrimFrame = window.requestAnimationFrame(() => {
    selectionTrimFrame = 0;
    trimRenderedSelection();
  });
}

function trimRenderedSelection() {
  if (isTrimmingRenderedSelection) return;
  const root = activeRenderedSelectionRoot();
  if (!root || !isVisible(root)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const bounds = selectedTextBounds(root, range);
  if (!bounds) return;

  const next = document.createRange();
  next.setStart(bounds.startNode, bounds.startOffset);
  next.setEnd(bounds.endNode, bounds.endOffset);
  if (sameRangeBoundary(range, next)) return;
  const backward = isBackwardSelection(selection);
  isTrimmingRenderedSelection = true;
  try {
    applySelectionBounds(selection, bounds, backward, next);
  } finally {
    isTrimmingRenderedSelection = false;
  }
}

function applySelectionBounds(
  selection: Selection,
  bounds: { startNode: Text; startOffset: number; endNode: Text; endOffset: number },
  backward: boolean,
  fallbackRange: Range,
) {
  if (selection.setBaseAndExtent) {
    if (backward) {
      selection.setBaseAndExtent(bounds.endNode, bounds.endOffset, bounds.startNode, bounds.startOffset);
    } else {
      selection.setBaseAndExtent(bounds.startNode, bounds.startOffset, bounds.endNode, bounds.endOffset);
    }
    return;
  }
  selection.removeAllRanges();
  selection.addRange(fallbackRange);
}

function isBackwardSelection(selection: Selection): boolean {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) return false;
  if (anchorNode === focusNode) return selection.anchorOffset > selection.focusOffset;
  const range = document.createRange();
  try {
    range.setStart(anchorNode, selection.anchorOffset);
    range.setEnd(focusNode, selection.focusOffset);
    return range.collapsed;
  } catch {
    return false;
  }
}

function selectedTextBounds(
  root: HTMLElement,
  range: Range,
): { startNode: Text; startOffset: number; endNode: Text; endOffset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || !node.data.trim()) continue;
    if (!range.intersectsNode(node)) continue;
    let start = node === range.startContainer ? range.startOffset : 0;
    let end = node === range.endContainer ? range.endOffset : node.data.length;
    if (isCodeTextNode(node)) {
      start = trimCodeLeadingBoundary(node.data, start, end);
      end = trimCodeTrailingBoundary(node.data, start, end);
    }
    if (end <= start || !node.data.slice(start, end).trim()) continue;
    if (!startNode) {
      startNode = node;
      startOffset = start;
    }
    endNode = node;
    endOffset = end;
  }

  return startNode && endNode ? { startNode, startOffset, endNode, endOffset } : null;
}

function isCodeTextNode(node: Text): boolean {
  return Boolean(node.parentElement?.closest("pre,code"));
}

function trimCodeLeadingBoundary(text: string, start: number, end: number): number {
  let nextStart = start;
  while (nextStart < end && /[\r\n]/.test(text[nextStart])) nextStart += 1;
  return nextStart;
}

function trimCodeTrailingBoundary(text: string, start: number, end: number): number {
  let nextEnd = end;
  while (nextEnd > start && /[\s]/.test(text[nextEnd - 1])) nextEnd -= 1;
  return nextEnd;
}

function sameRangeBoundary(a: Range, b: Range): boolean {
  return a.startContainer === b.startContainer
    && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer
    && a.endOffset === b.endOffset;
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
      "#reader, #git-diff-scroll, #preview, #format-preview-text, #health-list, .debug-list",
    ) || null;
    renderedSurfacePointerDown = Boolean(target?.closest("#reader, #preview"));
    renderedSurfaceSelectionHotUntil = renderedSurfacePointerDown ? performance.now() + 1_500 : 0;
  }, { capture: true });
  document.addEventListener("pointerup", () => {
    if (!renderedSurfacePointerDown) return;
    renderedSurfacePointerDown = false;
    renderedSurfaceSelectionHotUntil = 0;
  }, { capture: true });
  document.addEventListener("selectionchange", () => {
    if (!renderedSurfacePointerDown && performance.now() > renderedSurfaceSelectionHotUntil) return;
    trimRenderedSelection();
  });
  document.addEventListener("dblclick", (event) => {
    if (!renderedSurfaceRoot(event.target)) return;
    renderedSurfaceSelectionHotUntil = performance.now() + 250;
    trimRenderedSelection();
    scheduleTrimRenderedSelection();
  }, { capture: true });
}
