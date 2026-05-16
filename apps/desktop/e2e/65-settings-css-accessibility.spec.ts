import { expect, Page, test } from "@playwright/test";

async function installSettingsMock(page: Page) {
  await page.addInitScript(() => {
    const settings = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false, theme: "system" },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "load_settings") return settings;
        if (cmd === "save_settings" || cmd === "close_current_window") return null;
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

test.describe("settings CSS and accessibility contract", () => {
  test("tabs have real relationships and roving keyboard navigation", async ({ page }) => {
    await installSettingsMock(page);
    await page.setViewportSize({ width: 760, height: 520 });
    await page.goto("/settings.html");

    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(3);
    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      const id = await tab.getAttribute("id");
      const controls = await tab.getAttribute("aria-controls");
      expect(id).toBeTruthy();
      expect(controls).toBeTruthy();
      await expect(page.locator(`#${controls}`)).toHaveAttribute("aria-labelledby", id!);
    }

    await page.locator("#settings-tab-general").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#settings-tab-model")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.locator("#settings-tab-git")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.locator("#settings-tab-general")).toHaveAttribute("aria-selected", "true");
  });

  test("model errors are announced and small-height actions remain reachable", async ({ page }) => {
    await installSettingsMock(page);
    await page.setViewportSize({ width: 760, height: 500 });
    await page.goto("/settings.html");
    await page.locator("#settings-tab-model").click();
    await page.locator("#test-connection").click();

    await expect(page.locator("#api-key-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#api-key-error")).toBeVisible();
    await expect(page.locator("#save-settings")).toBeInViewport();
  });
});
