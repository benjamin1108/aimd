import { workspaceCollapseEl, workspaceSectionEl } from "../core/dom";
import { state, STORAGE_WORKSPACE_COLLAPSED } from "../core/state";

export function applyWorkspaceCollapseState() {
  workspaceSectionEl().classList.toggle("is-collapsed", state.workspaceCollapsed);
  workspaceCollapseEl().setAttribute("aria-expanded", String(!state.workspaceCollapsed));
  workspaceCollapseEl().textContent = state.workspaceCollapsed ? "⌄" : "⌃";
  workspaceCollapseEl().title = state.workspaceCollapsed ? "展开项目" : "折叠项目";
}

export function bindWorkspaceCollapse(render: () => void) {
  state.workspaceCollapsed = window.localStorage.getItem(STORAGE_WORKSPACE_COLLAPSED) === "true";
  workspaceCollapseEl().addEventListener("click", () => {
    state.workspaceCollapsed = !state.workspaceCollapsed;
    window.localStorage.setItem(STORAGE_WORKSPACE_COLLAPSED, String(state.workspaceCollapsed));
    render();
  });
}
