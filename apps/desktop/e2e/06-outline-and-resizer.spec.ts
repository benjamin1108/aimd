import { test, expect, Page } from "@playwright/test";

/**
 * Outline navigation + sidebar resizer.
 *
 * - Outline must scroll to the matching heading regardless of the active mode.
 *   The renderer copies heading IDs into reader / preview / inline-editor; if
 *   that sync drops in any mode the outline silently no-ops.
 * - The vertical resizer between sections owns pointer-capture state and
 *   writes flex sizes inline. A bug in pointer release would leave the
 *   document body locked into `resizing-v` and selection-disabled.
 */

const LONG_DOC = {
  path: "/mock/long.aimd",
  title: "长文档",
  // Several short headings; we'll measure scroll position relative to the
  // last one to confirm outline navigation works.
  markdown: "# 一级标题\n\n填充段落 A\n\n## 二级\n\n" +
            "填充段落 B\n\n".repeat(20) +
            "## 末尾标题\n\n填充段落 C\n",
  html: "<h1>一级标题</h1><p>填充段落 A</p><h2>二级</h2>" +
        "<p>填充段落 B</p>".repeat(20) +
        "<h2>末尾标题</h2><p>填充段落 C</p>",
  // outline / asset 之间的 resizer 仅在 asset 区有内容时才显示，
  // 这里塞一张占位资源让 sidebar 同时展示两个 section。
  assets: [{
    id: "img-1",
    path: "assets/sample.png",
    mime: "image/png",
    size: 1024,
    sha256: "deadbeef",
    role: "content-image",
    url: "asset://localhost/sample.png",
    localPath: "/tmp/sample.png",
  }],
  dirty: false,
};

async function installTauriMock(page: Page, doc = LONG_DOC) {
  await page.addInitScript((d: typeof LONG_DOC) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_doc_file: () => d.path,
      choose_image_file: () => null,
      open_aimd: () => d,
      save_aimd: (a) => ({ ...d, markdown: (a as any)?.markdown ?? d.markdown, dirty: false }),
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      add_image: () => null,
      list_aimd_assets: () => [],
      load_settings: () => ({ ui: { showAssetPanel: true, debugMode: false } }),
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
  }, doc);
}

test.describe("Outline navigation across modes", () => {
  for (const mode of ["read", "edit", "source"] as const) {
    test(`outline target heading carries an id in ${mode} mode`, async ({ page }) => {
      await installTauriMock(page);
      await page.goto("/");
      await page.locator("#empty-open").click();
      await page.locator(`#mode-${mode}`).click();

      // Sanity: outline has at least three items (h1 + 2× h2).
      const items = page.locator(".outline-item");
      await expect(items).toHaveCount(3);

      // The heading id pipeline should have stamped IDs on the *visible* pane —
      // otherwise outline-click cannot resolve the scroll target and the
      // navigation silently no-ops. This is what failed in edit mode after the
      // refactor: setMode("edit") seeds inline-editor from state.doc.html, and
      // state.doc.html never received the IDs that extractOutlineFromHTML
      // synthesizes at open time.
      const paneSel =
        mode === "read"   ? "#reader" :
        mode === "edit"   ? "#inline-editor" :
                            "#preview";
      const taggedHeadings = await page.locator(`${paneSel} h1[id], ${paneSel} h2[id]`).count();
      expect(taggedHeadings).toBeGreaterThanOrEqual(3);

      // Verify the outline-button data-id actually resolves to a heading
      // inside the visible pane. If the resolution fails, outline-click is a
      // no-op even when scrollTop changes coincidentally.
      const lastId = await items.last().getAttribute("data-id");
      expect(lastId).toBeTruthy();
      const matched = await page.locator(`${paneSel} #${lastId!.replace(/"/g, '\\"')}`).count();
      expect(matched).toBe(1);
    });
  }
});

test.describe("Sidebar resizer", () => {
  // ux-product-audit P1-4：原 doc-section 已经从 sidebar 移走（与 header 重复）。
  // 现在 sidebar 上下两段是 #outline-section 和 #asset-section，
  // 它们之间的 resizer 改名为 #sb-resizer-outline-asset。
  test("dragging the outline/asset resizer changes outline-section flex height", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const resizer = page.locator("#sb-resizer-outline-asset");
    await expect(resizer).toBeVisible();

    const outlineSection = page.locator("#outline-section");
    const before = await outlineSection.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);

    // Use raw mouse events so pointer capture on the resizer engages.
    const box = await resizer.boundingBox();
    if (!box) throw new Error("resizer not laid out");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 60, { steps: 6 });
    await page.mouse.up();

    const after = await outlineSection.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
    expect(after).not.toBe(before);

    // After pointerup, the body must NOT remain in the resizing state, otherwise
    // the whole UI stays locked to ns-resize.
    const stuck = await page.evaluate(() => document.body.classList.contains("resizing-v"));
    expect(stuck).toBe(false);
  });

  test("double-clicking the resizer resets flex", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const resizer = page.locator("#sb-resizer-outline-asset");
    const outlineSection = page.locator("#outline-section");

    // First, force a custom flex via direct drag.
    const box = await resizer.boundingBox();
    if (!box) throw new Error("resizer not laid out");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 50, { steps: 6 });
    await page.mouse.up();

    const customFlex = await outlineSection.evaluate((el: HTMLElement) => el.style.flex);
    expect(customFlex).not.toBe("");

    await resizer.dblclick();
    const reset = await outlineSection.evaluate((el: HTMLElement) => el.style.flex);
    expect(reset).toBe("");
  });

  test("asset-section 无内容时整段折叠（不再常驻空区域）", async ({ page }) => {
    await installTauriMock(page, { ...LONG_DOC, assets: [] });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#outline-section")).toBeVisible();
    await expect(page.locator("#asset-section")).toBeHidden();
    await expect(page.locator("#sb-resizer-outline-asset")).toBeHidden();
  });
});
