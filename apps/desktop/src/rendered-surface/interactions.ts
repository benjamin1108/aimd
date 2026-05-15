import type { LinkOpenMode, RenderedSurfaceCallbacks, RenderedSurfaceProfile } from "./types";

const LINK_HINT_STATUS_ACTION = "link-hover-hint";

let activeHintCallbacks: RenderedSurfaceCallbacks | null = null;

export function clearRenderedSurfaceInteractionStatus() {
  activeHintCallbacks?.clearLinkHint();
  activeHintCallbacks = null;
}

export function prepareRenderedSurfaceInteractions(
  root: HTMLElement,
  profile: RenderedSurfaceProfile,
  callbacks: RenderedSurfaceCallbacks,
) {
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const url = resolveExternalUrl(anchor);
    if (!url) {
      delete anchor.dataset.externalLink;
      delete anchor.dataset.externalMediaLink;
      return;
    }
    if (isMediaOnlyLink(anchor)) {
      delete anchor.dataset.externalLink;
      anchor.dataset.externalMediaLink = "true";
    } else {
      delete anchor.dataset.externalMediaLink;
      anchor.dataset.externalLink = "true";
    }
  });

  if (profile.taskToggle) {
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      box.disabled = false;
    });
  }

  if (profile.codeCopy) addCodeCopyButtons(root, profile, callbacks);
}

export function bindRenderedSurfaceInteractions(
  root: HTMLElement,
  profile: RenderedSurfaceProfile,
  callbacks: RenderedSurfaceCallbacks,
): () => void {
  const onMouseOver = (event: MouseEvent) => {
    if (isSurfaceInactive(root) || profile.linkOpen === "none") return;
    const anchor = anchorFromEvent(root, event);
    if (!anchor || !resolveExternalUrl(anchor)) return;
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && anchor.contains(related)) return;
    activeHintCallbacks = callbacks;
    callbacks.showLinkHint();
  };

  const onMouseOut = (event: MouseEvent) => {
    if (profile.linkOpen === "none") return;
    const anchor = anchorFromEvent(root, event);
    if (!anchor) return;
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && anchor.contains(related)) return;
    if (activeHintCallbacks === callbacks) activeHintCallbacks = null;
    callbacks.clearLinkHint();
  };

  const onClick = (event: MouseEvent) => {
    if (isSurfaceInactive(root)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const img = target.closest<HTMLImageElement>("img");
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (profile.imageLightbox && img && root.contains(img) && !img.closest(".aimd-lightbox")) {
      if (!(anchor && isModifierClick(event))) {
        const src = img.getAttribute("src") || "";
        if (!src) return;
        event.preventDefault();
        event.stopPropagation();
        callbacks.openImage(src);
        return;
      }
    }

    const task = target.closest<HTMLInputElement>('input[type="checkbox"]');
    if (profile.taskToggle && task && root.contains(task)) {
      event.stopPropagation();
      callbacks.toggleTask(taskIndex(root, task));
      return;
    }

    if (anchor && root.contains(anchor)) {
      handleAnchorOpen(anchor, event, profile.linkOpen, callbacks);
    }
  };

  const onContextMenu = (event: MouseEvent) => {
    if (isSurfaceInactive(root) || profile.linkOpen !== "modifier" || !isModifierClick(event)) return;
    const anchor = anchorFromEvent(root, event);
    if (anchor) handleAnchorOpen(anchor, event, profile.linkOpen, callbacks);
  };

  root.addEventListener("mouseover", onMouseOver);
  root.addEventListener("mouseout", onMouseOut);
  root.addEventListener("click", onClick);
  root.addEventListener("contextmenu", onContextMenu);

  return () => {
    root.removeEventListener("mouseover", onMouseOver);
    root.removeEventListener("mouseout", onMouseOut);
    root.removeEventListener("click", onClick);
    root.removeEventListener("contextmenu", onContextMenu);
    if (activeHintCallbacks === callbacks) {
      callbacks.clearLinkHint();
      activeHintCallbacks = null;
    }
  };
}

function addCodeCopyButtons(
  root: HTMLElement,
  profile: RenderedSurfaceProfile,
  callbacks: RenderedSurfaceCallbacks,
) {
  root.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy";
    btn.contentEditable = "false";
    btn.textContent = "复制";
    btn.dataset.surfaceKind = profile.kind;
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text.replace(btn.textContent || "", ""));
        callbacks.setStatus("代码已复制", "success");
      } catch {
        callbacks.setStatus("复制失败", "warn");
      }
    });
    pre.appendChild(btn);
  });
}

function handleAnchorOpen(
  anchor: HTMLAnchorElement,
  event: MouseEvent,
  mode: LinkOpenMode,
  callbacks: RenderedSurfaceCallbacks,
) {
  event.preventDefault();
  event.stopPropagation();
  if (mode === "none") return;
  const shouldOpen = mode === "plain" || isModifierClick(event);
  if (!shouldOpen) {
    activeHintCallbacks = callbacks;
    callbacks.showLinkHint();
    return;
  }
  const url = resolveExternalUrl(anchor);
  if (!url) {
    callbacks.setStatus("这个链接不能用系统浏览器打开", "warn");
    return;
  }
  void callbacks.openExternalUrl(url);
}

function anchorFromEvent(root: HTMLElement, event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]") ?? null;
  return anchor && root.contains(anchor) ? anchor : null;
}

function taskIndex(root: HTMLElement, task: HTMLInputElement): number {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).indexOf(task);
}

function isModifierClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function isSurfaceInactive(root: HTMLElement): boolean {
  return root.hidden || Boolean(root.closest("[hidden]"));
}

function isMediaOnlyLink(anchor: HTMLAnchorElement): boolean {
  return anchor.textContent?.trim() === "" && Boolean(anchor.querySelector("img, picture, svg"));
}

function resolveExternalUrl(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute("href")?.trim();
  if (!raw || raw.startsWith("#")) return null;
  try {
    const url = new URL(raw, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
