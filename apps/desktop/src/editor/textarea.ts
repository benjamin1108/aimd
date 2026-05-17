import { markdownEl } from "../core/dom";
import type { MarkdownCommandResult } from "./markdown-commands";

export type TextareaEdit = {
  replaceStart: number;
  replaceEnd: number;
  replacement: string;
  selectionStart: number;
  selectionEnd: number;
};

export function applyTextareaEdit(edit: TextareaEdit) {
  const textarea = markdownEl();
  textarea.focus();
  textarea.setRangeText(edit.replacement, edit.replaceStart, edit.replaceEnd, "preserve");
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  textarea.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertReplacementText",
    data: edit.replacement,
  }));
}

export function applyMarkdownCommandResult(result: MarkdownCommandResult) {
  applyTextareaEdit({
    replaceStart: result.replaceStart,
    replaceEnd: result.replaceEnd,
    replacement: result.replacement,
    selectionStart: result.selectionStart,
    selectionEnd: result.selectionEnd,
  });
}

export function insertMarkdownAtSelection(markdown: string, selectInserted = false) {
  const textarea = markdownEl();
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const selectionEnd = start + markdown.length;
  applyTextareaEdit({
    replaceStart: start,
    replaceEnd: end,
    replacement: markdown,
    selectionStart: selectInserted ? start : selectionEnd,
    selectionEnd,
  });
}

export function replaceSelectedMarkdown(markdown: string) {
  insertMarkdownAtSelection(markdown, true);
}

export function replaceAllMarkdown(markdown: string) {
  const textarea = markdownEl();
  applyTextareaEdit({
    replaceStart: 0,
    replaceEnd: textarea.value.length,
    replacement: markdown,
    selectionStart: 0,
    selectionEnd: 0,
  });
}
