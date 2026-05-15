import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

import { APP_HTML } from "./ui/template";

// Inject the app shell BEFORE any module touches the lazy DOM accessors.
document.querySelector<HTMLDivElement>("#app")!.innerHTML = APP_HTML;

import { state } from "./core/state";
import type { AimdDocument } from "./core/types";
import {
  markdownEl, inlineEditorEl, modeReadEl, modeEditEl, modeSourceEl,
  saveEl, saveAsEl, closeEl,
  moreMenuToggleEl, moreMenuEl, webImportEl, formatDocumentEl,
  checkUpdatesEl,
  debugIndicatorEl, debugIndicatorCountEl,
} from "./core/dom";
import { setMode, refreshSourceBanner } from "./ui/mode";
import { setStatus, updateChrome } from "./ui/chrome";
import { bindFormatToolbar } from "./editor/format-toolbar";
import { bindSearch, openFindBar } from "./editor/search";
import { bindSourceHighlight } from "./editor/source-highlight";
import { bindWidthSwitch, setWidth } from "./ui/width";
import { bindSidebarResizers, bindSidebarHrResizer } from "./ui/resizers";
import { bindImageLightbox } from "./ui/lightbox";
import { showFileContextMenu } from "./ui/context-menu";
import { onInlineInput, flushInline } from "./editor/inline";
import { bindImageDeleteGuard } from "./editor/image-delete";
import { onInlinePaste, onInlineKeydown, collectClipboardImages, pasteImageFiles } from "./editor/paste";
import { scheduleRender } from "./ui/outline";
import { clearRecentDocuments, loadRecentPaths } from "./ui/recents";
import {
  chooseAndOpen, newDocument, closeDocument,
  routeOpenedPath, openDocument, chooseAndImportMarkdownProject,
} from "./document/lifecycle";
import { saveDocument, saveDocumentAs } from "./document/persist";
import { hasAimdImageReferences, hasExternalImageReferences } from "./document/assets";
import { importWebClip } from "./document/web-clip";
import { bindFormatDocumentPanel, formatCurrentDocument } from "./document/format";
import { cleanupOldDrafts } from "./document/drafts";
import { optimizeDocumentAssets } from "./document/optimize";
import { exportMarkdownAssets, exportHTML, exportPDF } from "./document/export";
import { bindHealthPanel, runHealthCheck, packageLocalImages } from "./document/health";
import {
  onWindowDragOver, onWindowDragLeave, onWindowDrop,
} from "./drag/window-drop";
import { persistSessionSnapshot, restoreSession } from "./session/snapshot";
import { applyDocument } from "./document/apply";
import { hasGitConflictMarkers } from "./document/apply";
import { debugLog, installDebugConsole, openDebugConsole, onDebugChange, setDebugMode } from "./debug/console";
import { bindWorkspacePanel, openWorkspacePicker } from "./ui/workspace";
import { bindDocPanelTabs } from "./ui/doc-panel";
import { bindGitPanel, refreshGitStatus } from "./ui/git";
import { bindGitDiffView } from "./ui/git-diff";
import { bindSelectionBoundary } from "./ui/selection";
import { loadAppSettings, type AppSettings } from "./core/settings";
import { createSourceModel } from "./editor/source-preserve";
import { bindUpdater, checkForUpdates, scheduleStartupUpdateCheck } from "./updater/client";

installDebugConsole();
bindSelectionBoundary("main");
bindUpdater();
if (isTauri()) {
  void listen<{ level?: string; traceId?: string; elapsedMs?: number; message?: string }>("aimd-pdf-log", (event) => {
    const payload = event.payload || {};
    const level = payload.level === "error"
      ? "error"
      : payload.level === "warn"
        ? "warn"
        : payload.level === "debug"
          ? "debug"
          : "info";
    debugLog(
      level,
      `[pdf:${payload.traceId || "-"} +${payload.elapsedMs ?? "?"}ms] ${payload.message || ""}`,
    );
  });
}

function applyAppSettings(settings: AppSettings) {
  state.uiSettings = { ...settings.ui };
  setDebugMode(state.uiSettings.debugMode);
  updateChrome();
}

// footer 状态条上的隐式调试指示器：只有出现 warn / error 时才显示，
// 文案 "调试 · N"，点击就开 Debug 窗口；不再用最小化 / 最小化条。
onDebugChange((errorCount) => {
  const indicator = debugIndicatorEl();
  if (state.uiSettings.debugMode && errorCount > 0) {
    indicator.hidden = false;
    debugIndicatorCountEl().textContent = String(errorCount);
  } else {
    indicator.hidden = true;
    debugIndicatorCountEl().textContent = "0";
  }
});
debugIndicatorEl().addEventListener("click", () => {
  if (state.uiSettings.debugMode) openDebugConsole();
});

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function bindMenuToggle(toggle: HTMLButtonElement, menu: HTMLElement) {
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextHidden = !menu.hidden;
    closeActionMenus();
    menu.hidden = nextHidden;
    toggle.setAttribute("aria-expanded", String(!nextHidden));
  });
}

