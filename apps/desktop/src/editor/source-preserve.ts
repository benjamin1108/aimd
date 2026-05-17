import type { MarkdownSourceBlock, MarkdownSourceCell, MarkdownSourceModel } from "../core/types";

type PatchResult =
  | { ok: true; markdown: string }
  | { ok: false; reason: string };

const SOURCE_REF = "mdSourceRef";

export function createSourceModel(markdown: string): MarkdownSourceModel {
  const lines = splitLines(markdown);
  const blocks: MarkdownSourceBlock[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.text.trim()) {
      i += 1;
      continue;
    }
    if (i === 0 && line.text === "---") {
      const end = lines.findIndex((candidate, index) => index > 0 && candidate.text === "---");
      if (end > 0) {
        i = end + 1;
        continue;
      }
    }

    const heading = /^(#{1,6})([ \t]+)(.*?)([ \t]+#+[ \t]*)?$/.exec(line.text);
    if (heading) {
      const prefix = heading[1].length + heading[2].length;
      const closing = heading[4]?.length || 0;
      blocks.push(block(`b${blockIndex++}`, "heading", line.start, line.end, line.start + prefix, line.start + line.text.length - closing));
      i += 1;
      continue;
    }

    if (/^\s*(```|~~~)/.test(line.text)) {
      const fence = line.text.trim().slice(0, 3);
      let end = i + 1;
      while (end < lines.length && !lines[end].text.trim().startsWith(fence)) end += 1;
      if (end < lines.length) end += 1;
      const last = lines[Math.max(i, end - 1)];
      const closingLine = end > i + 1 && lines[end - 1]?.text.trim().startsWith(fence)
        ? lines[end - 1]
        : null;
      blocks.push(block(
        `b${blockIndex++}`,
        "code",
        line.start,
        last.end,
        line.end,
        closingLine ? closingLine.start : last.end,
      ));
      i = end;
      continue;
    }

    if (isThematicBreak(line.text)) {
      blocks.push(block(`b${blockIndex++}`, "thematic_break", line.start, line.end, line.start, line.endWithoutBreak));
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      let end = i + 2;
      while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end].text)) end += 1;
      const last = lines[end - 1];
      const table = block(`b${blockIndex++}`, "table", line.start, last.end, line.start, last.end);
      table.cells = tableCells(lines.slice(i, end), table.id);
      blocks.push(table);
      i = end;
      continue;
    }

    const list = /^(\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(.*)$/.exec(line.text);
    if (list) {
      const prefix = list[1].length;
      blocks.push(block(`b${blockIndex++}`, "list_item", line.start, line.end, line.start + prefix, line.endWithoutBreak));
      i += 1;
      continue;
    }

    const quote = /^(\s*>\s?)(.*)$/.exec(line.text);
    if (quote) {
      const prefix = quote[1].length;
      blocks.push(block(`b${blockIndex++}`, "blockquote", line.start, line.end, line.start + prefix, line.endWithoutBreak));
      i += 1;
      continue;
    }

    const start = i;
    i += 1;
    while (i < lines.length && lines[i].text.trim() && !startsSpecial(lines, i)) i += 1;
    const first = lines[start];
    const last = lines[i - 1];
    blocks.push(block(`b${blockIndex++}`, "paragraph", first.start, last.end, first.start, last.endWithoutBreak));
  }

  return { markdown, blocks };
}

export function annotateSourceBlocks(root: HTMLElement, model: MarkdownSourceModel) {
  root.querySelectorAll("[data-md-source-ref]").forEach((el) => {
    delete (el as HTMLElement).dataset[SOURCE_REF];
  });
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,hr"));
  const blocks = model.blocks.filter((b) => b.kind !== "other");
  let blockIndex = 0;
  for (const el of candidates) {
    const expected = elementKind(el);
    while (blockIndex < blocks.length && !kindMatches(expected, blocks[blockIndex])) blockIndex += 1;
    const source = blocks[blockIndex];
    if (!source) break;
    el.dataset[SOURCE_REF] = source.id;
    if (source.kind === "table") annotateTableCells(el, source);
    blockIndex += 1;
  }
}

export function sourceRefFromEvent(event?: Event): string | null {
  const target = event?.target;
  if (target instanceof HTMLElement) {
    const fromTarget = sourceRefFromNode(target);
    if (fromTarget) return fromTarget;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  const fromAnchor = sourceRefFromNode(anchor);
  if (fromAnchor) return fromAnchor;

  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  if (container instanceof HTMLElement) {
    const before = range.startOffset > 0 ? container.childNodes[range.startOffset - 1] : null;
    const after = container.childNodes[range.startOffset] ?? null;
    return sourceRefFromNode(before) || sourceRefFromNode(after);
  }
  return null;
}

export function patchDirtySource(root: HTMLElement, model: MarkdownSourceModel, refs: Set<string>): PatchResult {
  const patches: Array<{ start: number; end: number; value: string }> = [];
  for (const ref of refs) {
    const el = root.querySelector<HTMLElement>(`[data-md-source-ref="${CSS.escape(ref)}"]`);
    if (!el) return { ok: false, reason: `找不到已编辑块: ${ref}` };
    const cell = findCell(model, ref);
    if (cell) {
      patches.push(patchForRange(model.markdown, cell.contentStart, cell.contentEnd, textForElement(el)));
      continue;
    }
    const block = model.blocks.find((candidate) => candidate.id === ref);
    if (!block) return { ok: false, reason: `找不到源块: ${ref}` };
    if (block.kind === "code") {
      patches.push(patchCodeBlock(model.markdown, block.contentStart, block.contentEnd, textForCodeBlock(el)));
      continue;
    }
    if (!["heading", "paragraph", "list_item", "blockquote"].includes(block.kind)) {
      return { ok: false, reason: `暂不支持直接保存此结构: ${block.kind}` };
    }
    patches.push(patchForRange(model.markdown, block.contentStart, block.contentEnd, textForElement(el)));
  }
  patches.sort((a, b) => b.start - a.start);
  let markdown = model.markdown;
  for (const patch of patches) {
    markdown = markdown.slice(0, patch.start) + patch.value + markdown.slice(patch.end);
  }
  return { ok: true, markdown };
}

export function patchRemovedImageBlocks(root: HTMLElement, model: MarkdownSourceModel): PatchResult | null {
  const patches: Array<{ start: number; end: number; value: string }> = [];
  for (const block of model.blocks) {
    const source = model.markdown.slice(block.start, block.end).trim();
    if (!isImageOnlyMarkdown(source)) continue;
    const el = root.querySelector<HTMLElement>(`[data-md-source-ref="${CSS.escape(block.id)}"]`);
    if (el && (el.querySelector("img") || (el.textContent || "").trim())) continue;
    patches.push({ start: block.start, end: block.end, value: "" });
  }
  if (!patches.length) return null;
  patches.sort((a, b) => b.start - a.start);
  let markdown = model.markdown;
  for (const patch of patches) {
    markdown = markdown.slice(0, patch.start) + patch.value + markdown.slice(patch.end);
  }
  return { ok: true, markdown };
}

export function appendedStructuralHTML(root: HTMLElement): string | null {
  const children = Array.from(root.children) as HTMLElement[];
  const firstUnmapped = children.findIndex((child) => !hasSourceRef(child));
  if (firstUnmapped < 0) return "";
  const before = children.slice(0, firstUnmapped);
  if (before.some((child) => !hasSourceRef(child))) return null;
  const appended = children.slice(firstUnmapped);
  if (appended.some((child) => hasSourceRef(child))) return null;
  return appended.map((child) => child.outerHTML).join("");
}

export function sourceOffsetFromSelection(root: HTMLElement, model: MarkdownSourceModel): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return model.markdown.length;
  const range = selection.getRangeAt(0);
  const direct = sourceOffsetFromNode(range.startContainer, model, range);
  if (direct !== null) return direct;
  if (range.startContainer === root) {
    const before = range.startOffset > 0 ? root.childNodes[range.startOffset - 1] : null;
    const after = root.childNodes[range.startOffset] ?? null;
    const beforeRef = sourceRefFromNode(before);
    if (beforeRef) return sourceRangeForRef(model, beforeRef)?.contentEnd ?? null;
    const afterRef = sourceRefFromNode(after);
    if (afterRef) return sourceRangeForRef(model, afterRef)?.start ?? null;
  }
  return model.markdown.length;
}

function isImageOnlyMarkdown(source: string) {
  return /^!\[[^\]]*\]\([^)]+\)$/.test(source);
}

function block(id: string, kind: MarkdownSourceBlock["kind"], start: number, end: number, contentStart: number, contentEnd: number): MarkdownSourceBlock {
  return { id, kind, start, end, contentStart, contentEnd };
}

function splitLines(markdown: string) {
  const matches = markdown.matchAll(/[^\n]*(?:\n|$)/g);
  const lines: Array<{ text: string; start: number; end: number; endWithoutBreak: number }> = [];
  for (const match of matches) {
    const raw = match[0];
    if (!raw) continue;
    const start = match.index || 0;
    const hasBreak = raw.endsWith("\n");
    const text = hasBreak ? raw.slice(0, -1).replace(/\r$/, "") : raw;
    const breakExtra = hasBreak ? raw.length - text.length : 0;
    lines.push({ text, start, end: start + raw.length, endWithoutBreak: start + raw.length - breakExtra });
  }
  return lines;
}

function startsSpecial(lines: ReturnType<typeof splitLines>, i: number) {
  return /^(#{1,6})\s/.test(lines[i].text)
    || /^\s*(```|~~~)/.test(lines[i].text)
    || isThematicBreak(lines[i].text)
    || /^(\s*(?:[-+*]|\d+[.)])\s+)/.test(lines[i].text)
    || /^\s*>\s?/.test(lines[i].text)
    || isTableStart(lines, i);
}

function isThematicBreak(line: string) {
  const trimmed = line.trim();
  return /^(?:\*\s*){3,}$/.test(trimmed)
    || /^(?:-\s*){3,}$/.test(trimmed)
    || /^(?:_\s*){3,}$/.test(trimmed);
}

function isTableStart(lines: ReturnType<typeof splitLines>, i: number) {
  return i + 1 < lines.length
    && /^\s*\|.*\|\s*$/.test(lines[i].text)
    && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1].text);
}

