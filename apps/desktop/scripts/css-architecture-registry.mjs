export const categories = [
  "global-selectors",
  "undefined-vars",
  "runtime-vars",
  "raw-color-tokens",
  "theme-contrast",
  "hard-colors",
  "var-fallback-colors",
  "naked-z-index",
  "important-allowlist",
  "runtime-style-writes",
  "outline-none",
  "pointer-events-none",
  "motion",
  "nowrap-truncation",
  "hidden-scrollbars",
  "print-ownership",
  "entry-imports",
  "webclip-style-source",
  "html-preboot-style",
  "breakpoints",
  "container-queries",
  "layers",
];

export const runtimeVars = {
  "--project-rail-width": {
    owner: "ui/resizers.ts",
    reason: "user-resized project rail width",
    cleanup: "removed when rail is collapsed or shell resets",
  },
  "--inspector-rail-width": {
    owner: "ui/resizers.ts",
    reason: "user-resized inspector rail width",
    cleanup: "removed when inspector is collapsed or shell resets",
  },
  "--update-progress-scale": {
    owner: "updater/view.ts",
    reason: "download progress transform scale",
    cleanup: "removed for indeterminate progress",
  },
  "--doc-panel-tab-count": {
    owner: "ui/doc-panel.ts",
    reason: "stable inspector tab grid count",
    cleanup: "persistent while inspector exists",
  },
  "--workspace-row-indent": {
    owner: "ui/workspace.ts",
    reason: "tree depth indentation",
    cleanup: "row is re-rendered",
  },
  "--ui-tooltip-x": {
    owner: "ui/tooltips.ts",
    reason: "measured tooltip portal x coordinate",
    cleanup: "tooltip hides between targets",
  },
  "--ui-tooltip-y": {
    owner: "ui/tooltips.ts",
    reason: "measured tooltip portal y coordinate",
    cleanup: "tooltip hides between targets",
  },
};

export const runtimeStyleWrites = [
  { file: "apps/desktop/src/debug/console.ts", pattern: "textarea.style.position", owner: "debug console copy probe" },
  { file: "apps/desktop/src/debug/console.ts", pattern: "textarea.style.left", owner: "debug console copy probe" },
  { file: "apps/desktop/src/debug/console.ts", pattern: "panelEl!.style.left", owner: "debug console drag position" },
  { file: "apps/desktop/src/debug/console.ts", pattern: "panelEl!.style.top", owner: "debug console drag position" },
  { file: "apps/desktop/src/debug/console.ts", pattern: "panelEl!.style.transform", owner: "debug console drag position" },
  { file: "apps/desktop/src/webview/injector-lifecycle.ts", pattern: "document.body.style.overflow", owner: "webclip body lock restore" },
  { file: "apps/desktop/src/ui/context-menu.ts", pattern: "menu.style.left", owner: "context menu measured position" },
  { file: "apps/desktop/src/ui/context-menu.ts", pattern: "menu.style.top", owner: "context menu measured position" },
  { file: "apps/desktop/src/ui/tree-overflow-portal.ts", pattern: "probe.style.width", owner: "tree overflow measurement probe" },
  { file: "apps/desktop/src/ui/tree-overflow-portal.ts", pattern: "overlay.style.top", owner: "tree overflow portal measured rect" },
  { file: "apps/desktop/src/ui/tree-overflow-portal.ts", pattern: "overlay.style.left", owner: "tree overflow portal measured rect" },
  { file: "apps/desktop/src/ui/tree-overflow-portal.ts", pattern: "overlay.style.width", owner: "tree overflow portal measured rect" },
  { file: "apps/desktop/src/ui/tree-overflow-portal.ts", pattern: "overlay.style.height", owner: "tree overflow portal measured rect" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "panelEl().style.setProperty", owner: "rail width CSS custom properties" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "panelEl().style.removeProperty", owner: "rail width CSS custom properties" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "aEl.style.flex", owner: "split-section drag sizing" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "bEl.style.flex", owner: "split-section drag sizing" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "a.style.flex", owner: "split-section cleanup" },
  { file: "apps/desktop/src/ui/resizers.ts", pattern: "b.style.flex", owner: "split-section cleanup" },
  { file: "apps/desktop/src/ui/chrome.ts", pattern: "panelEl().style.gridTemplateColumns", owner: "legacy shell reset" },
  { file: "apps/desktop/src/ui/chrome.ts", pattern: "panelEl().style.removeProperty", owner: "legacy shell reset" },
  { file: "apps/desktop/src/updater/view.ts", pattern: "refs.progressFill.style.setProperty", owner: "updater progress CSS variable" },
  { file: "apps/desktop/src/updater/view.ts", pattern: "refs.progressFill.style.removeProperty", owner: "updater progress CSS variable cleanup" },
  { file: "apps/desktop/src/ui/doc-panel.ts", pattern: "outlineSectionEl().style.setProperty", owner: "inspector tab count CSS variable" },
  { file: "apps/desktop/src/ui/workspace.ts", pattern: "style=\"${workspaceIndentStyle(depth)}\"", owner: "workspace tree depth CSS variable" },
  { file: "apps/desktop/src/ui/tooltips.ts", pattern: "tooltip.style.setProperty", owner: "tooltip portal measured position" },
];

export const pointerEventsNone = [
  { file: "apps/desktop/src/styles/surfaces/editor.css", selector: ".ft-btn[title]::after", reason: "passive tooltip surface" },
  { file: "apps/desktop/src/styles/surfaces/editor.css", selector: ".inline-editor :where", reason: "decorative placeholder text" },
  { file: "apps/desktop/src/styles/entries/webclip.css", selector: ":host", reason: "host shell lets isolated controls opt into pointer events" },
  { file: "apps/desktop/src/styles/entries/webclip.css", selector: ".aimd-clip-bar::before", reason: "decorative aura layer" },
  { file: "apps/desktop/src/styles/overlays/debug-console.css", selector: ".debug-modal", reason: "transparent overlay with interactive panel child" },
  { file: "apps/desktop/src/styles/overlays/tree-overflow-portal.css", selector: ".workspace-row-overflow-measure", reason: "hidden measurement probe" },
  { file: "apps/desktop/src/styles/overlays/tree-overflow-portal.css", selector: ".workspace-row.workspace-row-overflow-overlay", reason: "visual clone; original row keeps interaction" },
  { file: "apps/desktop/src/styles/overlays/tooltips.css", selector: ".ui-tooltip", reason: "passive tooltip surface" },
  { file: "apps/desktop/src/styles/components/settings.css", selector: ".api-key-mask", reason: "masked text overlay passes clicks to input" },
  { file: "apps/desktop/src/styles/components/sidebar-tooltips.css", selector: ".workspace-actions .icon-btn[title]::after", reason: "passive tooltip surface" },
];

export const hiddenScrollbars = [
  {
    file: "apps/desktop/src/styles/surfaces/editor.css",
    selector: ".format-toolbar",
    alternate: "toolbar separator drag handles bound in ui/toolbar-drag.ts",
  },
];

export const registeredBreakpoints = new Set([1320, 1180, 1100, 1020, 900, 760, 720, 620]);
