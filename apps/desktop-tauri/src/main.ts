import { invoke } from "@tauri-apps/api/core";
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
  url: string;
};

type AimdDocument = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  dirty: boolean;
};

type RenderResult = {
  html: string;
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
};

// Tracks whether the inline editor's DOM has been mutated by user input since
// the last flush / paint. flushInline skips its (expensive) turndown call when
// false — this is what keeps mode hops snappy on long documents.
let inlineDirty = false;

const ICONS = {
  document: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z"/><path d="M9 1.5V5.5h4"/></svg>`,
  image: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 3 3 2-2 2.5 2.5"/></svg>`,
  folder: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.2v8a1.3 1.3 0 0 0 1.3 1.3h9.4a1.3 1.3 0 0 0 1.3-1.3V5.8a1.3 1.3 0 0 0-1.3-1.3H8L6.5 3H3.3A1.3 1.3 0 0 0 2 4.2Z"/></svg>`,
  read: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5V4a1 1 0 0 1 1.2-1l4.3 1 4.3-1A1 1 0 0 1 13 4v8.5"/><path d="M7.5 4v9"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 2.5 13.5 4.8 5.4 12.9l-3 .7.7-3z"/><path d="m10.2 3.5 2.3 2.3"/></svg>`,
  source: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4-3 4 3 4M10.5 4l3 4-3 4"/></svg>`,
  save: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L11 3H4a1 1 0 0 0-1 .5z"/><path d="M5 3.5V7h6V3.5M5 13.5V10h6v3.5"/></svg>`,
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
    <div class="panel">
      <aside class="sidebar">
        <header class="sidebar-head">
          <div class="brand">
            <span class="brand-mark">A</span>
            <span class="brand-name">AIMD</span>
          </div>
          <button class="icon-btn ghost" id="open-top" type="button" title="打开文件 (⌘O)">${ICONS.folder}</button>
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

        <footer class="sidebar-foot">
          <button id="open" class="footer-action" type="button">
            <span class="footer-action-icon">${ICONS.folder}</span>
            <span class="footer-action-text">
              <span class="footer-action-title">打开 AIMD 文件</span>
              <span class="footer-action-hint">⌘O</span>
            </span>
          </button>
        </footer>
      </aside>

      <main class="workspace">
        <header class="workspace-head">
          <div class="doc-meta">
            <h1 id="doc-title" class="doc-title">AIMD Desktop</h1>
            <div id="doc-path" class="doc-path">尚未打开任何文档</div>
          </div>

          <div class="head-actions">
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
                <span>保存</span>
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

        <section class="workspace-body">
          <article id="empty" class="empty-state">
            <div class="empty-mark">${ICONS.document}</div>
            <h2>把 .aimd 当作单文件笔记</h2>
            <p>Markdown 内联，图片与附件就地嵌入，一个文件就是一篇可分享的内容。打开文件即可阅读，"编辑"在所见即所得，"源码"是高级 Markdown 模式。</p>
            <button id="empty-open" class="primary-btn lg" type="button">
              <span class="primary-btn-icon">${ICONS.folder}</span>
              <span>打开 AIMD 文件</span>
            </button>
            <div class="empty-hint">⌘O 打开 · ⌘S 保存</div>
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
const saveEl = $("#save") as HTMLButtonElement;
const modeReadEl = $("#mode-read") as HTMLButtonElement;
const modeEditEl = $("#mode-edit") as HTMLButtonElement;
const modeSourceEl = $("#mode-source") as HTMLButtonElement;

/* ============================================================
   Wiring
   ============================================================ */

$("#open").addEventListener("click", chooseAndOpen);
$("#open-top").addEventListener("click", chooseAndOpen);
$("#empty-open").addEventListener("click", chooseAndOpen);
modeReadEl.addEventListener("click", () => setMode("read"));
modeEditEl.addEventListener("click", () => setMode("edit"));
modeSourceEl.addEventListener("click", () => setMode("source"));
saveEl.addEventListener("click", saveDocument);

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

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveDocument();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void chooseAndOpen();
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await listen<string>("aimd-open-file", (event) => {
      void openDocument(event.payload);
    });
    const initial = await invoke<string | null>("initial_open_path");
    if (initial) await openDocument(initial);
  } catch {
    // Running outside of Tauri (vite dev / e2e). UI renders empty state; user actions
    // that invoke the Go sidecar will still surface their own errors when triggered.
  }
});

/* ============================================================
   Document lifecycle
   ============================================================ */

async function chooseAndOpen() {
  const path = await invoke<string | null>("choose_aimd_file");
  if (path) await openDocument(path);
}

async function openDocument(path: string) {
  setStatus("正在打开", "loading");
  const doc = await invoke<AimdDocument>("open_aimd", { path });
  state.doc = doc;
  markdownEl.value = doc.markdown;
  applyHTML(doc.html);
  setMode("read");
  updateChrome();
  setStatus("已打开", "success");
}