function tableCells(lines: ReturnType<typeof splitLines>, tableId: string): MarkdownSourceCell[] {
  const cells: MarkdownSourceCell[] = [];
  for (const line of lines) {
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.text)) continue;
    const pipes = pipePositions(line.text);
    for (let i = 0; i + 1 < pipes.length; i += 1) {
      const start = line.start + pipes[i] + 1;
      const end = line.start + pipes[i + 1];
      const raw = line.text.slice(pipes[i] + 1, pipes[i + 1]);
      const leading = raw.match(/^\s*/)?.[0].length || 0;
      const trailing = raw.match(/\s*$/)?.[0].length || 0;
      cells.push({ id: `${tableId}:c${cells.length}`, start, end, contentStart: start + leading, contentEnd: end - trailing });
    }
  }
  return cells;
}

function pipePositions(line: string) {
  const positions: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "|" && line[i - 1] !== "\\") positions.push(i);
  }
  if (positions[0] !== 0) positions.unshift(-1);
  if (positions[positions.length - 1] !== line.length - 1) positions.push(line.length);
  return positions;
}

function elementKind(el: HTMLElement): MarkdownSourceBlock["kind"] {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "li") return "list_item";
  if (tag === "blockquote") return "blockquote";
  if (tag === "table") return "table";
  if (tag === "pre") return "code";
  if (tag === "hr") return "thematic_break";
  return "paragraph";
}

