import { state } from "../core/state";
import {
  titleEl, pathEl, appScopePrimaryEl, appScopeSecondaryEl, statusEl, statusPillEl, panelEl, emptyEl,
  docStateBadgesEl,
  outlineSectionEl, assetSectionEl, assetListEl,
  sidebarOutlineAssetResizerEl,
  starterActionsEl, docActionsEl, sidebarFootEl,
  saveEl, saveLabelEl, saveAsEl, closeEl,
  packageLocalImagesEl, healthCheckEl, webImportEl, exportMarkdownEl, exportHtmlEl, exportPdfEl,
  formatDocumentEl,
  globalNewProjectAimdEl, globalNewProjectMarkdownEl, findToggleEl,
  modeReadEl, modeEditEl, modeSourceEl, docToolbarEl,
} from "../core/dom";
import type { AimdAsset, AimdDocument } from "../core/types";
import { fileStem, extractHeadingTitle } from "../util/path";
import { escapeAttr, escapeHTML } from "../util/escape";
import { renderRecentList } from "./recents";
import { persistSessionSnapshot } from "../session/snapshot";
import { syncDirtyDocumentState } from "../updater/dirty-state";
import { activeTab, syncActiveTabFromFacade } from "../document/open-document-state";
import { renderOpenTabs } from "./tabs";

export function displayDocTitle(doc: AimdDocument): string {
  return extractHeadingTitle(doc.markdown) || doc.title || fileStem(doc.path) || "未命名文档";
}

export function formatPathHint(path: string) {
  const parts = path.split(/[\\/]/);
  if (parts.length <= 2) return path;
  return ".../" + parts.slice(-2).join("/");
}

function assetItem(asset: AimdAsset) {
  const size = asset.size > 1024 * 1024
    ? `${(asset.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(asset.size / 1024))} KB`;
  const ext = (asset.mime?.split("/").pop() || asset.id.split(".").pop() || "asset").toUpperCase();
  const thumbURL = asset.url || "";
  return `
    <div class="asset">
      <div class="asset-thumb">
        <img src="${thumbURL}" alt="" loading="lazy">
      </div>
      <div class="asset-info">
        <div class="asset-id" title="${escapeAttr(asset.id)}">${escapeHTML(asset.id)}</div>
        <div class="asset-meta">${escapeHTML(ext)} · ${size}</div>
      </div>
    </div>
  `;
}

