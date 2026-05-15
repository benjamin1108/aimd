import { inspectorHrResizerEl, panelEl, sidebarHrResizerEl } from "../core/dom";
import { state, STORAGE_DOC_PANEL_COLLAPSED, STORAGE_WORKSPACE_COLLAPSED } from "../core/state";

export const PROJECT_RAIL_MIN_W = 200;
export const PROJECT_RAIL_DEFAULT_W = 244;
export const PROJECT_RAIL_MAX_W = 320;
export const INSPECTOR_RAIL_MIN_W = 236;
export const INSPECTOR_RAIL_DEFAULT_W = 300;
export const INSPECTOR_RAIL_MAX_W = 390;

function panelWidth() {
  return panelEl().getBoundingClientRect().width || window.innerWidth;
}

function workspaceMinWidth() {
  if (window.innerWidth <= 1100) return 0;
  if (window.innerWidth <= 1180) return 500;
  return 560;
}

function gridTracks() {
  return getComputedStyle(panelEl()).gridTemplateColumns
    .split(/\s+/)
    .map((track) => Number.parseFloat(track))
    .filter((value) => Number.isFinite(value));
}

function currentProjectWidth() {
  return gridTracks()[0] || PROJECT_RAIL_DEFAULT_W;
}

function currentInspectorWidth() {
  const tracks = gridTracks();
  return tracks.length >= 3 ? tracks[tracks.length - 1] : INSPECTOR_RAIL_DEFAULT_W;
}

function getProjectRailMaxW() {
  const maxByPanel = panelWidth() - currentInspectorWidth() - workspaceMinWidth();
  return Math.max(PROJECT_RAIL_MIN_W, Math.min(PROJECT_RAIL_MAX_W, maxByPanel));
}

function getInspectorRailMaxW() {
  const maxByPanel = panelWidth() - currentProjectWidth() - workspaceMinWidth();
  return Math.max(INSPECTOR_RAIL_MIN_W, Math.min(INSPECTOR_RAIL_MAX_W, maxByPanel));
}

export function applyProjectRailWidth(w: number) {
  const clamped = Math.min(Math.max(w, PROJECT_RAIL_MIN_W), getProjectRailMaxW());
  panelEl().style.setProperty("--project-rail-width", `${Math.round(clamped)}px`);
}

export function applyInspectorRailWidth(w: number) {
  const clamped = Math.min(Math.max(w, INSPECTOR_RAIL_MIN_W), getInspectorRailMaxW());
  panelEl().style.setProperty("--inspector-rail-width", `${Math.round(clamped)}px`);
}

export function applySidebarWidth(w: number) {
  applyProjectRailWidth(w);
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
      btn.title = "折叠项目";
    }
  }
  if (el.id === "outline-section" && state.docPanelCollapsed) {
    state.docPanelCollapsed = false;
    window.localStorage.setItem(STORAGE_DOC_PANEL_COLLAPSED, "false");
    el.classList.remove("is-collapsed");
      const btn = document.querySelector<HTMLButtonElement>("#doc-panel-collapse");
      if (btn) {
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "›";
        btn.title = "折叠检查器";
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
    startW = currentProjectWidth();
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
    panelEl().style.removeProperty("--project-rail-width");
  });

  let resizeRafId = 0;
  window.addEventListener("resize", () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      const project = panelEl().style.getPropertyValue("--project-rail-width");
      const inspector = panelEl().style.getPropertyValue("--inspector-rail-width");
      if (project) applyProjectRailWidth(currentProjectWidth());
      if (inspector) applyInspectorRailWidth(currentInspectorWidth());
    });
  });
}

export function bindInspectorHrResizer() {
  const handle = inspectorHrResizerEl();
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (state.docPanelCollapsed || window.innerWidth <= 1100) return;
    e.preventDefault();
    startX = e.clientX;
    startW = currentInspectorWidth();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing-h");
  });

  handle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    applyInspectorRailWidth(startW - dx);
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
    panelEl().style.removeProperty("--inspector-rail-width");
  });
}
