import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import "./styles.css";

type AimdAsset = {
  id: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
  role: string;
  url?: string;
  localPath?: string;
};

type AimdDocument = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  dirty: boolean;
  isDraft?: boolean;
  format: "aimd" | "markdown";
};

type RenderResult = {
  html: string;
};

type SessionSnapshot = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  dirty: boolean;
  isDraft: boolean;
  format: "aimd" | "markdown";
  mode: Mode;
};

type AddedAsset = {
  asset: AimdAsset;
  uri: string;
  markdown: string;
};

type OutlineNode = {
  id: string;
  text: string;
  level: number;
};

type Mode = "read" | "edit" | "source";

const state: {
  doc: AimdDocument | null;
  mode: Mode;
  renderTimer: number | null;
  flushTimer: number | null;
  statusTimer: number | null;
  outline: OutlineNode[];
  htmlVersion: number;
  paintedVersion: Record<Mode, number>;
  recentPaths: string[];
} = {
  doc: null,
  mode: "read",
  renderTimer: null,
  flushTimer: null,
  statusTimer: null,
  outline: [],
  // Bumped every time state.doc.html changes (applyHTML, flushInline-with-md-change).
  // paintedVersion tracks which version each pane's DOM currently shows; setMode
  // only re-paints a pane when its painted version trails htmlVersion. Without
  // this, mode hops on a long doc rebuild innerHTML for the destination pane
  // every time and feel sluggish.
  htmlVersion: 0,
  paintedVersion: { read: -1, edit: -1, source: -1 },
  recentPaths: [],
};

// Tracks whether the inline editor's DOM has been mutated by user input since
// the last flush / paint. flushInline skips its (expensive) turndown call when
// false — this is what keeps mode hops snappy on long documents.
let inlineDirty = false;
let isBootstrappingSession = false;

const ICONS = {
  document: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z"/><path d="M9 1.5V5.5h4"/></svg>`,
  image: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 3 3 2-2 2.5 2.5"/></svg>`,
  folder: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.2v8a1.3 1.3 0 0 0 1.3 1.3h9.4a1.3 1.3 0 0 0 1.3-1.3V5.8a1.3 1.3 0 0 0-1.3-1.3H8L6.5 3H3.3A1.3 1.3 0 0 0 2 4.2Z"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  read: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5V4a1 1 0 0 1 1.2-1l4.3 1 4.3-1A1 1 0 0 1 13 4v8.5"/><path d="M7.5 4v9"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 2.5 13.5 4.8 5.4 12.9l-3 .7.7-3z"/><path d="m10.2 3.5 2.3 2.3"/></svg>`,
  source: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4-3 4 3 4M10.5 4l3 4-3 4"/></svg>`,
  save: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L11 3H4a1 1 0 0 0-1 .5z"/><path d="M5 3.5V7h6V3.5M5 13.5V10h6v3.5"/></svg>`,
  close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m4 4 8 8M12 4 4 12"/></svg>`,
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
  link: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.4 9.4 7M6.7 5.6 8.2 4a2.6 2.6 0 0 1 3.7 3.7l-1.4 1.5M9.5 10.4 8 12a2.6 2.6 0 0 1-3.7-3.7L5.6 7"/></svg>`,
};

/* ============================================================
   Turndown configuration
   ============================================================ */

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndown.use(gfm);

turndown.addRule("aimdImage", {
  filter: "img",
  replacement(_content, node) {
    const img = node as Element;
    const alt = img.getAttribute("alt") || "";
    const cid = img.getAttribute("data-asset-id");
    const src = cid ? `asset://${cid}` : (img.getAttribute("src") || "");
    return `![${alt}](${src})`;
  },
});

turndown.addRule("strikethrough", {
  filter: ["s", "del", "strike"] as any,
  replacement: (content) => `~~${content}~~`,
});

/* ============================================================
   DOM bootstrap
   ============================================================ */

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="app-frame">
    <div class="panel" id="panel" data-shell="launch">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-hr-resizer" id="sidebar-hr-resizer" aria-label="调整侧边栏宽度"></div>
        <header class="sidebar-head">
          <div class="brand">
            <span class="brand-mark">A</span>
            <span class="brand-name">AIMD</span>
          </div>
        </header>

        <nav class="sidebar-body" id="sidebar-body">
          <section class="nav-section nav-section--doc" id="doc-section">
            <div class="section-label">文档</div>
            <div class="section-content">
              <div id="doc-card" class="doc-card" data-state="empty">
                <span class="doc-card-icon">${ICONS.document}</span>
                <div class="doc-card-text">
                  <div class="doc-card-title">未打开文档</div>
                  <div class="doc-card-meta">点击下方打开 .aimd</div>
                </div>
              </div>
            </div>
          </section>

          <button class="sb-resizer" id="resizer-1" hidden
                  data-above="#doc-section" data-below="#outline-section"
                  aria-label="调整文档与大纲高度"></button>

          <section class="nav-section" id="outline-section" hidden>
            <div class="section-label">
              <span>大纲</span>
              <span class="section-count" id="outline-count">0</span>
            </div>
            <div class="section-content">
              <div id="outline-list" class="outline-list"></div>
            </div>
          </section>

          <button class="sb-resizer" id="resizer-2" hidden
                  data-above="#outline-section" data-below="#asset-section"
                  aria-label="调整大纲与资源高度"></button>

          <section class="nav-section" id="asset-section" hidden>
            <div class="section-label">
              <span>资源</span>
              <span class="section-count" id="asset-count">0</span>
            </div>
            <div class="section-content">
              <div id="asset-list" class="asset-list"></div>
            </div>
          </section>
        </nav>

        <footer class="sidebar-foot" id="sidebar-foot">
          <button id="sidebar-save" class="secondary-btn" type="button" hidden>
            <span class="secondary-btn-icon">${ICONS.save}</span>
            <span>保存</span>
          </button>
          <button id="sidebar-new" class="secondary-btn" type="button">
            <span class="secondary-btn-icon">${ICONS.plus}</span>
            <span>新建</span>
          </button>
          <button id="sidebar-open" class="secondary-btn" type="button">
            <span class="secondary-btn-icon">${ICONS.folder}</span>
            <span>打开</span>
          </button>
        </footer>
      </aside>

      <main class="workspace">
        <header class="workspace-head">
          <div class="doc-meta">
            <h1 id="doc-title" class="doc-title">AIMD Desktop</h1>
            <div id="doc-path" class="doc-path">正文、图片和元信息始终在一起</div>
          </div>

          <div class="starter-actions" id="starter-actions">
            <button id="head-new" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.plus}</span>
              <span>新建</span>
            </button>
            <button id="head-open" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.folder}</span>
              <span>打开</span>
            </button>
            <button id="head-import" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.document}</span>
              <span>打开 Markdown</span>
            </button>
          </div>

          <div class="head-actions" id="doc-actions" hidden>
            <div class="mode-switch" role="tablist">
              <button id="mode-read" class="mode-btn" role="tab" aria-selected="true" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.read}</span>
                <span>阅读</span>
              </button>
              <button id="mode-edit" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.edit}</span>
                <span>编辑</span>
              </button>
              <button id="mode-source" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.source}</span>
                <span>源码</span>
              </button>
            </div>

            <div class="quick-actions">
              <button id="save" class="primary-btn" type="button" disabled>
                <span class="primary-btn-icon">${ICONS.save}</span>
                <span id="save-label">保存</span>
              </button>
              <button id="save-as" class="secondary-btn" type="button" disabled>
                <span class="secondary-btn-icon">${ICONS.folder}</span>
                <span>另存为</span>
              </button>
              <button id="close" class="secondary-btn" type="button" disabled>
                <span class="secondary-btn-icon">${ICONS.close}</span>
                <span>关闭文档</span>
              </button>
            </div>
          </div>
        </header>

        <div class="format-toolbar" id="format-toolbar" hidden>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="bold" type="button" title="粗体 (⌘B)">${ICONS.bold}</button>
            <button class="ft-btn" data-cmd="italic" type="button" title="斜体 (⌘I)">${ICONS.italic}</button>
            <button class="ft-btn" data-cmd="strike" type="button" title="删除线">${ICONS.strike}</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="h1" type="button" title="标题 1">${ICONS.h1}</button>
            <button class="ft-btn" data-cmd="h2" type="button" title="标题 2">${ICONS.h2}</button>
            <button class="ft-btn" data-cmd="h3" type="button" title="标题 3">${ICONS.h3}</button>
            <button class="ft-btn ft-btn--text" data-cmd="paragraph" type="button" title="正文">正文</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="ul" type="button" title="无序列表">${ICONS.ul}</button>
            <button class="ft-btn" data-cmd="ol" type="button" title="有序列表">${ICONS.ol}</button>
            <button class="ft-btn" data-cmd="quote" type="button" title="引用">${ICONS.quote}</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="code" type="button" title="行内代码">${ICONS.code}</button>
            <button class="ft-btn" data-cmd="link" type="button" title="链接">${ICONS.link}</button>
            <button class="ft-btn" data-cmd="image" type="button" title="插入图片">${ICONS.image}</button>
          </div>
        </div>

        <!-- BUG-013: 自定义链接输入浮层，替代 WKWebView 不支持的 window.prompt -->
        <div id="link-popover" class="link-popover" hidden>
          <label class="link-popover-label" for="link-popover-input" id="link-popover-title">链接地址</label>
          <input id="link-popover-input" class="link-popover-input" type="url" placeholder="https://" />
          <div class="link-popover-actions">
            <button id="link-popover-unlink" class="secondary-btn sm danger-btn" type="button" hidden>删除链接</button>
            <button id="link-popover-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="link-popover-confirm" class="primary-btn sm" type="button">确定</button>
          </div>
        </div>

        <section class="workspace-body">
          <article id="empty" class="empty-state">
            <div class="launch-hero">
              <div class="empty-mark">${ICONS.document}</div>
              <div class="launch-eyebrow">AIMD Desktop</div>
              <h2>把图文文档装进一个文件</h2>
              <p>正文、图片和元信息始终在一起。发给别人，不丢图；换个目录，也能完整打开。</p>
              <div class="launch-actions">
                <button id="empty-new" class="primary-btn lg" type="button">
                  <span class="primary-btn-icon">${ICONS.plus}</span>
                  <span>新建文档</span>
                </button>
                <button id="empty-open" class="secondary-btn lg" type="button">
                  <span class="secondary-btn-icon">${ICONS.folder}</span>
                  <span>打开文件</span>
                </button>
                <button id="empty-import" class="secondary-btn lg" type="button">
                  <span class="secondary-btn-icon">${ICONS.document}</span>
                  <span>打开 Markdown</span>
                </button>
              </div>
              <div class="empty-hint">⌘N 新建 · ⌘O 打开 · ⇧⌘S 另存为 · 拖入 .aimd 可直接打开</div>
            </div>

            <section class="recent-section" id="recent-section" hidden>
              <div class="recent-head">
                <div class="recent-title">最近打开</div>
                <button id="clear-recent" class="text-btn" type="button">清空</button>
              </div>
              <div id="recent-list" class="recent-list"></div>
            </section>
          </article>

          <article id="reader" class="reader aimd" hidden></article>

          <article id="inline-editor"
                   class="reader aimd inline-editor"
                   contenteditable="true"
                   spellcheck="false"
                   hidden></article>

          <div id="editor-wrap" class="editor-split" hidden>
            <div class="editor-pane">
              <div class="pane-tag">Markdown</div>
              <textarea id="markdown" spellcheck="false"></textarea>
            </div>
            <div class="preview-pane">
              <div class="pane-tag">预览</div>
              <div id="preview" class="reader aimd preview"></div>
            </div>
          </div>
        </section>

        <footer class="workspace-foot">
          <span class="status-pill" id="status-pill" data-tone="idle">
            <span class="status-dot"></span>
            <span id="status">就绪</span>
          </span>
        </footer>
      </main>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const titleEl = $("#doc-title");
