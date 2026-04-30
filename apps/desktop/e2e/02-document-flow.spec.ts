import { test, expect, Page } from "@playwright/test";

/**
 * Mock the Tauri invoke surface so we can drive the UI in a plain Chromium.
 * Tauri V2 routes invoke() through window.__TAURI_INTERNALS__.invoke; stubbing
 * that hook is sufficient to satisfy the @tauri-apps/api/core wrapper.
 */
async function installTauriMock(page: Page, options: { initialPath?: string | null } = {}) {
  const seed = {
    initialPath: options.initialPath ?? null,
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown:
        "# AIMD 样例\n\n这是一段用于 QA 自动化测试的正文。\n\n## 二级标题\n\n- 列表项一\n- 列表项二\n\n```\ncode block\n```\n",
      html:
        "<h1>AIMD 样例</h1><p>这是一段用于 QA 自动化测试的正文。</p><h2>二级标题</h2><ul><li>列表项一</li><li>列表项二</li></ul><pre><code>code block\n</code></pre>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => s.initialPath,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      choose_markdown_file: () => null,
      choose_image_file: () => null,
      choose_save_aimd_file: () => "/mock/saved.aimd",
      open_aimd: () => s.doc,
      create_aimd: (a) => ({ ...s.doc, path: "/mock/new.aimd", markdown: String((a as any)?.markdown ?? ""), dirty: false }),
      save_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown, dirty: false }),
      save_aimd_as: (a) => ({
        ...s.doc,
        path: String((a as any)?.savePath ?? "/mock/saved.aimd"),
        markdown: String((a as any)?.markdown ?? s.doc.markdown),
        dirty: false,
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      render_markdown_standalone: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      add_image: () => null,
      import_markdown: () => s.doc,
      list_aimd_assets: () => [],
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI__ = {
      ...(window as any).__TAURI__,
      core: {
        ...((window as any).__TAURI__?.core ?? {}),
        convertFileSrc,
      },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}

test.describe("Document flow — mocked Tauri", () => {
  test("opens a mocked document via the empty-state CTA", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-open").click();

    await expect(page.locator("#doc-title")).toHaveText("AIMD 样例");
    await expect(page.locator("#reader h1")).toHaveText("AIMD 样例");
    await expect(page.locator("#mode-read")).toHaveClass(/active/);
    await expect(page.locator("#mode-read")).not.toBeDisabled();
    await expect(page.locator("#empty")).toBeHidden();
  });

  test("mode tabs switch and reveal corresponding panes", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader")).toBeVisible();

    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();
    await expect(page.locator("#format-toolbar")).toBeVisible();
    await expect(page.locator("#reader")).toBeHidden();

    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#inline-editor")).toBeHidden();
  });

  test("outline list is populated from rendered headings", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#outline-section")).toBeVisible();
    const items = page.locator(".outline-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("AIMD 样例");
    await expect(items.nth(1)).toContainText("二级标题");
  });

  test("format toolbar issues bold to inline editor selection", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    // Select the first paragraph text and apply bold via the toolbar.
    await page.evaluate(() => {
      const p = document.querySelector("#inline-editor p")!;
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.locator('[data-cmd="bold"]').click();
    await expect(page.locator("#inline-editor p b, #inline-editor p strong")).toHaveCount(1);
  });
});
