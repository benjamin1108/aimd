import { test, expect, Page } from "@playwright/test";

/**
 * asset:// references must survive an HTML→Markdown round-trip.
 *
 * The desktop UI must display packed assets through a file/protocol URL rather
 * than `data:`. The *canonical* form on disk is still the asset:// URI. The
 * turndown rule `aimdImage` is supposed to read `data-asset-id` on each <img>
 * and emit `![alt](asset://<id>)`. If that rule were broken — or if
 * `tagAssetImages` stopped tagging images that arrive via the rendered HTML —
 * saving would silently rewrite all images to their rendered URL, decoupling
 * them from the asset table.
 *
 * This spec wires a fake document where the renderer returns an <img> whose
 * src is the mocked desktop asset URL and whose asset id is exposed in
 * state.doc.assets, then asserts that display never falls back to base64
 * while flushInline/save continue to preserve asset:// markdown.
 */

const ASSET_ID = "img-001.png";
const ASSET_FILE_PATH = "/mock/assets/img-001.png";

function mockConvertFileSrc(path: string, protocol = "asset") {
  return `${protocol}://localhost${encodeURI(path)}`;
}

const ASSET_DISPLAY_URL = mockConvertFileSrc(ASSET_FILE_PATH);

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/with-image.aimd",
      title: "含图文档",
      markdown: `# 图片测试\n\n![cover](asset://${ASSET_ID})\n\n后续段落。\n`,
      html: `<h1>图片测试</h1><p><img src="${ASSET_DISPLAY_URL}" alt="cover"></p><p>后续段落。</p>`,
      assets: [
        {
          id: ASSET_ID,
          path: ASSET_FILE_PATH,
          mime: "image/png",
          size: 95,
          sha256: "deadbeef",
          role: "content-image",
          url: ASSET_DISPLAY_URL,
        },
      ],
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`;
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

test.describe("Desktop asset display and round-trip", () => {
  test("opening an asset-backed document renders images via asset/file URLs, never data URLs", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const readerImg = page.locator("#reader img");
    await expect(readerImg).toHaveCount(1);
    await expect(readerImg).toHaveAttribute("src", ASSET_DISPLAY_URL);
    const readerHtml = await page.locator("#reader").innerHTML();
    expect(readerHtml).not.toContain("data:image/");

    await page.locator("#mode-edit").click();
    const inlineImg = page.locator("#inline-editor img");
    await expect(inlineImg).toHaveCount(1);
    await expect(inlineImg).toHaveAttribute("src", ASSET_DISPLAY_URL);
    await expect(inlineImg).toHaveAttribute("data-asset-id", ASSET_ID);
    const inlineHtml = await page.locator("#inline-editor").innerHTML();
    expect(inlineHtml).not.toContain("data:image/");
  });

  test("rendered <img data-asset-id> stays asset:// after turndown", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor img")).toHaveCount(1);

    // The image inside the inline editor must carry the asset id; tagAssetImages
    // is responsible for that mapping. Without it turndown emits the rendered URL.
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
    expect(markdown).not.toContain("data:image/");
    expect(markdown).not.toContain(ASSET_DISPLAY_URL);
  });

  test("save propagates asset:// (not rendered asset URLs or data:) to the backend", async ({ page }) => {
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
    expect(saved).not.toContain("data:image/");
    expect(saved).not.toContain(ASSET_DISPLAY_URL);
  });
});
