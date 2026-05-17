import { state } from "../core/state";

type SelectAllContext = "main" | "settings";

let lastSelectableRoot: HTMLElement | null = null;
let doubleClickAnchor: {
  block: HTMLElement;
  node: Text | null;
  offset: number;
  root: HTMLElement;
  until: number;
} | null = null;

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

function renderedSurfaceRoot(target: HTMLElement | null): HTMLElement | null {
  return target?.closest<HTMLElement>("#reader, #preview") || null;
}

function selectableBlock(target: HTMLElement | null, root: HTMLElement): HTMLElement | null {
  const block = target?.closest<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th");
  return block && root.contains(block) ? block : null;
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

function textAnchorFromPoint(event: MouseEvent, block: HTMLElement): { node: Text | null; offset: number } {
  const caret = caretRangeFromPoint(event.clientX, event.clientY);
  const node = caret?.startContainer;
  if (node instanceof Text && block.contains(node)) {
    return { node, offset: caret?.startOffset ?? 0 };
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const fallback = walker.nextNode();
  return { node: fallback instanceof Text ? fallback : null, offset: 0 };
}

function rememberDoubleClickAnchor(event: MouseEvent) {
  if (event.detail < 2) return;
  const target = elementFromTarget(event.target);
  const root = renderedSurfaceRoot(target);
  if (!root) {
    doubleClickAnchor = null;
    return;
  }
  const block = selectableBlock(target, root);
  if (!block) {
    doubleClickAnchor = null;
    return;
  }
  const anchor = textAnchorFromPoint(event, block);
  doubleClickAnchor = {
    block,
    node: anchor.node,
    offset: anchor.offset,
    root,
    until: performance.now() + 900,
  };
}

function normalizeDoubleClickSelection() {
  const anchor = doubleClickAnchor;
  if (!anchor || performance.now() > anchor.until || !isVisible(anchor.root) || !isVisible(anchor.block)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!anchor.root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== anchor.root) return;
  if (selectionInside(anchor.block)) return;
  selectWordAtAnchor(anchor);
}

function selectWordAtAnchor(anchor: NonNullable<typeof doubleClickAnchor>) {
  const node = anchor.node && anchor.block.contains(anchor.node) ? anchor.node : firstTextNode(anchor.block);
  if (!node || !node.data.length) return;
  const index = nearestWordIndex(node.data, anchor.offset);
  if (index === null) return;
  const [start, end] = wordBounds(node.data, index);
  if (start === end) return;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function firstTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
}

function nearestWordIndex(text: string, offset: number): number | null {
  const start = Math.max(0, Math.min(offset, text.length - 1));
  for (let distance = 0; distance < text.length; distance += 1) {
    const left = start - distance;
    const right = start + distance;
    if (left >= 0 && isWordChar(text[left])) return left;
    if (right < text.length && isWordChar(text[right])) return right;
  }
  return null;
}

function wordBounds(text: string, index: number): [number, number] {
  let start = index;
  let end = index + 1;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return [start, end];
}

function isWordChar(char: string | undefined): boolean {
  return Boolean(char && /[\p{L}\p{N}_$.-]/u.test(char));
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
  document.addEventListener("mousedown", rememberDoubleClickAnchor, { capture: true });
  document.addEventListener("dblclick", () => {
    window.requestAnimationFrame(normalizeDoubleClickSelection);
    window.setTimeout(normalizeDoubleClickSelection, 0);
  }, { capture: true });
  document.addEventListener("pointerdown", (event) => {
    const target = elementFromTarget(event.target);
    lastSelectableRoot = target?.closest<HTMLElement>(
      "#reader, #git-diff-scroll, #preview, #format-preview-text, #health-list, .debug-list",
    ) || null;
  }, { capture: true });
}
