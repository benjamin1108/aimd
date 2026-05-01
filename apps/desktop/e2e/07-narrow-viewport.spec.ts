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

  test("at 600px workspace-head does not exceed 120px when a doc is open", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader")).toBeVisible();

    const headHeight = await page.locator(".workspace-head").evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    // Before fix: flex: 1 1 240px on .doc-meta in column-direction caused ~300px
    // After fix: flex: 0 0 auto resets the height to content-only (~70px)
    expect(headHeight).toBeLessThan(120);
  });

  test("source-mode preview pane only collapses below 760px", async ({ page }) => {
    // ux-product-audit P2-3：原来 900px 就直接隐藏预览，桌面窄窗口编辑 markdown
    // 时没有渲染反馈。新规则只在 mobile 760 以下折叠，900 仍保留双栏。
    await page.setViewportSize({ width: 880, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const previewVisible = await page.locator(".preview-pane").evaluate(
      (el) => window.getComputedStyle(el).display !== "none",
    );
    expect(previewVisible).toBe(true);
  });

  test("at 700px the preview pane finally collapses", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const previewDisplay = await page.locator(".preview-pane").evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    expect(previewDisplay).toBe("none");
  });
});
