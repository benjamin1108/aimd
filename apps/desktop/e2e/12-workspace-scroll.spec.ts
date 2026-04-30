import { test, expect, Page } from "@playwright/test";

/**
 * Workspace-body scroll regression.
 *
 * `.workspace-body` is `display: grid` and stacks reader / inline-editor /
 * editor-split into a single grid cell. Without explicit
 * `grid-template-rows/columns: minmax(0, 1fr)`, the implicit auto track sizes
 * to max-content, the children grow past the viewport, and the
 * `.reader { overflow-y: auto }` scroll never engages. The whole document
 * then becomes unscrollable, which also breaks outline navigation
 * (scrollIntoView has nothing to scroll). Pin the invariant.
 */

const LONG_HTML = "<h1>头</h1>" + "<p>段落 X</p>".repeat(120) + "<h2>尾</h2>";
const LONG_MD = "# 头\n\n" + "段落 X\n\n".repeat(120) + "## 尾\n";

async function installLongDocMock(page: Page) {
  const doc = {
    path: "/mock/long-scroll.aimd",
    title: "长文档",
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

async function installShortDocMock(page: Page) {
  const doc = {
    path: "/mock/short.aimd",
    title: "短文档",
    markdown: "# 短文档\n\n一段正文。\n",
    html: "<h1>短文档</h1><p>一段正文。</p>",
    assets: [] as Array<unknown>,
    dirty: false,
  };
  await page.addInitScript((d: typeof doc) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_markdown_file: () => null,
      choose_image_file: () => null,
      choose_save_aimd_file: () => null,
      open_aimd: () => d,
      create_aimd: () => d,
      save_aimd: () => ({ ...d, dirty: false }),
      save_aimd_as: () => d,
      render_markdown: () => ({ html: d.html }),
      render_markdown_standalone: () => ({ html: d.html }),
      add_image: () => null,
      import_markdown: () => d,
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

async function metrics(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el: HTMLElement) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
}

test.describe("Workspace scrolls when content overflows", () => {
  test("reader is the scroll container in read mode", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    const reader = page.locator("#reader");
    await expect(reader).toBeVisible();

    const m = await metrics(reader);
    // The long body must be larger than the visible viewport: that's the only
    // way overflow:auto can actually scroll. If clientHeight ≈ scrollHeight,
    // the grid track grew to fit the content (the bug we're guarding against).
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight + 200);

    await reader.evaluate((el: HTMLElement) => { el.scrollTop = 400; });
    const top = await reader.evaluate((el: HTMLElement) => el.scrollTop);
    expect(top).toBeGreaterThan(0);
  });

  test("inline editor is the scroll container in edit mode", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    const editor = page.locator("#inline-editor");
    await expect(editor).toBeVisible();

    const m = await metrics(editor);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight + 200);

    await editor.evaluate((el: HTMLElement) => { el.scrollTop = 400; });
    const top = await editor.evaluate((el: HTMLElement) => el.scrollTop);
    expect(top).toBeGreaterThan(0);
  });

  test("preview pane scrolls in source mode", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    const preview = page.locator("#preview");
    await expect(preview).toBeVisible();

    const m = await metrics(preview);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight + 200);
  });

  test("outline click leaves the reader scrolled — and scrolling back is possible", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installLongDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    const reader = page.locator("#reader");
    await expect(reader).toBeVisible();

    // Click the last outline item (h2) → reader should scroll down to it.
    const items = page.locator(".outline-item");
    await items.last().click();

    // Allow smooth-scroll to settle.
    await page.waitForTimeout(400);
    const downTop = await reader.evaluate((el: HTMLElement) => el.scrollTop);
    expect(downTop).toBeGreaterThan(100);

    // The user must be able to scroll back to the top — the bug report said
    // outline clicks "scrolled to the bottom and never came back". Wait for
    // smooth-scroll to settle, then assert that scrollTop returns to 0.
    await page.waitForTimeout(700);
    await reader.evaluate((el: HTMLElement) => {
      el.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    });
    await page.waitForTimeout(50);
    const backTop = await reader.evaluate((el: HTMLElement) => el.scrollTop);
    expect(backTop).toBeLessThanOrEqual(1);
  });

  test("footer stays pinned to the bottom for a short document", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await installShortDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const { workspaceBottom, footerBottom, footerTop, workspaceTop } = await page.evaluate(() => {
      const workspace = document.querySelector(".workspace") as HTMLElement;
      const footer = document.querySelector(".workspace-foot") as HTMLElement;
      const w = workspace.getBoundingClientRect();
      const f = footer.getBoundingClientRect();
      return {
        workspaceTop: w.top,
        workspaceBottom: w.bottom,
        footerTop: f.top,
        footerBottom: f.bottom,
      };
    });

    expect(Math.abs(workspaceBottom - footerBottom)).toBeLessThanOrEqual(1);
    expect(footerTop).toBeGreaterThan(workspaceTop + 200);
  });
});
