import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

import { APP_HTML } from "./ui/template";

// Inject the app shell BEFORE any module touches the lazy DOM accessors.
document.querySelector<HTMLDivElement>("#app")!.innerHTML = APP_HTML;

import { state } from "./core/state";
import {
  markdownEl, inlineEditorEl, modeReadEl, modeEditEl, modeSourceEl,
  saveEl, saveAsEl, closeEl,
} from "./core/dom";
import { setMode } from "./ui/mode";
import { updateChrome } from "./ui/chrome";
import { bindFormatToolbar } from "./editor/format-toolbar";
import { bindWidthSwitch } from "./ui/width";
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
  routeOpenedPath, openDocument,
} from "./document/lifecycle";
import { saveDocument, saveDocumentAs } from "./document/persist";
import { optimizeDocumentAssets } from "./document/optimize";
import {
  onWindowDragOver, onWindowDragLeave, onWindowDrop,
} from "./drag/window-drop";
import { persistSessionSnapshot, restoreSession } from "./session/snapshot";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

$("#head-new").addEventListener("click", () => { void newDocument(); });
$("#head-open").addEventListener("click", () => { void chooseAndOpen(); });
$("body").addEventListener("dragover", onWindowDragOver);
$("body").addEventListener("drop", onWindowDrop);
$("body").addEventListener("dragleave", onWindowDragLeave);
$("#empty-open").addEventListener("click", chooseAndOpen);
$("#empty-new").addEventListener("click", () => { void newDocument(); });
$("#sidebar-new").addEventListener("click", () => { void newDocument(); });
$("#sidebar-save").addEventListener("click", () => { void saveDocument(); });
$("#sidebar-open").addEventListener("click", chooseAndOpen);
$("#clear-recent").addEventListener("click", clearRecentDocuments);
modeReadEl().addEventListener("click", () => setMode("read"));
modeEditEl().addEventListener("click", () => setMode("edit"));
modeSourceEl().addEventListener("click", () => setMode("source"));
saveEl().addEventListener("click", saveDocument);
saveAsEl().addEventListener("click", saveDocumentAs);
$<HTMLButtonElement>("#new-window").addEventListener("click", () => {
  void invoke("open_in_new_window", { path: null });
});
closeEl().addEventListener("click", () => { void closeDocument(); });

markdownEl().addEventListener("input", () => {
  if (!state.doc) return;
  state.doc.markdown = markdownEl().value;
  state.doc.dirty = true;
  updateChrome();
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
bindWidthSwitch();
bindImageDeleteGuard(inlineEditorEl());
bindSidebarResizers();
bindSidebarHrResizer();

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (key === "f5" || (mod && key === "r")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (mod && key === "n" && event.shiftKey) {
    event.preventDefault();
    void invoke("open_in_new_window", { path: null });
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
});

// Block the system context menu in production (image right-click "Save Image
// As", etc). In dev we leave it on so DevTools "Inspect" still works. e2e sets
// __aimd_force_contextmenu_block via addInitScript to drive the real listener
// through the same path production runs.
// Items marked [data-file-item] handle contextmenu themselves; let them pass.
if (!(import.meta as any).env?.DEV || (window as any).__aimd_force_contextmenu_block) {
  document.addEventListener("contextmenu", (e) => {
    if ((e.target as HTMLElement)?.closest("[data-file-item]")) return;
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
  updateChrome();
  try {
    await listen<string>("aimd-open-file", (event) => {
      void routeOpenedPath(event.payload, { skipConfirm: false });
    });
  } catch {
    // Ignore event binding failures outside the Tauri shell.
  }
  let initialPath: string | null = null;
  try {
    initialPath = await invoke<string | null>("initial_open_path");
  } catch {
    // Running outside of Tauri (vite dev / e2e).
  }
  try {
    if (initialPath) {
      await routeOpenedPath(initialPath, { skipConfirm: true });
      return;
    }
    await restoreSession();
  } finally {
    state.isBootstrappingSession = false;
    if (!state.doc) updateChrome();
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
