import { test, expect, Page } from "@playwright/test";

/**
 * Narrow-viewport (< 760px) layout regression.
 *
 * The CSS contract in styles.css around `@media (max-width: 760px)` says:
 *  - .panel collapses to a single column
 *  - .sidebar is hidden (display: none)
 *  - .doc-path max-width tightens to 50vw
 *
 * If a future refactor drops or renames any of these rules, the workspace
 * will overflow horizontally on small windows and users won't be able to
 * read content. This spec pins the contract so it can't silently break.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "# AIMD 样例\n\n正文一段。\n",
      html: "<h1>AIMD 样例</h1><p>正文一段。</p>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => s.doc,
      save_aimd: () => ({ ...s.doc, dirty: false }),
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

test.describe("Narrow viewport (< 760px) layout", () => {
  test("at 600px sidebar collapses and panel uses a single column", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader")).toBeVisible();

    // The sidebar must be effectively hidden (display: none via @media rule).
    const sidebarDisplay = await page.locator(".sidebar").evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    expect(sidebarDisplay).toBe("none");

    // The panel grid must collapse to a single track. computedStyle returns
    // the resolved track sizes, so we just assert it's not the 244px+1fr layout.
    const gridCols = await page.locator(".panel").evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns,
    );
    // At 244px+1fr the first track resolves to "244px <something>"; collapsed
    // it should be a single track.
    expect(gridCols.split(/\s+/).length).toBe(1);

    // Workspace must not be wider than the viewport (no horizontal overflow).
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("at 600px the empty-state CTA is reachable before opening anything", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await installTauriMock(page);
    await page.goto("/");

    // Even with sidebar hidden, empty-state lives inside the workspace and
    // must remain clickable so first-run users can open a file.
    await expect(page.locator("#empty-open")).toBeVisible();
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader h1")).toHaveText("AIMD 样例");
  });

  test("at 600px document command strip stays compact when a doc is open", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader")).toBeVisible();

    const stripHeight = await page.locator("#document-command-strip").evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(stripHeight).toBeLessThan(120);
  });

  test("edit-mode preview pane stays visible at 880px", async ({ page }) => {
    // Markdown 编辑面板在窄桌面仍保留源码和预览，避免编辑时失去渲染反馈。
    await page.setViewportSize({ width: 880, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const previewVisible = await page.locator(".preview-pane").evaluate(
      (el) => window.getComputedStyle(el).display !== "none",
    );
    expect(previewVisible).toBe(true);
  });

  test("at 700px the edit panel stacks source and preview vertically", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const previewDisplay = await page.locator(".preview-pane").evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    expect(previewDisplay).toBe("flex");

    const splitColumns = await page.locator("#editor-wrap").evaluate(
      (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/),
    );
    expect(splitColumns).toHaveLength(1);
  });
});
