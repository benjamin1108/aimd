import { inlineEditorEl } from "../core/dom";

function closestBlock(node: Node | null): Element | null {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as Element).tagName;
      if (/^(P|H[1-6]|LI|BLOCKQUOTE|DIV)$/.test(tag)) return n as Element;
    }
    n = n.parentNode;
  }
  return null;
}

function refocusAfterDelete(root: HTMLElement) {
  root.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const lastChild = root.lastChild;
  if (!lastChild) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    root.appendChild(p);
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  const r = document.createRange();
  if (lastChild.nodeType === Node.TEXT_NODE) {
    r.setStart(lastChild, (lastChild as Text).length);
  } else {
    r.setStartAfter(lastChild);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function selectedOrAdjacentImg(sel: Selection): HTMLImageElement | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;

  if (container.nodeType === Node.ELEMENT_NODE) {
    const el = container as Element;
    if (el.tagName === "IMG") return el as HTMLImageElement;
    if (sel.isCollapsed) {
      const offset = range.startOffset;
      const child = el.childNodes[offset - 1];
      if (child && (child as Element).tagName === "IMG") return child as HTMLImageElement;
      const childAt = el.childNodes[offset];
      if (childAt && (childAt as Element).tagName === "IMG") return childAt as HTMLImageElement;
    }
  }

  if (container.nodeType === Node.TEXT_NODE && sel.isCollapsed) {
    const offset = range.startOffset;
    const parent = container.parentNode;
    if (!parent) return null;
    if (offset === 0) {
      const prev = container.previousSibling;
      if (prev && (prev as Element).tagName === "IMG") return prev as HTMLImageElement;
    }
    if (offset === (container as Text).length) {
      const next = container.nextSibling;
      if (next && (next as Element).tagName === "IMG") return next as HTMLImageElement;
    }
  }

  return null;
}

export function bindImageDeleteGuard(root: HTMLElement) {
  root.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const sel = window.getSelection();
    if (!sel) return;

    const img = selectedOrAdjacentImg(sel);
    if (!img) return;

    event.preventDefault();

    const block = closestBlock(img);
    if (block && block !== root) {
      const isOnlyChild = block.childNodes.length === 1
        || (block.childNodes.length === 2 && Array.from(block.childNodes).some((n) => (n as Element).tagName === "BR"));
      if (isOnlyChild) {
        const prevBlock = block.previousElementSibling;
        block.remove();
        if (prevBlock) {
          const r = document.createRange();
          const lastNode = prevBlock.lastChild;
          if (lastNode) {
            if (lastNode.nodeType === Node.TEXT_NODE) {
              r.setStart(lastNode, (lastNode as Text).length);
            } else {
              r.setStartAfter(lastNode);
            }
          } else {
            r.setStart(prevBlock, 0);
          }
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } else {
          refocusAfterDelete(root);
        }
      } else {
        img.remove();
        refocusAfterDelete(root);
      }
    } else {
      img.remove();
      refocusAfterDelete(root);
    }

    root.dispatchEvent(new Event("input"));
  });
}
