import { panelEl, sidebarHrResizerEl } from "../core/dom";
import { state, STORAGE_DOC_PANEL_COLLAPSED, STORAGE_WORKSPACE_COLLAPSED } from "../core/state";

export const SIDEBAR_MIN_W = 160;
export const SIDEBAR_DEFAULT_W = 244;

export function getSidebarMaxW() {
  return Math.min(Math.round(window.innerWidth * 0.5), 480);
}

export function applySidebarWidth(w: number) {
  const clamped = Math.min(Math.max(w, SIDEBAR_MIN_W), getSidebarMaxW());
  panelEl().style.gridTemplateColumns = `${clamped}px minmax(0, 1fr)`;
}

function expandForResize(el: HTMLElement) {
  if (el.id === "workspace-section" && state.workspaceCollapsed) {
    state.workspaceCollapsed = false;
    window.localStorage.setItem(STORAGE_WORKSPACE_COLLAPSED, "false");
    el.classList.remove("is-collapsed");
    document.querySelector<HTMLButtonElement>("#workspace-collapse")?.setAttribute("aria-expanded", "true");
    const btn = document.querySelector<HTMLButtonElement>("#workspace-collapse");
    if (btn) {
      btn.textContent = "⌃";
      btn.title = "折叠目录";
    }
  }
  if (el.id === "outline-section" && state.docPanelCollapsed) {
    state.docPanelCollapsed = false;
    window.localStorage.setItem(STORAGE_DOC_PANEL_COLLAPSED, "false");
    el.classList.remove("is-collapsed");
    const btn = document.querySelector<HTMLButtonElement>("#doc-panel-collapse");
    if (btn) {
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "⌃";
      btn.title = "折叠大纲/Git";
    }
  }
}

export function bindSidebarResizers() {
  document.querySelectorAll<HTMLElement>(".sb-resizer").forEach((handle) => {
    let startY = 0;
    let aHeight = 0;
    let bHeight = 0;
    let aEl: HTMLElement | null = null;
    let bEl: HTMLElement | null = null;

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      aEl = document.querySelector(handle.dataset.above!);
      bEl = document.querySelector(handle.dataset.below!);
      if (!aEl || !bEl) return;
      e.preventDefault();
      expandForResize(aEl);
      expandForResize(bEl);
      startY = e.clientY;
      aHeight = aEl.getBoundingClientRect().height;
      bHeight = bEl.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("resizing-v");
    });

    handle.addEventListener("pointermove", (e: PointerEvent) => {
      if (!aEl || !bEl) return;
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const dy = e.clientY - startY;
      const min = 64;
      const newA = Math.max(min, aHeight + dy);
      const newB = Math.max(min, bHeight - dy);
      aEl.style.flex = `0 0 ${newA}px`;
      bEl.style.flex = `0 0 ${newB}px`;
    });

    const finish = (e: PointerEvent) => {
      if (handle.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-v");
      aEl = null;
      bEl = null;
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);

    handle.addEventListener("dblclick", () => {
      const a = document.querySelector<HTMLElement>(handle.dataset.above!);
      const b = document.querySelector<HTMLElement>(handle.dataset.below!);
      if (a) a.style.flex = "";
      if (b) b.style.flex = "";
    });
  });
}

export function bindSidebarHrResizer() {
  const handle = sidebarHrResizerEl();
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panelEl().getBoundingClientRect().width
      ? parseInt(getComputedStyle(panelEl()).gridTemplateColumns.split(" ")[0]) || SIDEBAR_DEFAULT_W
      : SIDEBAR_DEFAULT_W;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing-h");
  });

  handle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    applySidebarWidth(startW + dx);
  });

  const finish = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing-h");
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => {
    panelEl().style.gridTemplateColumns = "";
  });

  let resizeRafId = 0;
  window.addEventListener("resize", () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      if (!panelEl().style.gridTemplateColumns) return;
      const m = panelEl().style.gridTemplateColumns.match(/^([\d.]+)px/);
      if (!m) return;
      const current = parseFloat(m[1]);
      const max = getSidebarMaxW();
      if (current > max) applySidebarWidth(max);
    });
  });
}
