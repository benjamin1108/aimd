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

export function setSidebarDocTab(tab: SidebarDocTab) {
  const hasContext = Boolean(state.doc || state.mainView === "git-diff");
  if (!hasContext) {
    state.sidebarDocTab = "outline";
  } else if (tab === "health") {
    state.sidebarDocTab = "outline";
  } else {
    state.sidebarDocTab = tab;
  }
  renderDocPanelTabs();
}

export function renderDocPanelTabs() {
  const inDiffView = state.mainView === "git-diff";
  const showSection = Boolean(state.doc || inDiffView);
  const activeDocumentTab = inDiffView ? null : activeTab();
  const activeDiffTab = inDiffView
    ? state.git.diffTabs.find((tab) => tab.id === state.openDocuments.activeTabId) || null
    : null;
  inspectorEl().hidden = !showSection;
  outlineSectionEl().hidden = !showSection;
  outlineSectionEl().style.setProperty("--doc-panel-tab-count", "3");
  sidebarWorkspaceDocResizerEl().hidden = true;
  outlineSectionEl().classList.toggle("is-collapsed", state.docPanelCollapsed);
  inspectorEl().classList.toggle("is-collapsed", state.docPanelCollapsed);
  const panel = inspectorEl().closest<HTMLElement>(".panel");
  panel?.setAttribute(
    "data-inspector",
    state.docPanelCollapsed ? "collapsed" : "expanded",
  );
  panel?.setAttribute(
    "data-source-pressure",
    state.mode === "source" && state.sidebarDocTab === "outline" ? "true" : "false",
  );
  docPanelCollapseEl().setAttribute("aria-expanded", String(!state.docPanelCollapsed));
  docPanelCollapseEl().textContent = state.docPanelCollapsed ? "‹" : "›";
  docPanelCollapseEl().title = state.docPanelCollapsed ? "展开检查器" : "折叠检查器";
  inspectorOwnerEl().textContent = activeDiffTab
    ? `Git Diff · ${activeDiffTab.title}`
    : activeDocumentTab
      ? `当前文档 · ${displayTabTitle(activeDocumentTab.doc)}`
      : "项目检查";
  gitTabEl().hidden = false;
  assetTabEl().hidden = false;
  healthTabEl().hidden = true;
  outlineSectionEl().classList.add("has-git-tab");
  if (!showSection && (state.sidebarDocTab === "git" || state.sidebarDocTab === "assets")) {
    state.sidebarDocTab = "outline";
  }
  if (state.sidebarDocTab === "health") state.sidebarDocTab = "outline";

  const active = state.sidebarDocTab;
  outlineTabEl().classList.toggle("is-active", active === "outline");
  assetTabEl().classList.toggle("is-active", active === "assets");
  gitTabEl().classList.toggle("is-active", active === "git");
  healthTabEl().classList.remove("is-active");
  outlineTabEl().setAttribute("aria-selected", String(active === "outline"));
  assetTabEl().setAttribute("aria-selected", String(active === "assets"));
  gitTabEl().setAttribute("aria-selected", String(active === "git"));
  healthTabEl().setAttribute("aria-selected", "false");
  outlinePanelEl().hidden = active !== "outline";
  assetPanelEl().hidden = active !== "assets";
  assetSectionEl().hidden = active !== "assets";
  gitPanelEl().hidden = active !== "git";
  healthPanelEl().hidden = true;
  if (inDiffView && active === "outline") {
    outlineListEl().innerHTML = `<div class="empty-list">Git Diff 没有文档大纲</div>`;
  } else if (!state.doc && showSection && active === "outline") {
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
  renderDocPanelTabs();
}
