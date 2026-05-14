import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { markdownEl } from "../core/dom";
import { setStatus, updateChrome } from "../ui/chrome";
import { scheduleRender } from "../ui/outline";

type LinkOpenMode = "plain" | "modifier";

export function enhanceRenderedDocument(
  root: HTMLElement,
  opts: { codeCopy?: boolean; taskToggle?: boolean; linkOpen?: LinkOpenMode } = {},
) {
  if (opts.codeCopy) addCodeCopyButtons(root);
  if (opts.taskToggle) enableTaskCheckboxes(root);
  if (opts.linkOpen) enableExternalLinks(root, opts.linkOpen);
}

function addCodeCopyButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy";
    btn.textContent = "复制";
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text.replace(btn.textContent || "", ""));
        setStatus("代码已复制", "success");
      } catch {
        setStatus("复制失败", "warn");
      }
    });
    pre.appendChild(btn);
  });
}

function enableTaskCheckboxes(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, index) => {
    box.disabled = false;
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTaskMarkdown(index);
    });
  });
}

function toggleTaskMarkdown(index: number) {
  if (!state.doc) return;
  const re = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+.*)$/gm;
  let seen = -1;
  const next = state.doc.markdown.replace(re, (full, start: string, mark: string, end: string) => {
    seen += 1;
    if (seen !== index) return full;
    return `${start}${mark.toLowerCase() === "x" ? " " : "x"}${end}`;
  });
  if (next === state.doc.markdown) return;
  state.doc.markdown = next;
  state.doc.dirty = true;
  markdownEl().value = next;
  updateChrome();
  scheduleRender();
}

function enableExternalLinks(root: HTMLElement, mode: LinkOpenMode) {
  root.dataset.linkOpenMode = mode;
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const url = resolveExternalUrl(anchor);
    if (!url) return;
    anchor.dataset.externalLink = "true";
  });
  if (root.dataset.externalLinkBound) return;
  root.dataset.externalLinkBound = "true";
  root.addEventListener("click", (event) => {
    handleAnchorOpenEvent(root, event);
  });
  root.addEventListener("contextmenu", (event) => {
    const openMode = root.dataset.linkOpenMode as LinkOpenMode | undefined;
    if (openMode !== "modifier" || (!event.metaKey && !event.ctrlKey)) return;
    handleAnchorOpenEvent(root, event);
  });
}

function handleAnchorOpenEvent(root: HTMLElement, event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !root.contains(anchor)) return;
  const openMode = root.dataset.linkOpenMode as LinkOpenMode | undefined;
  const shouldOpen = openMode === "plain" || event.metaKey || event.ctrlKey;
  if (!shouldOpen) return;
  event.preventDefault();
  event.stopPropagation();
  void openAnchorExternally(anchor);
}

function resolveExternalUrl(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute("href")?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function openAnchorExternally(anchor: HTMLAnchorElement) {
  const url = resolveExternalUrl(anchor);
  if (!url) {
    setStatus("这个链接不能用系统浏览器打开", "warn");
    return;
  }
  try {
    await invoke("open_external_url", { url });
  } catch (err) {
    setStatus(`打开链接失败: ${String(err)}`, "warn");
  }
}