function closeActionMenus() {
  moreMenuEl().hidden = true;
  moreMenuToggleEl().setAttribute("aria-expanded", "false");
}

async function openNewWindow() {
  try {
    await invoke("open_in_new_window", { path: null });
    setStatus("已打开新窗口", "success");
  } catch (err) {
    console.error(err);
    setStatus(`新建窗口失败: ${String(err)}`, "warn");
  }
}

$("#head-new").addEventListener("click", () => { void newDocument(); });
$("#head-open").addEventListener("click", () => { void chooseAndOpen(); });
$("body").addEventListener("dragover", onWindowDragOver);
$("body").addEventListener("drop", onWindowDrop);
$("body").addEventListener("dragleave", onWindowDragLeave);
$("#empty-open").addEventListener("click", chooseAndOpen);
$("#empty-open-workspace").addEventListener("click", () => { void openWorkspacePicker(); });
$("#empty-new").addEventListener("click", () => { void newDocument(); });
$("#empty-import-web").addEventListener("click", () => { void importWebClip(); });
$("#empty-import-md-project").addEventListener("click", () => { void chooseAndImportMarkdownProject(); });
$("#sidebar-new").addEventListener("click", () => { void newDocument(); });
$("#sidebar-save").addEventListener("click", () => { void saveDocument(); });
$("#sidebar-open").addEventListener("click", chooseAndOpen);
$("#clear-recent").addEventListener("click", clearRecentDocuments);
modeReadEl().addEventListener("click", () => setMode("read"));
modeEditEl().addEventListener("click", () => setMode("edit"));
modeSourceEl().addEventListener("click", () => setMode("source"));
saveEl().addEventListener("click", saveDocument);
saveAsEl().addEventListener("click", () => { closeActionMenus(); void saveDocumentAs(); });
formatDocumentEl().addEventListener("click", () => { closeActionMenus(); void formatCurrentDocument(); });
$("#package-local-images").addEventListener("click", () => { closeActionMenus(); void packageLocalImages(); });
webImportEl().addEventListener("click", () => { closeActionMenus(); void importWebClip(); });
$("#health-check").addEventListener("click", () => { closeActionMenus(); void runHealthCheck(); });
checkUpdatesEl().addEventListener("click", () => { closeActionMenus(); void checkForUpdates({ manual: true }); });
$("#export-markdown").addEventListener("click", () => { closeActionMenus(); void exportMarkdownAssets(); });
$("#export-html").addEventListener("click", () => { closeActionMenus(); void exportHTML(); });
$("#export-pdf").addEventListener("click", () => { closeActionMenus(); void exportPDF(); });
bindMenuToggle(moreMenuToggleEl(), moreMenuEl());
$<HTMLButtonElement>("#new-window").addEventListener("click", () => {
  closeActionMenus();
  void openNewWindow();
});
closeEl().addEventListener("click", () => { closeActionMenus(); void closeDocument(); });
document.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest(".more-menu-wrap")) closeActionMenus();
});

markdownEl().addEventListener("input", () => {
  if (!state.doc) return;
  state.doc.markdown = markdownEl().value;
  state.sourceModel = createSourceModel(state.doc.markdown);
  state.sourceDirtyRefs.clear();
  state.sourceStructuralDirty = false;
  state.doc.dirty = true;
  state.doc.hasGitConflicts = hasGitConflictMarkers(state.doc.markdown);
  state.doc.hasExternalImageReferences = hasExternalImageReferences(state.doc.markdown);
  if (state.doc.format === "markdown") {
    state.doc.requiresAimdSave = hasAimdImageReferences(state.doc.markdown) || state.doc.assets.length > 0;
    state.doc.needsAimdSave = state.doc.requiresAimdSave;
  }
  updateChrome();
  refreshSourceBanner();
  scheduleRender();
});

markdownEl().addEventListener("paste", (event) => {
  if (!event.clipboardData || !state.doc) return;
  const imageFiles = collectClipboardImages(event.clipboardData);
  if (imageFiles.length === 0) return;
  event.preventDefault();
  void pasteImageFiles(imageFiles, "source");
});

inlineEditorEl().addEventListener("input", onInlineInput);
inlineEditorEl().addEventListener("paste", onInlinePaste);
inlineEditorEl().addEventListener("keydown", onInlineKeydown);

inlineEditorEl().addEventListener("focus", () => {
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {}
}, { once: true });

