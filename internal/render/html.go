// Package render turns AIMD documents into HTML.
package render

import (
	"bytes"
	stdhtml "html"

	"github.com/aimd-org/aimd/internal/mdx"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

// AssetResolver maps an asset:// id to a URL usable in <img src="...">.
// Return "" to leave the original asset:// URI untouched.
type AssetResolver func(id string) string

// Markdown renders a Markdown document to an HTML body fragment, rewriting
// asset:// image references using resolve.
func Markdown(src []byte, resolve AssetResolver) ([]byte, error) {
	rewritten := mdx.Rewrite(src, func(ref mdx.ImageRef) string {
		id := mdx.AssetURIID(ref.URL)
		if id == "" {
			return ""
		}
		if resolve == nil {
			return ""
		}
		return resolve(id)
	})
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
		goldmark.WithRendererOptions(gmhtml.WithUnsafe()),
	)
	var buf bytes.Buffer
	if err := md.Convert(rewritten, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// EditorPage returns the native-window HTML app used by aimd view. The app
// talks to the loopback preview server for rendering and persistence.
func EditorPage(title string) []byte {
	var buf bytes.Buffer
	buf.WriteString(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	buf.WriteString(stdhtml.EscapeString(title))
	buf.WriteString(`</title>
<style>` + defaultCSS + editorCSS + `</style>
</head>
<body class="editor-shell" data-mode="read">
<header class="topbar">
  <div class="topbar-main">
    <div class="doc-meta">
      <div class="doc-title">`)
	buf.WriteString(stdhtml.EscapeString(title))
	buf.WriteString(`</div>
      <div id="status" class="doc-status">正在载入</div>
    </div>
    <div class="topbar-actions">
      <div class="mode-switch" aria-label="视图模式">
        <button id="read-mode" class="mode-button" type="button">阅读</button>
        <button id="edit-mode" class="mode-button" type="button">编辑</button>
      </div>
      <button id="save" class="primary" type="button">保存</button>
    </div>
  </div>
  <div class="toolbar" aria-label="编辑工具">
    <div class="tool-group">
      <button data-edit-only data-block="h1" type="button" title="一级标题">H1</button>
      <button data-edit-only data-block="h2" type="button" title="二级标题">H2</button>
      <button data-edit-only data-block="blockquote" type="button" title="引用">引用</button>
    </div>
    <div class="tool-group">
      <button data-edit-only data-cmd="bold" type="button" title="加粗"><strong>B</strong></button>
      <button data-edit-only data-cmd="italic" type="button" title="斜体"><em>I</em></button>
      <button data-edit-only id="code" type="button" title="行内代码">Code</button>
      <button data-edit-only id="link" type="button" title="链接">链接</button>
    </div>
    <div class="tool-group">
      <button data-edit-only data-cmd="insertUnorderedList" type="button" title="无序列表">列表</button>
      <button data-edit-only data-cmd="insertOrderedList" type="button" title="有序列表">编号</button>
      <button data-edit-only id="task" type="button" title="任务列表">任务</button>
      <button data-edit-only id="hr" type="button" title="分割线">分割线</button>
    </div>
    <div class="tool-group">
      <button data-edit-only id="image" type="button" title="选择图片插入">插入图片</button>
      <button data-edit-only id="delete-image" type="button" title="删除选中的图片">删除图片</button>
    </div>
  </div>
</header>
<main id="reader" class="aimd"></main>
<main id="editor" class="aimd inline-editor" contenteditable="true" spellcheck="true" hidden></main>
<input id="image-file" type="file" accept="image/*" hidden>
<nav id="context-menu" class="context-menu" hidden>
  <button data-action="copy" type="button">复制</button>
  <button data-action="image" type="button">插入图片</button>
  <button data-action="paste-image" type="button">粘贴图片</button>
  <button data-action="delete-image" type="button">删除选中图片</button>
  <button data-action="mode" type="button">切换阅读/编辑</button>
  <button data-action="save" type="button">保存</button>
</nav>
<script>
const state = { markdown: "", mode: "read", saved: true };
const el = id => document.getElementById(id);
const reader = el("reader");
const editor = el("editor");
const menu = el("context-menu");
const status = el("status");
const readMode = el("read-mode");
const editMode = el("edit-mode");
const saveButton = el("save");
let lastRange = null;
let selectedImage = null;

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadDoc() {
  setStatus("正在载入");
  const doc = await api("/api/document");
  state.markdown = doc.markdown || "";
  reader.innerHTML = doc.html || "";
  editor.innerHTML = doc.html || "";
  setMode("read");
  state.saved = true;
  setStatus("已保存");
}

function setStatus(text, tone = "") {
  status.textContent = text;
  status.dataset.tone = tone;
}

function setMode(next) {
  if (next === "read" && state.mode === "edit") {
    reader.innerHTML = editor.innerHTML;
  }
  state.mode = next;
  el("reader").hidden = next !== "read";
  el("editor").hidden = next !== "edit";
  editor.contentEditable = next === "edit" ? "true" : "false";
  readMode.classList.toggle("active", next === "read");
  editMode.classList.toggle("active", next === "edit");
  document.querySelectorAll("[data-edit-only]").forEach(b => b.disabled = next !== "edit");
  saveButton.disabled = next !== "edit";
  document.body.dataset.mode = next;
  if (next === "edit") editor.focus();
}

function markDirty() {
  state.saved = false;
  setStatus("未保存", "dirty");
}

async function renderNow() {
  const out = await api("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown: state.markdown })
  });
  reader.innerHTML = out.html || "";
  editor.innerHTML = out.html || "";
}

function rememberSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
    lastRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  editor.focus();
  if (!lastRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(lastRange);
}

function exec(cmd, value = null) {
  restoreSelection();
  document.execCommand(cmd, false, value);
  rememberSelection();
  markDirty();
}

async function save() {
  if (state.mode !== "edit") return;
  setStatus("正在保存");
  saveButton.disabled = true;
  state.markdown = domToMarkdown(editor);
  try {
    await api("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: state.markdown })
    });
    state.saved = true;
    await renderNow();
    setStatus("已保存", "saved");
  } catch (err) {
    setStatus("保存失败", "error");
    throw err;
  } finally {
    saveButton.disabled = state.mode !== "edit";
  }
}

async function uploadImage(file) {
  setStatus("正在插入图片");
  const fd = new FormData();
  fd.append("image", file);
  const out = await api("/api/images", { method: "POST", body: fd });
  insertImage(out.id, out.filename);
  setStatus("图片已插入", "dirty");
}

async function uploadImageFromPath(path) {
  setStatus("正在插入图片");
  const out = await api("/api/images/from-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  insertImage(out.id, out.filename);
  setStatus("图片已插入", "dirty");
}

async function pasteNativeImages() {
  if (typeof window.aimdPasteImagePaths !== "function") return false;
  const paths = await window.aimdPasteImagePaths();
  if (!paths || !paths.length) return false;
  rememberSelection();
  for (const path of paths) await uploadImageFromPath(path);
  return true;
}

async function chooseNativeImages() {
  if (typeof window.aimdChooseImagePaths !== "function") return false;
  const paths = await window.aimdChooseImagePaths();
  if (!paths || !paths.length) return true;
  restoreSelection();
  for (const path of paths) await uploadImageFromPath(path);
  return true;
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name || "");
}

function imagePathsFromClipboard(data) {
  const text = [
    data.getData("text/uri-list"),
    data.getData("text/plain")
  ].filter(Boolean).join("\n");
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .filter(line => /^(file:\/\/|\/).*\.(png|jpe?g|gif|webp|svg)$/i.test(line));
}

function insertImage(id, filename) {
  restoreSelection();
  const img = document.createElement("img");
  img.src = "/assets/" + id;
  img.alt = filename.replace(/\.[^.]+$/, "").replace(/-/g, " ");
  img.dataset.assetId = id;
  const figure = document.createElement("p");
  figure.appendChild(img);
  const range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
  if (range) {
    range.deleteContents();
    range.insertNode(figure);
    range.setStartAfter(figure);
    range.collapse(true);
  } else {
    editor.appendChild(figure);
  }
  rememberSelection();
  markDirty();
}

function assetIDForImage(img) {
  if (!img) return "";
  if (img.dataset.assetId) return img.dataset.assetId;
  const src = img.getAttribute("src") || "";
  const match = src.match(/\/assets\/([^?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function deleteSelectedImage() {
  const img = selectedImage || currentImage();
  if (!img) {
    setStatus("请先点选图片", "error");
    return;
  }
  const id = assetIDForImage(img);
  const parent = img.parentElement && img.parentElement.childNodes.length === 1 ? img.parentElement : img;
  parent.remove();
  selectedImage = null;
  state.markdown = domToMarkdown(editor);
  if (!id) {
    markDirty();
    return;
  }
  await api("/api/assets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, markdown: state.markdown })
  });
  markDirty();
}

function currentImage() {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return null;
  const node = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
  return node && node.closest ? node.closest("img") : null;
}

function inlineCode() {
  restoreSelection();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const existing = container && container.closest ? container.closest("code") : null;
  if (existing && editor.contains(existing)) {
    const text = document.createTextNode(existing.textContent || "");
    existing.replaceWith(text);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(text);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    rememberSelection();
    markDirty();
    return;
  }
  if (!range.collapsed) {
    const fragment = range.cloneContents();
    if (fragment.querySelector && fragment.querySelector("code")) {
      fragment.querySelectorAll("code").forEach(code => code.replaceWith(document.createTextNode(code.textContent || "")));
      range.deleteContents();
      range.insertNode(fragment);
      rememberSelection();
      markDirty();
      return;
    }
  }
  const code = document.createElement("code");
  code.textContent = range.toString() || "code";
  range.deleteContents();
  range.insertNode(code);
  range.selectNodeContents(code);
  rememberSelection();
  markDirty();
}

function insertLink() {
  const href = prompt("URL", "https://example.com");
  if (!href) return;
  exec("createLink", href);
}

function ensureEditMode() {
  if (state.mode !== "edit") setMode("edit");
}

function insertTask() {
  exec("insertHTML", "<ul><li>[ ] </li></ul>");
}

function textOf(node) {
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function escapeMarkdown(text) {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.nodeValue || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const name = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map(inlineMarkdown).join("");
  if (name === "strong" || name === "b") return "**" + inner + "**";
  if (name === "em" || name === "i") return "*" + inner + "*";
  if (name === "code") {
    const tick = String.fromCharCode(96);
    return tick + textOf(node) + tick;
  }
  if (name === "a") return "[" + inner + "](" + (node.getAttribute("href") || "") + ")";
  if (name === "img") {
    const id = assetIDForImage(node);
    const src = id ? "asset://" + id : (node.getAttribute("src") || "");
    return "![" + escapeMarkdown(node.getAttribute("alt") || "") + "](" + src + ")";
  }
  if (name === "br") return "\n";
  return inner;
}

function blockMarkdown(node, index = 0) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.nodeValue || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const name = node.tagName.toLowerCase();
  const inline = () => Array.from(node.childNodes).map(inlineMarkdown).join("").trim();
  if (name === "h1") return "# " + inline() + "\n\n";
  if (name === "h2") return "## " + inline() + "\n\n";
  if (name === "h3") return "### " + inline() + "\n\n";
  if (name === "h4") return "#### " + inline() + "\n\n";
  if (name === "p" || name === "div") return inline() + "\n\n";
  if (name === "blockquote") {
    return Array.from(node.childNodes).map(n => blockMarkdown(n).trim()).join("\n").split("\n").map(line => "> " + line).join("\n") + "\n\n";
  }
  if (name === "pre") return String.fromCharCode(96,96,96) + "\n" + textOf(node) + "\n" + String.fromCharCode(96,96,96) + "\n\n";
  if (name === "ul") return Array.from(node.children).map(li => "- " + inlineMarkdown(li).trim()).join("\n") + "\n\n";
  if (name === "ol") return Array.from(node.children).map((li, i) => (i + 1) + ". " + inlineMarkdown(li).trim()).join("\n") + "\n\n";
  if (name === "li") return "- " + inline() + "\n";
  if (name === "hr") return "---\n\n";
  if (name === "img") return inlineMarkdown(node) + "\n\n";
  return Array.from(node.childNodes).map((child, i) => blockMarkdown(child, i)).join("");
}

function domToMarkdown(root) {
  return Array.from(root.childNodes).map((node, i) => blockMarkdown(node, i)).join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

document.querySelectorAll(".toolbar button").forEach(button => {
  button.addEventListener("mousedown", event => event.preventDefault());
});
document.querySelectorAll("[data-cmd]").forEach(b => b.addEventListener("click", () => exec(b.dataset.cmd)));
document.querySelectorAll("[data-block]").forEach(b => b.addEventListener("click", () => exec("formatBlock", b.dataset.block)));
el("code").addEventListener("click", inlineCode);
el("task").addEventListener("click", insertTask);
el("link").addEventListener("click", insertLink);
el("hr").addEventListener("click", () => exec("insertHorizontalRule"));
el("image").addEventListener("click", async () => {
  ensureEditMode();
  rememberSelection();
  const handled = await chooseNativeImages();
  if (!handled) el("image-file").click();
});
el("image-file").addEventListener("change", e => e.target.files[0] && uploadImage(e.target.files[0]));
el("delete-image").addEventListener("click", deleteSelectedImage);
saveButton.addEventListener("click", save);
readMode.addEventListener("click", () => setMode("read"));
editMode.addEventListener("click", () => setMode("edit"));
editor.addEventListener("input", markDirty);
editor.addEventListener("keyup", rememberSelection);
editor.addEventListener("mouseup", rememberSelection);
editor.addEventListener("click", e => {
  document.querySelectorAll(".inline-editor img.selected").forEach(img => img.classList.remove("selected"));
  selectedImage = e.target.tagName === "IMG" ? e.target : null;
  if (selectedImage) selectedImage.classList.add("selected");
  rememberSelection();
});
document.addEventListener("selectionchange", rememberSelection);
editor.addEventListener("paste", async e => {
  const files = Array.from(e.clipboardData && e.clipboardData.files ? e.clipboardData.files : []);
  const itemFiles = Array.from(e.clipboardData && e.clipboardData.items ? e.clipboardData.items : [])
    .filter(item => item.kind === "file")
    .map(item => item.getAsFile())
    .filter(Boolean);
  const images = files.concat(itemFiles).filter(isImageFile);
  const paths = e.clipboardData ? imagePathsFromClipboard(e.clipboardData) : [];
  if (!images.length && !paths.length) return;
  e.preventDefault();
  rememberSelection();
  for (const file of images) await uploadImage(file);
  for (const path of paths) await uploadImageFromPath(path);
});
window.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && state.mode === "edit") {
    e.preventDefault();
    pasteNativeImages().then(inserted => {
      if (inserted) return;
      navigator.clipboard.readText()
        .then(text => text && exec("insertText", text))
        .catch(() => {});
    });
  }
});
document.addEventListener("contextmenu", e => {
  e.preventDefault();
  menu.hidden = false;
  const x = Math.min(e.clientX, window.innerWidth - 210);
  const y = Math.min(e.clientY, window.innerHeight - 190);
  menu.style.left = Math.max(8, x) + "px";
  menu.style.top = Math.max(8, y) + "px";
});
document.addEventListener("click", e => {
  if (!menu.contains(e.target)) menu.hidden = true;
});
menu.addEventListener("click", async e => {
  const action = e.target.dataset.action;
  if (action === "copy") document.execCommand("copy");
  if (action === "mode") setMode(state.mode === "read" ? "edit" : "read");
  if (action === "image") {
    ensureEditMode();
    await chooseNativeImages();
  }
  if (action === "paste-image") {
    ensureEditMode();
    await pasteNativeImages();
  }
  if (action === "delete-image") {
    ensureEditMode();
    await deleteSelectedImage();
  }
  if (action === "save") await save();
  menu.hidden = true;
});

loadDoc().catch(err => {
  reader.textContent = err.message;
});
</script>
</body>
</html>
`)
	return buf.Bytes()
}

// Page wraps a body fragment in a self-contained HTML document with light
// default styling. title may be empty.
func Page(title string, body []byte) []byte {
	var buf bytes.Buffer
	buf.WriteString(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	buf.WriteString(stdhtml.EscapeString(title))
	buf.WriteString(`</title>
<style>` + defaultCSS + `</style>
</head>
<body><main class="aimd">
`)
	buf.Write(body)
	buf.WriteString(`
</main></body>
</html>
`)
	return buf.Bytes()
}