const pathEl = $("#doc-path");
const statusEl = $("#status");
const statusPillEl = $("#status-pill");
const panelEl = $("#panel");
const emptyEl = $("#empty");
const readerEl = $("#reader");
const inlineEditorEl = $("#inline-editor");
const editorWrapEl = $("#editor-wrap");
const markdownEl = $("#markdown") as HTMLTextAreaElement;
const previewEl = $("#preview");
const formatToolbarEl = $("#format-toolbar");
const docCardEl = $("#doc-card");
const outlineSectionEl = $("#outline-section");
const outlineListEl = $("#outline-list");
const outlineCountEl = $("#outline-count");
const assetSectionEl = $("#asset-section");
const assetListEl = $("#asset-list");
const assetCountEl = $("#asset-count");
const resizer1El = $("#resizer-1");
const resizer2El = $("#resizer-2");
const sidebarHrResizerEl = $("#sidebar-hr-resizer");
const starterActionsEl = $("#starter-actions");
const docActionsEl = $("#doc-actions");
const recentSectionEl = $("#recent-section");
const recentListEl = $("#recent-list");
const sidebarFootEl = $("#sidebar-foot");
const sidebarNewEl = $("#sidebar-new") as HTMLButtonElement;
const sidebarSaveEl = $("#sidebar-save") as HTMLButtonElement;
const saveEl = $("#save") as HTMLButtonElement;
const saveLabelEl = $("#save-label");
const saveAsEl = $("#save-as") as HTMLButtonElement;
const closeEl = $("#close") as HTMLButtonElement;
const modeReadEl = $("#mode-read") as HTMLButtonElement;
const modeEditEl = $("#mode-edit") as HTMLButtonElement;
const modeSourceEl = $("#mode-source") as HTMLButtonElement;
const linkPopoverEl = $("#link-popover");
const linkPopoverInputEl = $("#link-popover-input") as HTMLInputElement;
const linkPopoverTitleEl = $("#link-popover-title");
const linkPopoverConfirmEl = $("#link-popover-confirm") as HTMLButtonElement;
const linkPopoverCancelEl = $("#link-popover-cancel") as HTMLButtonElement;
const linkPopoverUnlinkEl = $("#link-popover-unlink") as HTMLButtonElement;

const STORAGE_RECENTS = "aimd.desktop.recents";
const STORAGE_LAST = "aimd.desktop.last";
const STORAGE_SESSION = "aimd.desktop.session";
const MAX_RECENTS = 8;
const ASSET_URI_PREFIX = "asset://";

function normalizeDocument(doc: AimdDocument): AimdDocument {
  return {
    ...doc,
    assets: normalizeAssets(doc.assets),
  };
}

function normalizeAssets(assets: AimdAsset[]): AimdAsset[] {
  return assets.map((asset) => {
    const localPath = resolveLocalAssetPath(asset);
    const url = localPath ? filePathToAssetURL(localPath) : sanitizeDisplayURL(asset.url);
    return {
      ...asset,
      localPath: localPath || undefined,
      url,
    };
  });
}

function resolveLocalAssetPath(asset: Pick<AimdAsset, "localPath" | "url">): string {
  if (typeof asset.localPath === "string" && asset.localPath.length > 0) return asset.localPath;
  if (typeof asset.url === "string" && looksLikeLocalPath(asset.url)) return asset.url;
  return "";
}

function sanitizeDisplayURL(value?: string): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.startsWith("data:") ? "" : value;
}

function looksLikeLocalPath(value: string): boolean {
  if (!value || value.startsWith("data:")) return false;
  if (value.startsWith("/") || value.startsWith("\\\\")) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
}

function filePathToAssetURL(filePath: string): string {
  try {
    return convertFileSrc(filePath);
  } catch {
    return filePath;
  }
}

function assetIDFromURL(value: string): string {
  if (!value.startsWith(ASSET_URI_PREFIX)) return "";
  const rest = value.slice(ASSET_URI_PREFIX.length);
  const end = rest.search(/[?#]/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function rewriteAssetURLs(html: string, assets: AimdAsset[]): string {
  if (!assets.length || !html.includes(ASSET_URI_PREFIX)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const byID = new Map(assets.map((asset) => [asset.id, asset]));
  tpl.content.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const source = img.getAttribute("src") || "";
    const id = img.getAttribute("data-asset-id") || assetIDFromURL(source);
    if (!id) return;
    const asset = byID.get(id);
    if (!asset?.url) return;
    img.dataset.assetId = id;
    img.src = asset.url;
  });
  return tpl.innerHTML;
}

/* ============================================================
   Wiring
   ============================================================ */

$("#head-new").addEventListener("click", () => { void newDocument(); });
$("#head-open").addEventListener("click", () => { void chooseAndOpen(); });
$("#head-import").addEventListener("click", () => { void chooseAndImportMarkdown(); });
$("body").addEventListener("dragover", onWindowDragOver);
$("body").addEventListener("drop", onWindowDrop);
$("body").addEventListener("dragleave", onWindowDragLeave);
$("#empty-open").addEventListener("click", chooseAndOpen);
$("#empty-new").addEventListener("click", () => { void newDocument(); });
$("#empty-import").addEventListener("click", () => { void chooseAndImportMarkdown(); });
$("#sidebar-new").addEventListener("click", () => { void newDocument(); });
$("#sidebar-save").addEventListener("click", () => { void saveDocument(); });
$("#sidebar-open").addEventListener("click", chooseAndOpen);
$("#clear-recent").addEventListener("click", clearRecentDocuments);
modeReadEl.addEventListener("click", () => setMode("read"));
modeEditEl.addEventListener("click", () => setMode("edit"));
modeSourceEl.addEventListener("click", () => setMode("source"));
saveEl.addEventListener("click", saveDocument);
saveAsEl.addEventListener("click", saveDocumentAs);
closeEl.addEventListener("click", () => { void closeDocument(); });

markdownEl.addEventListener("input", () => {
  if (!state.doc) return;
  state.doc.markdown = markdownEl.value;
  state.doc.dirty = true;
  updateChrome();
  scheduleRender();
});

markdownEl.addEventListener("paste", (event) => {
  if (!event.clipboardData || !state.doc) return;
  const imageFiles = collectClipboardImages(event.clipboardData);
  if (imageFiles.length === 0) return;
  event.preventDefault();
  void pasteImageFiles(imageFiles, "source");
});

inlineEditorEl.addEventListener("input", onInlineInput);
inlineEditorEl.addEventListener("paste", onInlinePaste);
inlineEditorEl.addEventListener("keydown", onInlineKeydown);

bindFormatToolbar();
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

  if (mod && key === "n") {
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
  if (state.mode === "edit" && inlineDirty) {
    flushInline();
  }
  persistSessionSnapshot();
});

window.addEventListener("DOMContentLoaded", async () => {
  state.recentPaths = loadRecentPaths();
  isBootstrappingSession = true;
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
    isBootstrappingSession = false;
    if (!state.doc) updateChrome();
  }
});

/* ============================================================
   Document lifecycle
   ============================================================ */

