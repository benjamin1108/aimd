import { parse as parseDiff2Html } from "diff2html";
import type { GitFileDiff } from "../core/types";

export type GitDiffPartKind = "staged" | "unstaged";

export type GitDiffDocument = {
  path: string;
  parts: GitDiffPart[];
  isBinary: boolean;
  truncated: boolean;
};

export type GitDiffPart = {
  kind: GitDiffPartKind;
  title: "已暂存差异" | "未暂存差异";
  raw: string;
  files: GitDiffFilePatch[];
};

export type GitDiffFilePatch = {
  oldPath: string;
  newPath: string;
  meta: GitDiffMetaRow[];
  hunks: GitDiffHunk[];
};

export type GitDiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  rows: GitDiffRow[];
};

export type GitDiffRow =
  | { kind: "context"; oldLine: number; newLine: number; text: string }
  | { kind: "delete"; oldLine: number; text: string }
  | { kind: "insert"; newLine: number; text: string }
  | { kind: "change"; oldLine: number; newLine: number; oldText: string; newText: string }
  | { kind: "meta"; text: string };

export type GitDiffMetaRow = {
  kind: "meta";
  text: string;
};

type Diff2HtmlFile = ReturnType<typeof parseDiff2Html>[number];
type Diff2HtmlBlock = Diff2HtmlFile["blocks"][number];
type Diff2HtmlLine = Diff2HtmlBlock["lines"][number];
type DeleteLine = { oldLine: number; text: string };
type InsertLine = { newLine: number; text: string };

const MAX_SIMILARITY_CELLS = 900;
const SIMILARITY_MATCH_THRESHOLD = 0.26;

function normalizeForSimilarity(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeForSimilarity(value)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

function commonPrefixRatio(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return limit ? index / Math.max(left.length, right.length) : 0;
}

function commonSuffixRatio(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return limit ? index / Math.max(left.length, right.length) : 0;
}

function tokenOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightCounts = new Map<string, number>();
  right.forEach((token) => rightCounts.set(token, (rightCounts.get(token) || 0) + 1));
  let overlap = 0;
  left.forEach((token) => {
    const count = rightCounts.get(token) || 0;
    if (count <= 0) return;
    overlap += 1;
    rightCounts.set(token, count - 1);
  });
  return overlap / Math.max(left.length, right.length);
}

function lineSimilarity(leftRaw: string, rightRaw: string): number {
  const left = normalizeForSimilarity(leftRaw);
  const right = normalizeForSimilarity(rightRaw);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  return (
    tokenOverlap(tokenize(left), tokenize(right)) * 0.45
    + commonPrefixRatio(left, right) * 0.3
    + commonSuffixRatio(left, right) * 0.15
    + lengthRatio * 0.1
  );
}

function pushSequentialPairs(rows: GitDiffRow[], deletes: DeleteLine[], inserts: InsertLine[]) {
  const pairs = Math.min(deletes.length, inserts.length);
  for (let index = 0; index < pairs; index += 1) {
    rows.push({
      kind: "change",
      oldLine: deletes[index].oldLine,
      newLine: inserts[index].newLine,
      oldText: deletes[index].text,
      newText: inserts[index].text,
    });
  }
  deletes.slice(pairs).forEach((line) => rows.push({ kind: "delete", ...line }));
  inserts.slice(pairs).forEach((line) => rows.push({ kind: "insert", ...line }));
}

function findBestPair(
  deletes: DeleteLine[],
  inserts: InsertLine[],
): { deleteIndex: number; insertIndex: number; score: number } | null {
  let best: { deleteIndex: number; insertIndex: number; score: number } | null = null;
  for (let deleteIndex = 0; deleteIndex < deletes.length; deleteIndex += 1) {
    for (let insertIndex = 0; insertIndex < inserts.length; insertIndex += 1) {
      const score = lineSimilarity(deletes[deleteIndex].text, inserts[insertIndex].text);
      if (
        !best
        || score > best.score
        || (score === best.score && deleteIndex + insertIndex < best.deleteIndex + best.insertIndex)
      ) {
        best = { deleteIndex, insertIndex, score };
      }
    }
  }
  return best;
}

