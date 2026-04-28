package render

const defaultCSS = `
:root {
  --fg: #1f2328;
  --muted: #59636e;
  --bg: #ffffff;
  --border: #d1d9e0;
  --code-bg: #f6f8fa;
  --link: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6edf3;
    --muted: #9198a1;
    --bg: #0d1117;
    --border: #30363d;
    --code-bg: #161b22;
    --link: #4493f8;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
main.aimd { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
main.aimd h1, main.aimd h2, main.aimd h3, main.aimd h4 { line-height: 1.25; margin-top: 1.6em; margin-bottom: 0.6em; }
main.aimd h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
main.aimd h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
main.aimd p { margin: 0.8em 0; }
main.aimd a { color: var(--link); text-decoration: none; }
main.aimd a:hover { text-decoration: underline; }
main.aimd img { max-width: 100%; height: auto; border-radius: 6px; }
main.aimd code { background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.92em; font-family: SFMono-Regular, Menlo, Consolas, monospace; }
main.aimd pre { background: var(--code-bg); padding: 16px; border-radius: 6px; overflow-x: auto; }
main.aimd pre code { background: transparent; padding: 0; }
main.aimd blockquote { border-left: 4px solid var(--border); margin: 1em 0; padding: 0 1em; color: var(--muted); }
main.aimd table { border-collapse: collapse; margin: 1em 0; }
main.aimd th, main.aimd td { border: 1px solid var(--border); padding: 6px 12px; }
main.aimd th { background: var(--code-bg); }
main.aimd hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
`

const editorCSS = `
body.editor-shell {
  min-height: 100vh;
  overflow: hidden;
  background: #f7f8fa;
}
@media (prefers-color-scheme: dark) {
  body.editor-shell { background: #0b0f14; }
}
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  backdrop-filter: blur(18px);
}
.topbar-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 10px 16px 8px;
}
.doc-meta {
  min-width: 120px;
  flex: 1;
}
.doc-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
  line-height: 1.25;
}
.doc-status {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.2;
}
.doc-status[data-tone="dirty"] { color: #9a6700; }
.doc-status[data-tone="saved"] { color: #1a7f37; }
.doc-status[data-tone="error"] { color: #cf222e; }
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.mode-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--code-bg);
}
.mode-button,
.toolbar button,
.context-menu button,
.primary {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--fg);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 80ms ease;
}
.mode-button {
  height: 28px;
  min-width: 48px;
  padding: 0 12px;
  background: transparent;
}
.mode-button:hover {
  background: color-mix(in srgb, var(--border) 35%, transparent);
}
.mode-button.active {
  background: var(--bg);
  border-color: var(--border);
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 16px 10px;
  overflow-x: auto;
}
body[data-mode="read"] .toolbar {
  display: none;
}
.tool-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--border);
}
.tool-group:last-child { border-right: 0; }
.toolbar button {
  height: 30px;
  min-width: 34px;
  padding: 0 10px;
  background: transparent;
  border-color: transparent;
  white-space: nowrap;
}
.toolbar button:hover:not(:disabled) {
  background: var(--code-bg);
  border-color: var(--border);
}
.toolbar button:active:not(:disabled),
.mode-button:active:not(:disabled),
.primary:active:not(:disabled) {
  transform: translateY(1px);
}
.toolbar button:focus-visible,
.mode-button:focus-visible,
.primary:focus-visible,
.context-menu button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--link) 65%, transparent);
  outline-offset: 2px;
}
.primary {
  height: 32px;
  padding: 0 14px;
  border-color: var(--link);
  background: var(--link);
  color: #fff;
}
.primary:hover:not(:disabled) {
  filter: brightness(1.05);
}
.toolbar button:disabled,
.primary:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}
body.editor-shell > main.aimd {
  height: calc(100vh - 56px);
  overflow: auto;
  margin-top: 56px;
  background: var(--bg);
}
.inline-editor {
  height: calc(100vh - 101px);
  overflow: auto;
  outline: 0;
  margin-top: 101px;
  background: var(--bg);
}
body[data-mode="edit"] > main.aimd {
  height: calc(100vh - 101px);
  margin-top: 101px;
}
.inline-editor[contenteditable="true"] {
  caret-color: var(--link);
}
.inline-editor[contenteditable="true"]:focus {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--link) 24%, transparent);
}
.inline-editor[contenteditable="true"] p:hover,
.inline-editor[contenteditable="true"] li:hover,
.inline-editor[contenteditable="true"] h1:hover,
.inline-editor[contenteditable="true"] h2:hover,
.inline-editor[contenteditable="true"] h3:hover,
.inline-editor[contenteditable="true"] blockquote:hover {
  background: color-mix(in srgb, var(--link) 5%, transparent);
}
.inline-editor img {
  cursor: default;
  transition: outline-color 120ms ease, box-shadow 120ms ease;
}
.inline-editor img:hover {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--link) 18%, transparent);
}
.inline-editor img.selected {
  outline: 3px solid var(--link);
  outline-offset: 3px;
}
.context-menu {
  position: fixed;
  z-index: 20;
  display: grid;
  gap: 2px;
  min-width: 188px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  box-shadow: 0 18px 42px rgba(0,0,0,0.22);
}
.context-menu[hidden] { display: none; }
.context-menu button {
  height: 28px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0 9px;
}
.context-menu button:hover {
  background: var(--code-bg);
}
@media (max-width: 760px) {
  body.editor-shell { overflow: auto; }
  .topbar-main { align-items: flex-start; flex-direction: column; gap: 8px; }
  .topbar-actions { width: 100%; justify-content: space-between; }
  .toolbar { width: 100%; }
  body.editor-shell > main.aimd,
  .inline-editor {
    height: calc(100vh - 104px);
    margin-top: 104px;
  }
  body[data-mode="edit"] > main.aimd,
  body[data-mode="edit"] .inline-editor {
    height: calc(100vh - 146px);
    margin-top: 146px;
  }
}
`