async function chooseAndOpen() {
  const path = await invoke<string | null>("choose_aimd_file");
  if (path) await openDocument(path);
}

type MarkdownDraft = { markdown: string; title: string; html: string };

async function openMarkdownDocument(markdownPath: string, opts?: { skipConfirm?: boolean }) {
  if (!opts?.skipConfirm && !await ensureCanDiscardChanges("打开另一个文档")) return;
  setStatus("正在打开", "loading");
  try {
    const draft = await invoke<MarkdownDraft>("convert_md_to_draft", { markdownPath });
    const stem = fileStem(markdownPath) || "未命名文档";
    const doc: AimdDocument = {
      path: markdownPath,
      title: draft.title || stem,
      markdown: draft.markdown,
      html: draft.html,
      assets: [],
      dirty: false,
      isDraft: false,
      format: "markdown",
    };
    applyDocument(doc, "read");
    rememberOpenedPath(markdownPath);
    setStatus("已打开（Markdown）", "success");
  } catch (err) {
    console.error(err);
    setStatus("打开失败", "warn");
  }
}

async function routeOpenedPath(path: string, opts?: { skipConfirm?: boolean }) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".aimd")) {
    await openDocument(path, { skipConfirm: opts?.skipConfirm });
  } else if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    await openMarkdownDocument(path, opts);
  } else {
    setStatus("不支持的文件类型", "warn");
  }
}

async function chooseAndImportMarkdown() {
  const markdownPath = await invoke<string | null>("choose_markdown_file");
  if (!markdownPath) return;
  await openMarkdownDocument(markdownPath);
}

async function newDocument() {
  if (!await ensureCanDiscardChanges("新建文档")) return;
  const markdown = "# 未命名文档\n\n";
  const doc: AimdDocument = {
    path: "",
    title: "未命名文档",
    markdown,
    html: "",
    assets: [],
    dirty: true,
    isDraft: true,
    format: "aimd",
  };
  state.doc = doc;
  markdownEl.value = markdown;
  try {
    const out = await invoke<RenderResult>("render_markdown_standalone", { markdown });
    applyHTML(out.html);
  } catch {
    applyHTML("<h1>未命名文档</h1>");
  }
  setMode("edit");
  updateChrome();
  setStatus("已创建草稿，先保存为 .aimd 文件", "info");
  // BUG-008: 显式将焦点和光标设到编辑区第一个可编辑节点开头
  inlineEditorEl.focus();
  const firstBlock = inlineEditorEl.firstElementChild;
  if (firstBlock) {
    const r = document.createRange();
    r.setStart(firstBlock, 0);
    r.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
}

async function openDocument(path: string, options: { skipConfirm?: boolean } = {}) {
  if (!options.skipConfirm && !await ensureCanDiscardChanges("打开另一个文档")) return;
  setStatus("正在打开", "loading");
  try {
    const doc = await invoke<AimdDocument>("open_aimd", { path });
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, "read");
    rememberOpenedPath(doc.path);
    setStatus("已打开", "success");
    void triggerOptimizeOnOpen(doc.path);
  } catch (err) {
    console.error(err);
    setStatus("打开失败", "warn");
  }
}

async function triggerOptimizeOnOpen(docPath: string) {
  if ((window as any).__aimd_e2e_disable_auto_optimize) return;
  try {
    setStatus("正在检查图片优化空间", "loading");
    const startedDocPath = docPath;
    const result = await optimizeDocumentAssets(docPath, startedDocPath);
    if (result.optimized === 0) {
      setStatus("就绪", "idle");
      return;
    }
    if (!state.doc || state.doc.path !== docPath) return;
    setStatus(`已自动压缩 ${result.optimized} 张图片，节省 ${formatBytes(result.savedBytes)}`, "success");
  } catch (err) {
    console.error("optimizeDocumentAssets:", err);
    setStatus("就绪", "idle");
  }
}

type AssetEntry = { name: string; size: number; mime: string };

async function optimizeDocumentAssets(
  path: string,
  guardPath?: string,
): Promise<{ optimized: number; savedBytes: number }> {
  const skipTypes = ["image/gif", "image/svg+xml", "image/webp"];
  const entries = await invoke<AssetEntry[]>("list_aimd_assets", { path });
  let optimized = 0;
  let savedBytes = 0;

  for (const entry of entries) {
    if (!entry.mime.startsWith("image/")) continue;
    if (skipTypes.includes(entry.mime)) continue;
    if (entry.size < IMG_COMPRESS_THRESHOLD) continue;

    if (guardPath !== undefined && state.doc?.path !== guardPath) break;

    try {
      const rawBytes = await invoke<number[]>("read_aimd_asset", { path, assetName: entry.name });
      const rawBuf = new Uint8Array(rawBytes).buffer;
      const baseName = entry.name.split("/").pop() ?? entry.name;
      const compressed = await compressImageBytes(rawBuf, entry.mime, baseName);
      if (compressed.data.byteLength >= rawBuf.byteLength) continue;

      if (guardPath !== undefined && state.doc?.path !== guardPath) break;

      await invoke("replace_aimd_asset", {
        path,
        oldName: entry.name,
        newName: entry.name,
        bytes: Array.from(compressed.data),
      });

      savedBytes += rawBuf.byteLength - compressed.data.byteLength;
      optimized += 1;
    } catch (err) {
      console.error(`optimizeDocumentAssets skip ${entry.name}:`, err);
    }
  }

  return { optimized, savedBytes };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function closeDocument() {
  if (!await ensureCanDiscardChanges("关闭当前文档")) return;
  state.doc = null;
  state.outline = [];
  inlineDirty = false;
  markdownEl.value = "";
  inlineEditorEl.innerHTML = "";
  previewEl.innerHTML = "";
  readerEl.innerHTML = "";
  clearSessionSnapshot();
  clearLastSessionPath();
  setMode("read");
  updateChrome();
  setStatus("已关闭文档", "info");
}

async function saveDocument() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  if (state.doc.isDraft || !state.doc.path) {
    await saveDocumentAs();
    return;
  }
  if (!state.doc.dirty) return;

  if (state.doc.format === "markdown") {
    if (state.doc.assets.length > 0) {
      await upgradeMarkdownToAimd();
      return;
    }
    setStatus("正在保存", "loading");
    saveEl.disabled = true;
    try {
      await invoke("save_markdown", { path: state.doc.path, markdown: state.doc.markdown });
      state.doc.dirty = false;
      updateChrome();
      rememberOpenedPath(state.doc.path);
      setStatus("已保存（Markdown）", "success");
    } catch (err) {
      console.error(err);
      setStatus("保存失败", "warn");
    } finally {
      saveEl.disabled = false;
    }
    return;
  }

  setStatus("正在保存", "loading");
  saveEl.disabled = true;
  try {
    const doc = await invoke<AimdDocument>("save_aimd", {
      path: state.doc.path,
      markdown: state.doc.markdown,
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
    rememberOpenedPath(doc.path);
    setStatus("已保存", "success");
  } catch (err) {
    console.error(err);
    setStatus("保存失败", "warn");
  } finally {
    saveEl.disabled = false;
  }
}

async function saveDocumentAs() {
  if (!state.doc) return;
  if (state.mode === "edit") flushInline();
  const isMarkdownDoc = state.doc.format === "markdown" && Boolean(state.doc.path);
  const wasDraft = Boolean(state.doc.isDraft || !state.doc.path);
  const suggestedName = isMarkdownDoc
    ? `${fileStem(state.doc.path)}.aimd`
    : suggestAimdFilename(state.doc.path || `${displayDocTitle(state.doc)}.aimd`);
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) return;
  setStatus(wasDraft ? "正在创建文件" : "正在另存为", "loading");
  saveAsEl.disabled = true;
  try {
    const doc = await invoke<AimdDocument>("save_aimd_as", {
      path: state.doc.path || null,
      savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    if (isMarkdownDoc) {
      applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus("已转换为 .aimd", "success");
    } else {
      applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
      rememberOpenedPath(doc.path);
      setStatus(wasDraft ? "文件已创建" : "已另存为", "success");
    }
  } catch (err) {
    console.error(err);
    setStatus("另存为失败", "warn");
  } finally {
    saveAsEl.disabled = false;
  }
}

async function upgradeMarkdownToAimd(): Promise<boolean> {
  if (!state.doc || state.doc.format !== "markdown") return false;
  let confirmed = false;
  try {
    confirmed = await invoke<boolean>("confirm_upgrade_to_aimd", {
      message: "文档包含图片资源，需要升级为 .aimd 格式才能保存。是否现在升级？",
    });
  } catch {
    confirmed = window.confirm("文档包含图片资源，需要升级为 .aimd 格式才能保存。是否现在升级？");
  }
  if (!confirmed) {
    setStatus("升级取消", "info");
    return false;
  }
  const stem = fileStem(state.doc.path) || displayDocTitle(state.doc);
  const suggestedName = `${stem}.aimd`;
  const savePath = await invoke<string | null>("choose_save_aimd_file", { suggestedName });
  if (!savePath) {
    setStatus("升级取消", "info");
    return false;
  }
  try {
    const doc = await invoke<AimdDocument>("create_aimd", {
      path: savePath,
      markdown: state.doc.markdown,
      title: displayDocTitle(state.doc),
    });
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, state.mode);
    rememberOpenedPath(savePath);
    setStatus("已升级为 .aimd", "success");
    return true;
  } catch (err) {
    console.error(err);
    setStatus("升级失败", "warn");
    return false;
  }
}

function inferFormat(doc: AimdDocument): "aimd" | "markdown" {
  if (doc.format) return doc.format;
  if (!doc.path) return "aimd";
  const lower = doc.path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) return "markdown";
  return "aimd";
}

function applyDocument(doc: AimdDocument, mode: Mode) {
  const withFormat: AimdDocument = { ...doc, format: inferFormat(doc) };
  const normalized = normalizeDocument(withFormat);
  state.doc = normalized;
  markdownEl.value = normalized.markdown;
  applyHTML(normalized.html);
  setMode(mode);
  updateChrome();
}

async function insertImage() {
  if (!state.doc) return;
  if (state.doc.format === "markdown") {
    const upgraded = await upgradeMarkdownToAimd();
    if (!upgraded) return;
  }
  if (state.doc.isDraft || !state.doc.path) {
    await saveDocumentAs();
    if (!state.doc?.path) return;
  }
  const imagePath = await invoke<string | null>("choose_image_file");
  if (!imagePath) return;
  setStatus("正在加入图片", "loading");
  try {
    const rawBytes = await invoke<number[]>("read_image_bytes", { imagePath });
    const rawBuf = new Uint8Array(rawBytes).buffer;
    const ext = imagePath.split(".").pop()?.toLowerCase() ?? "png";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    };
    const mime = mimeMap[ext] ?? "image/png";
    const baseName = imagePath.split(/[\\/]/).pop() ?? `image.${ext}`;
    const compressed = await compressImageBytes(rawBuf, mime, baseName);
    const added = normalizeAddedAsset(await invoke<AddedAsset>("add_image_bytes", {
      path: state.doc.path,
      filename: compressed.filename,
      data: Array.from(compressed.data),
    }));
    if (state.mode === "edit") {
      insertImageInline(added);
    } else if (state.mode === "source") {
      insertAtCursor(`${added.markdown}\n`);
    } else {
      // In read mode, just append to markdown source for next save.
      state.doc.markdown += `\n${added.markdown}\n`;
    }
    state.doc.assets = [...state.doc.assets, added.asset];
    state.doc.dirty = true;
    updateChrome();
    if (state.mode === "source") scheduleRender();
    setStatus("图片已就绪，保存后写入正文", "info");
  } catch (err) {
    console.error(err);
    setStatus("插入图片失败", "warn");
  }
}