async function saveDocument() {
  if (!state.doc) return;
  // Flush any pending in-memory edits before saving.
  if (state.mode === "edit") flushInline();
  if (!state.doc.dirty) return;
  setStatus("正在保存", "loading");
  saveEl.disabled = true;
  const doc = await invoke<AimdDocument>("save_aimd", {
    path: state.doc.path,
    markdown: state.doc.markdown,
  });
  state.doc = doc;
  markdownEl.value = doc.markdown;
  applyHTML(doc.html);
  // If still in edit mode, refresh contenteditable HTML
  if (state.mode === "edit") {
    inlineEditorEl.innerHTML = doc.html;
    tagAssetImages(inlineEditorEl, doc.assets);
  }
  updateChrome();
  setStatus("已保存", "success");
}

async function insertImage() {
  if (!state.doc) return;
  const imagePath = await invoke<string | null>("choose_image_file");
  if (!imagePath) return;
  setStatus("正在加入图片", "loading");
  const added = await invoke<AddedAsset>("add_image", {
    path: state.doc.path,
    imagePath,
  });
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
  img.src = added.asset.url;
  img.alt = added.asset.id;
  img.dataset.assetId = added.asset.id;
  return img;
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

function onInlineInput() {
  if (!state.doc) return;
  inlineDirty = true;
  state.doc.dirty = true;
  updateChrome();
  // Defer expensive HTML→MD conversion until idle.
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
  setStatus("正在加入粘贴的图片", "loading");
  try {
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const data = Array.from(new Uint8Array(buf));
      const filename = (file.name && file.name.length > 0)
        ? file.name
        : `pasted-${Date.now()}.${guessImageExt(file.type)}`;
      const added = await invoke<AddedAsset>("add_image_bytes", {
        path: state.doc.path,
        filename,
        data,
      });
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
  // Normalize Enter behavior to produce <p> instead of <div>.
  if (event.key === "Enter" && !event.shiftKey) {
    // Let the browser handle, but coerce to paragraph mode upfront
    // (defaultParagraphSeparator is set on first focus, see below).
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
      const url = window.prompt("链接地址（http/https）", "https://");
      if (url && url.trim()) document.execCommand("createLink", false, url.trim());
      break;
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
    sel.addRange(r);
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
    while (bq.firstChild) parent.insertBefore(bq.firstChild, bq);
    parent.removeChild(bq);
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
  // If selection is already inside a <code>, unwrap.
  const parent = range.commonAncestorContainer.parentElement;
  if (parent && parent.tagName.toLowerCase() === tag) {
    const text = parent.textContent || "";
    parent.replaceWith(document.createTextNode(text));
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
    /* ignore selection errors */
  }
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
   Render & outline
   ============================================================ */

function scheduleRender() {
  if (state.renderTimer) window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderPreview, 220);
}

async function renderPreview() {
  if (!state.doc) return;
  const out = await invoke<RenderResult>("render_markdown", {
    path: state.doc.path,
    markdown: state.doc.markdown,
  });
  applyHTML(out.html);
}

function applyHTML(html: string) {
  state.htmlVersion += 1;
  previewEl.innerHTML = html;
  readerEl.innerHTML = html;
  state.paintedVersion.read = state.htmlVersion;
  state.paintedVersion.source = state.htmlVersion;
  if (state.mode === "edit" && state.doc) {
    inlineEditorEl.innerHTML = html;
    tagAssetImages(inlineEditorEl, state.doc.assets);
    state.paintedVersion.edit = state.htmlVersion;
    inlineDirty = false;
  }
  if (state.doc) {
    tagAssetImages(readerEl, state.doc.assets);
    tagAssetImages(previewEl, state.doc.assets);
  }
  state.outline = extractOutlineFromHTML(html);
  if (state.doc) {
    state.doc.html = previewEl.innerHTML;
  }
  renderOutline();
}

function tagAssetImages(container: HTMLElement, assets: AimdAsset[]) {
  if (!assets.length) return;
  const map = new Map<string, string>();
  for (const a of assets) map.set(a.url, a.id);
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

/* ============================================================
   Chrome / status
   ============================================================ */

function updateChrome() {
  const doc = state.doc;
  titleEl.textContent = doc?.title || "AIMD Desktop";
  pathEl.textContent = doc?.path || "尚未打开任何文档";
  saveEl.disabled = !doc || !doc.dirty;
  modeReadEl.disabled = !doc;
  modeEditEl.disabled = !doc;
  modeSourceEl.disabled = !doc;

  if (!doc) {
    docCardEl.dataset.state = "empty";
    docCardEl.classList.remove("active");
    docCardEl.querySelector<HTMLElement>(".doc-card-title")!.textContent = "未打开文档";
    docCardEl.querySelector<HTMLElement>(".doc-card-meta")!.textContent = "点击下方打开 .aimd";
    assetSectionEl.hidden = true;
    outlineSectionEl.hidden = true;
    resizer1El.hidden = true;
    resizer2El.hidden = true;
    assetListEl.innerHTML = "";
    return;
  }

  docCardEl.dataset.state = doc.dirty ? "dirty" : "active";
  docCardEl.classList.add("active");
  docCardEl.querySelector<HTMLElement>(".doc-card-title")!.textContent = doc.title || "未命名文档";
  docCardEl.querySelector<HTMLElement>(".doc-card-meta")!.textContent =
    formatPathHint(doc.path) + (doc.dirty ? " · 未保存" : "");

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

  if (doc.dirty) setStatus("未保存的修改", "warn");
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
  return `
    <div class="asset">
      <div class="asset-thumb">
        <img src="${asset.url}" alt="" loading="lazy">
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
