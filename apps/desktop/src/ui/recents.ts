import { state, STORAGE_RECENTS, STORAGE_LAST, MAX_RECENTS } from "../core/state";
import { recentSectionEl, recentListEl } from "../core/dom";
import { fileStem } from "../util/path";
import { escapeAttr, escapeHTML } from "../util/escape";
import { formatPathHint, setStatus } from "./chrome";
import { showFileContextMenu } from "./context-menu";
import { routeOpenedPath } from "../document/lifecycle";

export function loadRecentPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_RECENTS);
    const items = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items)) return [];
    return items.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecentPaths() {
  window.localStorage.setItem(STORAGE_RECENTS, JSON.stringify(state.recentPaths.slice(0, MAX_RECENTS)));
}

export function rememberOpenedPath(path: string) {
  if (!path) return;
  state.recentPaths = [path, ...state.recentPaths.filter((item) => item !== path)].slice(0, MAX_RECENTS);
  window.localStorage.setItem(STORAGE_LAST, path);
  saveRecentPaths();
  renderRecentList();
}

export function forgetRecentPath(path: string) {
  state.recentPaths = state.recentPaths.filter((item) => item !== path);
  saveRecentPaths();
  renderRecentList();
}

export function clearRecentDocuments() {
  state.recentPaths = [];
  window.localStorage.removeItem(STORAGE_RECENTS);
  renderRecentList();
}

export function renderRecentList() {
  recentSectionEl().hidden = state.recentPaths.length === 0;
  if (state.recentPaths.length === 0) {
    recentListEl().innerHTML = "";
    return;
  }
  recentListEl().innerHTML = state.recentPaths
    .map((path, index) => `
      <button class="recent-item" data-path="${escapeAttr(path)}" data-file-item="true" type="button">
        <span class="recent-item-main">
          <span class="recent-item-title">${escapeHTML(fileStem(path) || "未命名文档")}</span>
          <span class="recent-item-meta">${escapeHTML(formatPathHint(path))}</span>
        </span>
        <span class="recent-item-badge">${index === 0 ? "继续" : "打开"}</span>
      </button>
    `)
    .join("");
  recentListEl().querySelectorAll<HTMLButtonElement>(".recent-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const path = button.dataset.path;
      if (!path) return;
      button.disabled = true;
      try {
        const result = await routeOpenedPath(path);
        if (result === "failed" || result === "unsupported") {
          forgetRecentPath(path);
          setStatus(result === "unsupported" ? "不支持的文件，已从最近列表移除" : "文件打不开，已从最近列表移除", "warn");
        }
      } finally {
        button.disabled = false;
      }
    });
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const path = button.dataset.path;
      if (path) showFileContextMenu(e.clientX, e.clientY, path);
    });
  });
}
