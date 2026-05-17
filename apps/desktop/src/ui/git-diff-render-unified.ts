import { escapeHTML } from "../util/escape";
import type { GitDiffDocument, GitDiffPart } from "./git-diff-model";

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "git-diff-line is-hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "git-diff-line is-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "git-diff-line is-del";
  if (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("---")
    || line.startsWith("+++")
  ) {
    return "git-diff-line is-meta";
  }
  return "git-diff-line";
}

function renderLines(text: string): string {
  return text.split("\n")
    .map((line) => `<div class="${lineClass(line)}">${escapeHTML(line || " ")}</div>`)
    .join("");
}

function renderPart(part: GitDiffPart): string {
  return `
    <section class="git-diff-block">
      <div class="git-diff-block-title">${escapeHTML(part.title)}</div>
      <div class="git-diff-code">${renderLines(part.raw)}</div>
    </section>`;
}

export function renderUnifiedDiffDocument(document: GitDiffDocument): string {
  return document.parts.length
    ? document.parts.map(renderPart).join("")
    : `<div class="git-diff-message">没有可显示的文本 diff</div>`;
}
