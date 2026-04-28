import { test, expect, Page } from "@playwright/test";

/**
 * asset:// references must survive an HTML→Markdown round-trip.
 *
 * The Go renderer turns `asset://<id>` into a `data:` URL for inline display,
 * but the *canonical* form on disk is the asset:// URI. The turndown rule
 * `aimdImage` is supposed to read `data-asset-id` on each <img> and emit
 * `![alt](asset://<id>)`. If that rule were broken — or if `tagAssetImages`
 * stopped tagging images that arrive via the rendered HTML — saving would
 * silently rewrite all images to their data: URLs, bloating the file and
 * decoupling them from the asset table.
 *
 * This spec wires a fake document where the Go renderer (mocked) returns
 * an <img> whose src is a data: URL but whose asset id is exposed in
 * state.doc.assets, and asserts that flushInline produces asset:// markdown.
 */

const ASSET_ID = "img-001.png";
const ASSET_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/with-image.aimd",
      title: "含图文档",
      markdown: `# 图片测试\n\n![cover](asset://${ASSET_ID})\n\n后续段落。\n`,
      // Mirror what the Go renderer does: it materializes asset:// into a data URL.
      html: `<h1>图片测试</h1><p><img src="${ASSET_DATA_URL}" alt="cover"></p><p>后续段落。</p>`,
      assets: [
        {
          id: ASSET_ID,
          path: `assets/${ASSET_ID}`,
          mime: "image/png",
          size: 95,
          sha256: "deadbeef",
          role: "content-image",
          url: ASSET_DATA_URL,
        },
      ],
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    let lastSavedMarkdown = "";
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => s.doc,
      save_aimd: (a) => {
        lastSavedMarkdown = String((a as any)?.markdown ?? "");
        (window as any).__lastSavedMarkdown = lastSavedMarkdown;
        return { ...s.doc, markdown: lastSavedMarkdown, dirty: false };
      },
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      add_image: () => null,
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

test.describe("asset:// references round-trip through the inline editor", () => {
  test("rendered <img data-asset-id> stays asset:// after turndown", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor img")).toHaveCount(1);

    // The image inside the inline editor must carry the asset id; tagAssetImages
    // is responsible for that mapping. Without it turndown emits the raw data: URL.
    const tagged = await page.locator("#inline-editor img").getAttribute("data-asset-id");
    expect(tagged).toBe(ASSET_ID);

    // Trigger an input event to force flushInline; nudge the editor so the
    // "no markdown change" early-out doesn't skip the conversion.
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const p = document.createElement("p");
      p.textContent = "trailing";
      el.appendChild(p);
      el.dispatchEvent(new Event("input"));
    });

    // Wait past the 700ms flushInline debounce.
    await page.waitForTimeout(900);

    const markdown = await page.evaluate(() => (document.getElementById("markdown") as HTMLTextAreaElement).value);
    expect(markdown).toContain(`asset://${ASSET_ID}`);
    expect(markdown).not.toContain("data:image/png;base64");
  });

  test("save propagates asset:// (not data:) to the backend", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();

    // Make a trivial edit to flip dirty, then save via ⌘S.
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const p = document.createElement("p");
      p.textContent = "尾段";
      el.appendChild(p);
      el.dispatchEvent(new Event("input"));
    });

    await page.keyboard.press("Meta+s");
    // Allow the save handler to flush + invoke the mock.
    await page.waitForTimeout(400);

    const saved = await page.evaluate(() => (window as any).__lastSavedMarkdown ?? "");
    expect(saved).toContain(`asset://${ASSET_ID}`);
    expect(saved).not.toContain("data:image/png;base64");
  });
});
