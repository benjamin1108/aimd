import { markdownEl, previewEl } from "../core/dom";
import { state } from "../core/state";
import { activeTab } from "../document/open-document-state";

type ScrollOwner = "source" | "preview";

type ScrollAnchor = {
  top: number;
};

const PREVIEW_ANCHOR_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "blockquote",
  "pre",
  "table",
  "img",
].join(",");

let scheduledFrame = 0;
let programmaticScroll: { owner: ScrollOwner; top: number } | null = null;
let programmaticClearFrame = 0;
let lastOwner: ScrollOwner = "source";

export function bindEditScrollSync() {
  markdownEl().addEventListener("scroll", () => scheduleEditScrollSync("source"), { passive: true });
  previewEl().addEventListener("scroll", () => scheduleEditScrollSync("preview"), { passive: true });
  window.addEventListener("resize", () => scheduleEditScrollSync(lastOwner), { passive: true });
}

export function refreshEditScrollSync(owner: ScrollOwner = lastOwner) {
  if (!canSyncEditScroll()) return;
  syncEditScrollFrom(owner);
}

function scheduleEditScrollSync(owner: ScrollOwner) {
  if (!canSyncEditScroll()) return;
  if (isExpectedProgrammaticScroll(owner)) return;
  programmaticScroll = null;
  lastOwner = owner;
  if (scheduledFrame) window.cancelAnimationFrame(scheduledFrame);
  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = 0;
    syncEditScrollFrom(owner);
  });
}

function syncEditScrollFrom(owner: ScrollOwner) {
  if (!canSyncEditScroll()) return;
  const source = markdownEl();
  const preview = previewEl();
  const sourceMax = maxScrollTop(source);
  const previewMax = maxScrollTop(preview);

  if (owner === "source") {
    const targetTop = mapScrollTop(
      source.scrollTop,
      sourceMax,
      previewMax,
      sourceAnchors(source),
      previewAnchors(preview),
    );
    setProgrammaticScroll(preview, targetTop, "preview");
  } else {
    const targetTop = mapScrollTop(
      preview.scrollTop,
      previewMax,
      sourceMax,
      previewAnchors(preview),
      sourceAnchors(source),
    );
    setProgrammaticScroll(source, targetTop, "source");
  }
  persistEditScrollState();
}

function canSyncEditScroll(): boolean {
  return Boolean(state.doc && state.mode === "edit" && !markdownEl().hidden && !previewEl().hidden);
}

function setProgrammaticScroll(element: HTMLElement, top: number, owner: ScrollOwner) {
  const nextTop = clamp(top, 0, maxScrollTop(element));
  if (Math.abs(element.scrollTop - nextTop) < 1) {
    persistEditScrollState();
    return;
  }
  programmaticScroll = { owner, top: nextTop };
  element.scrollTop = nextTop;
  if (programmaticClearFrame) window.cancelAnimationFrame(programmaticClearFrame);
  programmaticClearFrame = window.requestAnimationFrame(() => {
    if (programmaticScroll?.owner === owner) programmaticScroll = null;
    programmaticClearFrame = 0;
    persistEditScrollState();
  });
}

function isExpectedProgrammaticScroll(owner: ScrollOwner): boolean {
  if (programmaticScroll?.owner !== owner) return false;
  const currentTop = owner === "source" ? markdownEl().scrollTop : previewEl().scrollTop;
  return Math.abs(currentTop - programmaticScroll.top) < 1;
}

function persistEditScrollState() {
  const tab = activeTab();
  if (!tab) return;
  tab.scroll.edit = previewEl().scrollTop;
  tab.scroll.source = markdownEl().scrollTop;
}