function insertImageInline(added: AddedAsset) {
  inlineEditorEl.focus();
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    inlineEditorEl.appendChild(buildAssetImage(added));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const figure = buildAssetImage(added);
  range.insertNode(figure);
  // Move caret after the inserted image
  range.setStartAfter(figure);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  inlineEditorEl.dispatchEvent(new Event("input"));
}

function buildAssetImage(added: AddedAsset): HTMLImageElement {
  const img = document.createElement("img");
  img.src = added.asset.url || "";
  img.alt = added.asset.id;
  img.dataset.assetId = added.asset.id;
  return img;
}

function normalizeAddedAsset(added: AddedAsset): AddedAsset {
  return {
    ...added,
    asset: normalizeAssets([added.asset])[0],
  };
}

function insertAtCursor(text: string) {
  const start = markdownEl.selectionStart;
  const end = markdownEl.selectionEnd;
  const before = markdownEl.value.slice(0, start);
  const after = markdownEl.value.slice(end);
  markdownEl.value = before + text + after;
  markdownEl.selectionStart = markdownEl.selectionEnd = start + text.length;
  markdownEl.dispatchEvent(new Event("input"));
  markdownEl.focus();
}

/* ============================================================
   Mode switching
   ============================================================ */

function setMode(mode: Mode) {
  // Flush from the mode we are leaving.
  if (state.mode === "edit" && mode !== "edit") flushInline();

  state.mode = mode;
  const hasDoc = Boolean(state.doc);

  emptyEl.hidden = hasDoc;
  readerEl.hidden = !hasDoc || mode !== "read";
  inlineEditorEl.hidden = !hasDoc || mode !== "edit";
  editorWrapEl.hidden = !hasDoc || mode !== "source";
  formatToolbarEl.hidden = !hasDoc || mode !== "edit";

  // Bring the destination pane in sync with state.doc.html, but only when
  // its painted version trails the current html version. flushInline keeps
  // state.doc.html updated while editing, and applyHTML keeps reader/preview
  // in sync on open / save / source-mode render — so most mode hops have
  // nothing to repaint and stay snappy on long documents.
  if (hasDoc) paintPaneIfStale(mode);

  for (const [el, m] of [[modeReadEl, "read"], [modeEditEl, "edit"], [modeSourceEl, "source"]] as const) {
    el.classList.toggle("active", mode === m);
    el.setAttribute("aria-selected", String(mode === m));
  }
  updateChrome();
}

/* ============================================================
   Inline editor (WYSIWYG)
   ============================================================ */

function lightNormalize(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("h1[style], h2[style], h3[style], h4[style], h5[style], h6[style], p[style]").forEach((el) => el.removeAttribute("style"));
}

function onInlineInput() {
  if (!state.doc) return;
  inlineDirty = true;
  state.doc.dirty = true;
  lightNormalize(inlineEditorEl);
  updateChrome();
  // Defer expensive HTML→MD conversion (full normalize + turndown) until idle.
  if (state.flushTimer) window.clearTimeout(state.flushTimer);
  state.flushTimer = window.setTimeout(() => {
    flushInline();
  }, 700);
}

function onInlinePaste(event: ClipboardEvent) {
  if (!event.clipboardData) return;

  const imageFiles = collectClipboardImages(event.clipboardData);
  if (imageFiles.length > 0) {
    event.preventDefault();
    void pasteImageFiles(imageFiles, "edit");
    return;
  }

  // Prefer plain text to avoid pasting external styles.
  const html = event.clipboardData.getData("text/html");
  const text = event.clipboardData.getData("text/plain");
  if (!html && !text) return;
  event.preventDefault();
  const fragment = html ? sanitizePastedHTML(html) : document.createTextNode(text);
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    inlineEditorEl.appendChild(fragment);
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
  }
  inlineEditorEl.dispatchEvent(new Event("input"));
}

const IMG_COMPRESS_MAX_SIDE = 2560;
const IMG_COMPRESS_THRESHOLD = 300 * 1024;
const IMG_COMPRESS_QUALITY = 0.82;

async function compressImageBytes(
  buf: ArrayBuffer,
  originalMime: string,
  originalName: string,
): Promise<{ data: Uint8Array; filename: string; mime: string }> {
  const skipTypes = ["image/gif", "image/svg+xml", "image/webp"];
  if (skipTypes.includes(originalMime) || buf.byteLength < IMG_COMPRESS_THRESHOLD) {
    return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
  }

  const blob = new Blob([buf], { type: originalMime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) {
      return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
    }

    let { naturalWidth: w, naturalHeight: h } = img;
    if (w > IMG_COMPRESS_MAX_SIDE || h > IMG_COMPRESS_MAX_SIDE) {
      if (w >= h) {
        h = Math.round((h / w) * IMG_COMPRESS_MAX_SIDE);
        w = IMG_COMPRESS_MAX_SIDE;
      } else {
        w = Math.round((w / h) * IMG_COMPRESS_MAX_SIDE);
        h = IMG_COMPRESS_MAX_SIDE;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);

    const outMime = "image/jpeg";
    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outMime, IMG_COMPRESS_QUALITY);
    });
    if (!compressed || compressed.size >= buf.byteLength) {
      return { data: new Uint8Array(buf), filename: originalName, mime: originalMime };
    }

    const outName = originalName.replace(/\.[^.]+$/, ".jpg");
    return { data: new Uint8Array(await compressed.arrayBuffer()), filename: outName, mime: outMime };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function collectClipboardImages(data: DataTransfer): File[] {
  const out: File[] = [];
  const files = data.files;
  if (files && files.length) {
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f && f.type.startsWith("image/")) out.push(f);
    }
  }
  // Some platforms expose images only via items[] (e.g. Finder copy of an image),
  // so fall back to that channel when the FileList came up empty.
  if (out.length === 0 && data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const it = data.items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

async function pasteImageFiles(files: File[], target: "edit" | "source") {
  if (!state.doc) return;
  if (state.doc.format === "markdown") {
    const upgraded = await upgradeMarkdownToAimd();
    if (!upgraded) return;
  }
  if (state.doc.isDraft || !state.doc.path) {
    const confirmed = window.confirm(
      "图片需要先保存到文件系统，是否现在创建 .aimd 文件？\n取消后可继续编辑，图片将在保存后再粘贴。",
    );
    if (!confirmed) return;
    await saveDocumentAs();
    if (!state.doc?.path) return;
  }
  setStatus("正在加入粘贴的图片", "loading");
  try {
    for (const file of files) {
      const rawBuf = await file.arrayBuffer();
      const baseName = (file.name && file.name.length > 0)
        ? file.name
        : `pasted-${Date.now()}.${guessImageExt(file.type)}`;
      const compressed = await compressImageBytes(rawBuf, file.type, baseName);
      const added = normalizeAddedAsset(await invoke<AddedAsset>("add_image_bytes", {
        path: state.doc.path,
        filename: compressed.filename,
        data: Array.from(compressed.data),
      }));
      if (target === "edit") {
        insertImageInline(added);
      } else {
        insertAtCursor(`${added.markdown}\n`);
      }
      state.doc.assets = [...state.doc.assets, added.asset];
      state.doc.dirty = true;
    }
    updateChrome();
    if (target === "source") scheduleRender();
    setStatus("已粘贴图片", "success");
  } catch (err) {
    console.error(err);
    setStatus("粘贴图片失败", "warn");
  }
}

function guessImageExt(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/gif":  return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}

function sanitizePastedHTML(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  // Strip <style>, <script>, inline styles, classes, data-* (except our asset id).
  tpl.content.querySelectorAll("style, script, link, meta, iframe, object, embed, frame, frameset").forEach((n) => n.remove());
  tpl.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") || "").trim().toLowerCase();
    if (href.startsWith("javascript:")) a.removeAttribute("href");
  });
  tpl.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.removeAttribute("style");
    el.removeAttribute("class");
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      if (attr.name.startsWith("data-") && attr.name !== "data-asset-id") {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.content;
}

function onInlineKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const block = closestBlock(range.startContainer);
      if (block && /^H[1-6]$/.test(block.tagName)) {
        event.preventDefault();
        // Extract content from cursor to end of heading into the new paragraph.
        const afterRange = range.cloneRange();
        afterRange.setEnd(block, block.childNodes.length);
        const fragment = afterRange.extractContents();
        const p = document.createElement("p");
        if (fragment.textContent && fragment.textContent.length > 0) {
          p.appendChild(fragment);
        } else {
          p.appendChild(document.createElement("br"));
        }
        block.after(p);
        const r = document.createRange();
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        inlineEditorEl.dispatchEvent(new Event("input"));
      }
    }
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === "b") { event.preventDefault(); runFormatCommand("bold"); }
    if (key === "i") { event.preventDefault(); runFormatCommand("italic"); }
    if (key === "k") { event.preventDefault(); runFormatCommand("link"); }
  }
}

