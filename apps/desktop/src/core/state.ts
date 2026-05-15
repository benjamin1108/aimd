import type {
  AimdDocument,
  GitFileDiff,
  GitDiffTab,
  GitRepoStatus,
  MainView,
  MarkdownSourceModel,
  Mode,
  OpenDocumentsState,
  OutlineNode,
  SidebarDocTab,
  WorkspaceRoot,
  UiSettings,
} from "./types";

export const STORAGE_RECENTS = "aimd.desktop.recents";
export const STORAGE_LAST = "aimd.desktop.last";
export const STORAGE_SESSION = "aimd.desktop.session";
export const STORAGE_WORKSPACE_ROOT = "aimd.desktop.workspace.root";
export const STORAGE_WORKSPACE_EXPANDED = "aimd.desktop.workspace.expanded";
export const STORAGE_WORKSPACE_COLLAPSED = "aimd.desktop.workspace.collapsed";
export const STORAGE_DOC_PANEL_COLLAPSED = "aimd.desktop.docPanel.collapsed";
export const MAX_RECENTS = 8;
export const ASSET_URI_PREFIX = "asset://";

export const ICONS = {
  document: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z"/><path d="M9 1.5V5.5h4"/></svg>`,
  image: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 3 3 2-2 2.5 2.5"/></svg>`,
  folder: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.2v8a1.3 1.3 0 0 0 1.3 1.3h9.4a1.3 1.3 0 0 0 1.3-1.3V5.8a1.3 1.3 0 0 0-1.3-1.3H8L6.5 3H3.3A1.3 1.3 0 0 0 2 4.2Z"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  refresh: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7a5 5 0 0 0-8.6-3.2L3 5.2"/><path d="M3 2.5v2.7h2.7M3 9a5 5 0 0 0 8.6 3.2L13 10.8"/><path d="M13 13.5v-2.7h-2.7"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>`,
  read: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5V4a1 1 0 0 1 1.2-1l4.3 1 4.3-1A1 1 0 0 1 13 4v8.5"/><path d="M7.5 4v9"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 2.5 13.5 4.8 5.4 12.9l-3 .7.7-3z"/><path d="m10.2 3.5 2.3 2.3"/></svg>`,
  source: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4-3 4 3 4M10.5 4l3 4-3 4"/></svg>`,
  save: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L11 3H4a1 1 0 0 0-1 .5z"/><path d="M5 3.5V7h6V3.5M5 13.5V10h6v3.5"/></svg>`,
  close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m4 4 8 8M12 4 4 12"/></svg>`,
  play: `<svg viewBox="0 0 16 16" fill="none"><path d="M5 3.7v8.6a.8.8 0 0 0 1.2.7l6.5-4.3a.8.8 0 0 0 0-1.4L6.2 3A.8.8 0 0 0 5 3.7Z" fill="currentColor"/></svg>`,
  sparkle: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.8 9.8 5l3.4 1.2-3.4 1.3-1.3 3.4-1.3-3.4-3.4-1.3L7.2 5z"/><path d="M3.2 9.8 3.8 11l1.2.5-1.2.5-.6 1.3-.5-1.3-1.2-.5 1.2-.5z"/></svg>`,
  settings: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M9.2 1.8 9.6 3a5 5 0 0 1 1.1.5l1.2-.5 1.3 2.2-1 .8c.1.4.1.7.1 1.1s0 .7-.1 1.1l1 .8-1.3 2.2-1.2-.5a5 5 0 0 1-1.1.5l-.4 1.2H6.8l-.4-1.2a5 5 0 0 1-1.1-.5l-1.2.5L2.8 9l1-.8A5 5 0 0 1 3.7 7c0-.4 0-.7.1-1.1l-1-.8 1.3-2.2 1.2.5A5 5 0 0 1 6.4 3l.4-1.2z"/></svg>`,
  console: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.4"/><path d="m4.5 6 2 2-2 2M8 10h3.5"/></svg>`,
  bold: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h4.2a2.3 2.3 0 0 1 0 4.6H5zM5 7.6h4.6a2.4 2.4 0 0 1 0 4.8H5zM5 3v9.4"/></svg>`,
  italic: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3H6.5M9.5 13H6M9 3l-3 10"/></svg>`,
  strike: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M11 5.5C11 4 9.7 3 8 3 6 3 5 4 5 5c0 2 6 1.5 6 4 0 1.3-1.4 2.4-3 2.4-2 0-3-1-3-2.4"/></svg>`,
  h1: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v10M9 3v10M2 8h7M11.8 5.5 13.2 4.5V13"/></svg>`,
  h2: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v10M8 3v10M2 8h6M10.5 6.2c0-1 .9-1.7 1.9-1.7 1.1 0 1.9.7 1.9 1.7 0 .8-.4 1.4-1.5 2.4l-2.4 2.4h3.9"/></svg>`,
  h3: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v10M8 3v10M2 8h6M10.4 5.4c.3-.6 1-1 1.8-1 1 0 1.8.7 1.8 1.6 0 .8-.6 1.5-1.6 1.5h-.4M11.4 7.5h.6c1.1 0 1.9.7 1.9 1.7 0 1.1-.9 1.8-2 1.8-.9 0-1.6-.4-1.9-1"/></svg>`,
  ul: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3" cy="4.5" r=".8" fill="currentColor"/><circle cx="3" cy="8" r=".8" fill="currentColor"/><circle cx="3" cy="11.5" r=".8" fill="currentColor"/><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5"/></svg>`,
  ol: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.6 2.7 3v3M2 7.5h1.4l-1.4 1.6h1.4M2 11.7c0-.4.3-.7.7-.7s.7.3.7.7c0 .8-1.4.9-1.4 1.6h1.4M5.6 4.5h7.9M5.6 8h7.9M5.6 11.5h7.9"/></svg>`,
  quote: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5C3 4.7 3.7 4 4.5 4H6v2.5L4.5 9H3V5.5zM10 5.5C10 4.7 10.7 4 11.5 4H13v2.5L11.5 9H10V5.5z"/><path d="M3 12h10"/></svg>`,
  code: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4-3 4 3 4M10.5 4l3 4-3 4"/></svg>`,
  table: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="1.2"/><path d="M2.5 6.5h11M2.5 10h11M6.2 3v10M10 3v10"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5 8 2 2 4-4"/></svg>`,
  link: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.4 9.4 7M6.7 5.6 8.2 4a2.6 2.6 0 0 1 3.7 3.7l-1.4 1.5M9.5 10.4 8 12a2.6 2.6 0 0 1-3.7-3.7L5.6 7"/></svg>`,
  info: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 7.4v3.4M8 5.4v.1"/></svg>`,
};