function mapScrollTop(
  fromTop: number,
  fromMax: number,
  toMax: number,
  fromAnchors: ScrollAnchor[],
  toAnchors: ScrollAnchor[],
): number {
  if (fromMax <= 0 || toMax <= 0) return 0;
  const count = Math.min(fromAnchors.length, toAnchors.length);
  if (count === 0) return proportionalTop(fromTop, fromMax, toMax);

  const pairs = normalizedAnchorPairs(
    fromMax,
    toMax,
    fromAnchors.slice(0, count),
    toAnchors.slice(0, count),
  );
  if (pairs.length < 2) return proportionalTop(fromTop, fromMax, toMax);

  for (let index = 1; index < pairs.length; index += 1) {
    const prev = pairs[index - 1];
    const next = pairs[index];
    if (fromTop <= next.from) {
      const span = Math.max(1, next.from - prev.from);
      const progress = clamp((fromTop - prev.from) / span, 0, 1);
      return prev.to + (next.to - prev.to) * progress;
    }
  }

  return toMax;
}

function normalizedAnchorPairs(
  fromMax: number,
  toMax: number,
  fromAnchors: ScrollAnchor[],
  toAnchors: ScrollAnchor[],
): Array<{ from: number; to: number }> {
  const pairs = [
    { from: 0, to: 0 },
    ...fromAnchors.map((anchor, index) => ({
      from: clamp(anchor.top, 0, fromMax),
      to: clamp(toAnchors[index]?.top ?? 0, 0, toMax),
    })),
    { from: fromMax, to: toMax },
  ].sort((a, b) => a.from - b.from);

  return pairs.reduce<Array<{ from: number; to: number }>>((acc, pair) => {
    const previous = acc[acc.length - 1];
    if (previous && Math.abs(previous.from - pair.from) < 1) {
      previous.to = pair.to;
      return acc;
    }
    acc.push(pair);
    return acc;
  }, []);
}

function proportionalTop(fromTop: number, fromMax: number, toMax: number): number {
  return clamp(fromTop / fromMax, 0, 1) * toMax;
}

function sourceAnchors(source: HTMLTextAreaElement): ScrollAnchor[] {
  const lineHeight = textareaLineHeight(source);
  const lines = source.value.split("\n");
  const anchors: ScrollAnchor[] = [];
  let inFence = false;
  let inParagraph = false;
  let inTable = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      inParagraph = false;
      inTable = false;
      return;
    }

    if (/^\s*(```|~~~)/.test(line)) {
      anchors.push({ top: index * lineHeight });
      inFence = !inFence;
      inParagraph = false;
      inTable = false;
      return;
    }
    if (inFence) return;

    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      anchors.push({ top: index * lineHeight });
      inParagraph = false;
      inTable = false;
      return;
    }

    if (/^\s{0,3}([-*+]|\d+[.)])\s+/.test(line)) {
      anchors.push({ top: index * lineHeight });
      inParagraph = false;
      inTable = false;
      return;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      anchors.push({ top: index * lineHeight });
      inParagraph = false;
      inTable = false;
      return;
    }

    if (/!\[[^\]]*]\([^)]+\)/.test(line)) {
      anchors.push({ top: index * lineHeight });
      inParagraph = false;
      inTable = false;
      return;
    }

    if (isTableLine(line, lines[index + 1], lines[index - 1])) {
      if (!inTable) anchors.push({ top: index * lineHeight });
      inTable = true;
      inParagraph = false;
      return;
    }

    inTable = false;
    if (!inParagraph) anchors.push({ top: index * lineHeight });
    inParagraph = true;
  });

  return anchors;
}

function previewAnchors(root: HTMLElement): ScrollAnchor[] {
  const rootRect = root.getBoundingClientRect();
  return Array.from(root.querySelectorAll<HTMLElement>(PREVIEW_ANCHOR_SELECTOR))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({
      top: element.getBoundingClientRect().top - rootRect.top + root.scrollTop,
    }));
}

function textareaLineHeight(textarea: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(textarea);
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) return parsed;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.45 : 22;
}

function isTableLine(line: string, next?: string, previous?: string): boolean {
  if (!line.includes("|")) return false;
  return isTableDivider(next) || isTableDivider(previous) || isTableDivider(line);
}

function isTableDivider(line: string | undefined): boolean {
  return Boolean(line && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line));
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
