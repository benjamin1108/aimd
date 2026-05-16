/**
 * 37-more-menu-close-action.spec.ts
 *
 * 钉住 #close 按钮移入 ⋯ 菜单后，必须通过展开菜单才能触发。
 * 同时验证：
 * - 关闭并不是破坏性动作，所以 #close 不再带 action-menu-item--danger
 * - 菜单中有分隔线（action-menu-sep）
 * - 展开后 #close 可见并可点击
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, unknown> | undefined;
    const doc = {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "# 样例文档\n\n正文。\n",
      html: "<h1>样例文档</h1><p>正文。</p>",
      assets: [],
      dirty: false,
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      list_aimd_assets: () => [],
      confirm_discard_changes: () => "discard",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

test.describe("⋯ 菜单关闭文档入口", () => {
  test("#more-menu 默认折叠，点 ⋯ 展开后 #close 可见", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-actions")).toBeVisible();

    // 展开前 #more-menu 应当 hidden
    await expect(page.locator("#more-menu")).toBeHidden();

    // 点击 ⋯ 展开
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu")).toBeVisible();
    await expect(page.locator("#close")).toBeVisible();
  });

  test("#close 不带危险样式 class（关闭并非破坏性动作）", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#close")).not.toHaveClass(/action-menu-item--danger/);
  });

  test("菜单中有分隔线 action-menu-divider", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu .action-menu-divider").first()).toBeVisible();
  });

  test("展开菜单后点 #close 可以关闭文档", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader")).toBeVisible();

    await page.locator("#more-menu-toggle").click();
    await page.locator("#close").click();

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeHidden();
  });

  test("点击菜单外区域关闭 ⋯ 菜单", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu")).toBeVisible();

    // 点击菜单外的工作区空白处应关闭菜单
    await page.mouse.click(24, 220);
    await expect(page.locator("#more-menu")).toBeHidden();
  });
});