export const state: {
  doc: AimdDocument | null;
  openDocuments: OpenDocumentsState;
  mainView: MainView;
  mode: Mode;
  flushTimer: number | null;
  statusTimer: number | null;
  statusOverride: {
    text: string;
    tone: "idle" | "loading" | "success" | "warn" | "info";
    action?: string;
  } | null;
  outline: OutlineNode[];
  markdownVersion: number;
  htmlVersion: number;
  htmlMarkdownVersion: number;
  pendingRenderVersion: number | null;
  renderErrorVersion: number | null;
  paintedVersion: Record<Mode, number>;
  recentPaths: string[];
  workspace: WorkspaceRoot | null;
  workspaceExpanded: Set<string>;
  workspaceSelectedPath: string;
  workspaceLoading: boolean;
  workspaceError: string;
  workspaceCollapsed: boolean;
  docPanelCollapsed: boolean;
  sidebarDocTab: SidebarDocTab;
  git: {
    isRepo: boolean;
    status: GitRepoStatus | null;
    diffTabs: GitDiffTab[];
    diffView: {
      path: string;
      diff: GitFileDiff | null;
      loading: boolean;
      error: string;
    };
    loading: boolean;
    action: boolean;
    error: string;
    selectedPath: string;
  };
  uiSettings: UiSettings;
  inlineDirty: boolean;
  sourceModel: MarkdownSourceModel | null;
  sourceDirtyRefs: Set<string>;
  sourceStructuralDirty: boolean;
  isBootstrappingSession: boolean;
} = {
  doc: null,
  openDocuments: {
    tabs: [],
    activeTabId: null,
  },
  mainView: "document",
  mode: "read",
  flushTimer: null,
  statusTimer: null,
  statusOverride: null,
  outline: [],
  // Bumped every time state.doc.html changes (applyHTML, flushInline-with-md-change).
  // paintedVersion tracks which version each pane's DOM currently shows; setMode
  // only re-paints a pane when its painted version trails htmlVersion. Without
  // this, mode hops on a long doc rebuild innerHTML for the destination pane
  // every time and feel sluggish.
  markdownVersion: 0,
  htmlVersion: 0,
  htmlMarkdownVersion: 0,
  pendingRenderVersion: null,
  renderErrorVersion: null,
  paintedVersion: { read: -1, edit: -1, source: -1 },
  recentPaths: [],
  workspace: null,
  workspaceExpanded: new Set(),
  workspaceSelectedPath: "",
  workspaceLoading: false,
  workspaceError: "",
  workspaceCollapsed: false,
  docPanelCollapsed: false,
  sidebarDocTab: "outline",
  git: {
    isRepo: false,
    status: null,
    diffTabs: [],
    diffView: {
      path: "",
      diff: null,
      loading: false,
      error: "",
    },
    loading: false,
    action: false,
    error: "",
    selectedPath: "",
  },
  uiSettings: { showAssetPanel: false, debugMode: false },
  // Tracks whether the inline editor's DOM has been mutated by user input since
  // the last flush / paint. flushInline skips its (expensive) turndown call when
  // false — this is what keeps mode hops snappy on long documents.
  inlineDirty: false,
  sourceModel: null,
  sourceDirtyRefs: new Set(),
  sourceStructuralDirty: false,
  isBootstrappingSession: false,
};
