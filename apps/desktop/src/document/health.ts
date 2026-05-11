import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { AimdDocument, DocumentHealthReport, HealthIssue } from "../core/types";
import {
  healthPanelEl, healthSummaryEl, healthListEl, healthCloseEl,
  healthCleanUnusedEl, healthPackageLocalEl,
} from "../core/dom";
import { setStatus, updateChrome } from "../ui/chrome";
import { flushInline } from "../editor/inline";
import { applyDocument } from "./apply";
import { saveDocumentAs } from "./persist";
import { escapeHTML } from "../util/escape";

function currentMarkdown() {
  if (state.mode === "edit") flushInline();
  return state.doc?.markdown ?? "";
}

export async function runHealthCheck() {
  if (!state.doc) return;
  setStatus("正在检查交付状态", "loading");
  try {
    const report = await invoke<DocumentHealthReport>("check_document_health", {
      path: state.doc.path || null,
      markdown: currentMarkdown(),
    });
    showHealthReport(report);
    setStatus(report.summary, report.status === "missing" ? "warn" : report.status === "risk" ? "info" : "success");
  } catch (err) {
    console.error(err);
    setStatus(`健康检查失败: ${String(err)}`, "warn");
  }
}

export function showHealthReport(report: DocumentHealthReport) {
  const panel = healthPanelEl();
  panel.hidden = false;
  panel.dataset.status = report.status;
  healthSummaryEl().textContent =
    `${report.summary} · ${report.counts.errors} 个错误 / ${report.counts.warnings} 个风险 / ${report.counts.infos} 个提示`;
  if (report.issues.length === 0) {
    healthListEl().innerHTML = `<div class="health-empty">未发现会影响离线交付的问题</div>`;
  } else {
    healthListEl().innerHTML = report.issues.map(renderIssue).join("");
  }
  const hasUnused = report.issues.some((i) => i.kind === "unreferenced_asset");
  const hasLocal = report.issues.some((i) => i.kind === "local_image");
  healthCleanUnusedEl().disabled = !hasUnused;
  healthPackageLocalEl().disabled = !hasLocal;
  healthPackageLocalEl().textContent = state.doc?.format === "markdown"
    ? "保存为 AIMD"
    : "嵌入本地图片";
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
  });
  healthCleanUnusedEl().addEventListener("click", () => {
    void cleanupUnreferencedAssets();
  });
  healthPackageLocalEl().addEventListener("click", () => {
    void packageLocalImages();
  });
}

export async function cleanupUnreferencedAssets() {
  if (!state.doc) return;
  if (state.doc.format !== "aimd" || !state.doc.path) {
    setStatus("当前文档不是 .aimd，无法清理资源", "warn");
    return;
  }
  setStatus("正在清理未引用资源", "loading");
  try {
    const doc = await invoke<AimdDocument>("save_aimd", {
      path: state.doc.path,
      markdown: currentMarkdown(),
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false }, state.mode);
    setStatus("未引用资源已清理", "success");
    await runHealthCheck();
  } catch (err) {
    console.error(err);
    setStatus(`清理失败: ${String(err)}`, "warn");
  } finally {
    updateChrome();
  }
}

export async function packageLocalImages() {
  if (!state.doc) return;
  if (state.doc.format === "markdown") {
    setStatus("请选择保存位置，将 Markdown 保存为 .aimd", "info");
    await saveDocumentAs();
    return;
  }
  if (!state.doc.path) {
    setStatus("请先保存 .aimd 文件，再嵌入本地图片", "info");
    await saveDocumentAs();
    return;
  }
  setStatus("正在嵌入本地图片", "loading");
  try {
    const doc = await invoke<AimdDocument>("package_local_images", {
      path: state.doc.path,
      markdown: currentMarkdown(),
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false, needsAimdSave: false }, state.mode);
    setStatus("本地图片已嵌入", "success");
    await runHealthCheck();
  } catch (err) {
    console.error(err);
    setStatus(`嵌入本地图片失败: ${String(err)}`, "warn");
  }
}
