/**
 * 24-link-button-bug.spec.ts
 *
 * Bug 1 (P1): 链接按钮在编辑模式下不起作用
 *
 * 原根因：window.prompt 在 WKWebView 下被静默屏蔽，调用立即返回 null。
 * 修复（BUG-013）：用自定义 HTML 浮层替代 window.prompt。
 *
 * 本 spec 更新为操作自定义浮层 #link-popover，不再依赖 page.on("dialog")。
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "链接测试",
      markdown: "测试链接文字。\n",
      html: "<p>测试链接文字。</p>",
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
      save_aimd: (a) => ({
        ...s.doc,
        markdown: (a as any)?.markdown ?? s.doc.markdown,
        dirty: false,
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
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

async function enterEditMode(page: Page) {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toBeVisible();
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

test.describe("Bug 1 — 链接按钮在编辑模式下的行为", () => {
  /**
   * 核心用例：选中文字 -> 点链接按钮 -> 浮层输入 URL -> 确定 -> <a href> 存在
   */
  test("选中文字后点击链接按钮，应将选中文字包裹为 <a href>（当前可能失败）", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);

    const selTextBefore = await page.evaluate(
      () => window.getSelection()?.toString() ?? "",
    );
    expect(selTextBefore).not.toBe("");

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();
    await page.locator("#link-popover-input").fill("https://example.com");
    await page.locator("#link-popover-confirm").click();

    const linkCount = await page
      .locator('#inline-editor a[href="https://example.com"]')
      .count();
    expect(linkCount).toBe(1);

    const linkText = await page
      .locator('#inline-editor a[href="https://example.com"]')
      .textContent();
    expect((linkText ?? "").length).toBeGreaterThan(0);
  });

  /**
   * 取消浮层时，编辑器不应产生任何 <a> 标签。
   */
  test("prompt 取消后，编辑器不产生 <a> 标签", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();
    await page.locator("#link-popover-cancel").click();

    const linkCount = await page.locator("#inline-editor a").count();
    expect(linkCount).toBe(0);
  });

  /**
   * 链接创建后，焦点应回到编辑器。
   */
  test("链接操作后，焦点仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();
    await page.locator("#link-popover-input").fill("https://example.com");
    await page.locator("#link-popover-confirm").click();

    const focused = await page.evaluate(
      () => document.activeElement?.id ?? "",
    );
    expect(focused).toBe("inline-editor");
  });

  /**
   * 无选中文字时（collapsed selection）点击链接按钮，wrapSelectionInTag 的
   * isCollapsed 检测应阻止打开浮层（因为 runFormatCommand 里 sel.isCollapsed 时
   * 会直接 return 不到 link case）。
   * 实际上 link case 不经过 wrapSelectionInTag，而是直接调 showLinkPopover。
   * 但 showLinkPopover 在 collapsed 时也能开浮层——这是已知行为，
   * createLink 对 collapsed selection 是 no-op，不产生空 <a>。
   */
  test("无选中文字时点击链接按钮，不应插入空 <a> 标签", async ({ page }) => {
    await enterEditMode(page);

    await page.evaluate(() => {
      const p = document.querySelector("#inline-editor > p")!;
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.locator('[data-cmd="link"]').click();

    // 如果浮层出现就取消（collapsed selection 下 createLink 是 no-op）
    const popoverVisible = await page.locator("#link-popover").isVisible();
    if (popoverVisible) {
      await page.locator("#link-popover-input").fill("https://example.com");
      await page.locator("#link-popover-confirm").click();
    }

    const emptyLinks = await page.evaluate(() => {
      const links = document.querySelectorAll("#inline-editor a");
      return Array.from(links).filter(
        (a) => (a.textContent ?? "").trim() === "",
      ).length;
    });
    expect(emptyLinks).toBe(0);
  });
});
