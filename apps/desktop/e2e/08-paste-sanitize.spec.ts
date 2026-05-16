import { test, expect, Page } from "@playwright/test";

/**
 * Paste sanitisation — exercise sanitizePastedHTML end-to-end.
 *
 * Round 1 only audited the source code (BUG-005). Round 2 actually drives a
 * real ClipboardEvent into the inline editor and asserts the dangerous nodes
 * are gone from the live DOM. This is the only thing that proves the regex /
 * querySelectorAll list is correct *and* that the attribute-stripping loop
 * doesn't accidentally re-introduce them via innerHTML round-tripping.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "# 标题\n\n段落。\n",
      html: "<h1>标题</h1><p>段落。</p>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const renderInline = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    const render = (md: string) => ({
      html: md.split(/\n/).map((line) => {
        if (line.startsWith("# ")) return `<h1>${renderInline(line.slice(2))}</h1>`;
        if (line.trim()) return `<p>${renderInline(line)}</p>`;
        return "";
      }).join(""),
    });
    let doc = { ...s.doc, html: render(s.doc.markdown).html, format: "aimd" };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => doc,
      save_aimd: (a) => {
        const markdown = String((a as any)?.markdown ?? doc.markdown);
        doc = { ...doc, markdown, html: render(markdown).html, dirty: false };
        return doc;
      },
      render_markdown: (a) => render(String((a as any)?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String((a as any)?.markdown ?? "")),
      add_image: () => null,
      list_aimd_assets: () => [],
      cleanup_old_drafts: () => undefined,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}

/**
 * Paste an HTML payload into the inline editor by synthesising a real
 * ClipboardEvent with a populated DataTransfer. The editor's listener calls
 * preventDefault + sanitizePastedHTML, so the resulting DOM mirrors the
 * production code path.
 */
async function pasteHTMLIntoEditor(page: Page, html: string) {
  await page.locator("#inline-editor").evaluate((el: HTMLElement, payload: string) => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const dt = new DataTransfer();
    dt.setData("text/html", payload);
    dt.setData("text/plain", payload);
    const evt = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    el.dispatchEvent(evt);
  }, html);
}

test.describe("Paste sanitisation", () => {
  test("strips iframe/object/embed/frame and javascript: hrefs from pasted HTML", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    const malicious = `
      <p>safe paragraph</p>
      <iframe src="https://attacker.example/iframe"></iframe>
      <object data="https://attacker.example/object"></object>
      <embed src="https://attacker.example/embed">
      <frame src="https://attacker.example/frame">
      <frameset></frameset>
      <a href="javascript:alert(1)">click</a>
      <a href="https://example.com">ok link</a>
      <p style="color: red" class="evil" onclick="alert(2)" data-evil="x">styled</p>
      <script>window.__pwned = true;</script>
      <style>body { background: red; }</style>
    `;

    await pasteHTMLIntoEditor(page, malicious);

    await page.locator("#mode-source").click();
    const markdown = await page.locator("#markdown").inputValue();

    const editor = page.locator("#inline-editor");

    // Dangerous embedded-content tags must never reach Markdown source.
    expect(markdown).not.toContain("iframe");
    expect(markdown).not.toContain("object");
    expect(markdown).not.toContain("embed");
    expect(markdown).not.toContain("frame");
    expect(markdown).not.toContain("frameset");
    expect(markdown).not.toContain("script");
    expect(markdown).not.toContain("background: red");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("onclick");
    expect(markdown).not.toContain("data-evil");

    // The script must not have executed.
    const pwned = await page.evaluate(() => (window as any).__pwned === true);
    expect(pwned).toBe(false);

    // Benign content survives as Markdown, not as raw pasted DOM.
    expect(markdown).toContain("safe paragraph");
    expect(markdown).toContain("[ok link](https://example.com)");

    await page.locator("#mode-edit").click();
    await expect(editor).toContainText("safe paragraph");
  });

  test("plaintext-only paste falls through unchanged", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    // No text/html → the listener uses text/plain. No sanitiser path; we just
    // confirm content is inserted and didn't crash.
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);

      const dt = new DataTransfer();
      dt.setData("text/plain", "plain pasted text");
      const evt = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(evt);
    });

    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/段落。plain pasted text/);
  });
});
