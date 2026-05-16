import { panelEl, projectRailCollapseEl, sidebarEl } from "../core/dom";
import { ICONS, state, STORAGE_PROJECT_RAIL_COLLAPSED } from "../core/state";

const RESPONSIVE_PROJECT_RAIL_COLLAPSE_WIDTH = 900;

let hasStoredProjectRailPreference = false;

function setProjectRailCollapsed(collapsed: boolean, persist: boolean) {
  if (state.projectRailCollapsed === collapsed && !persist) return;
  state.projectRailCollapsed = collapsed;
  if (persist) {
    hasStoredProjectRailPreference = true;
    window.localStorage.setItem(STORAGE_PROJECT_RAIL_COLLAPSED, String(collapsed));
  }
  applyProjectRailCollapseState();
}

export function applyProjectRailCollapseState() {
  const sidebar = sidebarEl();
  sidebar.classList.toggle("is-collapsed", state.projectRailCollapsed);
  sidebar.tabIndex = state.projectRailCollapsed ? 0 : -1;
  sidebar.setAttribute("aria-label", state.projectRailCollapsed ? "展开项目栏" : "项目栏");
  if (state.projectRailCollapsed) {
    sidebar.setAttribute("role", "button");
  } else {
    sidebar.removeAttribute("role");
  }
  panelEl().dataset.projectRail = state.projectRailCollapsed ? "collapsed" : "expanded";
  projectRailCollapseEl().setAttribute("aria-expanded", String(!state.projectRailCollapsed));
  projectRailCollapseEl().innerHTML = state.projectRailCollapsed ? "›" : ICONS.sidePanelClose;
  projectRailCollapseEl().title = state.projectRailCollapsed ? "展开项目栏" : "折叠项目栏";
}

export function bindProjectRailCollapse() {
  const storedCollapse = window.localStorage.getItem(STORAGE_PROJECT_RAIL_COLLAPSED);
  hasStoredProjectRailPreference = storedCollapse != null;
  state.projectRailCollapsed = hasStoredProjectRailPreference
    ? storedCollapse === "true"
    : window.innerWidth <= RESPONSIVE_PROJECT_RAIL_COLLAPSE_WIDTH;
  applyProjectRailCollapseState();

  projectRailCollapseEl().addEventListener("click", (event) => {
    event.stopPropagation();
    setProjectRailCollapsed(!state.projectRailCollapsed, true);
  });
  sidebarEl().addEventListener("click", () => {
    if (state.projectRailCollapsed) setProjectRailCollapsed(false, true);
  });
  sidebarEl().addEventListener("keydown", (event) => {
    if (!state.projectRailCollapsed) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setProjectRailCollapsed(false, true);
  });

  window.addEventListener("resize", () => {
    if (hasStoredProjectRailPreference) return;
    setProjectRailCollapsed(
      window.innerWidth <= RESPONSIVE_PROJECT_RAIL_COLLAPSE_WIDTH,
      false,
    );
  });
}
