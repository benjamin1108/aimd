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
  test("brand, empty hero, disabled mode tabs", async ({ page }) => {
    const trap = trapPageErrors(page);
    await page.goto("/");

    await expect(page.locator(".brand-name")).toHaveText("AIMD");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#empty h2")).toContainText("把 .aimd 当作单文件笔记");

    await expect(page.locator("#mode-read")).toBeDisabled();
    await expect(page.locator("#mode-edit")).toBeDisabled();
    await expect(page.locator("#mode-source")).toBeDisabled();
    await expect(page.locator("#save")).toBeDisabled();

    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#reader")).toBeHidden();
    await expect(page.locator("#inline-editor")).toBeHidden();
    await expect(page.locator("#editor-wrap")).toBeHidden();

    await expect(page.locator("#outline-section")).toBeHidden();
    await expect(page.locator("#asset-section")).toBeHidden();

    expect(trap.errors).toEqual([]);
  });

  test("sidebar branding and footer action are present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-mark")).toHaveText("A");
    await expect(page.locator(".footer-action-title")).toContainText("打开 AIMD 文件");
    await expect(page.locator(".footer-action-hint")).toContainText("⌘O");
  });

  test("status pill is in idle tone on first paint", async ({ page }) => {
    await page.goto("/");
    const pill = page.locator("#status-pill");
    await expect(pill).toHaveAttribute("data-tone", "idle");
    await expect(page.locator("#status")).toHaveText("就绪");
  });
});