function kindMatches(expected: MarkdownSourceBlock["kind"], block: MarkdownSourceBlock) {
  if (expected === "paragraph" && block.kind === "paragraph") return true;
  return expected === block.kind;
}

function annotateTableCells(el: HTMLElement, block: MarkdownSourceBlock) {
  const cells = block.cells || [];
  const domCells = Array.from(el.querySelectorAll<HTMLElement>("th,td"));
  domCells.forEach((cell, i) => {
    const source = cells[i];
    if (source) cell.dataset[SOURCE_REF] = source.id;
  });
}

function findCell(model: MarkdownSourceModel, id: string): MarkdownSourceCell | null {
  for (const block of model.blocks) {
    const cell = block.cells?.find((candidate) => candidate.id === id);
    if (cell) return cell;
  }
  return null;
}

function textForElement(el: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("ul,ol").forEach((child) => child.remove());
  return (clone.textContent || "").replace(/\u00a0/g, " ").trim();
}

function textForCodeBlock(el: HTMLElement) {
  return el.querySelector("code")?.textContent ?? el.textContent ?? "";
}

function patchCodeBlock(markdown: string, start: number, end: number, nextText: string) {
  const original = markdown.slice(start, end);
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const normalized = nextText.replace(/\r\n|\r|\n/g, newline);
  const value = original.endsWith(newline) || normalized.length > 0
    ? `${trimOneTrailingNewline(normalized, newline)}${newline}`
    : normalized;
  return { start, end, value };
}

