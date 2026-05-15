import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { AimdDocument, DocumentHealthReport, HealthIssue } from "../core/types";
import {
  healthPanelEl, healthSummaryEl, healthListEl, healthCloseEl,
  healthCleanUnusedEl, healthPackageLocalEl,
} from "../core/dom";
import { setStatus, updateChrome } from "../ui/chrome";
import { flushInline } from "../editor/inline";
import { applyDocumentToTab } from "./apply";
import { saveDocumentAs } from "./persist";
import { escapeHTML } from "../util/escape";
import {
  activeTab,
  beginTabOperation,
  findTab,
  isActiveOperationCurrent,
  isOperationCurrent,
  syncActiveTabFromFacade,
} from "./open-document-state";

function currentMarkdown() {
  if (state.mode === "edit") flushInline();
  return state.doc?.markdown ?? "";
}

function markdownForTab(tabId: string) {
  if (state.openDocuments.activeTabId === tabId) return currentMarkdown();
  return findTab(tabId)?.doc.markdown ?? "";
}

function currentDocIsAimdWithPath(): boolean {
  return Boolean(state.doc?.path && state.doc.format === "aimd");
}

export async function runHealthCheck() {
  if (!state.doc) return;
  const target = beginTabOperation();
  if (!target) return;
  const targetTab = findTab(target.tabId);
  if (!targetTab) return;
  const path = targetTab.doc.path || null;
  const markdown = markdownForTab(target.tabId);
  setStatus("正在检查资源", "loading");
  try {
    const report = await invoke<DocumentHealthReport>("check_document_health", {
      path,
      markdown,
    });
    if (!isOperationCurrent(target)) return;
    showHealthReport(report, target.tabId);
    if (isActiveOperationCurrent(target)) {
      setStatus(report.summary, report.status === "missing" ? "warn" : report.status === "risk" ? "info" : "success");
    }
  } catch (err) {
    if (!isOperationCurrent(target)) return;
    console.error(err);
    if (isActiveOperationCurrent(target)) setStatus(`资源检查失败: ${String(err)}`, "warn");
  }
}

export function showHealthReport(report: DocumentHealthReport, tabId = state.openDocuments.activeTabId || "") {
  const tab = findTab(tabId);
  if (tab) tab.healthReport = report;
  if (!tab || tab.id !== state.openDocuments.activeTabId) return;
  state.sidebarDocTab = "health";
  renderHealthReport(report);
  window.dispatchEvent(new CustomEvent("aimd-health-report-updated"));
}

export function renderActiveHealthReport() {
  const report = activeTab()?.healthReport || null;
  if (!report) {
    healthSummaryEl().textContent = "当前文档尚未检查";
    healthListEl().innerHTML = `<div class="health-empty">点击“资源检查”生成当前文档的健康报告</div>`;
    healthCleanUnusedEl().disabled = true;
    healthPackageLocalEl().disabled = true;
    healthPackageLocalEl().textContent = "嵌入本地图片";
    return;
  }
  renderHealthReport(report);
}

function renderHealthReport(report: DocumentHealthReport) {
  const panel = healthPanelEl();
  panel.dataset.status = report.status;
  healthSummaryEl().textContent =
    `${report.summary} · ${report.counts.errors} 个错误 / ${report.counts.warnings} 个风险 / ${report.counts.infos} 个提示`;
  if (report.issues.length === 0) {
    healthListEl().innerHTML = `<div class="health-empty">未发现外部依赖或缺失资源</div>`;
  } else {
    healthListEl().innerHTML = report.issues.map(renderIssue).join("");
  }
  const hasUnused = report.issues.some((i) => i.kind === "unreferenced_asset");
  const hasLocal = report.issues.some((i) => i.kind === "local_image");
  const hasRemote = report.issues.some((i) => i.kind === "remote_image");
  healthCleanUnusedEl().disabled = !hasUnused;
  healthPackageLocalEl().disabled = !(hasLocal || hasRemote);
  if (state.doc?.format === "markdown") {
    healthPackageLocalEl().textContent = hasLocal || hasRemote ? "保存为 AIMD 并嵌入图片" : "保存为 AIMD";
  } else if (hasLocal && hasRemote) {
    healthPackageLocalEl().textContent = "嵌入图片";
  } else if (hasRemote) {
    healthPackageLocalEl().textContent = "嵌入远程图片";
  } else {
    healthPackageLocalEl().textContent = "嵌入本地图片";
  }
}

function renderIssue(issue: HealthIssue) {
  const meta = [issue.id, issue.url, issue.path, issue.mime]
    .filter(Boolean)
    .map((v) => escapeHTML(String(v)))
    .join(" · ");
  return `
    <div class="health-issue" data-severity="${issue.severity}" data-kind="${escapeHTML(issue.kind)}">
      <div class="health-issue-main">
        <span class="health-badge">${escapeHTML(issue.severity)}</span>
        <span>${escapeHTML(issue.message)}</span>
      </div>
      ${meta ? `<div class="health-issue-meta">${meta}</div>` : ""}
    </div>
  `;
}

