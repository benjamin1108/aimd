import { test, expect, Page } from "@playwright/test";

/**
 * Format toolbar coverage.
 *
 * The previous spec only checks the bold button. The toolbar exposes ten
 * commands and every one is a candidate for a regression after the
 * UI refactor (mousedown handlers, execCommand fallthroughs, code wrapping,
 * link createLink). This spec drives each button against a fresh selection
 * and asserts the resulting DOM contains the expected tag.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "正文段落用于格式化测试。\n",
      // Three short paragraphs so each test gets a fresh, untouched paragraph.
      html:
        "<p>第一段正文用于粗体斜体。</p>" +
        "<p>第二段正文用于标题切换。</p>" +
        "<p>第三段正文用于列表与引用。</p>" +
        "<p>第四段正文用于行内代码与链接。</p>",
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
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
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

async function selectParagraph(page: Page, index: number) {
  await page.evaluate((i: number) => {
    const p = document.querySelectorAll("#inline-editor > p")[i];
    if (!p) throw new Error(`paragraph ${i} not found`);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, index);
}

async function enterEditMode(page: Page) {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toBeVisible();
}

test.describe("Format toolbar — every button", () => {
  test("italic wraps selection in <em>/<i>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);
    await page.locator('[data-cmd="italic"]').click();
    await expect(page.locator("#inline-editor i, #inline-editor em")).toHaveCount(1);
  });

  test("strikethrough wraps selection in <s>/<strike>/<del>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);
    await page.locator('[data-cmd="strike"]').click();
    await expect(page.locator("#inline-editor s, #inline-editor strike, #inline-editor del")).toHaveCount(1);
  });

  test("H1/H2/H3 + paragraph cycle through formatBlock", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 1);
    await page.locator('[data-cmd="h1"]').click();
    await expect(page.locator("#inline-editor h1")).toHaveCount(1);

    await page.locator("#inline-editor h1").click();
    await page.locator('[data-cmd="h2"]').click();
    await expect(page.locator("#inline-editor h2")).toHaveCount(1);

    await page.locator("#inline-editor h2").click();
    await page.locator('[data-cmd="h3"]').click();
    await expect(page.locator("#inline-editor h3")).toHaveCount(1);

    await page.locator("#inline-editor h3").click();
    await page.locator('[data-cmd="paragraph"]').click();
    await expect(page.locator("#inline-editor h1, #inline-editor h2, #inline-editor h3")).toHaveCount(0);
  });

  test("unordered list converts a paragraph into a <ul><li>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 2);
    await page.locator('[data-cmd="ul"]').click();
    await expect(page.locator("#inline-editor ul li")).toHaveCount(1);
  });

  test("ordered list converts a paragraph into an <ol><li>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 2);
    await page.locator('[data-cmd="ol"]').click();
    await expect(page.locator("#inline-editor ol li")).toHaveCount(1);
  });

  test("blockquote wraps selection in <blockquote>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 2);
    await page.locator('[data-cmd="quote"]').click();
    await expect(page.locator("#inline-editor blockquote")).toHaveCount(1);
  });

  test("inline code wraps selection in <code>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 3);
    await page.locator('[data-cmd="code"]').click();
    await expect(page.locator("#inline-editor code")).toHaveCount(1);
  });

  test("link prompt creates an <a href>", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 3);

    page.on("dialog", (dlg) => void dlg.accept("https://example.com"));
    await page.locator('[data-cmd="link"]').click();

    await expect(page.locator('#inline-editor a[href="https://example.com"]')).toHaveCount(1);
  });

  test("clicking H1 twice toggles back to paragraph (no font-size stacking)", async ({ page }) => {
    // Bug report: 不停点 H1，字体会越来越大. WebKit's `formatBlock` would let
    // wrappers stack on repeated clicks; the fix is a manual toggle that drops
    // back to <p> when the current block already matches the requested tag.
    await enterEditMode(page);
    await selectParagraph(page, 1);
    await page.locator('[data-cmd="h1"]').click();
    await expect(page.locator("#inline-editor h1")).toHaveCount(1);

    await page.locator("#inline-editor h1").click();
    await page.locator('[data-cmd="h1"]').click();
    // Toggled off → no headings; the original paragraph survives.
    await expect(page.locator("#inline-editor h1")).toHaveCount(0);
    await expect(page.locator("#inline-editor")).toContainText("第二段正文用于标题切换");
  });

  test("clicking blockquote twice unwraps it", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 2);
    await page.locator('[data-cmd="quote"]').click();
    await expect(page.locator("#inline-editor blockquote")).toHaveCount(1);

    await page.locator("#inline-editor blockquote").click();
    await page.locator('[data-cmd="quote"]').click();
    await expect(page.locator("#inline-editor blockquote")).toHaveCount(0);
  });

  test("toolbar buttons preserve selection (mousedown preventDefault)", async ({ page }) => {
    // If a button were to steal focus before its click handler ran, the
    // selection would collapse and bold would no-op. Verify that bold leaves
    // the selection intact and produces a <b>/<strong>.
    await enterEditMode(page);
    await selectParagraph(page, 0);
    await page.locator('[data-cmd="bold"]').click();
    await expect(page.locator("#inline-editor b, #inline-editor strong")).toHaveCount(1);
    // The cursor should still be in the inline editor afterwards.
    const focused = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(focused).toBe("inline-editor");
  });
});
