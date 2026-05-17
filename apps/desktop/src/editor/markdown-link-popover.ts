import {
  linkPopoverEl,
  linkPopoverInputEl,
  linkPopoverTitleEl,
  linkPopoverConfirmEl,
  linkPopoverCancelEl,
  linkPopoverUnlinkEl,
  markdownEl,
} from "../core/dom";
import { applyTextareaEdit } from "./textarea";

type LinkEditTarget = {
  start: number;
  end: number;
  text: string;
  url: string;
  full: string;
} | null;

function markdownLinkAtSelection(markdown: string, start: number, end: number): LinkEditTarget {
  const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^)]+["'])?\)/g;
  for (const match of markdown.matchAll(re)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (start >= matchStart && end <= matchEnd) {
      return {
        start: matchStart,
        end: matchEnd,
        text: match[1],
        url: match[2],
        full: match[0],
      };
    }
  }
  return null;
}

function escapeLinkText(value: string): string {
  return value.replace(/]/g, "\\]");
}

function replacementFor(url: string, target: LinkEditTarget, selected: string) {
  if (target) return `[${escapeLinkText(target.text || "链接")}](${url})`;
  return `[${escapeLinkText(selected || "链接")}](${url})`;
}

export function showMarkdownLinkPopover(): Promise<string | null> {
  const textarea = markdownEl();
  const markdown = textarea.value;
  const selectionStart = textarea.selectionStart ?? 0;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  const selected = markdown.slice(selectionStart, selectionEnd);
  const target = markdownLinkAtSelection(markdown, selectionStart, selectionEnd);

  return new Promise((resolve) => {
    const isEdit = Boolean(target);
    linkPopoverInputEl().value = target?.url || "https://";
    linkPopoverTitleEl().textContent = isEdit ? "编辑链接" : "链接地址";
    linkPopoverConfirmEl().textContent = isEdit ? "更新" : "确定";
    linkPopoverUnlinkEl().hidden = !isEdit;
    linkPopoverEl().hidden = false;
    linkPopoverInputEl().focus();
    linkPopoverInputEl().select();

    const cleanup = () => {
      linkPopoverEl().hidden = true;
      linkPopoverConfirmEl().removeEventListener("click", onConfirm);
      linkPopoverCancelEl().removeEventListener("click", onCancel);
      linkPopoverUnlinkEl().removeEventListener("click", onUnlink);
      linkPopoverInputEl().removeEventListener("keydown", onKeydown);
      textarea.focus();
    };

    const finish = (value: string | null) => {
      cleanup();
      resolve(value);
    };

    const onConfirm = () => {
      const url = linkPopoverInputEl().value.trim();
      if (!url) {
        if (target) onUnlink();
        else finish(null);
        return;
      }
      const replaceStart = target?.start ?? selectionStart;
      const replaceEnd = target?.end ?? selectionEnd;
      const replacement = replacementFor(url, target, selected);
      const textStart = replaceStart + 1;
      applyTextareaEdit({
        replaceStart,
        replaceEnd,
        replacement,
        selectionStart: textStart,
        selectionEnd: textStart + (target?.text || selected || "链接").length,
      });
      finish(url);
    };

    const onCancel = () => finish(null);

    const onUnlink = () => {
      if (!target) {
        finish(null);
        return;
      }
      applyTextareaEdit({
        replaceStart: target.start,
        replaceEnd: target.end,
        replacement: target.text,
        selectionStart: target.start,
        selectionEnd: target.start + target.text.length,
      });
      finish(null);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    linkPopoverConfirmEl().addEventListener("click", onConfirm);
    linkPopoverCancelEl().addEventListener("click", onCancel);
    linkPopoverUnlinkEl().addEventListener("click", onUnlink);
    linkPopoverInputEl().addEventListener("keydown", onKeydown);
  });
}