inlineEditorEl.addEventListener("focus", () => {
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {}
}, { once: true });

function normalizeInlineDOM() {
  inlineEditorEl.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,p,li,blockquote"
  ).forEach((block) => {
    block.removeAttribute("style");
    block.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
  });
}

function flushInline() {
  if (!state.doc) return;
  if (state.mode !== "edit") return;
  if (state.flushTimer) {
    window.clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  // Mode hops without user edits in between (e.g., edit → read → edit) used
  // to run turndown on every transition; on long docs that was the dominant
  // chunk of the perceived "click takes a beat" lag. Skip it when nothing
  // mutated the inline editor since the last flush / paint.
  if (!inlineDirty) return;
  normalizeInlineDOM();
  inlineDirty = false;
  const html = inlineEditorEl.innerHTML;
  const md = htmlToMarkdown(html);
  if (md !== state.doc.markdown) {
    state.doc.markdown = md;
    markdownEl.value = md;
    state.outline = extractOutlineFromHTML(html);
    state.doc.html = inlineEditorEl.innerHTML;
    state.htmlVersion += 1;
    state.paintedVersion.edit = state.htmlVersion;
    renderOutline();
    persistSessionSnapshot();
  }
}

function paintPaneIfStale(mode: Mode) {
  if (!state.doc) return;
  if (state.paintedVersion[mode] === state.htmlVersion) return;
  if (mode === "edit") {
    inlineEditorEl.innerHTML = state.doc.html;
    tagAssetImages(inlineEditorEl, state.doc.assets);
    inlineDirty = false;
  } else if (mode === "read") {
    readerEl.innerHTML = state.doc.html;
    tagAssetImages(readerEl, state.doc.assets);
  } else {
    previewEl.innerHTML = state.doc.html;
    tagAssetImages(previewEl, state.doc.assets);
  }
  state.paintedVersion[mode] = state.htmlVersion;
}

function htmlToMarkdown(html: string): string {
  // Wrap in a div so turndown can iterate freely.
  const md = turndown.turndown(html.trim());
  // Normalize 3+ consecutive blank lines down to 2.
  return md.replace(/\n{3,}/g, "\n\n");
}

/* ============================================================
   Format toolbar
   ============================================================ */

function bindFormatToolbar() {
  formatToolbarEl.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
    // Prevent the button from stealing focus from the editor mid-selection.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd!;
      runFormatCommand(cmd);
    });
  });
}

function runFormatCommand(cmd: string) {
  inlineEditorEl.focus();
  switch (cmd) {
    case "bold":      document.execCommand("bold"); break;
    case "italic":    document.execCommand("italic"); break;
    case "strike":    document.execCommand("strikeThrough"); break;
    case "h1":
    case "h2":
    case "h3":
    case "paragraph": applyBlockFormat(cmd === "paragraph" ? "P" : cmd.toUpperCase()); break;
    case "ul":        document.execCommand("insertUnorderedList"); break;
    case "ol":        document.execCommand("insertOrderedList"); break;
    case "quote":     toggleBlockquote(); break;
    case "code":      wrapSelectionInTag("code"); break;
    case "link": {
      // BUG-013: window.prompt 在 WKWebView 下被静默屏蔽，改用自定义 HTML 浮层。
      // 先保存 selection，浮层关闭后恢复再执行 createLink（在 showLinkPopover 内部完成）。
      const selBeforePopover = document.getSelection();
      const savedRange = (selBeforePopover && selBeforePopover.rangeCount > 0)
        ? selBeforePopover.getRangeAt(0).cloneRange()
        : null;
      // 检测光标是否在已有 <a> 内——若是，走编辑模式
      const anchorNode = selBeforePopover ? selBeforePopover.anchorNode : null;
      const existingAnchor = closestAncestor(anchorNode, "a") as HTMLAnchorElement | null;
      void showLinkPopover(savedRange, existingAnchor);
      return; // showLinkPopover 内部自行 dispatchEvent("input")，不需要外层再 dispatch
    }
    case "image":     void insertImage(); return; // insertImage handles its own dirty
  }
  inlineEditorEl.dispatchEvent(new Event("input"));
}

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "DIV", "LI",
]);

function closestBlock(node: Node | null): HTMLElement | null {
  let el = (node && node.nodeType === Node.ELEMENT_NODE
    ? node
    : node?.parentNode ?? null) as HTMLElement | null;
  while (el && el !== inlineEditorEl) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function closestAncestor(node: Node | null, tag: string): HTMLElement | null {
  const target = tag.toUpperCase();
  let el = (node && node.nodeType === Node.ELEMENT_NODE
    ? node
    : node?.parentNode ?? null) as HTMLElement | null;
  while (el && el !== inlineEditorEl) {
    if (el.tagName === target) return el;
    el = el.parentElement;
  }
  return null;
}

function replaceBlockTag(block: HTMLElement, newTag: string) {
  if (block.tagName === newTag.toUpperCase()) return;
  const replacement = document.createElement(newTag);
  while (block.firstChild) replacement.appendChild(block.firstChild);
  block.replaceWith(replacement);
  const sel = document.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(replacement);
    r.collapse(false);
    sel.removeAllRanges();
    // BUG-010: WKWebView 下 addRange 在 replaceWith 后可能静默失败，
    // 用 try/catch 兜底确保焦点回到编辑器而不是飞出去。
    try { sel.addRange(r); } catch { inlineEditorEl.focus(); }
  }
}

function applyBlockFormat(targetTag: string) {
  // Toggle behaviour: clicking the active tag again drops back to a paragraph.
  // Without this, repeated H1 clicks on WebKit keep stacking wrappers and the
  // text grows on every click.
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    document.execCommand("formatBlock", false, targetTag);
    return;
  }
  const block = closestBlock(sel.getRangeAt(0).startContainer);
  const target = targetTag.toUpperCase();
  if (!block) {
    document.execCommand("formatBlock", false, targetTag);
    return;
  }
  if (block.tagName === target) {
    if (target !== "P") replaceBlockTag(block, "P");
    // BUG-011: target 已是 P 时直接 return，WKWebView 下 selection 可能已偏移，
    // 显式 focus 确保焦点仍在编辑器内
    else inlineEditorEl.focus();
    return;
  }
  replaceBlockTag(block, targetTag);
}

function toggleBlockquote() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    document.execCommand("formatBlock", false, "BLOCKQUOTE");
    return;
  }
  const range = sel.getRangeAt(0);
  const bq = closestAncestor(range.startContainer, "BLOCKQUOTE");
  if (bq) {
    const parent = bq.parentNode;
    if (!parent) return;
    // 记住第一个要被 unwrap 的子节点，用于恢复 selection
    const firstMoved = bq.firstChild as Node | null;
    while (bq.firstChild) parent.insertBefore(bq.firstChild, bq);
    parent.removeChild(bq);
    // BUG-010: WKWebView 下 removeChild 后 selection 可能飞出编辑区，手动恢复
    if (firstMoved) {
      const targetNode = firstMoved.nodeType === Node.ELEMENT_NODE
        ? (firstMoved as HTMLElement)
        : firstMoved.parentElement;
      if (targetNode) {
        const r2 = document.createRange();
        r2.selectNodeContents(targetNode);
        r2.collapse(false);
        sel.removeAllRanges();
        try { sel.addRange(r2); } catch { inlineEditorEl.focus(); }
      }
    }
    return;
  }
  const block = closestBlock(range.startContainer);
  if (!block) {
    document.execCommand("formatBlock", false, "BLOCKQUOTE");
    return;
  }
  const wrapper = document.createElement("blockquote");
  block.parentNode?.insertBefore(wrapper, block);
  wrapper.appendChild(block);
  const r = document.createRange();
  r.selectNodeContents(block);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

