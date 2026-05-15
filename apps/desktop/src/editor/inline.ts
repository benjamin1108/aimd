import { state, ASSET_URI_PREFIX } from "../core/state";
import { inlineEditorEl, markdownEl } from "../core/dom";
import { setStatus, updateChrome } from "../ui/chrome";
import {
  extractOutlineFromHTML, renderOutline, scheduleRender,
} from "../ui/outline";
import { persistSessionSnapshot } from "../session/snapshot";
import { htmlToMarkdown } from "./markdown";
import { hasAimdImageReferences, hasExternalImageReferences } from "../document/assets";
import { joinFrontmatter, splitFrontmatter } from "../markdown/frontmatter";
import { appendedStructuralHTML, createSourceModel, patchDirtySource, sourceRefFromEvent } from "./source-preserve";

export function lightNormalize(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("h1[style], h2[style], h3[style], h4[style], h5[style], h6[style], p[style]").forEach((el) => el.removeAttribute("style"));
}

/** Hard cap on document title (H1) text length. Above this, the workspace-head
 *  doc-title and the inline editor's H1 itself start to crowd surrounding UI;
 *  more importantly, an unbounded H1 lets a single Backspace-merge accident
 *  push the layout into a state the user can't recover from without undo. */
export const MAX_TITLE_LENGTH = 100;

/** Truncate an over-long H1 to MAX_TITLE_LENGTH and park the cursor at its
 *  end. Only invoked as a safety net after `input` (paste, IME commit, drag-
 *  drop, dictation); the keydown path in paste.ts already blocks character
 *  typing past the limit. Skipped during IME composition because mutating
 *  textContent mid-compose breaks the candidate window. */
function enforceTitleLength(root: HTMLElement) {
  const h1 = root.querySelector("h1");
  if (!h1) return;
  const text = h1.textContent ?? "";
  if (text.length <= MAX_TITLE_LENGTH) return;
  h1.textContent = text.slice(0, MAX_TITLE_LENGTH);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const node = h1.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, (node as Text).length);
  } else {
    range.setStart(h1, h1.childNodes.length);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function onInlineInput(event?: Event) {
  if (!state.doc) return;
  const composing = (event as InputEvent | undefined)?.isComposing;
  const sourceRef = sourceRefFromEvent(event);
  if (sourceRef) state.sourceDirtyRefs.add(sourceRef);
  else state.sourceStructuralDirty = true;
  state.inlineDirty = true;
  state.doc.dirty = true;
  lightNormalize(inlineEditorEl());
  if (!composing) enforceTitleLength(inlineEditorEl());
  ensureSelectionInEditor();
  updateChrome();
  // Defer expensive HTML→MD conversion (full normalize + turndown) until idle.
  if (state.flushTimer) window.clearTimeout(state.flushTimer);
  state.flushTimer = window.setTimeout(() => {
    flushInline();
  }, 700);
}

function ensureSelectionInEditor() {
  const root = inlineEditorEl();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchor = sel.anchorNode;
  if (anchor && root.contains(anchor)) return;
  root.focus();
  const last = root.lastChild;
  if (!last) return;
  const r = document.createRange();
  if (last.nodeType === Node.TEXT_NODE) {
    r.setStart(last, (last as Text).length);
  } else {
    r.setStartAfter(last);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
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
  const existing = splitFrontmatter(state.doc.markdown);
  let structuralMarkdown: string | null = null;
  if (state.sourceStructuralDirty) {
    const appended = appendedStructuralHTML(inlineEditorEl());
    if (appended !== null && state.sourceModel?.markdown === state.doc.markdown) {
      const serialized = htmlToMarkdown(appended).trim();
      structuralMarkdown = serialized
        ? `${state.doc.markdown.replace(/\s*$/, "")}\n\n${serialized}\n`
        : state.doc.markdown;
    } else {
      state.inlineDirty = true;
      setStatus("当前可视化结构编辑不能安全保持 Markdown 原文，请切到 Markdown 模式完成这次结构修改", "warn");
      updateChrome();
      return;
    }
  }
  const patched = state.sourceModel?.markdown === state.doc.markdown && state.sourceDirtyRefs.size > 0
    ? patchDirtySource(inlineEditorEl(), state.sourceModel, state.sourceDirtyRefs)
    : null;
  if (patched && !patched.ok) {
    state.inlineDirty = true;
    setStatus(`可视化保存受限: ${patched.reason}，请切到 Markdown 模式保存该结构`, "warn");
    updateChrome();
    return;
  }
  const md = structuralMarkdown
    ?? (patched?.ok
    ? patched.markdown
    : joinFrontmatter(existing.frontmatter, htmlToMarkdown(html)));
  if (patched?.ok || structuralMarkdown !== null) {
    state.sourceDirtyRefs.clear();
    state.sourceStructuralDirty = false;
  }
  if (md !== state.doc.markdown) {
    state.doc.markdown = md;
    state.sourceModel = createSourceModel(md);
    markdownEl().value = md;
    state.doc.hasExternalImageReferences = hasExternalImageReferences(md);
    if (state.doc.format === "markdown") {
      state.doc.requiresAimdSave = hasAimdImageReferences(md) || state.doc.assets.length > 0;
      state.doc.needsAimdSave = state.doc.requiresAimdSave;
    }
    state.outline = extractOutlineFromHTML(html);
    state.doc.html = inlineEditorEl().innerHTML;
    state.htmlVersion += 1;
    state.paintedVersion.edit = state.htmlVersion;
    renderOutline();
    gcInlineAssets(md);
    persistSessionSnapshot();
    scheduleRender();
  }
}

function gcInlineAssets(markdown: string) {
  if (!state.doc || state.doc.assets.length === 0) return;
  const prefix = ASSET_URI_PREFIX;
  const before = state.doc.assets.length;
  state.doc.assets = state.doc.assets.filter((a) =>
    markdown.includes(prefix + a.id)
  );
  if (state.doc.assets.length !== before) {
    updateChrome();
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
