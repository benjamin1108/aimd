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
  test("brand, launchpad shell, hidden editor chrome", async ({ page }) => {
    // ux-product-audit P1-6：空态从 marketing hero 改为 launchpad 紧凑布局。
    const trap = trapPageErrors(page);
    await page.goto("/");

    await expect(page.locator(".brand-name")).toHaveText("AIMD");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#empty .launch-main h2")).toHaveText("继续处理文档");

    await expect(page.locator("#empty-new")).toBeVisible();
    await expect(page.locator("#empty-open")).toBeVisible();
    await expect(page.locator("#starter-actions")).toBeHidden();
    await expect(page.locator("#doc-actions")).toBeHidden();

    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#reader")).toBeHidden();
    await expect(page.locator("#inline-editor")).toBeHidden();
    await expect(page.locator("#editor-wrap")).toBeHidden();

    await expect(page.locator("#outline-section")).toBeHidden();
    await expect(page.locator("#asset-section")).toBeHidden();

    expect(trap.errors).toEqual([]);
  });

  test("launchpad exposes new/open actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-mark")).toHaveText("A");
    await expect(page.locator("#empty-new")).toContainText("空白 AIMD 草稿");
    await expect(page.locator("#empty-open")).toContainText("打开 AIMD / Markdown");
    await expect(page.locator("#empty-import")).not.toBeAttached();
  });

  test("launch action and recent panels align without forced slack", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/project/Daily.md", "/mock/project/Report.aimd"]),
      );
    });
    await page.goto("/");
    await expect(page.locator("#recent-section")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el) : null;
      };
      const action = document.querySelector(".launch-command-block")?.getBoundingClientRect();
      const recent = document.querySelector("#recent-section")?.getBoundingClientRect();
      const commandCard = document.querySelector("#empty-new")?.getBoundingClientRect();
      const recentItem = document.querySelector(".recent-item")?.getBoundingClientRect();
      const lastRecentItem = document.querySelector(".recent-item:last-child")?.getBoundingClientRect();
      const commandCardStyle = style("#empty-new");
      const recentItemStyle = style(".recent-item");
      const commandIconStyle = style(".launch-card-icon");
      const recentIconStyle = style(".recent-item-icon");
      const commandLabelStyle = style(".launch-group-label");
      const recentLabelStyle = style(".recent-title");
      const commandTitleStyle = style(".launch-card-title");
      const recentTitleStyle = style(".recent-item-title");
      const commandMetaStyle = style(".launch-card-meta");
      const recentMetaStyle = style(".recent-item-meta");
      return {
        topDelta: action && recent ? Math.abs(action.top - recent.top) : 999,
        cardHeightDelta: commandCard && recentItem ? Math.abs(commandCard.height - recentItem.height) : 999,
        recentBottomPadding: recent && lastRecentItem ? recent.bottom - lastRecentItem.bottom : 999,
        cardBackground: commandCardStyle && recentItemStyle ? [commandCardStyle.backgroundColor, recentItemStyle.backgroundColor] : [],
        cardBorder: commandCardStyle && recentItemStyle ? [commandCardStyle.borderColor, recentItemStyle.borderColor] : [],
        iconBackground: commandIconStyle && recentIconStyle ? [commandIconStyle.backgroundColor, recentIconStyle.backgroundColor] : [],
        iconColor: commandIconStyle && recentIconStyle ? [commandIconStyle.color, recentIconStyle.color] : [],
        labelColor: commandLabelStyle && recentLabelStyle ? [commandLabelStyle.color, recentLabelStyle.color] : [],
        labelFont: commandLabelStyle && recentLabelStyle ? [commandLabelStyle.fontSize, recentLabelStyle.fontSize] : [],
        labelWeight: commandLabelStyle && recentLabelStyle ? [commandLabelStyle.fontWeight, recentLabelStyle.fontWeight] : [],
        titleFont: commandTitleStyle && recentTitleStyle ? [commandTitleStyle.fontSize, recentTitleStyle.fontSize] : [],
        titleWeight: commandTitleStyle && recentTitleStyle ? [commandTitleStyle.fontWeight, recentTitleStyle.fontWeight] : [],
        titleColor: commandTitleStyle && recentTitleStyle ? [commandTitleStyle.color, recentTitleStyle.color] : [],
        metaFont: commandMetaStyle && recentMetaStyle ? [commandMetaStyle.fontSize, recentMetaStyle.fontSize] : [],
        metaColor: commandMetaStyle && recentMetaStyle ? [commandMetaStyle.color, recentMetaStyle.color] : [],
      };
    });

    expect(metrics.topDelta).toBeLessThanOrEqual(1);
    expect(metrics.cardHeightDelta).toBeLessThanOrEqual(1);
    expect(metrics.recentBottomPadding).toBeLessThanOrEqual(18);
    expect(metrics.cardBackground[0]).toBe(metrics.cardBackground[1]);
    expect(metrics.cardBorder[0]).toBe(metrics.cardBorder[1]);
    expect(metrics.iconBackground[0]).toBe(metrics.iconBackground[1]);
    expect(metrics.iconColor[0]).toBe(metrics.iconColor[1]);
    expect(metrics.labelColor[0]).toBe(metrics.labelColor[1]);
    expect(metrics.labelFont[0]).toBe(metrics.labelFont[1]);
    expect(metrics.labelWeight[0]).toBe(metrics.labelWeight[1]);
    expect(metrics.titleFont[0]).toBe(metrics.titleFont[1]);
    expect(metrics.titleWeight[0]).toBe(metrics.titleWeight[1]);
    expect(metrics.titleColor[0]).toBe(metrics.titleColor[1]);
    expect(metrics.metaFont[0]).toBe(metrics.metaFont[1]);
    expect(metrics.metaColor[0]).toBe(metrics.metaColor[1]);
  });

  test("status pill is in idle tone on first paint", async ({ page }) => {
    await page.goto("/");
    const pill = page.locator("#status-pill");
    await expect(pill).toHaveAttribute("data-tone", "idle");
    await expect(page.locator("#status")).toHaveText("就绪");
  });
});
