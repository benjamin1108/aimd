import { test, expect, Page } from "@playwright/test";

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
      ui: { showAssetPanel: false, debugMode: false },
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

test.describe("settings bootstrap resilience", () => {
  test("module startup failure shows an error instead of a blank page", async ({ page }) => {
    await page.route("**/src/settings/template.ts*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "throw new Error('settings template import failed');",
      });
    });

    await page.goto("/settings.html");

    await expect(page.locator("#settings-app")).toContainText("设置加载失败", { timeout: 10_000 });
    await expect(page.locator("#settings-app")).toContainText(/settings template import failed|does not provide an export|设置页启动超时/);
  });

  test("invalid nav target falls back to the general section", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/settings.html");

    const activeSection = page.locator(".settings-section:not([hidden])");
    await expect(activeSection).toHaveAttribute("data-section", "general");

    await page.evaluate(() => {
      const modelNav = document.querySelector<HTMLButtonElement>(".settings-nav-item[data-section='model']");
      if (!modelNav) throw new Error("missing model nav");
      modelNav.dataset.section = "missing-section";
      modelNav.click();
    });

    await expect(activeSection).toHaveAttribute("data-section", "general");
    await expect(page.locator(".settings-nav-item.is-active")).toHaveAttribute("data-section", "general");
  });
});
