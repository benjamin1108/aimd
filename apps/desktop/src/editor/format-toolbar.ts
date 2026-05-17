import {
  editPaneSwapEl,
  formatToolbarEl,
  imageAltPopoverEl,
  imageAltInputEl,
  imageAltConfirmEl,
  imageAltCancelEl,
  markdownEl,
} from "../core/dom";
import { state } from "../core/state";
import { syncActiveTabFromFacade } from "../document/open-document-state";
import { refreshEditPaneOrder } from "../ui/mode";
import { setStatus } from "../ui/chrome";
import { insertImage } from "./images";
import { runMarkdownCommand, type MarkdownCommand } from "./markdown-commands";
import { showMarkdownLinkPopover } from "./markdown-link-popover";
import { applyMarkdownCommandResult, applyTextareaEdit } from "./textarea";

function currentCommandInput() {
  const textarea = markdownEl();
  return {
    markdown: textarea.value,
    selectionStart: textarea.selectionStart ?? 0,
    selectionEnd: textarea.selectionEnd ?? textarea.selectionStart ?? 0,
  };
}

function markdownImageAtSelection(markdown: string, start: number, end: number) {
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^)]+["'])?\)/g;
  let first: {
    start: number;
    end: number;
    alt: string;
    src: string;
  } | null = null;
  for (const match of markdown.matchAll(re)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    first ??= {
      start: matchStart,
      end: matchEnd,
      alt: match[1],
      src: match[2],
    };
    if (start >= matchStart && end <= matchEnd) {
      return {
        start: matchStart,
        end: matchEnd,
        alt: match[1],
        src: match[2],
      };
    }
  }
  return first;
}

function escapeAlt(value: string): string {
  return value.replace(/]/g, "\\]");
}

function editableImageDescription(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (
    normalized === "image"
    || normalized === "clipboard"
    || /^pasted(?: \d+)?$/.test(normalized)
    || /^aimd paste(?: \d+)?(?: image)?$/.test(normalized)
  ) {
    return "";
  }
  return value;
}

function openImageAltPopover() {
  const textarea = markdownEl();
  const target = markdownImageAtSelection(
    textarea.value,
    textarea.selectionStart ?? 0,
    textarea.selectionEnd ?? textarea.selectionStart ?? 0,
  );
  if (!target) {
    setStatus("请先把光标放在 Markdown 图片语法内", "info");
    textarea.focus();
    return;
  }

  imageAltInputEl().value = editableImageDescription(target.alt);
  imageAltPopoverEl().hidden = false;
  imageAltInputEl().focus();
  imageAltInputEl().select();

  const cleanup = () => {
    imageAltPopoverEl().hidden = true;
    imageAltConfirmEl().removeEventListener("click", onConfirm);
    imageAltCancelEl().removeEventListener("click", onCancel);
    imageAltInputEl().removeEventListener("keydown", onKeydown);
    textarea.focus();
  };

  const onConfirm = () => {
    const alt = imageAltInputEl().value;
    const replacement = `![${escapeAlt(alt)}](${target.src})`;
    applyTextareaEdit({
      replaceStart: target.start,
      replaceEnd: target.end,
      replacement,
      selectionStart: target.start + 2,
      selectionEnd: target.start + 2 + alt.length,
    });
    cleanup();
  };
  const onCancel = () => cleanup();
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm();
    }
  };

  imageAltConfirmEl().addEventListener("click", onConfirm);
  imageAltCancelEl().addEventListener("click", onCancel);
  imageAltInputEl().addEventListener("keydown", onKeydown);
}

export function runFormatCommand(cmd: string) {
  if (cmd === "link") {
    void showMarkdownLinkPopover();
    return;
  }
  if (cmd === "image") {
    void insertImage();
    return;
  }
  if (cmd === "image-alt") {
    openImageAltPopover();
    return;
  }
  applyMarkdownCommandResult(runMarkdownCommand(cmd as MarkdownCommand, currentCommandInput()));
}

function toggleEditPaneOrder() {
  state.editPaneOrder = state.editPaneOrder === "source-first" ? "preview-first" : "source-first";
  refreshEditPaneOrder();
  syncActiveTabFromFacade();
}

export function bindFormatToolbar() {
  formatToolbarEl().querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => runFormatCommand(btn.dataset.cmd || ""));
  });
  editPaneSwapEl().addEventListener("click", toggleEditPaneOrder);
}
