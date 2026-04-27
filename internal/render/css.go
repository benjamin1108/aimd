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
