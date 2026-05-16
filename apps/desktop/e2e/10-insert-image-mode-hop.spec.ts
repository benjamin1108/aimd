import { test, expect, Page } from "@playwright/test";

/**
 * Insert-image followed by an immediate mode hop.
 *
 * insertImageInline mutates the inline editor DOM directly and then fires a
 * single 'input' event, which schedules flushInline on a 700ms debounce.
 * If the user clicks "源码" within that window, setMode("source") must
 * synchronously flush before swapping panes; otherwise the freshly-inserted
 * <img data-asset-id> is gone from state.doc.markdown and gets silently
 * dropped on the next save.
 *
 * This codifies the contract that the round-1 BUG-001 fix relies on:
 * setMode flushes when leaving edit mode, regardless of debounce state.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例",
      markdown: "# 样例\n\n正文。\n",
      html: "<h1>样例</h1><p>正文。</p>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
    addedAsset: {
      asset: {
        id: "asset-001.png",
        path: "assets/asset-001.png",
        mime: "image/png",
        size: 1024,
        sha256: "abc123",
        role: "content-image",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      },
      uri: "asset://asset-001.png",
      markdown: "![asset 001](asset://asset-001.png)",
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      // Return a fake image path so insertImage proceeds past the dialog.
      choose_image_file: () => "/mock/image.png",
      // insertImage now calls read_image_bytes first, then add_image_bytes.
      read_image_bytes: () => [137, 80, 78, 71],
      add_image_bytes: () => ({
        ...s.addedAsset,
        asset: {
          ...s.addedAsset.asset,
          url: convertFileSrc(s.addedAsset.asset.path),
        },
      }),
      open_aimd: () => s.doc,
      save_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown, dirty: false }),
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 200)}</p>` }),
      add_image: () => s.addedAsset,
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

test.describe("Insert image then hop modes", () => {
  test("inserting an image and immediately leaving edit mode flushes asset:// to markdown", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // Trigger the toolbar image button — it ultimately calls insertImageInline
    // which appends an <img data-asset-id> to the inline editor.
    await page.locator('[data-cmd="image"]').click();
    await expect(
      page.locator('#inline-editor img[data-asset-id="asset-001.png"]'),
    ).toHaveCount(1);

    // Immediately hop to source — well under the 700ms flushInline debounce.
    // setMode("source") must synchronously flush so the textarea shows the
    // freshly-inserted asset markdown.
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const md = await page.locator("#markdown").inputValue();
    expect(md).toContain("asset://asset-001.png");
  });

  test("inserting an image in edit mode is visible in read mode without saving", async ({ page }) => {
    // Bug report: 在编辑模式下插入了图片，然后切到阅读模式，这个图片就消失了，
    // 必须要点保存再切过去才会显示. setMode used to only sync inline-editor
    // on entry; reader/preview were last painted by applyHTML at open/save
    // time, so any unsaved edit-mode mutation (image, formatting, typing)
    // was invisible after a mode hop.
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.locator('[data-cmd="image"]').click();
    await expect(
      page.locator('#inline-editor img[data-asset-id="asset-001.png"]'),
    ).toHaveCount(1);

    // Hop to read mode without saving. The image must be in the reader DOM.
    await page.locator("#mode-read").click();
    await expect(page.locator("#reader")).toBeVisible();
    await expect(
      page.locator('#reader img[data-asset-id="asset-001.png"]'),
    ).toHaveCount(1);

    // And hop again to source mode — the preview pane should also have it.
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();
    await expect(
      page.locator('#preview img[data-asset-id="asset-001.png"]'),
    ).toHaveCount(1);
  });

  test("inserting an image and pressing save immediately persists the asset", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    let savedMarkdown = "";
    await page.exposeFunction("__captureSave", (md: string) => {
      savedMarkdown = md;
    });
    await page.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = async (cmd: string, a: any) => {
        if (cmd === "save_aimd") {
          await (window as any).__captureSave(a?.markdown ?? "");
        }
        return original(cmd, a);
      };
    });

    await page.locator('[data-cmd="image"]').click();
    await expect(
      page.locator('#inline-editor img[data-asset-id="asset-001.png"]'),
    ).toHaveCount(1);

    // ⌘S without waiting out the debounce. saveDocument calls flushInline
    // when state.mode === "edit" so the freshly inserted image must be in
    // the markdown payload.
    await page.locator("#more-menu-toggle").click();
    await page.locator("#save").click();

    // Allow the invoke promise to resolve.
    await page.waitForTimeout(150);
    expect(savedMarkdown).toContain("asset://asset-001.png");
  });
});