function wrapSelectionInTag(tag: string) {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  // Determine the effective ancestor element: if commonAncestorContainer is
  // already an Element (e.g. the <code> node itself when all its content is
  // selected), use it directly; otherwise use its parentElement.
  const container = range.commonAncestorContainer;
  const ancestor: HTMLElement | null =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as HTMLElement)
      : (container as Node).parentElement;

  // Check 1: walk up the ancestor chain to find the nearest matching tag,
  // staying within the inline editor.
  let existing: HTMLElement | null = ancestor;
  while (existing && existing !== inlineEditorEl) {
    if (existing.tagName.toLowerCase() === tag) break;
    existing = existing.parentElement;
  }

  // Check 2: if ancestor itself is not the tag, check whether the ancestor's
  // meaningful children are all a single target tag (covers the case where the
  // user selects the entire content of a <p> that contains a lone <code>).
  if (!existing || existing === inlineEditorEl) {
    if (ancestor && ancestor !== inlineEditorEl) {
      const significant = Array.from(ancestor.childNodes).filter(
        (n) => !(n.nodeType === Node.TEXT_NODE && n.textContent?.trim() === ""),
      );
      if (
        significant.length === 1 &&
        significant[0].nodeType === Node.ELEMENT_NODE &&
        (significant[0] as HTMLElement).tagName.toLowerCase() === tag
      ) {
        existing = significant[0] as HTMLElement;
      }
    }
  }

  if (existing && existing !== inlineEditorEl && existing.tagName.toLowerCase() === tag) {
    // Unwrap: replace the wrapper element with a text node of its content.
    const text = existing.textContent || "";
    existing.replaceWith(document.createTextNode(text));
    inlineEditorEl.focus();
    return;
  }

  const wrapper = document.createElement(tag);
  try {
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    inlineEditorEl.focus();
  }
}

/* ============================================================
   Link popover (BUG-013: 替代 WKWebView 屏蔽的 window.prompt)
   ============================================================ */

let _linkPopoverResolve: ((url: string | null) => void) | null = null;

function showLinkPopover(savedRange: Range | null, existingAnchor?: HTMLAnchorElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    _linkPopoverResolve = resolve;
    const isEdit = !!existingAnchor;

    // 编辑模式：预填现有 href，更新标题和确认按钮文案，显示"删除链接"按钮
    if (isEdit) {
      linkPopoverInputEl.value = existingAnchor!.getAttribute("href") ?? "";
      linkPopoverTitleEl.textContent = "编辑链接";
      linkPopoverConfirmEl.textContent = "更新";
      linkPopoverUnlinkEl.removeAttribute("hidden");
    } else {
      linkPopoverInputEl.value = "https://";
      linkPopoverTitleEl.textContent = "链接地址";
      linkPopoverConfirmEl.textContent = "确定";
      linkPopoverUnlinkEl.setAttribute("hidden", "");
    }

    linkPopoverEl.removeAttribute("hidden");
    linkPopoverInputEl.focus();
    linkPopoverInputEl.select();

    const closePopover = () => {
      linkPopoverEl.setAttribute("hidden", "");
      _linkPopoverResolve = null;
    };

    const applyLink = (url: string) => {
      inlineEditorEl.focus();
      if (isEdit) {
        // 编辑模式：直接更新 href，不走 execCommand（避免选区漂移或嵌套）
        existingAnchor!.setAttribute("href", url);
      } else {
        if (savedRange) {
          const s = document.getSelection();
          if (s) {
            s.removeAllRanges();
            s.addRange(savedRange);
          }
        }
        document.execCommand("createLink", false, url);
      }
      inlineEditorEl.dispatchEvent(new Event("input"));
    };

    const unlinkAnchor = () => {
      if (!existingAnchor) return;
      inlineEditorEl.focus();
      // 把 a 的所有子节点移到 a 前面，再移除 a
      const parent = existingAnchor.parentNode;
      if (parent) {
        while (existingAnchor.firstChild) {
          parent.insertBefore(existingAnchor.firstChild, existingAnchor);
        }
        existingAnchor.remove();
      }
      inlineEditorEl.dispatchEvent(new Event("input"));
    };

    const finish = (action: "confirm" | "cancel" | "unlink") => {
      closePopover();
      if (action === "confirm") {
        const url = linkPopoverInputEl.value.trim();
        if (url) {
          applyLink(url);
        } else if (isEdit) {
          // 编辑模式下清空 URL 确认 = 解链接
          unlinkAnchor();
        }
        resolve(url || null);
      } else if (action === "unlink") {
        unlinkAnchor();
        resolve(null);
      } else {
        resolve(null);
      }
    };

    const onConfirm = () => { finish("confirm"); cleanup(); };
    const onCancel = () => { finish("cancel"); cleanup(); };
    const onUnlink = () => { finish("unlink"); cleanup(); };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    const cleanup = () => {
      linkPopoverConfirmEl.removeEventListener("click", onConfirm);
      linkPopoverCancelEl.removeEventListener("click", onCancel);
      linkPopoverUnlinkEl.removeEventListener("click", onUnlink);
      linkPopoverInputEl.removeEventListener("keydown", onKeydown);
    };

    linkPopoverConfirmEl.addEventListener("click", onConfirm);
    linkPopoverCancelEl.addEventListener("click", onCancel);
    linkPopoverUnlinkEl.addEventListener("click", onUnlink);
    linkPopoverInputEl.addEventListener("keydown", onKeydown);
  });
}

/* ============================================================
   Sidebar resizers
   ============================================================ */

function bindSidebarResizers() {
  document.querySelectorAll<HTMLElement>(".sb-resizer").forEach((handle) => {
    let startY = 0;
    let aHeight = 0;
    let bHeight = 0;
    let aEl: HTMLElement | null = null;
    let bEl: HTMLElement | null = null;

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      aEl = document.querySelector(handle.dataset.above!);
      bEl = document.querySelector(handle.dataset.below!);
      if (!aEl || !bEl) return;
      e.preventDefault();
      startY = e.clientY;
      aHeight = aEl.getBoundingClientRect().height;
      bHeight = bEl.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("resizing-v");
    });

    handle.addEventListener("pointermove", (e: PointerEvent) => {
      if (!aEl || !bEl) return;
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const dy = e.clientY - startY;
      const min = 64;
      const newA = Math.max(min, aHeight + dy);
      const newB = Math.max(min, bHeight - dy);
      aEl.style.flex = `0 0 ${newA}px`;
      bEl.style.flex = `0 0 ${newB}px`;
    });

    const finish = (e: PointerEvent) => {
      if (handle.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-v");
      aEl = null;
      bEl = null;
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);

    handle.addEventListener("dblclick", () => {
      const a = document.querySelector<HTMLElement>(handle.dataset.above!);
      const b = document.querySelector<HTMLElement>(handle.dataset.below!);
      if (a) a.style.flex = "";
      if (b) b.style.flex = "";
    });
  });
}

/* ============================================================
   Sidebar horizontal resizer
   ============================================================ */

const SIDEBAR_MIN_W = 160;
const SIDEBAR_DEFAULT_W = 244;

function getSidebarMaxW() {
  return Math.min(Math.round(window.innerWidth * 0.5), 480);
}

function applySidebarWidth(w: number) {
  const clamped = Math.min(Math.max(w, SIDEBAR_MIN_W), getSidebarMaxW());
  panelEl.style.gridTemplateColumns = `${clamped}px minmax(0, 1fr)`;
}

function bindSidebarHrResizer() {
  const handle = sidebarHrResizerEl;
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panelEl.getBoundingClientRect().width
      ? parseInt(getComputedStyle(panelEl).gridTemplateColumns.split(" ")[0]) || SIDEBAR_DEFAULT_W
      : SIDEBAR_DEFAULT_W;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing-h");
  });

  handle.addEventListener("pointermove", (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    applySidebarWidth(startW + dx);
  });

  const finish = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing-h");
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", () => {
    panelEl.style.gridTemplateColumns = "";
  });

  let resizeRafId = 0;
  window.addEventListener("resize", () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      if (!panelEl.style.gridTemplateColumns) return;
      const m = panelEl.style.gridTemplateColumns.match(/^([\d.]+)px/);
      if (!m) return;
      const current = parseFloat(m[1]);
      const max = getSidebarMaxW();
      if (current > max) applySidebarWidth(max);
    });
  });
}

/* ============================================================
   Render & outline
   ============================================================ */

function scheduleRender() {
  if (state.renderTimer) window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderPreview, 220);
}

async function renderPreview() {
  if (!state.doc) return;
  try {
    const out = state.doc.path && !state.doc.isDraft && state.doc.format !== "markdown"
      ? await invoke<RenderResult>("render_markdown", {
        path: state.doc.path,
        markdown: state.doc.markdown,
      })
      : await invoke<RenderResult>("render_markdown_standalone", {
        markdown: state.doc.markdown,
      });
    applyHTML(out.html);
  } catch (err) {
    console.error(err);
    setStatus("预览更新失败", "warn");
  }
}

function applyHTML(html: string) {
  const renderedHTML = state.doc ? rewriteAssetURLs(html, state.doc.assets) : html;
  state.htmlVersion += 1;
  previewEl.innerHTML = renderedHTML;
  readerEl.innerHTML = renderedHTML;
  state.paintedVersion.read = state.htmlVersion;
  state.paintedVersion.source = state.htmlVersion;
  if (state.mode === "edit" && state.doc) {
    inlineEditorEl.innerHTML = renderedHTML;
    tagAssetImages(inlineEditorEl, state.doc.assets);
    state.paintedVersion.edit = state.htmlVersion;
    inlineDirty = false;
  }
  if (state.doc) {
    tagAssetImages(readerEl, state.doc.assets);
    tagAssetImages(previewEl, state.doc.assets);
  }
  state.outline = extractOutlineFromHTML(renderedHTML);
  if (state.doc) {
    state.doc.html = previewEl.innerHTML;
  }
  renderOutline();
  persistSessionSnapshot();
}

