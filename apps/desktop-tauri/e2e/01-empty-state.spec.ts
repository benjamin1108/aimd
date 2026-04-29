import { test, expect, Page } from "@playwright/test";

function trapPageErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Tauri IPC failures are expected when running outside the Tauri webview.
      if (/__TAURI__|tauri/i.test(text)) return;
      errors.push(`console: ${text}`);
    }
  });
  return { errors };
}

test.describe("Empty state — running outside Tauri", () => {
  test("brand, launchpad hero, hidden editor chrome", async ({ page }) => {
    const trap = trapPageErrors(page);
    await page.goto("/");

    await expect(page.locator(".brand-name")).toHaveText("AIMD");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#empty h2")).toContainText("把图文文档装进一个文件");
    await expect(page.locator("#empty")).toContainText("发给别人，不丢图");

    await expect(page.locator("#starter-actions")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeHidden();

    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#reader")).toBeHidden();
    await expect(page.locator("#inline-editor")).toBeHidden();
    await expect(page.locator("#editor-wrap")).toBeHidden();

    await expect(page.locator("#outline-section")).toBeHidden();
    await expect(page.locator("#asset-section")).toBeHidden();

    expect(trap.errors).toEqual([]);
  });

  test("launchpad exposes new/open/import actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-mark")).toHaveText("A");
    await expect(page.locator("#empty-new")).toContainText("新建文档");
    await expect(page.locator("#empty-open")).toContainText("打开文件");
    await expect(page.locator("#empty-import")).toContainText("打开 Markdown");
  });

  test("status pill is in idle tone on first paint", async ({ page }) => {
    await page.goto("/");
    const pill = page.locator("#status-pill");
    await expect(pill).toHaveAttribute("data-tone", "idle");
    await expect(page.locator("#status")).toHaveText("就绪");
  });
});
