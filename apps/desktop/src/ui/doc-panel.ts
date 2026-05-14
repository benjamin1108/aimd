import { state } from "../core/state";
import {
  docPanelCollapseEl,
  gitPanelEl,
  gitTabEl,
  outlineListEl,
  outlinePanelEl,
  outlineSectionEl,
  outlineTabEl,
  sidebarWorkspaceDocResizerEl,
} from "../core/dom";
import { STORAGE_DOC_PANEL_COLLAPSED } from "../core/state";
import type { SidebarDocTab } from "../core/types";

export function setSidebarDocTab(tab: SidebarDocTab) {
  state.sidebarDocTab = tab === "git" && !state.git.isRepo ? "outline" : tab;
  renderDocPanelTabs();
}

export function renderDocPanelTabs() {
  const showGit = state.git.isRepo;
  const showSection = Boolean(state.doc || showGit);
  outlineSectionEl().hidden = !showSection;
  sidebarWorkspaceDocResizerEl().hidden = !showSection;
  outlineSectionEl().classList.toggle("is-collapsed", state.docPanelCollapsed);
  docPanelCollapseEl().setAttribute("aria-expanded", String(!state.docPanelCollapsed));
  docPanelCollapseEl().textContent = state.docPanelCollapsed ? "⌄" : "⌃";
  docPanelCollapseEl().title = state.docPanelCollapsed ? "展开大纲/Git" : "折叠大纲/Git";
  gitTabEl().hidden = !showGit;
  outlineSectionEl().classList.toggle("has-git-tab", showGit);
  if (!showGit && state.sidebarDocTab === "git") state.sidebarDocTab = "outline";

  const active = state.sidebarDocTab;
  outlineTabEl().classList.toggle("is-active", active === "outline");
  gitTabEl().classList.toggle("is-active", active === "git");
  outlineTabEl().setAttribute("aria-selected", String(active === "outline"));
  gitTabEl().setAttribute("aria-selected", String(active === "git"));
  outlinePanelEl().hidden = active !== "outline";
  gitPanelEl().hidden = active !== "git";
  if (!state.doc && showSection) {
    outlineListEl().innerHTML = `<div class="empty-list">未打开文档</div>`;
  }
}

export function bindDocPanelTabs(onGitOpen: () => void) {
  state.docPanelCollapsed = window.localStorage.getItem(STORAGE_DOC_PANEL_COLLAPSED) === "true";
  docPanelCollapseEl().addEventListener("click", () => {
    state.docPanelCollapsed = !state.docPanelCollapsed;
    window.localStorage.setItem(STORAGE_DOC_PANEL_COLLAPSED, String(state.docPanelCollapsed));
    renderDocPanelTabs();
  });
  outlineTabEl().addEventListener("click", () => setSidebarDocTab("outline"));
  gitTabEl().addEventListener("click", () => {
    setSidebarDocTab("git");
    onGitOpen();
  });
  renderDocPanelTabs();
}
