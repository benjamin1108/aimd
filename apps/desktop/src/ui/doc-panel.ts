import { state } from "../core/state";
import {
  assetPanelEl,
  assetSectionEl,
  assetTabEl,
  docPanelCollapseEl,
  gitPanelEl,
  gitTabEl,
  healthPanelEl,
  healthTabEl,
  inspectorEl,
  inspectorOwnerEl,
  outlineListEl,
  outlinePanelEl,
  outlineSectionEl,
  outlineTabEl,
  sidebarWorkspaceDocResizerEl,
} from "../core/dom";
import { STORAGE_DOC_PANEL_COLLAPSED } from "../core/state";
import type { SidebarDocTab } from "../core/types";
import { activeTab, displayTabTitle } from "../document/open-document-state";
import { renderActiveHealthReport } from "../document/health";

export function setSidebarDocTab(tab: SidebarDocTab) {
  if (tab === "git" && !state.git.isRepo) {
    state.sidebarDocTab = "outline";
  } else if ((tab === "assets" || tab === "health") && !state.doc) {
    state.sidebarDocTab = "outline";
  } else {
    state.sidebarDocTab = tab;
  }
  renderDocPanelTabs();
}

export function renderDocPanelTabs() {
  const showGit = state.git.isRepo;
  const showSection = Boolean(state.doc || state.workspace || showGit);
  const activeDocumentTab = activeTab();
  inspectorEl().hidden = !showSection;
  outlineSectionEl().hidden = !showSection;
  sidebarWorkspaceDocResizerEl().hidden = true;
  outlineSectionEl().classList.toggle("is-collapsed", state.docPanelCollapsed);
  inspectorEl().classList.toggle("is-collapsed", state.docPanelCollapsed);
  inspectorEl().closest<HTMLElement>(".panel")?.setAttribute(
    "data-inspector",
    state.docPanelCollapsed ? "collapsed" : "expanded",
  );
  docPanelCollapseEl().setAttribute("aria-expanded", String(!state.docPanelCollapsed));
  docPanelCollapseEl().textContent = state.docPanelCollapsed ? "‹" : "›";
  docPanelCollapseEl().title = state.docPanelCollapsed ? "展开检查器" : "折叠检查器";
  inspectorOwnerEl().textContent = activeDocumentTab
    ? `当前文档 · ${displayTabTitle(activeDocumentTab.doc)}`
    : "项目检查";
  gitTabEl().hidden = !showGit;
  assetTabEl().hidden = !state.doc;
  healthTabEl().hidden = !state.doc;
  outlineSectionEl().classList.toggle("has-git-tab", showGit);
  if (!showGit && state.sidebarDocTab === "git") state.sidebarDocTab = "outline";
  if (!state.doc && (state.sidebarDocTab === "assets" || state.sidebarDocTab === "health")) state.sidebarDocTab = "outline";

  const active = state.sidebarDocTab;
  outlineTabEl().classList.toggle("is-active", active === "outline");
  assetTabEl().classList.toggle("is-active", active === "assets");
  gitTabEl().classList.toggle("is-active", active === "git");
  healthTabEl().classList.toggle("is-active", active === "health");
  outlineTabEl().setAttribute("aria-selected", String(active === "outline"));
  assetTabEl().setAttribute("aria-selected", String(active === "assets"));
  gitTabEl().setAttribute("aria-selected", String(active === "git"));
  healthTabEl().setAttribute("aria-selected", String(active === "health"));
  outlinePanelEl().hidden = active !== "outline";
  assetPanelEl().hidden = active !== "assets";
  assetSectionEl().hidden = active !== "assets";
  gitPanelEl().hidden = active !== "git";
  healthPanelEl().hidden = active !== "health";
  if (active === "health") renderActiveHealthReport();
  if (!state.doc && showSection) {
    outlineListEl().innerHTML = `<div class="empty-list">未打开文档</div>`;
  }
}

export function bindDocPanelTabs(onGitOpen: () => void) {
  const storedCollapse = window.localStorage.getItem(STORAGE_DOC_PANEL_COLLAPSED);
  state.docPanelCollapsed = storedCollapse == null
    ? window.innerWidth <= 1100
    : storedCollapse === "true";
  docPanelCollapseEl().addEventListener("click", () => {
    state.docPanelCollapsed = !state.docPanelCollapsed;
    window.localStorage.setItem(STORAGE_DOC_PANEL_COLLAPSED, String(state.docPanelCollapsed));
    renderDocPanelTabs();
  });
  outlineTabEl().addEventListener("click", () => setSidebarDocTab("outline"));
  assetTabEl().addEventListener("click", () => setSidebarDocTab("assets"));
  gitTabEl().addEventListener("click", () => {
    setSidebarDocTab("git");
    onGitOpen();
  });
  healthTabEl().addEventListener("click", () => setSidebarDocTab("health"));
  window.addEventListener("aimd-health-report-updated", renderDocPanelTabs);
  renderDocPanelTabs();
}
