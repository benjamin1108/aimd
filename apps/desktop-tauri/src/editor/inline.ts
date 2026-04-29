import { state } from "../core/state";
import { inlineEditorEl, markdownEl } from "../core/dom";
import { updateChrome } from "../ui/chrome";
import {
  extractOutlineFromHTML, renderOutline,
} from "../ui/outline";
import { persistSessionSnapshot } from "../session/snapshot";
import { htmlToMarkdown } from "./markdown";

export function lightNormalize(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("h1[style], h2[style], h3[style], h4[style], h5[style], h6[style], p[style]").forEach((el) => el.removeAttribute("style"));
}

export function onInlineInput() {
  if (!state.doc) return;
  state.inlineDirty = true;
  state.doc.dirty = true;
  lightNormalize(inlineEditorEl());
  updateChrome();
  // Defer expensive HTML→MD conversion (full normalize + turndown) until idle.
  if (state.flushTimer) window.clearTimeout(state.flushTimer);
  state.flushTimer = window.setTimeout(() => {
    flushInline();
  }, 700);
}

export function normalizeInlineDOM() {
  inlineEditorEl().querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,p,li,blockquote"
  ).forEach((block) => {
    block.removeAttribute("style");
    block.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
  });
}

export function flushInline() {
  if (!state.doc) return;
  if (state.mode !== "edit") return;
  if (state.flushTimer) {
    window.clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  // Mode hops without user edits in between (e.g., edit → read → edit) used
  // to run turndown on every transition; on long docs that was the dominant
  // chunk of the perceived "click takes a beat" lag. Skip it when nothing
  // mutated the inline editor since the last flush / paint.
  if (!state.inlineDirty) return;
  normalizeInlineDOM();
  state.inlineDirty = false;
  const html = inlineEditorEl().innerHTML;
  const md = htmlToMarkdown(html);
  if (md !== state.doc.markdown) {
    state.doc.markdown = md;
    markdownEl().value = md;
    state.outline = extractOutlineFromHTML(html);
    state.doc.html = inlineEditorEl().innerHTML;
    state.htmlVersion += 1;
    state.paintedVersion.edit = state.htmlVersion;
    renderOutline();
    persistSessionSnapshot();
  }
}

export function sanitizePastedHTML(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  // Strip <style>, <script>, inline styles, classes, data-* (except our asset id).
  tpl.content.querySelectorAll("style, script, link, meta, iframe, object, embed, frame, frameset").forEach((n) => n.remove());
  tpl.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") || "").trim().toLowerCase();
    if (href.startsWith("javascript:")) a.removeAttribute("href");
  });
  tpl.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.removeAttribute("style");
    el.removeAttribute("class");
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      if (attr.name.startsWith("data-") && attr.name !== "data-asset-id") {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.content;
}

export function insertAtCursor(text: string) {
  const start = markdownEl().selectionStart;
  const end = markdownEl().selectionEnd;
  const before = markdownEl().value.slice(0, start);
  const after = markdownEl().value.slice(end);
  markdownEl().value = before + text + after;
  markdownEl().selectionStart = markdownEl().selectionEnd = start + text.length;
  markdownEl().dispatchEvent(new Event("input"));
  markdownEl().focus();
}
