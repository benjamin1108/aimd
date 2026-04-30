/**
 * 28-link-button-regression.spec.ts
 *
 * Bug B (P1, 回归): 链接按钮在 Tauri/WKWebView 下点击没有任何反应
 *
 * 根因：window.prompt 在 WKWebView 下被静默屏蔽，调用立即返回 null，
 * 导致链接创建逻辑完全跳过。
 *
 * 修复方案（BUG-013）：用自定义 HTML 浮层替代 window.prompt。
 * 点击链接按钮后显示 #link-popover，用户输入 URL 后点确定/按 Enter 创建链接。
 *
 * 本 spec 更新为操作自定义浮层，不再使用 page.on("dialog")。
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/link-test.aimd",
      title: "链接回归测试",
      markdown: "请选中这段文字再点链接按钮。\n",
      html: "<p>请选中这段文字再点链接按钮。</p>",
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

async function selectFirstParagraph(page: Page) {
  await page.evaluate(() => {
    const p = document.querySelector("#inline-editor > p");
    if (!p) throw new Error("paragraph not found");
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test.describe("Bug B — 链接按钮自定义浮层（BUG-013 修复验证）", () => {
  /**
   * 核心断言：点击链接按钮后，自定义浮层 #link-popover 变为可见。
   * 修复前：window.prompt 被 WKWebView 屏蔽，点击无任何反应。
   * 修复后：显示自定义 HTML 浮层，用户可输入 URL。
   */
  test("点击链接按钮后显示自定义链接浮层", async ({ page }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    // 浮层初始应该隐藏
    await expect(page.locator("#link-popover")).toBeHidden();

    await page.locator('[data-cmd="link"]').click();

    // 浮层应该显示
    await expect(page.locator("#link-popover")).toBeVisible();

    // 输入框应该获得焦点，值为 https://
    await expect(page.locator("#link-popover-input")).toBeFocused();
  });

  /**
   * 完整流程：选中文字 -> 点链接按钮 -> 浮层输入 URL -> 点确定 -> 断言 <a href> 存在
   */
  test("完整流程：浮层输入 URL 并确定后，选中文字变成 <a href>", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 清空默认值，输入测试 URL
    await page.locator("#link-popover-input").fill("https://aimd.app");

    // 点确定按钮
    await page.locator("#link-popover-confirm").click();

    // 浮层应该关闭
    await expect(page.locator("#link-popover")).toBeHidden();

    // 编辑器里应该有 <a href="https://aimd.app">
    await expect(
      page.locator('#inline-editor a[href="https://aimd.app"]'),
    ).toHaveCount(1);

    const linkText = await page
      .locator('#inline-editor a[href="https://aimd.app"]')
      .textContent();
    expect((linkText ?? "").length).toBeGreaterThan(0);
  });

  /**
   * 点取消按钮后，浮层关闭，编辑器内不应有 <a> 标签。
   */
  test("点取消按钮后浮层关闭，无 <a> 标签残留", async ({ page }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    await page.locator("#link-popover-cancel").click();

    await expect(page.locator("#link-popover")).toBeHidden();
    const linkCount = await page.locator("#inline-editor a").count();
    expect(linkCount).toBe(0);
  });

  /**
   * 在浮层输入框内按 Enter 键，等价于点确定按钮。
   */
  test("浮层输入 URL 后按 Enter 键确认创建链接", async ({ page }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    await page.locator("#link-popover-input").fill("https://enter-test.com");
    await page.locator("#link-popover-input").press("Enter");

    await expect(page.locator("#link-popover")).toBeHidden();
    await expect(
      page.locator('#inline-editor a[href="https://enter-test.com"]'),
    ).toHaveCount(1);
  });

  /**
   * 键盘快捷键 Cmd+K 也应该触发链接浮层（与按钮等价）
   */
  test("键盘快捷键 Cmd+K 也能触发链接浮层", async ({ page }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    // 把焦点放回编辑区
    await page.locator("#inline-editor").click();
    await selectFirstParagraph(page);

    await page.keyboard.press("Meta+k");

    await expect(page.locator("#link-popover")).toBeVisible();

    // 取消关闭浮层
    await page.locator("#link-popover-cancel").click();
    await expect(page.locator("#link-popover")).toBeHidden();
  });

  /**
   * 在浮层输入框内按 Escape 键，等价于点取消按钮。
   */
  test("浮层内按 Escape 键取消，无链接残留", async ({ page }) => {
    await enterEditMode(page);
    await selectFirstParagraph(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    await page.locator("#link-popover-input").press("Escape");

    await expect(page.locator("#link-popover")).toBeHidden();
    const linkCount = await page.locator("#inline-editor a").count();
    expect(linkCount).toBe(0);
  });
});
