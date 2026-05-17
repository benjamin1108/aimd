import { escapeAttr, escapeHTML } from "../util/escape";
import type { GitDiffDocument, GitDiffFilePatch, GitDiffPart, GitDiffRow } from "./git-diff-model";

type SplitSide = "old" | "new";
type SplitCellSemantic = "context" | "del" | "add" | "placeholder";

function renderLineNumber(lineNumber: number | null): string {
  return lineNumber && lineNumber > 0 ? String(lineNumber) : "";
}

function renderText(value: string): string {
  return escapeHTML(value || " ");
}

function renderCell(
  side: SplitSide,
  lineNumber: number | null,
  text: string,
  semantic: SplitCellSemantic,
): string {
  const classes = [
    "git-diff-split-cell",
    `git-diff-split-cell--${side}`,
    `is-${semantic}`,
  ].join(" ");
  const marker = semantic === "add" ? "+" : semantic === "del" ? "-" : "";
  const textMarkup = semantic === "placeholder"
    ? `<span class="git-diff-text-viewport git-diff-placeholder" aria-hidden="true"><span class="git-diff-text"></span></span>`
    : `<span class="git-diff-text-viewport"><span class="git-diff-text">${renderText(text)}</span></span>`;
  return `
    <div class="${classes}" role="cell" data-side="${side}">
      <div class="git-diff-split-cell-inner">
        <span class="git-diff-gutter" aria-hidden="true">${escapeHTML(renderLineNumber(lineNumber))}</span>
        <span class="git-diff-marker" aria-hidden="true">${marker}</span>
        ${textMarkup}
      </div>
    </div>`;
}

function renderTextRow(row: Exclude<GitDiffRow, { kind: "meta" }>): string {
  if (row.kind === "context") {
    return `
      <div class="git-diff-split-row is-context" role="row">
        ${renderCell("old", row.oldLine, row.text, "context")}
        ${renderCell("new", row.newLine, row.text, "context")}
      </div>`;
  }
  if (row.kind === "delete") {
    return `
      <div class="git-diff-split-row is-del" role="row">
        ${renderCell("old", row.oldLine, row.text, "del")}
        ${renderCell("new", null, "", "placeholder")}
      </div>`;
  }
  if (row.kind === "insert") {
    return `
      <div class="git-diff-split-row is-add" role="row">
        ${renderCell("old", null, "", "placeholder")}
        ${renderCell("new", row.newLine, row.text, "add")}
      </div>`;
  }
  return `
    <div class="git-diff-split-row is-change" role="row">
      ${renderCell("old", row.oldLine, row.oldText, "del")}
      ${renderCell("new", row.newLine, row.newText, "add")}
    </div>`;
}

function renderRow(row: GitDiffRow): string {
  return row.kind === "meta" ? "" : renderTextRow(row);
}

function renderHunkRows(file: GitDiffFilePatch): GitDiffRow[] {
  return file.hunks.flatMap((hunk) => hunk.rows);
}

function renderFile(file: GitDiffFilePatch): string {
  return renderHunkRows(file).map(renderRow).join("");
}

function renderPart(part: GitDiffPart): string {
  return `
    <section class="git-diff-block" data-diff-mode="side-by-side">
      <div class="git-diff-block-title">${escapeHTML(part.title)}</div>
      <div class="git-diff-split" role="table" aria-label="${escapeAttr(`${part.title}左右对比`)}">
        <div class="git-diff-split-content">
          <div class="git-diff-split-header" role="row">
            <div class="git-diff-split-heading" role="columnheader">
              <div class="git-diff-split-cell-inner">
                <span class="git-diff-gutter" aria-hidden="true"></span>
                <span class="git-diff-marker" aria-hidden="true"></span>
                <span class="git-diff-text">旧版本</span>
              </div>
            </div>
            <div class="git-diff-split-heading" role="columnheader">
              <div class="git-diff-split-cell-inner">
                <span class="git-diff-gutter" aria-hidden="true"></span>
                <span class="git-diff-marker" aria-hidden="true"></span>
                <span class="git-diff-text">新版本</span>
              </div>
            </div>
          </div>
          <div class="git-diff-split-body">${part.files.map(renderFile).join("")}</div>
          <div class="git-diff-split-scrollbars" aria-hidden="true">
            <div class="git-diff-x-scroll" data-diff-x-scroll="old"><div class="git-diff-x-scroll-spacer"></div></div>
            <div class="git-diff-x-scroll" data-diff-x-scroll="new"><div class="git-diff-x-scroll-spacer"></div></div>
          </div>
        </div>
      </div>
    </section>`;
}

export function renderSplitDiffDocument(document: GitDiffDocument): string {
  return document.parts.length
    ? document.parts.map(renderPart).join("")
    : `<div class="git-diff-message">没有可显示的文本 diff</div>`;
}
