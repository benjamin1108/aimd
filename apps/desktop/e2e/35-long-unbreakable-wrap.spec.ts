import { test, expect, Page } from "@playwright/test";

/**
 * Long-unbreakable-string wrap regression.
 *
 * Bug: when a paragraph contains a long run of characters that has no break
 * opportunity (e.g. `aaaaaaaaaa…` ~250 chars, or a long URL/hash), the line
 * cannot wrap. Because `.reader { overflow-y: auto }` makes the spec promote
 * `overflow-x` to `auto` too, an unwanted horizontal scrollbar appears and
 * the viewport width feels "out of control" — the user reported this after
 * reopening a file they had typed long runs into.
 *
 * Contract: with `overflow-wrap: anywhere` on `.aimd`, the rendered paragraph
 * must not exceed the reader's clientWidth, and the reader must not scroll
 * horizontally — regardless of whether we're in read mode or edit mode.
 */

const LONG_RUN = "a".repeat(250);
const LONG_MD = `# 未命名文档\n\n啊啊啊啊啊啊啊啊 ${LONG_RUN}\n`;
const LONG_HTML = `<h1>未命名文档</h1><p>啊啊啊啊啊啊啊啊 ${LONG_RUN}</p>`;

async function installLongRunMock(page: Page) {
  const doc = {
    path: "/mock/long-run.aimd",
    title: "未命名文档",
    markdown: LONG_MD,
    html: LONG_HTML,
    assets: [] as Array<unknown>,
    dirty: false,
  };
  await page.addInitScript((d: typeof doc) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_doc_file: () => d.path,
      choose_image_file: () => null,
      open_aimd: () => d,
      save_aimd: () => ({ ...d, dirty: false }),
      render_markdown: () => ({ html: d.html }),
      render_markdown_standalone: () => ({ html: d.html }),
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
  }, doc);
}

test.describe("Long unbreakable strings wrap inside the reader", () => {
  test("read mode: paragraph never overflows reader width", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongRunMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const reader = page.locator("#reader");
    await expect(reader).toBeVisible();

    const m = await reader.evaluate((el: HTMLElement) => {
      const p = el.querySelector("p") as HTMLElement | null;
      return {
        readerScrollWidth: el.scrollWidth,
        readerClientWidth: el.clientWidth,
        pScrollWidth: p ? p.scrollWidth : 0,
        pClientWidth: p ? p.clientWidth : 0,
      };
    });

    // The paragraph must fit inside its containing block.
    expect(m.pScrollWidth).toBeLessThanOrEqual(m.pClientWidth + 1);
    // And the reader itself must not become horizontally scrollable.
    expect(m.readerScrollWidth).toBeLessThanOrEqual(m.readerClientWidth + 1);
  });

  test("edit mode: paragraph never overflows inline editor width", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongRunMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    const editor = page.locator("#inline-editor");
    await expect(editor).toBeVisible();

    const m = await editor.evaluate((el: HTMLElement) => {
      const p = el.querySelector("p") as HTMLElement | null;
      return {
        editorScrollWidth: el.scrollWidth,
        editorClientWidth: el.clientWidth,
        pScrollWidth: p ? p.scrollWidth : 0,
        pClientWidth: p ? p.clientWidth : 0,
      };
    });

    expect(m.pScrollWidth).toBeLessThanOrEqual(m.pClientWidth + 1);
    expect(m.editorScrollWidth).toBeLessThanOrEqual(m.editorClientWidth + 1);
  });
});