function trimOneTrailingNewline(value: string, newline: string) {
  return value.endsWith(newline) ? value.slice(0, -newline.length) : value;
}

function patchForRange(markdown: string, start: number, end: number, nextText: string) {
  const original = markdown.slice(start, end);
  const mapped = inlineVisibleMap(original);
  const oldText = mapped.text;
  let prefix = 0;
  while (prefix < oldText.length && prefix < nextText.length && oldText[prefix] === nextText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix + prefix < oldText.length
    && suffix + prefix < nextText.length
    && oldText[oldText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) suffix += 1;
  const replaceStart = sourceIndexForVisible(mapped.positions, prefix, original.length);
  const replaceEnd = sourceIndexForVisible(mapped.positions, oldText.length - suffix, original.length);
  const value = original.slice(0, replaceStart) + nextText.slice(prefix, nextText.length - suffix) + original.slice(replaceEnd);
  return { start, end, value };
}

function sourceIndexForVisible(positions: Array<{ start: number; end: number }>, index: number, fallback: number) {
  if (index <= 0) return positions[0]?.start ?? 0;
  if (index >= positions.length) return positions[positions.length - 1]?.end ?? fallback;
  return positions[index].start;
}

function visibleOffsetWithin(el: HTMLElement, range: Range) {
  const probe = document.createRange();
  try {
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  } catch {
    return null;
  }
}

function sourceOffsetFromNode(node: Node, model: MarkdownSourceModel, range: Range): number | null {
  const ref = sourceRefFromNode(node);
  if (!ref) return null;
  const el = node instanceof HTMLElement
    ? node.closest<HTMLElement>("[data-md-source-ref]")
    : node.parentElement?.closest<HTMLElement>("[data-md-source-ref]");
  if (!el) return null;
  const sourceRange = sourceRangeForRef(model, ref);
  if (!sourceRange) return null;
  const visibleOffset = visibleOffsetWithin(el, range);
  if (visibleOffset === null) return null;
  const original = model.markdown.slice(sourceRange.contentStart, sourceRange.contentEnd);
  const mapped = inlineVisibleMap(original);
  return sourceRange.contentStart + sourceIndexForVisible(mapped.positions, visibleOffset, original.length);
}

function sourceRangeForRef(model: MarkdownSourceModel, id: string) {
  const cell = findCell(model, id);
  if (cell) return cell;
  return model.blocks.find((candidate) => candidate.id === id) ?? null;
}

function inlineVisibleMap(source: string) {
  const positions: Array<{ start: number; end: number }> = [];
  let text = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\" && i + 1 < source.length) {
      text += source[i + 1];
      positions.push({ start: i, end: i + 2 });
      i += 1;
      continue;
    }
    if (ch === "!" && source[i + 1] === "[") {
      const close = source.indexOf("]", i + 2);
      const open = close >= 0 ? source.indexOf("(", close) : -1;
      const end = open >= 0 ? source.indexOf(")", open) : -1;
      if (close >= 0 && open === close + 1 && end >= 0) {
        i = end;
        continue;
      }
    }
    if (ch === "[") {
      const close = source.indexOf("]", i + 1);
      const open = close >= 0 ? source.indexOf("(", close) : -1;
      const end = open >= 0 ? source.indexOf(")", open) : -1;
      if (close >= 0 && open === close + 1 && end >= 0) {
        for (let p = i + 1; p < close; p += 1) {
          text += source[p];
          positions.push({ start: p, end: p + 1 });
        }
        i = end;
        continue;
      }
    }
    if ("*_`~".includes(ch)) continue;
    text += ch;
    positions.push({ start: i, end: i + 1 });
  }
  return { text, positions };
}

function sourceRefFromNode(node: Node | null | undefined): string | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-md-source-ref]")?.dataset[SOURCE_REF] || null;
}

function hasSourceRef(el: HTMLElement): boolean {
  return Boolean(el.dataset[SOURCE_REF] || el.querySelector("[data-md-source-ref]"));
}