function normalizeForScope(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isInsideCurrentProject(path: string): boolean {
  if (!state.workspace?.root || !path) return false;
  const root = normalizeForScope(state.workspace.root);
  const current = normalizeForScope(path);
  return current === root || current.startsWith(`${root}/`);
}

function documentFormatLabel(doc: AimdDocument): string {
  if (doc.isDraft) return "草稿";
  return doc.format === "markdown" ? "Markdown" : "AIMD";
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path || "未命名";
}

function renderAppScope(doc: AimdDocument | null, inDiffView: boolean) {
  if (inDiffView) {
    const diffTab = state.git.diffTabs.find((tab) => tab.id === state.openDocuments.activeTabId) || null;
    appScopePrimaryEl().textContent = `Git / ${diffTab?.title || "项目变更"}`;
    appScopeSecondaryEl().textContent = diffTab?.directory || "项目文件差异";
    return;
  }
  if (doc) {
    appScopePrimaryEl().textContent = `${state.workspace ? "项目" : "文档"} / ${displayDocTitle(doc)}`;
    appScopeSecondaryEl().textContent = doc.path ? formatPathHint(doc.path) : "未保存草稿";
    return;
  }
  if (state.workspace?.root) {
    appScopePrimaryEl().textContent = `项目 / ${basename(state.workspace.root)}`;
    appScopeSecondaryEl().textContent = "未打开文档";
    return;
  }
  appScopePrimaryEl().textContent = "启动页";
  appScopeSecondaryEl().textContent = "入口按命令域分层";
}

function renderDocumentStateBadges(doc: AimdDocument | null) {
  const container = docStateBadgesEl();
  if (!doc) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const badges: Array<{ text: string; tone?: "warn" | "info" | "strong" }> = [
    { text: documentFormatLabel(doc), tone: "strong" },
  ];
  const hasConflict = doc.hasGitConflicts || hasGitConflictMarkers(doc.markdown) || hasGitConflictMarkers(doc.html);
  if (doc.dirty) badges.push({ text: "未保存", tone: "warn" });
  if (doc.requiresAimdSave) badges.push({ text: "保存需选格式", tone: "info" });
  if (hasConflict) badges.push({ text: "Git 冲突", tone: "warn" });
  const tab = activeTab();
  if (tab?.recoveryState === "disk-changed") badges.push({ text: "磁盘已变化", tone: "warn" });
  if (state.workspace?.root && doc.path) {
    badges.push({ text: isInsideCurrentProject(doc.path) ? "项目内" : "项目外", tone: "info" });
  }
  container.hidden = false;
  container.innerHTML = badges
    .map((badge) => `<span class="doc-state-badge" data-tone="${badge.tone || "idle"}">${escapeHTML(badge.text)}</span>`)
    .join("");
}

// 底部 status-pill 只承载稳定摘要和临时反馈；标题区的 doc-state-badges
// 负责长期可见的格式、脏状态、冲突和项目归属。1.8s 后 success/info 会回退到
// 当前 doc 的稳定态（脏 → 未保存的修改；干净 → 就绪）。
//
// state.statusTimer 同时充当"当前是否在临时反馈窗口期"的标志：updateChrome 看到
// 它非 null 时会跳过稳定态写入，避免把"已保存"立刻盖回"就绪"。
export function setStatus(
  text: string,
  tone: "idle" | "loading" | "success" | "warn" | "info" = "idle",
  action?: string,
) {
  applyStatus(text, tone, action);
  if (state.statusTimer) {
    window.clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
  if (tone === "success" || tone === "info") {
    state.statusTimer = window.setTimeout(() => {
      state.statusTimer = null;
      renderStableStatus();
    }, 1800);
  }
}

export function setStatusOverride(
  text: string,
  tone: "idle" | "loading" | "success" | "warn" | "info" = "info",
  action?: string,
  immediate = false,
) {
  state.statusOverride = { text, tone, action };
  if (immediate || state.statusTimer == null) renderStableStatus();
}

export function clearStatusOverride(action?: string, immediate = false) {
  if (action && state.statusOverride?.action !== action) return;
  state.statusOverride = null;
  if (immediate || state.statusTimer == null) renderStableStatus();
}

function applyStatus(text: string, tone: "idle" | "loading" | "success" | "warn" | "info", action?: string) {
  statusEl().textContent = text;
  statusPillEl().dataset.tone = tone;
  if (action) {
    statusPillEl().dataset.action = action;
  } else {
    delete statusPillEl().dataset.action;
  }
}

function renderStableStatus() {
  if (state.statusOverride) {
    applyStatus(state.statusOverride.text, state.statusOverride.tone, state.statusOverride.action);
    return;
  }
  const doc = state.doc;
  const tab = activeTab();
  if (state.mainView === "git-diff") {
    applyStatus("Git Diff 只读", "info");
  } else if (doc && (doc.hasGitConflicts || hasGitConflictMarkers(doc.markdown) || hasGitConflictMarkers(doc.html))) {
    doc.hasGitConflicts = true;
    applyStatus("文档包含 Git 冲突，请解决后保存", "warn");
  } else if (tab?.recoveryState === "disk-changed") {
    applyStatus("已恢复工作副本，磁盘文件已变化", "warn");
  } else if (doc?.requiresAimdSave) {
    applyStatus("保存时需选择格式", "info");
  } else if (doc?.isDraft && !doc.dirty) {
    applyStatus("这是未保存草稿，保存后才会生成 .aimd 文件", "info");
  } else if (doc?.dirty) {
    applyStatus("未保存的修改", "warn");
  } else {
    applyStatus("就绪", "idle");
  }
}

export function updateChrome() {
  syncActiveTabFromFacade();
  renderOpenTabs();
  const doc = state.doc;
  void syncDirtyDocumentState();
  const hasWorkspace = Boolean(state.workspace);
  renderRecentList();
  panelEl().dataset.shell = doc || hasWorkspace ? "document" : "launch";
  panelEl().dataset.mode = state.mode;
  panelEl().dataset.mainView = state.mainView;
  panelEl().dataset.sourcePressure = state.mode === "source" && state.sidebarDocTab === "outline" ? "true" : "false";
  // Rail resizers write CSS variables. Drop them before each launch transition
  // so the single-column launch shell cannot inherit a stale desktop rail size.
  if (!doc && !hasWorkspace) {
    panelEl().style.gridTemplateColumns = "";
    panelEl().style.removeProperty("--project-rail-width");
    panelEl().style.removeProperty("--inspector-rail-width");
  }
  const inDiffView = state.mainView === "git-diff";
  panelEl().dataset.hasDoc = doc ? "true" : "false";
  renderAppScope(doc, inDiffView);
  globalNewProjectAimdEl().disabled = !hasWorkspace;
  globalNewProjectMarkdownEl().disabled = !hasWorkspace;
  starterActionsEl().hidden = Boolean(doc) || inDiffView;
  docActionsEl().hidden = !doc || inDiffView;
  docToolbarEl().hidden = !doc || inDiffView;
  sidebarFootEl().hidden = true;

  if (inDiffView) {
    const diffTab = state.git.diffTabs.find((tab) => tab.id === state.openDocuments.activeTabId) || null;
    titleEl().textContent = diffTab?.title || "Git Diff";
    pathEl().textContent = diffTab?.path ? `Git Diff · ${diffTab.directory}` : "Git Diff";
    docStateBadgesEl().hidden = false;
    docStateBadgesEl().innerHTML = `
      <span class="doc-state-badge" data-tone="strong">Git Diff</span>
      <span class="doc-state-badge" data-tone="info">只读</span>
    `;
  } else {
    titleEl().textContent = doc ? displayDocTitle(doc) : "AIMD Desktop";
    pathEl().textContent = doc
      ? (doc.requiresAimdSave
        ? `${doc.path ? formatPathHint(doc.path) : "Markdown 草稿"} · 保存时需选择格式`
        : (doc.path || "未保存草稿 · 保存时选择 .md / .aimd"))
      : "未打开文档";
    renderDocumentStateBadges(doc);
  }
  // 保存按钮在文档没有变化时禁用：用户的"按钮亮着但其实没活做"会变成第二种困惑。
  // 草稿状态(isDraft)即使 dirty=false 也要保留可点（点击会触发 saveDocumentAs 创建文件）。
  const canSave = Boolean(!inDiffView && doc && (doc.dirty || doc.isDraft));
  saveEl().disabled = !canSave;
  saveAsEl().disabled = !doc || inDiffView;
  formatDocumentEl().disabled = !doc || inDiffView || !doc.markdown.trim();
  packageLocalImagesEl().disabled = inDiffView || doc?.format !== "markdown";
  healthCheckEl().disabled = !doc || inDiffView;
  webImportEl().disabled = false;
  exportMarkdownEl().disabled = !doc || inDiffView || doc.format === "markdown";
  exportHtmlEl().disabled = !doc || inDiffView;
  exportPdfEl().disabled = !doc || inDiffView;
  findToggleEl().disabled = !doc || inDiffView;
  closeEl().disabled = !doc || inDiffView;
  // 顶部的主按钮统一显示「保存」：草稿状态下点击仍走 saveDocumentAs 创建文件，
  // 但视觉/语义上对用户都是"保存"动作（与 sidebar-foot 一致）。
  saveLabelEl().textContent = "保存";
  modeReadEl().disabled = !doc || inDiffView;
  modeEditEl().disabled = !doc || inDiffView;
  modeSourceEl().disabled = !doc || inDiffView;

  if (!doc) {
    assetSectionEl().hidden = true;
    outlineSectionEl().hidden = !state.git.isRepo;
    sidebarOutlineAssetResizerEl().hidden = true;
    assetListEl().innerHTML = "";
    emptyEl().hidden = inDiffView;
    if (state.statusTimer == null) renderStableStatus();
    if (!state.isBootstrappingSession) persistSessionSnapshot();
    return;
  }

  emptyEl().hidden = true;
  outlineSectionEl().hidden = false;
  const showActiveAssetPanel = state.sidebarDocTab === "assets";
  const assetVisibilityChanged = assetSectionEl().hidden === showActiveAssetPanel;
  assetSectionEl().hidden = !showActiveAssetPanel;
  sidebarOutlineAssetResizerEl().hidden = true;
  if (assetVisibilityChanged) {
    outlineSectionEl().style.flex = "";
    assetSectionEl().style.flex = "";
  }

  if (doc.assets.length > 0) {
    assetListEl().innerHTML = doc.assets.map(assetItem).join("");
  } else {
    assetListEl().innerHTML = `<div class="empty-list">当前文档没有 AIMD 托管资源</div>`;
  }

  // 把当前文档的稳定状态推到底部 status-pill。setStatus 的临时反馈（保存中 /
  // 已保存 / 失败）窗口期内 statusTimer 非 null，这里不抢；timer 回调结束后
  // 会自己根据 dirty 或 statusOverride 回退到稳定态。
  if (state.statusTimer == null) {
    renderStableStatus();
  }
  persistSessionSnapshot();
}

function hasGitConflictMarkers(markdown: string): boolean {
  return markdown.includes("<<<<<<<") && markdown.includes("=======") && markdown.includes(">>>>>>>");
}
