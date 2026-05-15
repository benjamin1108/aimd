import { state } from "../core/state";
import {
  emptyEl, readerEl, inlineEditorEl, editorWrapEl, formatToolbarEl,
  gitDiffViewEl,
  modeReadEl, modeEditEl, modeSourceEl,
  sourceBannerEl, sourceBannerTextEl,
} from "../core/dom";
import type { Mode } from "../core/types";
import { paintPaneIfStale } from "./outline";
import { updateChrome } from "./chrome";
import { flushInline } from "../editor/inline";
import { splitFrontmatter } from "../markdown/frontmatter";
import { captureActiveViewState, restoreActiveViewState } from "../document/view-state";

export function refreshSourceBanner() {
  const banner = sourceBannerEl();
  if (!state.doc || state.mode !== "source") {
    banner.hidden = true;
    return;
  }
  if (state.doc.hasGitConflicts) {
    sourceBannerTextEl().innerHTML =
      "<strong>Git 冲突</strong>：文档包含 conflict markers，请在 Markdown 中搜索 <<<<<<< 并解决后保存。";
    banner.hidden = false;
    return;
  }
  const { frontmatter } = splitFrontmatter(state.doc.markdown);
  if (!frontmatter) {
    banner.hidden = true;
    return;
  }
  const lineCount = frontmatter.split("\n").length;
  sourceBannerTextEl().innerHTML =
    `<strong>Markdown 视图</strong>：开头 ${lineCount} 行是 YAML 元信息。预览 / 可视编辑会保护这些内容；Markdown 模式可直接修改。`;
  banner.hidden = false;
}

export function setMode(mode: Mode, options: { skipCapture?: boolean } = {}) {
  if (!options.skipCapture) captureActiveViewState();
  // Flush from the mode we are leaving.
  if (state.mode === "edit" && mode !== "edit") flushInline();

  state.mode = mode;
  const hasDoc = Boolean(state.doc);
  if (state.mainView === "git-diff") {
    emptyEl().hidden = true;
    readerEl().hidden = true;
    inlineEditorEl().hidden = true;
    editorWrapEl().hidden = true;
    formatToolbarEl().hidden = true;
    gitDiffViewEl().hidden = false;
    updateChrome();
    return;
  }

  emptyEl().hidden = hasDoc;
  gitDiffViewEl().hidden = true;
  readerEl().hidden = !hasDoc || mode !== "read";
  inlineEditorEl().hidden = !hasDoc || mode !== "edit";
  editorWrapEl().hidden = !hasDoc || mode !== "source";
  formatToolbarEl().hidden = !hasDoc || mode !== "edit";

  // Bring the destination pane in sync with state.doc.html, but only when
  // its painted version trails the current html version. flushInline keeps
  // state.doc.html updated while editing, and applyHTML keeps reader/preview
  // in sync on open / save / source-mode render — so most mode hops have
  // nothing to repaint and stay snappy on long documents.
  if (hasDoc) {
    paintPaneIfStale(mode);
    if (mode === "source") refreshSourceBanner();
    restoreActiveViewState(mode);
  }

  for (const [el, m] of [[modeReadEl(), "read"], [modeEditEl(), "edit"], [modeSourceEl(), "source"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }

  updateChrome();
}
