import { test, expect, Page } from "@playwright/test";

/**
 * GFM round-trip — turndown must preserve tables and task lists when
 * converting inline-editor HTML back to markdown.
 *
 * Round 2 found BUG-006: turndown without `turndown-plugin-gfm` silently
 * flattens <table> rows into bare paragraphs and drops <input type=checkbox>
 * from task lists. Once the user edits + saves, the disk copy is degraded.
 *
 * This spec drives a real ClipboardEvent that delivers a GFM-shaped HTML
 * payload into the inline editor, lets the 700ms flushInline debounce settle
 * by switching to source mode (which calls flushInline directly), and asserts
 * the resulting markdown contains pipe-table syntax and `- [ ]` task list
 * markers. Without the GFM plugin, both assertions fail.
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
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => s.doc,
      save_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown, dirty: false }),
      render_markdown: () => ({ html: s.doc.html }),
      add_image: () => null,
      list_aimd_assets: () => [],
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

test.describe("GFM round-trip", () => {
  test("pasted HTML table survives turndown as pipe-table markdown", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    const tableHTML = `
      <table>
        <thead>
          <tr><th>Name</th><th>Score</th></tr>
        </thead>
        <tbody>
          <tr><td>Alice</td><td>90</td></tr>
          <tr><td>Bob</td><td>85</td></tr>
        </tbody>
      </table>
    `;

    await pasteHTMLIntoEditor(page, tableHTML);

    // Switch to source mode — setMode('source') calls flushInline() directly,
    // bypassing the 700ms debounce. The textarea should now hold pipe-table
    // markdown, not bare-paragraph rubble.
    await page.locator("#mode-source").click();

    const md = await page.locator("#markdown").inputValue();

    // Pipe-table syntax: | Name | Score | + separator row + data rows.
    expect(md).toMatch(/\|\s*Name\s*\|\s*Score\s*\|/);
    expect(md).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);
    expect(md).toMatch(/\|\s*Alice\s*\|\s*90\s*\|/);
    expect(md).toMatch(/\|\s*Bob\s*\|\s*85\s*\|/);
  });

  test("pasted HTML task list survives turndown as `- [ ]` / `- [x]` markdown", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    const taskListHTML = `
      <ul>
        <li><input type="checkbox" disabled> task one</li>
        <li><input type="checkbox" disabled checked> task two</li>
      </ul>
    `;

    await pasteHTMLIntoEditor(page, taskListHTML);

    await page.locator("#mode-source").click();

    const md = await page.locator("#markdown").inputValue();

    // Task-list markers must survive. GFM uses `- [ ]` for unchecked and
    // `- [x]` for checked. Tolerate either case for the checked marker.
    expect(md).toMatch(/-\s*\[\s\]\s*task one/);
    expect(md).toMatch(/-\s*\[[xX]\]\s*task two/);
  });
});
