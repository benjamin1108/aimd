const HOVER_DELAY_MS = 35;
const FALLBACK_TEARDOWN_MS = 180;

type ActiveOverlay = {
  target: HTMLElement;
  overlay: HTMLElement;
  originalWidth: number;
  animationFrame: number;
  teardownTimer: number | null;
};

let hoverTimer: number | null = null;
let activeOverlay: ActiveOverlay | null = null;

function portalRoot() {
  let root = document.querySelector<HTMLElement>("#workspace-row-overflow-portal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "workspace-row-overflow-portal-root";
    document.body.appendChild(root);
  }
  return root;
}

function clearHoverTimer() {
  if (hoverTimer == null) return;
  window.clearTimeout(hoverTimer);
  hoverTimer = null;
}

function removeActiveOverlay() {
  if (!activeOverlay) return;
  window.cancelAnimationFrame(activeOverlay.animationFrame);
  if (activeOverlay.teardownTimer != null) {
    window.clearTimeout(activeOverlay.teardownTimer);
  }
  activeOverlay.overlay.remove();
  activeOverlay = null;
}

export function clearTreeOverflowOverlay() {
  clearHoverTimer();
  removeActiveOverlay();
}

function targetText(target: HTMLElement, textSelector: string) {
  return target.querySelector<HTMLElement>(textSelector);
}

function isPhysicallyTruncated(text: HTMLElement) {
  return text.scrollWidth > text.clientWidth + 1;
}

function measuredCssLength(customProperty: string) {
  const probe = document.createElement("div");
  probe.className = "workspace-row-overflow-measure";
  probe.style.width = `var(${customProperty}, var(--size-control-xs))`;
  portalRoot().appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(width) ? width : 0;
}

function targetOverlayWidth(rect: DOMRect, text: HTMLElement) {
  const overflowWidth = Math.max(0, text.scrollWidth - text.clientWidth);
  const extensionLimit = measuredCssLength("--workspace-row-overflow-max-extension");
  const buffer = measuredCssLength("--workspace-row-overflow-buffer");
  const viewportGutter = measuredCssLength("--workspace-row-overflow-viewport-gutter");
  const compactOverflowWidth = extensionLimit > 0 ? Math.min(overflowWidth, extensionLimit) : overflowWidth;
  const viewportWidth = Math.max(rect.width, window.innerWidth - rect.left - viewportGutter);
  return Math.ceil(Math.min(rect.width + compactOverflowWidth + buffer, viewportWidth));
}

function cloneOverlay(target: HTMLElement) {
  const overlay = target.cloneNode(true) as HTMLElement;
  overlay.classList.add("workspace-row-overflow-overlay");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("tabindex", "-1");
  overlay.removeAttribute("id");
  overlay.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  return overlay;
}

function mountOverlay(target: HTMLElement, textSelector: string) {
  const text = targetText(target, textSelector);
  if (!text || !isPhysicallyTruncated(text)) return;
  removeActiveOverlay();

  const rect = target.getBoundingClientRect();
  const targetWidth = targetOverlayWidth(rect, text);
  const overlay = cloneOverlay(target);

  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  portalRoot().appendChild(overlay);

  const animationFrame = window.requestAnimationFrame(() => {
    overlay.classList.add("is-open");
    overlay.style.width = `${targetWidth}px`;
  });

  activeOverlay = {
    target,
    overlay,
    originalWidth: rect.width,
    animationFrame,
    teardownTimer: null,
  };
}

function closeOverlayFor(target: HTMLElement) {
  if (!activeOverlay || activeOverlay.target !== target) return;
  const current = activeOverlay;
  window.cancelAnimationFrame(current.animationFrame);
  current.overlay.classList.remove("is-open");
  current.overlay.style.width = `${current.originalWidth}px`;

  const finish = (event?: TransitionEvent) => {
    if (event && (event.target !== current.overlay || event.propertyName !== "width")) return;
    current.overlay.removeEventListener("transitionend", finish);
    if (activeOverlay?.overlay === current.overlay) {
      removeActiveOverlay();
    } else {
      current.overlay.remove();
    }
  };
  current.overlay.addEventListener("transitionend", finish);
  current.teardownTimer = window.setTimeout(() => finish(), FALLBACK_TEARDOWN_MS);
}

export function bindTreeOverflowOverlay(target: HTMLElement, textSelector = ".workspace-name") {
  target.addEventListener("mouseenter", () => {
    clearHoverTimer();
    hoverTimer = window.setTimeout(() => {
      hoverTimer = null;
      mountOverlay(target, textSelector);
    }, HOVER_DELAY_MS);
  });
  target.addEventListener("mouseleave", () => {
    clearHoverTimer();
    closeOverlayFor(target);
  });
}