function tagAssetImages(container: HTMLElement, assets: AimdAsset[]) {
  if (!assets.length) return;
  const map = new Map<string, string>();
  for (const a of assets) {
    if (a.url) map.set(a.url, a.id);
  }
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const id = map.get(src);
    if (id) img.dataset.assetId = id;
  });
}

function extractOutlineFromHTML(html: string): OutlineNode[] {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const nodes: OutlineNode[] = [];
  const headings = tmp.querySelectorAll("h1, h2, h3, h4");
  let counter = 0;
  headings.forEach((h) => {
    const tag = h.tagName.toLowerCase();
    const level = Number(tag.slice(1));
    const text = (h.textContent || "").trim();
    if (!text) return;
    const id = h.id || `aimd-heading-${counter++}`;
    if (!h.id) h.id = id;
    nodes.push({ id, text, level });
  });
  syncHeadingIds(readerEl, tmp);
  syncHeadingIds(previewEl, tmp);
  syncHeadingIds(inlineEditorEl, tmp);
  return nodes;
}

function syncHeadingIds(target: HTMLElement, source: HTMLElement) {
  const targetH = target.querySelectorAll("h1, h2, h3, h4");
  const sourceH = source.querySelectorAll("h1, h2, h3, h4");
  targetH.forEach((node, i) => {
    const id = sourceH[i]?.id;
    if (id) (node as HTMLElement).id = id;
  });
}

function renderOutline() {
  if (!state.doc) {
    outlineSectionEl.hidden = true;
    return;
  }
  outlineSectionEl.hidden = false;
  outlineCountEl.textContent = String(state.outline.length);
  if (!state.outline.length) {
    outlineListEl.innerHTML = `<div class="empty-list">未发现标题</div>`;
    return;
  }
  const minLevel = Math.min(...state.outline.map((n) => n.level));
  outlineListEl.innerHTML = state.outline
    .map((node) => {
      const indent = node.level - minLevel;
      return `<button class="outline-item" data-id="${escapeAttr(node.id)}" data-indent="${indent}" type="button" title="${escapeAttr(node.text)}"><span class="outline-bullet"></span><span class="outline-text">${escapeHTML(node.text)}</span></button>`;
    })
    .join("");
  outlineListEl.querySelectorAll<HTMLButtonElement>(".outline-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const target = currentScrollPane().querySelector(`#${CSS.escape(id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function currentScrollPane(): HTMLElement {
  if (state.mode === "edit") return inlineEditorEl;
  if (state.mode === "source") return previewEl;
  return readerEl;
}

// Tauri 2 webview 默认吞掉 window.confirm()（无 UI、悄悄返回 false），
// 所以"丢弃未保存内容前的确认"必须走 Rust 端的原生对话框。
// 三按钮："保存" → 先 saveDocument 再继续；"不保存" → 直接放弃；"取消" → 留在原文档。
async function ensureCanDiscardChanges(action: string): Promise<boolean> {
  if (!state.doc?.dirty) return true;
  let choice: "save" | "discard" | "cancel";
  try {
    choice = await invoke<"save" | "discard" | "cancel">("confirm_discard_changes", {
      message: `当前文档有未保存的修改，仍要${action}吗？`,
    });
  } catch {
    // 退化到 window.confirm，仅用于 vite-only 开发态 / e2e 兜底（不希望在 Tauri 实跑里走到这里）
    choice = window.confirm(`当前文档有未保存的修改，仍要${action}吗？`) ? "discard" : "cancel";
  }
  if (choice === "save") {
    await saveDocument();
    // saveDocument 内部走 saveDocumentAs；若用户在 file picker 里取消、文档仍是 draft / 仍 dirty，则视为放弃此次离开。
    return !(state.doc?.dirty ?? false);
  }
  return choice === "discard";
}

function displayDocTitle(doc: AimdDocument): string {
  return extractHeadingTitle(doc.markdown) || doc.title || fileStem(doc.path) || "未命名文档";
}

function extractHeadingTitle(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}

function fileStem(path: string): string {
  if (!path) return "";
  const file = path.split(/[\\/]/).pop() || "";
  return file.replace(/\.aimd$/i, "").replace(/\.[^.]+$/, "");
}

function suggestAimdFilename(input: string): string {
  const stem = fileStem(input) || "untitled";
  return `${stem}.aimd`;
}

function loadRecentPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_RECENTS);
    const items = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items)) return [];
    return items.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function saveRecentPaths() {
  window.localStorage.setItem(STORAGE_RECENTS, JSON.stringify(state.recentPaths.slice(0, MAX_RECENTS)));
}

function loadLastSessionPath(): string | null {
  return window.localStorage.getItem(STORAGE_LAST);
}

function loadSessionSnapshot(): SessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    return {
      path: typeof parsed.path === "string" ? parsed.path : "",
      title: typeof parsed.title === "string" ? parsed.title : "",
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : "",
      html: typeof parsed.html === "string" ? parsed.html : "",
      assets,
      dirty: Boolean(parsed.dirty),
      isDraft: Boolean(parsed.isDraft),
      format: parsed.format === "markdown" ? "markdown" : "aimd",
      mode: parsed.mode === "edit" || parsed.mode === "source" ? parsed.mode : "read",
    };
  } catch {
    return null;
  }
}

function clearLastSessionPath() {
  window.localStorage.removeItem(STORAGE_LAST);
}

function clearSessionSnapshot() {
  window.localStorage.removeItem(STORAGE_SESSION);
}

function persistSessionSnapshot() {
  if (!state.doc) {
    clearSessionSnapshot();
    return;
  }
  const snapshot: SessionSnapshot = {
    path: state.doc.path,
    title: state.doc.title,
    markdown: state.doc.markdown,
    html: state.doc.html,
    assets: state.doc.assets,
    dirty: state.doc.dirty,
    isDraft: Boolean(state.doc.isDraft),
    format: state.doc.format,
    mode: state.mode,
  };
  window.localStorage.setItem(STORAGE_SESSION, JSON.stringify(snapshot));
  if (state.doc.path) {
    window.localStorage.setItem(STORAGE_LAST, state.doc.path);
  } else {
    clearLastSessionPath();
  }
}

function rememberOpenedPath(path: string) {
  if (!path) return;
  state.recentPaths = [path, ...state.recentPaths.filter((item) => item !== path)].slice(0, MAX_RECENTS);
  window.localStorage.setItem(STORAGE_LAST, path);
  saveRecentPaths();
  renderRecentList();
}

async function restoreSession() {
  const snapshot = loadSessionSnapshot();
  if (snapshot) {
    const restored = await restoreSnapshot(snapshot);
    if (restored) {
      applyDocument(restored.doc, restored.mode);
      if (restored.doc.path) rememberOpenedPath(restored.doc.path);
      setStatus(restored.message, "info");
      return;
    }
    clearSessionSnapshot();
  }

  const path = loadLastSessionPath();
  if (!path) return;
  try {
    const doc = await invoke<AimdDocument>("open_aimd", { path });
    applyDocument({ ...doc, isDraft: false, format: "aimd" }, "read");
    rememberOpenedPath(doc.path);
    setStatus("已恢复上次文档", "info");
  } catch {
    clearLastSessionPath();
    updateChrome();
  }
}

async function restoreSnapshot(snapshot: SessionSnapshot): Promise<{ doc: AimdDocument; mode: Mode; message: string } | null> {
  if (snapshot.path && !snapshot.isDraft && snapshot.format !== "markdown") {
    try {
      const diskDoc = await invoke<AimdDocument>("open_aimd", { path: snapshot.path });
      if (!snapshot.dirty && snapshot.markdown === diskDoc.markdown) {
        return {
          doc: { ...diskDoc, isDraft: false, format: "aimd" },
          mode: snapshot.mode,
          message: "已恢复上次文档",
        };
      }
      const html = await renderSnapshotHTML({
        ...snapshot,
        path: diskDoc.path,
        assets: diskDoc.assets,
        title: snapshot.title || diskDoc.title,
      });
      return {
        doc: {
          ...diskDoc,
          title: snapshot.title || diskDoc.title,
          markdown: snapshot.markdown,
          html,
          assets: diskDoc.assets,
          dirty: true,
          isDraft: false,
          format: "aimd",
        },
        mode: snapshot.mode,
        message: "已恢复未保存修改",
      };
    } catch {
      // Fall back to the persisted snapshot below.
    }
  }

  const html = await renderSnapshotHTML(snapshot);
  return {
    doc: {
      path: snapshot.path,
      title: snapshot.title,
      markdown: snapshot.markdown,
      html,
      assets: snapshot.assets,
      dirty: snapshot.dirty,
      isDraft: snapshot.isDraft,
      format: snapshot.format,
    },
    mode: snapshot.mode,
    message: snapshot.dirty || snapshot.isDraft ? "已恢复未保存草稿" : "已恢复上次会话",
  };
}

