import { state } from "../core/state";
import {
  findBarEl, findInputEl, replaceInputEl, findCountEl,
  findPrevEl, findNextEl, replaceOneEl, replaceAllEl, findCloseEl,
  findToggleEl, markdownEl, readerEl, inlineEditorEl, previewEl,
} from "../core/dom";
import { setStatus, updateChrome } from "../ui/chrome";
import { flushInline, insertAtCursor } from "./inline";

let activeIndex = -1;

export function bindSearch() {
  findToggleEl().addEventListener("click", () => openFindBar());
  findCloseEl().addEventListener("click", closeFindBar);
  findInputEl().addEventListener("input", () => {
    activeIndex = -1;
    findNext();
  });
  findInputEl().addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.shiftKey ? findPrev() : findNext();
    }
    if (event.key === "Escape") closeFindBar();
  });
  findPrevEl().addEventListener("click", findPrev);
  findNextEl().addEventListener("click", findNext);
  replaceOneEl().addEventListener("click", replaceOne);
  replaceAllEl().addEventListener("click", replaceAll);
}

export function openFindBar(showReplace = state.mode === "source") {
  if (!state.doc) return;
  findBarEl().hidden = false;
  replaceInputEl().hidden = !showReplace;
  replaceOneEl().hidden = !showReplace;
  replaceAllEl().hidden = !showReplace;
  replaceInputEl().disabled = !showReplace;
  replaceOneEl().disabled = !showReplace;
  replaceAllEl().disabled = !showReplace;
  findInputEl().focus();
  findInputEl().select();
  updateFindCount();
}

function closeFindBar() {
  findBarEl().hidden = true;
  activeIndex = -1;
  const sel = window.getSelection();
  sel?.removeAllRanges();
}

function findPrev() {
  jumpToMatch(-1);
}

function findNext() {
  jumpToMatch(1);
}

function jumpToMatch(direction: 1 | -1) {
  const query = findInputEl().value;
  if (!query || !state.doc) {
    updateFindCount();
    return;
  }
  if (state.mode === "edit" && !flushInline().ok) return;
  const matches = collectMatches(query);
  if (matches.length === 0) {
    activeIndex = -1;
    updateFindCount(0, 0);
    setStatus("未找到匹配项", "info");
    return;
  }
  activeIndex = activeIndex < 0
    ? (direction > 0 ? 0 : matches.length - 1)
    : (activeIndex + direction + matches.length) % matches.length;
  selectMatch(matches[activeIndex]);
  updateFindCount(activeIndex + 1, matches.length);
}

type Match = { start: number; end: number };

function collectMatches(query: string): Match[] {
  const haystack = currentSearchText();
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  const out: Match[] = [];
  let i = 0;
  while (q && (i = h.indexOf(q, i)) !== -1) {
    out.push({ start: i, end: i + query.length });
    i += Math.max(1, query.length);
  }
  return out;
}

function currentSearchText(): string {
  if (state.mode === "source") return markdownEl().value;
  const root = currentTextRoot();
  return root.textContent || "";
}

function selectMatch(match: Match) {
  if (state.mode === "source") {
    markdownEl().focus();
    markdownEl().setSelectionRange(match.start, match.end);
    const lineHeight = 22;
    const before = markdownEl().value.slice(0, match.start);
    const line = before.split("\n").length - 1;
    markdownEl().scrollTop = Math.max(0, line * lineHeight - markdownEl().clientHeight / 2);
    return;
  }

  const root = currentTextRoot();
  const range = rangeForTextOffsets(root, match.start, match.end);
  if (!range) return;
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  const node = range.startContainer.parentElement || root;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
}

function currentTextRoot(): HTMLElement {
  if (state.mode === "edit") return inlineEditorEl();
  if (state.mode === "source") return previewEl();
  return readerEl();
}

function rangeForTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = offset + node.data.length;
    if (!startNode && start >= offset && start <= next) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && end >= offset && end <= next) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function replaceOne() {
  if (state.mode !== "source") return;
  const query = findInputEl().value;
  if (!query) return;
  const start = markdownEl().selectionStart;
  const end = markdownEl().selectionEnd;
  const selected = markdownEl().value.slice(start, end);
  if (selected.toLowerCase() !== query.toLowerCase()) {
    findNext();
    return;
  }
  insertAtCursor(replaceInputEl().value);
  activeIndex = -1;
  findNext();
  updateChrome();
}

function replaceAll() {
  if (state.mode !== "source" || !state.doc) return;
  const query = findInputEl().value;
  if (!query) return;
  const replacement = replaceInputEl().value;
  const re = new RegExp(escapeRegExp(query), "gi");
  const before = markdownEl().value;
  const after = before.replace(re, replacement);
  if (after === before) {
    setStatus("未找到可替换内容", "info");
    return;
  }
  markdownEl().value = after;
  markdownEl().dispatchEvent(new Event("input"));
  state.doc.dirty = true;
  activeIndex = -1;
  updateFindCount();
  setStatus("已完成全部替换", "success");
}

function updateFindCount(index?: number, total?: number) {
  const query = findInputEl().value;
  const matches = query ? collectMatches(query) : [];
  const count = total ?? matches.length;
  const current = index ?? (count > 0 && activeIndex >= 0 ? activeIndex + 1 : 0);
  findCountEl().textContent = `${current}/${count}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
