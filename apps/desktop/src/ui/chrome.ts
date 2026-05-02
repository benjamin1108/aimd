import { state } from "../core/state";
import {
  titleEl, pathEl, statusEl, statusPillEl, panelEl, emptyEl,
  outlineSectionEl, assetSectionEl, assetListEl, assetCountEl,
  sidebarOutlineAssetResizerEl,
  starterActionsEl, docActionsEl, sidebarFootEl,
  sidebarNewEl, sidebarSaveEl, saveEl, saveLabelEl, saveAsEl, closeEl,
  modeReadEl, modeEditEl, modeSourceEl, docToolbarEl,
} from "../core/dom";
import type { AimdAsset, AimdDocument } from "../core/types";
import { fileStem, extractHeadingTitle } from "../util/path";
import { escapeAttr, escapeHTML } from "../util/escape";
import { renderRecentList } from "./recents";
import { persistSessionSnapshot } from "../session/snapshot";

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

// 底部 status-pill 是唯一的状态显示位：稳定态（就绪 / 未保存的修改 / 草稿提示）
// + 临时反馈（保存中 / 已保存 / 失败）共用同一槽位。1.8s 后 success/info 会回退到
// 当前 doc 的稳定态（脏 → 未保存的修改；干净 → 就绪）。不再额外开 head 状态文字。
//
// state.statusTimer 同时充当"当前是否在临时反馈窗口期"的标志：updateChrome 看到
// 它非 null 时会跳过稳定态写入，避免把"已保存"立刻盖回"就绪"。
export function setStatus(text: string, tone: "idle" | "loading" | "success" | "warn" | "info" = "idle") {
  statusEl().textContent = text;
  statusPillEl().dataset.tone = tone;
  if (state.statusTimer) {
    window.clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
  if (tone === "success" || tone === "info") {
    state.statusTimer = window.setTimeout(() => {
      state.statusTimer = null;
      const doc = state.doc;
      if (doc?.dirty) {
        statusEl().textContent = "未保存的修改";
        statusPillEl().dataset.tone = "warn";
      } else {
        statusEl().textContent = "就绪";
        statusPillEl().dataset.tone = "idle";
      }
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
  // 保存按钮在文档没有变化时禁用：用户的"按钮亮着但其实没活做"会变成第二种困惑。
  // 草稿状态(isDraft)即使 dirty=false 也要保留可点（点击会触发 saveDocumentAs 创建文件）。
  const canSave = Boolean(doc && (doc.dirty || doc.isDraft));
  saveEl().disabled = !canSave;
  saveAsEl().disabled = !doc;
  closeEl().disabled = !doc;
  // 顶部的主按钮统一显示「保存」：草稿状态下点击仍走 saveDocumentAs 创建文件，
  // 但视觉/语义上对用户都是"保存"动作（与 sidebar-foot 一致）。
  saveLabelEl().textContent = "保存";
  modeReadEl().disabled = !doc;
  modeEditEl().disabled = !doc;
  modeSourceEl().disabled = !doc;

  if (!doc) {
    assetSectionEl().hidden = true;
    outlineSectionEl().hidden = true;
    sidebarOutlineAssetResizerEl().hidden = true;
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

  outlineSectionEl().hidden = false;
  // 资源区无内容时折叠：空区域只会降低 sidebar 信息密度。
  const hasAssets = doc.assets.length > 0;
  assetSectionEl().hidden = !hasAssets;
  sidebarOutlineAssetResizerEl().hidden = !hasAssets;

  assetCountEl().textContent = String(doc.assets.length);
  if (hasAssets) {
    assetListEl().innerHTML = doc.assets.map(assetItem).join("");
  } else {
    assetListEl().innerHTML = "";
  }

  // 把当前文档的稳定状态推到底部 status-pill。setStatus 的临时反馈（保存中 /
  // 已保存 / 失败）窗口期内 statusTimer 非 null，这里不抢；timer 回调结束后
  // 会自己根据 dirty 回退到稳定态。
  if (state.statusTimer == null) {
    if (doc.isDraft && !doc.dirty) {
      setStatus("这是未保存草稿，保存后才会生成 .aimd 文件", "info");
    } else if (doc.dirty) {
      statusEl().textContent = "未保存的修改";
      statusPillEl().dataset.tone = "warn";
    } else {
      statusEl().textContent = "就绪";
      statusPillEl().dataset.tone = "idle";
    }
  }
  persistSessionSnapshot();
}