async function renderSnapshotHTML(snapshot: SessionSnapshot): Promise<string> {
  try {
    if (snapshot.path && !snapshot.isDraft && snapshot.format !== "markdown") {
      const out = await invoke<RenderResult>("render_markdown", {
        path: snapshot.path,
        markdown: snapshot.markdown,
      });
      return out.html;
    }
  } catch {
    // Fall through to standalone rendering.
  }

  try {
    const out = await invoke<RenderResult>("render_markdown_standalone", {
      markdown: snapshot.markdown,
    });
    return out.html;
  } catch {
    return snapshot.html || "";
  }
}

function clearRecentDocuments() {
  state.recentPaths = [];
  window.localStorage.removeItem(STORAGE_RECENTS);
  renderRecentList();
}

function renderRecentList() {
  recentSectionEl.hidden = state.recentPaths.length === 0;
  if (state.recentPaths.length === 0) {
    recentListEl.innerHTML = "";
    return;
  }
  recentListEl.innerHTML = state.recentPaths
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
  recentListEl.querySelectorAll<HTMLButtonElement>(".recent-item").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.path;
      if (path) void openDocument(path);
    });
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const path = button.dataset.path;
      if (path) showFileContextMenu(e.clientX, e.clientY, path);
    });
  });
}

function onWindowDragOver(event: DragEvent) {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  panelEl.classList.add("dragging-file");
}

function onWindowDragLeave(event: DragEvent) {
  if (event.relatedTarget) return;
  panelEl.classList.remove("dragging-file");
}

async function onWindowDrop(event: DragEvent) {
  panelEl.classList.remove("dragging-file");
  const file = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
  if (!file) return;
  event.preventDefault();
  const droppedPath = file.path || "";
  if (!droppedPath) return;
  if (/\.aimd$/i.test(droppedPath)) {
    await openDocument(droppedPath);
    return;
  }
  if (/\.(md|markdown|mdx)$/i.test(droppedPath)) {
    await openMarkdownDocument(droppedPath);
  }
}

/* ============================================================
   Chrome / status
   ============================================================ */

function updateChrome() {
  const doc = state.doc;
  renderRecentList();
  panelEl.dataset.shell = doc ? "document" : "launch";
  // Sidebar resizer writes an inline `grid-template-columns` (e.g.
  // "460px minmax(0,1fr)") which beats the launch-shell CSS rule. In launch
  // mode the sidebar is `display: none`, so the now-only workspace child
  // collapses into the first column of that two-column track and the right
  // side renders empty. Drop the inline override before each launch transition.
  if (!doc) panelEl.style.gridTemplateColumns = "";
  starterActionsEl.hidden = Boolean(doc);
  docActionsEl.hidden = !doc;
  sidebarFootEl.hidden = !doc;

  titleEl.textContent = doc ? displayDocTitle(doc) : "AIMD Desktop";
  pathEl.textContent = doc
    ? (doc.path || "未保存草稿 · 先另存为 .aimd")
    : "正文、图片和元信息始终在一起";
  saveEl.disabled = !doc || (!doc.dirty && !doc.isDraft);
  saveAsEl.disabled = !doc;
  closeEl.disabled = !doc;
  // 顶部的主按钮统一显示「保存」：草稿状态下点击仍走 saveDocumentAs 创建文件，
  // 但视觉/语义上对用户都是"保存"动作（与 sidebar-foot 一致）。
  saveLabelEl.textContent = "保存";
  modeReadEl.disabled = !doc;
  modeEditEl.disabled = !doc;
  modeSourceEl.disabled = !doc;

  if (!doc) {
    docCardEl.dataset.state = "empty";
    docCardEl.classList.remove("active");
    docCardEl.querySelector<HTMLElement>(".doc-card-title")!.textContent = "未打开文档";
    docCardEl.querySelector<HTMLElement>(".doc-card-meta")!.textContent = "新建、打开或导入 Markdown";
    assetSectionEl.hidden = true;
    outlineSectionEl.hidden = true;
    resizer1El.hidden = true;
    resizer2El.hidden = true;
    assetListEl.innerHTML = "";
    emptyEl.hidden = false;
    if (!isBootstrappingSession) persistSessionSnapshot();
    return;
  }

  emptyEl.hidden = true;
  // 草稿一旦输入了内容（dirty），sidebar-foot 把 "新建" 替换成 "保存"，
  // 把这一步的主动作放在更显眼的位置；非草稿/未脏的状态保留 "新建" 入口。
  const draftWithContent = Boolean(doc.isDraft && doc.dirty);
  sidebarNewEl.hidden = draftWithContent;
  sidebarSaveEl.hidden = !draftWithContent;
  docCardEl.dataset.state = doc.dirty ? "dirty" : (doc.isDraft ? "draft" : "active");
  docCardEl.classList.add("active");
  docCardEl.querySelector<HTMLElement>(".doc-card-title")!.textContent = displayDocTitle(doc);
  docCardEl.querySelector<HTMLElement>(".doc-card-meta")!.textContent =
    (doc.path ? formatPathHint(doc.path) : "未保存草稿")
    + (doc.dirty ? " · 未保存" : "");

  outlineSectionEl.hidden = false;
  assetSectionEl.hidden = false;
  resizer1El.hidden = false;
  resizer2El.hidden = false;

  assetCountEl.textContent = String(doc.assets.length);
  if (doc.assets.length) {
    assetListEl.innerHTML = doc.assets.map(assetItem).join("");
  } else {
    assetListEl.innerHTML = `<div class="empty-list">无嵌入资源</div>`;
  }

  if (doc.isDraft) {
    setStatus("这是未保存草稿，保存后才会生成 .aimd 文件", "info");
  } else if (doc.dirty) {
    setStatus("未保存的修改", "warn");
  }
  persistSessionSnapshot();
}

function formatPathHint(path: string) {
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

function setStatus(text: string, tone: "idle" | "loading" | "success" | "warn" | "info" = "idle") {
  statusEl.textContent = text;
  statusPillEl.dataset.tone = tone;
  if (state.statusTimer) window.clearTimeout(state.statusTimer);
  if (tone === "success" || tone === "info") {
    state.statusTimer = window.setTimeout(() => {
      statusEl.textContent = state.doc?.dirty ? "未保存的修改" : "就绪";
      statusPillEl.dataset.tone = state.doc?.dirty ? "warn" : "idle";
    }, 1800);
  }
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}

function escapeAttr(value: string) {
  return escapeHTML(value);
}

/* ============================================================
   Image lightbox
   ============================================================ */

function openLightbox(src: string) {
  const existing = document.getElementById("aimd-lightbox");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "aimd-lightbox";
  overlay.className = "aimd-lightbox";
  overlay.setAttribute("data-lightbox", "true");

  const img = document.createElement("img");
  img.className = "aimd-lightbox-img";
  img.src = src;

  const closeBtn = document.createElement("button");
  closeBtn.className = "aimd-lightbox-close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "关闭");

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  overlay.addEventListener("click", (e) => {
    if (e.target !== img) close();
  });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey, { capture: true });
}

function bindImageLightbox() {
  const open = (e: MouseEvent, mode: Mode) => {
    if (state.mode !== mode) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "IMG") return;
    if (target.closest(".aimd-lightbox")) return;
    const img = target as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    if (!src) return;
    e.preventDefault();
    openLightbox(src);
  };
  readerEl.addEventListener("click", (e) => open(e, "read"));
  // 编辑模式下点图片也放大；preventDefault 顺手挡住 contenteditable
  // 把光标定到图片附近的副作用，按 ESC 回编辑器即可继续编辑。
  inlineEditorEl.addEventListener("click", (e) => open(e, "edit"));
}

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

/* ============================================================
   File item context menu
   ============================================================ */

let activeContextMenu: HTMLElement | null = null;

function dismissContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showFileContextMenu(x: number, y: number, path: string) {
  dismissContextMenu();

  const menu = document.createElement("div");
  menu.className = "file-ctx-menu";
  menu.setAttribute("data-file-ctx-menu", "true");
  menu.setAttribute("role", "menu");

  const items: Array<{ label: string; action: () => void }> = [
    {
      label: "在 Finder 中显示",
      action: () => {
        dismissContextMenu();
        void invoke("reveal_in_finder", { path }).catch((err) => {
          console.error("reveal_in_finder:", err);
          setStatus(String(err), "warn");
        });
      },
    },
    {
      label: "复制路径",
      action: () => {
        dismissContextMenu();
        void navigator.clipboard.writeText(path).catch(() => {});
      },
    },
    {
      label: "从最近列表移除",
      action: () => {
        dismissContextMenu();
        state.recentPaths = state.recentPaths.filter((p) => p !== path);
        saveRecentPaths();
        renderRecentList();
      },
    },
  ];

  items.forEach(({ label, action }) => {
    const btn = document.createElement("button");
    btn.className = "file-ctx-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    menu.appendChild(btn);
  });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  const menuW = menu.offsetWidth || 180;
  const menuH = menu.offsetHeight || 120;
  const left = Math.min(x, window.innerWidth - menuW - 4);
  const top = Math.min(y, window.innerHeight - menuH - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDismiss = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Escape") {
        dismissContextMenu();
        document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
        document.removeEventListener("click", onDismiss as EventListener, { capture: true });
      }
      return;
    }
    if (!(e.target as HTMLElement).closest("[data-file-ctx-menu]")) {
      dismissContextMenu();
      document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
      document.removeEventListener("click", onDismiss as EventListener, { capture: true });
    }
  };

  setTimeout(() => {
    document.addEventListener("click", onDismiss as EventListener, { capture: true });
    document.addEventListener("keydown", onDismiss as EventListener, { capture: true });
  }, 0);
}

(window as any).__aimd_showFileContextMenu = showFileContextMenu;
