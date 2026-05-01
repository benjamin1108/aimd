import { state } from "../core/state";
import {
  titleEl, pathEl, statusEl, statusPillEl, panelEl, emptyEl,
  docCardEl, outlineSectionEl, assetSectionEl, assetListEl, assetCountEl,
  resizer1El, resizer2El, starterActionsEl, docActionsEl, sidebarFootEl,
  sidebarNewEl, sidebarSaveEl, saveEl, saveLabelEl, saveAsEl, closeEl,
  modeReadEl, modeEditEl, modeSourceEl, docuTourGenerateEl, docuTourPlayEl, docToolbarEl,
  tourStatusDotEl,
} from "../core/dom";
import type { AimdAsset, AimdDocument } from "../core/types";
import { fileStem, extractHeadingTitle } from "../util/path";
import { escapeAttr, escapeHTML } from "../util/escape";
import { renderRecentList } from "./recents";
import { persistSessionSnapshot } from "../session/snapshot";
import { extractDocuTour } from "../docutour/frontmatter";

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

export function setStatus(text: string, tone: "idle" | "loading" | "success" | "warn" | "info" = "idle") {
  statusEl().textContent = text;
  statusPillEl().dataset.tone = tone;
  if (state.statusTimer) window.clearTimeout(state.statusTimer);
  if (tone === "success" || tone === "info") {
    state.statusTimer = window.setTimeout(() => {
      statusEl().textContent = state.doc?.dirty ? "未保存的修改" : "就绪";
      statusPillEl().dataset.tone = state.doc?.dirty ? "warn" : "idle";
    }, 1800);
  }
}

export function updateChrome() {
  const doc = state.doc;
  renderRecentList();
  panelEl().dataset.shell = doc ? "document" : "launch";
  // Sidebar resizer writes an inline `grid-template-columns` (e.g.
  // "460px minmax(0,1fr)") which beats the launch-shell CSS rule. In launch
  // mode the sidebar is `display: none`, so the now-only workspace child
  // collapses into the first column of that two-column track and the right
  // side renders empty. Drop the inline override before each launch transition.
  if (!doc) panelEl().style.gridTemplateColumns = "";
  starterActionsEl().hidden = Boolean(doc);
  docActionsEl().hidden = !doc;
  docToolbarEl().hidden = !doc;
  sidebarFootEl().hidden = !doc;

  titleEl().textContent = doc ? displayDocTitle(doc) : "AIMD Desktop";
  pathEl().textContent = doc
    ? (doc.path || "未保存草稿 · 先另存为 .aimd")
    : "正文、图片和元信息始终在一起";
  saveEl().disabled = !doc || (!doc.dirty && !doc.isDraft);
  saveAsEl().disabled = !doc;
  const existingTour = doc ? extractDocuTour(doc.markdown) : null;
  docuTourGenerateEl().disabled = !doc;
  docuTourGenerateEl().querySelector("span:last-child")!.textContent = existingTour
    ? "更新导览"
    : "生成导览";
  docuTourPlayEl().disabled = !doc || !existingTour?.steps.length;
  docuTourPlayEl().querySelector("span:last-child")!.textContent = existingTour?.steps.length
    ? `播放导读（${existingTour.steps.length} 步）`
    : "播放导读（无导览）";

  // Tour status dot — 仅在"非生成中"时由 updateChrome 更新；
  // generating 状态由 tour.ts 在生成中临时切换并恢复，避免 updateChrome 抢走脉冲态。
  const dot = tourStatusDotEl();
  if (dot.dataset.state !== "generating") {
    dot.dataset.state = existingTour?.steps.length ? "ready" : "none";
  }
  closeEl().disabled = !doc;
  // 顶部的主按钮统一显示「保存」：草稿状态下点击仍走 saveDocumentAs 创建文件，
  // 但视觉/语义上对用户都是"保存"动作（与 sidebar-foot 一致）。
  saveLabelEl().textContent = "保存";
  modeReadEl().disabled = !doc;
  modeEditEl().disabled = !doc;
  modeSourceEl().disabled = !doc;

  if (!doc) {
    docCardEl().dataset.state = "empty";
    docCardEl().classList.remove("active");
    docCardEl().querySelector<HTMLElement>(".doc-card-title")!.textContent = "未打开文档";
    docCardEl().querySelector<HTMLElement>(".doc-card-meta")!.textContent = "新建、打开或导入 Markdown";
    assetSectionEl().hidden = true;
    outlineSectionEl().hidden = true;
    resizer1El().hidden = true;
    resizer2El().hidden = true;
    assetListEl().innerHTML = "";
    emptyEl().hidden = false;
    if (!state.isBootstrappingSession) persistSessionSnapshot();
    return;
  }

  emptyEl().hidden = true;
  // 草稿一旦输入了内容（dirty），sidebar-foot 把 "新建" 替换成 "保存"，
  // 把这一步的主动作放在更显眼的位置；非草稿/未脏的状态保留 "新建" 入口。
  const draftWithContent = Boolean(doc.isDraft && doc.dirty);
  sidebarNewEl().hidden = draftWithContent;
  sidebarSaveEl().hidden = !draftWithContent;
  docCardEl().dataset.state = doc.dirty ? "dirty" : (doc.isDraft ? "draft" : "active");
  docCardEl().classList.add("active");
  docCardEl().querySelector<HTMLElement>(".doc-card-title")!.textContent = displayDocTitle(doc);
  docCardEl().querySelector<HTMLElement>(".doc-card-meta")!.textContent =
    (doc.path ? formatPathHint(doc.path) : "未保存草稿")
    + (doc.dirty ? " · 未保存" : "");

  outlineSectionEl().hidden = false;
  assetSectionEl().hidden = false;
  resizer1El().hidden = false;
  resizer2El().hidden = false;

  assetCountEl().textContent = String(doc.assets.length);
  if (doc.assets.length) {
    assetListEl().innerHTML = doc.assets.map(assetItem).join("");
  } else {
    assetListEl().innerHTML = `<div class="empty-list">无嵌入资源</div>`;
  }

  if (doc.isDraft) {
    setStatus("这是未保存草稿，保存后才会生成 .aimd 文件", "info");
  } else if (doc.dirty) {
    setStatus("未保存的修改", "warn");
  }
  persistSessionSnapshot();
}