function flushChangeGroup(rows: GitDiffRow[], deletes: DeleteLine[], inserts: InsertLine[]) {
  if (!deletes.length && !inserts.length) return;
  if (!deletes.length) {
    inserts.forEach((line) => rows.push({ kind: "insert", ...line }));
    return;
  }
  if (!inserts.length) {
    deletes.forEach((line) => rows.push({ kind: "delete", ...line }));
    return;
  }
  if (deletes.length === inserts.length || deletes.length * inserts.length > MAX_SIMILARITY_CELLS) {
    pushSequentialPairs(rows, deletes, inserts);
    return;
  }

  let remainingDeletes = [...deletes];
  let remainingInserts = [...inserts];
  while (remainingDeletes.length && remainingInserts.length) {
    const best = findBestPair(remainingDeletes, remainingInserts);
    if (!best || best.score < SIMILARITY_MATCH_THRESHOLD) {
      rows.push({
        kind: "change",
        oldLine: remainingDeletes[0].oldLine,
        newLine: remainingInserts[0].newLine,
        oldText: remainingDeletes[0].text,
        newText: remainingInserts[0].text,
      });
      remainingDeletes = remainingDeletes.slice(1);
      remainingInserts = remainingInserts.slice(1);
      continue;
    }

    remainingDeletes.slice(0, best.deleteIndex).forEach((line) => rows.push({ kind: "delete", ...line }));
    remainingInserts.slice(0, best.insertIndex).forEach((line) => rows.push({ kind: "insert", ...line }));
    rows.push({
      kind: "change",
      oldLine: remainingDeletes[best.deleteIndex].oldLine,
      newLine: remainingInserts[best.insertIndex].newLine,
      oldText: remainingDeletes[best.deleteIndex].text,
      newText: remainingInserts[best.insertIndex].text,
    });
    remainingDeletes = remainingDeletes.slice(best.deleteIndex + 1);
    remainingInserts = remainingInserts.slice(best.insertIndex + 1);
  }
  remainingDeletes.forEach((line) => rows.push({ kind: "delete", ...line }));
  remainingInserts.forEach((line) => rows.push({ kind: "insert", ...line }));
}

function stripDiffMarker(line: Diff2HtmlLine): string {
  return line.content ? line.content.slice(1) : "";
}

function rowsFromDiff2HtmlLines(lines: Diff2HtmlLine[]): GitDiffRow[] {
  const rows: GitDiffRow[] = [];
  let pendingDeletes: DeleteLine[] = [];
  let pendingInserts: InsertLine[] = [];
  const flushPending = () => {
    flushChangeGroup(rows, pendingDeletes, pendingInserts);
    pendingDeletes = [];
    pendingInserts = [];
  };

  lines.forEach((line) => {
    if (line.type === "delete") {
      pendingDeletes.push({ oldLine: line.oldNumber, text: stripDiffMarker(line) });
      return;
    }
    if (line.type === "insert") {
      pendingInserts.push({ newLine: line.newNumber, text: stripDiffMarker(line) });
      return;
    }

    flushPending();
    rows.push({
      kind: "context",
      oldLine: line.oldNumber,
      newLine: line.newNumber,
      text: stripDiffMarker(line),
    });
  });
  flushPending();
  return rows;
}

function fileMetaRows(file: Diff2HtmlFile): GitDiffMetaRow[] {
  const oldPath = file.oldName || file.newName || "";
  const newPath = file.newName || file.oldName || "";
  const rows: GitDiffMetaRow[] = [];
  if (file.isGitDiff) rows.push({ kind: "meta", text: `diff --git a/${oldPath} b/${newPath}` });
  if (file.isNew && file.newFileMode) rows.push({ kind: "meta", text: `new file mode ${file.newFileMode}` });
  if (file.isDeleted && file.deletedFileMode) rows.push({ kind: "meta", text: `deleted file mode ${file.deletedFileMode}` });
  if (file.isRename) {
    rows.push({ kind: "meta", text: `rename from ${oldPath}` });
    rows.push({ kind: "meta", text: `rename to ${newPath}` });
  }
  if (file.checksumBefore && file.checksumAfter) {
    const before = Array.isArray(file.checksumBefore) ? file.checksumBefore.join(",") : file.checksumBefore;
    const mode = file.mode ? ` ${file.mode}` : "";
    rows.push({ kind: "meta", text: `index ${before}..${file.checksumAfter}${mode}` });
  }
  if (oldPath || newPath) {
    rows.push({ kind: "meta", text: `--- ${file.isNew ? "/dev/null" : `a/${oldPath}`}` });
    rows.push({ kind: "meta", text: `+++ ${file.isDeleted ? "/dev/null" : `b/${newPath}`}` });
  }
  return rows;
}

function mapDiff2HtmlFile(file: Diff2HtmlFile): GitDiffFilePatch {
  const hunks = file.blocks.map((block) => ({
    header: block.header,
    oldStart: block.oldStartLine,
    newStart: block.newStartLine,
    rows: rowsFromDiff2HtmlLines(block.lines),
  }));
  return {
    oldPath: file.oldName || "",
    newPath: file.newName || "",
    meta: fileMetaRows(file),
    hunks,
  };
}

function parsePart(
  kind: GitDiffPartKind,
  title: GitDiffPart["title"],
  raw: string,
): GitDiffPart {
  const files = parseDiff2Html(raw, {
    drawFileList: false,
    matching: "lines",
    outputFormat: "side-by-side",
  }).map(mapDiff2HtmlFile);
  return { kind, title, raw, files };
}

export function buildGitDiffDocument(diff: GitFileDiff): GitDiffDocument {
  const parts = [
    diff.stagedDiff ? parsePart("staged", "已暂存差异", diff.stagedDiff) : null,
    diff.unstagedDiff ? parsePart("unstaged", "未暂存差异", diff.unstagedDiff) : null,
  ].filter((part): part is GitDiffPart => Boolean(part));
  return {
    path: diff.path,
    parts,
    isBinary: diff.isBinary,
    truncated: Boolean(diff.truncated),
  };
}