bindFormatToolbar();
bindSearch();
bindSourceHighlight();
bindHealthPanel();
bindFormatDocumentPanel();
bindWorkspacePanel();
bindDocPanelTabs(() => { void refreshGitStatus(); });
bindGitPanel();
bindGitDiffView();
bindWidthSwitch();
bindImageDeleteGuard(inlineEditorEl());
bindSidebarResizers();
bindSidebarHrResizer();

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (key === "f5" || (mod && key === "r")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (mod && key === "n" && event.shiftKey) {
    event.preventDefault();
    void openNewWindow();
  } else if (mod && key === "n") {
    event.preventDefault();
    void newDocument();
  }
  if (mod && key === "w") {
    event.preventDefault();
    void closeDocument();
  }
  if (mod && key === "s" && event.shiftKey) {
    event.preventDefault();
    void saveDocumentAs();
  } else if (mod && key === "s") {
    event.preventDefault();
    void saveDocument();
  }
  if (mod && key === "o") {
    event.preventDefault();
    void chooseAndOpen();
  }
  if (mod && key === "f") {
    event.preventDefault();
    openFindBar(false);
  }
  if (mod && key === "h") {
    event.preventDefault();
    openFindBar(true);
  }
  if (event.key === "Escape") closeActionMenus();
});

// Block the system context menu in production (image right-click "Save Image
// As", etc). In dev we leave it on so DevTools "Inspect" still works. e2e sets
// __aimd_force_contextmenu_block via addInitScript to drive the real listener
// through the same path production runs.
//
// 例外（让原生菜单透出）：
//   - [data-file-item] 自己处理 contextmenu。
//   - input / textarea / contenteditable / 源码 #markdown：用户需要"剪切/复制/粘贴"
//     原生菜单。一刀切阻断会让 API key 等密码字段也丢失粘贴入口（用户会以为
//     "禁用了 copy paste"）。
if (!(import.meta as any).env?.DEV || (window as any).__aimd_force_contextmenu_block) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-file-item]")) return;
    if (target.closest("input, textarea, [contenteditable='true'], #markdown")) return;
    e.preventDefault();
  }, { capture: true });
}

window.addEventListener("beforeunload", () => {
  if (state.mode === "edit" && state.inlineDirty) {
    flushInline();
  }
  persistSessionSnapshot();
});

window.addEventListener("DOMContentLoaded", async () => {
  state.recentPaths = loadRecentPaths();
  state.isBootstrappingSession = true;
  try {
    applyAppSettings(await loadAppSettings());
  } catch {
    updateChrome();
  }
  updateChrome();
  try {
    await listen<string>("aimd-open-file", (event) => {
      void routeOpenedPath(event.payload, { skipConfirm: false });
    });
    const menuHandlers: Record<string, () => void> = {
      "settings":          () => { void invoke("open_settings_window"); },
      "check-updates":     () => { void checkForUpdates({ manual: true }); },
      "debug-console":     () => { if (state.uiSettings.debugMode) openDebugConsole(); },
      "new-document":      () => { void newDocument(); },
      "open-document":     () => { void chooseAndOpen(); },
      "save-document":     () => { void saveDocument(); },
      "save-document-as":  () => { void saveDocumentAs(); },
      "new-window":        () => { void openNewWindow(); },
      "close-document":    () => { void closeDocument(); },
      "mode-read":         () => { setMode("read"); },
      "mode-edit":         () => { setMode("edit"); },
      "mode-source":       () => { setMode("source"); },
      "width-normal":      () => { setWidth("normal"); },
      "width-wide":        () => { setWidth("wide"); },
      "width-ultra":       () => { setWidth("ultra"); },
    };
    await listen<string>("aimd-menu", (event) => {
      menuHandlers[event.payload]?.();
    });
    await listen<AppSettings>("aimd-settings-updated", (event) => {
      applyAppSettings(event.payload);
    });
  } catch {
    // Ignore event binding failures outside the Tauri shell.
  }
  let initialDraftPath: string | null = null;
  try {
    initialDraftPath = await invoke<string | null>("initial_draft_path");
  } catch {
    // Older builds / browser e2e mocks may not provide draft-window boot data.
  }
  let initialPath: string | null = null;
  try {
    initialPath = await invoke<string | null>("initial_open_path");
  } catch {
    // Running outside of Tauri (vite dev / e2e).
  }
  try {
    if (initialDraftPath) {
      const doc = await invoke<AimdDocument>("open_aimd", { path: initialDraftPath });
      applyDocument({
        ...doc,
        path: "",
        isDraft: true,
        dirty: true,
        draftSourcePath: initialDraftPath,
        format: "aimd",
      }, "read");
      setStatus("网页草稿已打开，保存后选择位置", "idle");
      return;
    }
    if (initialPath) {
      await routeOpenedPath(initialPath, { skipConfirm: true });
      return;
    }
    await restoreSession();
  } finally {
    state.isBootstrappingSession = false;
    void cleanupOldDrafts(state.doc?.draftSourcePath ? [state.doc.draftSourcePath] : []);
    if (!state.doc) updateChrome();
    scheduleStartupUpdateCheck();
  }
});

bindImageLightbox();

(window as any).__aimd_testInsertImageBytes = async (
  buf: ArrayBuffer,
  mime: string,
  name: string,
  target: "edit" | "source",
) => {
  const f = new File([buf], name, { type: mime });
  await pasteImageFiles([f], target);
};

(window as any).__aimd_testOptimizeAssets = (path: string) =>
  optimizeDocumentAssets(path);

(window as any).__aimd_showFileContextMenu = showFileContextMenu;