export function bindHealthPanel() {
  healthCloseEl().addEventListener("click", () => {
    healthPanelEl().hidden = true;
    state.sidebarDocTab = "outline";
  });
  healthCleanUnusedEl().addEventListener("click", () => {
    void cleanupUnreferencedAssets();
  });
  healthPackageLocalEl().addEventListener("click", () => {
    void packageImageDependencies();
  });
}

export async function cleanupUnreferencedAssets() {
  if (!state.doc) return;
  if (state.doc.format !== "aimd" || !state.doc.path) {
    setStatus("当前文档不是 .aimd，无法清理资源", "warn");
    return;
  }
  setStatus("正在清理未引用资源", "loading");
  const target = beginTabOperation();
  if (!target) return;
  const targetTab = findTab(target.tabId);
  if (!targetTab) return;
  try {
    const doc = await invoke<AimdDocument>("save_aimd", {
      path: targetTab.doc.path,
      markdown: markdownForTab(target.tabId),
    });
    if (!isOperationCurrent(target)) return;
    applyDocumentToTab(target.tabId, { ...doc, isDraft: false, format: "aimd", dirty: false }, targetTab.mode);
    if (isActiveOperationCurrent(target)) {
      setStatus("未引用资源已清理", "success");
      await runHealthCheck();
    }
  } catch (err) {
    console.error(err);
    if (isActiveOperationCurrent(target)) setStatus(`清理失败: ${String(err)}`, "warn");
  } finally {
    updateChrome();
  }
}

async function ensureAimdDocumentForEmbedding(kind: "本地图片" | "远程图片" | "图片"): Promise<boolean> {
  if (!state.doc) return false;
  if (state.doc.format === "markdown") {
    setStatus(`请选择保存位置，将 Markdown 保存为 .aimd 后嵌入${kind}`, "info");
    await saveDocumentAs();
    return currentDocIsAimdWithPath();
  }
  if (!state.doc.path) {
    setStatus(`请先保存 .aimd 文件，再嵌入${kind}`, "info");
    await saveDocumentAs();
    return currentDocIsAimdWithPath();
  }
  return true;
}

export async function packageLocalImages(options: { refreshHealth?: boolean } = {}) {
  if (!state.doc) return;
  const refreshHealth = options.refreshHealth !== false;
  if (!(await ensureAimdDocumentForEmbedding("本地图片"))) return;
  setStatus("正在嵌入本地图片", "loading");
  const target = beginTabOperation();
  if (!target) return;
  const targetTab = findTab(target.tabId);
  if (!targetTab) return;
  const path = targetTab.doc.path;
  const markdown = markdownForTab(target.tabId);
  try {
    const doc = await invoke<AimdDocument>("package_local_images", {
      path,
      markdown,
    });
    if (!isOperationCurrent(target)) return;
    applyDocumentToTab(target.tabId, { ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, targetTab.mode);
    if (isActiveOperationCurrent(target)) {
      setStatus("本地图片已嵌入", "success");
      if (refreshHealth) await runHealthCheck();
    }
  } catch (err) {
    console.error(err);
    if (isActiveOperationCurrent(target)) setStatus(`嵌入本地图片失败: ${String(err)}`, "warn");
  }
}

export async function packageRemoteImages(options: { refreshHealth?: boolean } = {}) {
  if (!state.doc) return;
  const refreshHealth = options.refreshHealth !== false;
  if (!(await ensureAimdDocumentForEmbedding("远程图片"))) return;
  setStatus("正在嵌入远程图片", "loading");
  const target = beginTabOperation();
  if (!target) return;
  const targetTab = findTab(target.tabId);
  if (!targetTab) return;
  const path = targetTab.doc.path;
  const markdown = markdownForTab(target.tabId);
  try {
    const doc = await invoke<AimdDocument>("package_remote_images", {
      path,
      markdown,
    });
    if (!isOperationCurrent(target)) return;
    applyDocumentToTab(target.tabId, { ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, targetTab.mode);
    if (isActiveOperationCurrent(target)) {
      setStatus("远程图片已嵌入", "success");
      if (refreshHealth) await runHealthCheck();
    }
  } catch (err) {
    console.error(err);
    if (isActiveOperationCurrent(target)) setStatus(`嵌入远程图片失败: ${String(err)}`, "warn");
  }
}

export async function packageImageDependencies() {
  if (!state.doc) return;
  syncActiveTabFromFacade();
  const issues = activeTab()?.healthReport?.issues ?? [];
  const hasLocal = issues.some((i) => i.kind === "local_image");
  const hasRemote = issues.some((i) => i.kind === "remote_image");
  if (!hasLocal && !hasRemote) return;
  if (!(await ensureAimdDocumentForEmbedding(hasLocal && hasRemote ? "图片" : hasRemote ? "远程图片" : "本地图片"))) return;

  if (hasLocal) await packageLocalImages({ refreshHealth: false });
  if (hasRemote) await packageRemoteImages({ refreshHealth: false });
  await runHealthCheck();
}
