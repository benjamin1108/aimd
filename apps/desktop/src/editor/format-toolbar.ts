import { inlineEditorEl, formatToolbarEl } from "../core/dom";
import { showLinkPopover } from "./link-popover";
import { insertImage } from "./images";

export const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "DIV", "LI",
]);

export function closestBlock(node: Node | null): HTMLElement | null {
  let el = (node && node.nodeType === Node.ELEMENT_NODE
    ? node
    : node?.parentNode ?? null) as HTMLElement | null;
  while (el && el !== inlineEditorEl()) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

export function closestAncestor(node: Node | null, tag: string): HTMLElement | null {
  const target = tag.toUpperCase();
  let el = (node && node.nodeType === Node.ELEMENT_NODE
    ? node
    : node?.parentNode ?? null) as HTMLElement | null;
  while (el && el !== inlineEditorEl()) {
    if (el.tagName === target) return el;
    el = el.parentElement;
  }
  return null;
}

export function replaceBlockTag(block: HTMLElement, newTag: string) {
  if (block.tagName === newTag.toUpperCase()) return;
  const replacement = document.createElement(newTag);
  while (block.firstChild) replacement.appendChild(block.firstChild);
  block.replaceWith(replacement);
  const sel = document.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(replacement);
    r.collapse(false);
    sel.removeAllRanges();
    // BUG-010: WKWebView 下 addRange 在 replaceWith 后可能静默失败，
    // 用 try/catch 兜底确保焦点回到编辑器而不是飞出去。
    try { sel.addRange(r); } catch { inlineEditorEl().focus(); }
  }
}

export function applyBlockFormat(targetTag: string) {
  // Toggle behaviour: clicking the active tag again drops back to a paragraph.
  // Without this, repeated H1 clicks on WebKit keep stacking wrappers and the
  // text grows on every click.
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    document.execCommand("formatBlock", false, targetTag);
    return;
  }
  const block = closestBlock(sel.getRangeAt(0).startContainer);
  const target = targetTag.toUpperCase();
  if (!block) {
    document.execCommand("formatBlock", false, targetTag);
    return;
  }
  if (block.tagName === target) {
    if (target !== "P") replaceBlockTag(block, "P");
    // BUG-011: target 已是 P 时直接 return，WKWebView 下 selection 可能已偏移，
    // 显式 focus 确保焦点仍在编辑器内
    else inlineEditorEl().focus();
    return;
  }
  replaceBlockTag(block, targetTag);
}

export function toggleBlockquote() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    document.execCommand("formatBlock", false, "BLOCKQUOTE");
    return;
  }
  const range = sel.getRangeAt(0);
  const bq = closestAncestor(range.startContainer, "BLOCKQUOTE");
  if (bq) {
    const parent = bq.parentNode;
    if (!parent) return;
    // 记住第一个要被 unwrap 的子节点，用于恢复 selection
    const firstMoved = bq.firstChild as Node | null;
    while (bq.firstChild) parent.insertBefore(bq.firstChild, bq);
    parent.removeChild(bq);
    // BUG-010: WKWebView 下 removeChild 后 selection 可能飞出编辑区，手动恢复
    if (firstMoved) {
      const targetNode = firstMoved.nodeType === Node.ELEMENT_NODE
        ? (firstMoved as HTMLElement)
        : firstMoved.parentElement;
      if (targetNode) {
        const r2 = document.createRange();
        r2.selectNodeContents(targetNode);
        r2.collapse(false);
        sel.removeAllRanges();
        try { sel.addRange(r2); } catch { inlineEditorEl().focus(); }
      }
    }
    return;
  }
  const block = closestBlock(range.startContainer);
  if (!block) {
    document.execCommand("formatBlock", false, "BLOCKQUOTE");
    return;
  }
  const wrapper = document.createElement("blockquote");
  block.parentNode?.insertBefore(wrapper, block);
  wrapper.appendChild(block);
  const r = document.createRange();
  r.selectNodeContents(block);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

export function wrapSelectionInTag(tag: string) {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  // Determine the effective ancestor element: if commonAncestorContainer is
  // already an Element (e.g. the <code> node itself when all its content is
  // selected), use it directly; otherwise use its parentElement.
  const container = range.commonAncestorContainer;
  const ancestor: HTMLElement | null =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
      : (container as Node).parentElement;

  // Check 1: walk up the ancestor chain to find the nearest matching tag,
  // staying within the inline editor.
  let existing: HTMLElement | null = ancestor;
  while (existing && existing !== inlineEditorEl()) {
    if (existing.tagName.toLowerCase() === tag) break;
    existing = existing.parentElement;
  }

  // Check 2: if ancestor itself is not the tag, check whether the ancestor's
  // meaningful children are all a single target tag (covers the case where the
  // user selects the entire content of a <p> that contains a lone <code>).
  if (!existing || existing === inlineEditorEl()) {
    if (ancestor && ancestor !== inlineEditorEl()) {
      const significant = Array.from(ancestor.childNodes).filter(
        (n) => !(n.nodeType === Node.TEXT_NODE && n.textContent?.trim() === ""),
      );
      if (
        significant.length === 1 &&
        significant[0].nodeType === Node.ELEMENT_NODE &&
        (significant[0] as HTMLElement).tagName.toLowerCase() === tag
      ) {
        existing = significant[0] as HTMLElement;
      }
    }
  }

  if (existing && existing !== inlineEditorEl() && existing.tagName.toLowerCase() === tag) {
    // Unwrap: replace the wrapper element with a text node of its content.
    const text = existing.textContent || "";
    existing.replaceWith(document.createTextNode(text));
    inlineEditorEl().focus();
    return;
  }

  const wrapper = document.createElement(tag);
  try {
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    inlineEditorEl().focus();
  }
}

export function runFormatCommand(cmd: string) {
  inlineEditorEl().focus();
  switch (cmd) {
    case "bold":      document.execCommand("bold"); break;
    case "italic":    document.execCommand("italic"); break;
    case "strike":    document.execCommand("strikeThrough"); break;
    case "h1":
    case "h2":
    case "h3":
    case "paragraph": applyBlockFormat(cmd === "paragraph" ? "P" : cmd.toUpperCase()); break;
    case "ul":        document.execCommand("insertUnorderedList"); break;
    case "ol":        document.execCommand("insertOrderedList"); break;
    case "quote":     toggleBlockquote(); break;
    case "code":      wrapSelectionInTag("code"); break;
    case "link": {
      // BUG-013: window.prompt 在 WKWebView 下被静默屏蔽，改用自定义 HTML 浮层。
      // 先保存 selection，浮层关闭后恢复再执行 createLink（在 showLinkPopover 内部完成）。
      const selBeforePopover = document.getSelection();
      const savedRange = (selBeforePopover && selBeforePopover.rangeCount > 0)
        ? selBeforePopover.getRangeAt(0).cloneRange()
        : null;
      // 检测光标是否在已有 <a> 内——若是，走编辑模式
      const anchorNode = selBeforePopover ? selBeforePopover.anchorNode : null;
      const existingAnchor = closestAncestor(anchorNode, "a") as HTMLAnchorElement | null;
      void showLinkPopover(savedRange, existingAnchor);
      return; // showLinkPopover 内部自行 dispatchEvent("input")，不需要外层再 dispatch
    }
    case "image":     void insertImage(); return; // insertImage handles its own dirty
  }
  inlineEditorEl().dispatchEvent(new Event("input"));
}

export function bindFormatToolbar() {
  formatToolbarEl().querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
    // Prevent the button from stealing focus from the editor mid-selection.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd!;
      runFormatCommand(cmd);
    });
  });
}
