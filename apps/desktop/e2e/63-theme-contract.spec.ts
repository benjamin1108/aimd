import { expect, Page, test } from "@playwright/test";

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
  ui: { showAssetPanel: false, debugMode: false, theme: "dark" },
};

async function installSettingsMock(page: Page, initialSettings = settings) {
  await page.addInitScript((initial) => {
    const state = { settings: initial, saved: null as unknown };
    (window as any).__settingsThemeMock = state;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        if (cmd === "load_settings") return state.settings;
        if (cmd === "save_settings") {
          state.saved = args.settings;
          state.settings = args.settings;
          return null;
        }
        if (cmd === "close_current_window") return null;
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, initialSettings);
}

test.describe("theme contract", () => {
  test("desktop applies persisted theme before user interaction", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "dark");
  });

  test("system theme resolves color scheme before desktop render", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await installSettingsMock(page, { ...settings, ui: { ...settings.ui, theme: "system" } });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain("dark");
  });

  test("dark theme exposes complete semantic color slots", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/");
    const failures = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(name).trim();
      const parseColor = (value: string) => {
        const raw = value.trim();
        let match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (match) {
          let hex = match[1];
          if (hex.length === 3) hex = hex.split("").map((part) => part + part).join("");
          return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
            a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
          };
        }
        match = raw.match(/^rgba?\(([^)]+)\)$/i);
        if (!match) return null;
        const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
        if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
        return { r: parts[0], g: parts[1], b: parts[2], a: Number.isNaN(parts[3]) ? 1 : parts[3] };
      };
      const mixOver = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number; a: number }) => {
        const alpha = fg.a ?? 1;
        return {
          r: fg.r * alpha + bg.r * (1 - alpha),
          g: fg.g * alpha + bg.g * (1 - alpha),
          b: fg.b * alpha + bg.b * (1 - alpha),
          a: 1,
        };
      };
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color: { r: number; g: number; b: number }) => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
      const contrast = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number; a: number }) => {
        const resolvedFg = mixOver(fg, bg);
        const lighter = Math.max(luminance(resolvedFg), luminance(bg));
        const darker = Math.min(luminance(resolvedFg), luminance(bg));
        return (lighter + 0.05) / (darker + 0.05);
      };
      const foregrounds: Array<[string, number]> = [
        ["--ink", 4.5],
        ["--ink-strong", 4.5],
        ["--ink-muted", 4.5],
        ["--ink-faint", 3],
        ["--tone-success", 4.5],
        ["--tone-warn", 4.5],
        ["--tone-info", 4.5],
        ["--tone-danger", 4.5],
        ["--nav-active-fg", 4.5],
        ["--git-added-text", 4.5],
        ["--git-removed-text", 4.5],
        ["--git-modified-text", 4.5],
        ["--markdown-heading", 4.5],
        ["--markdown-code-fence", 4.5],
        ["--markdown-code", 4.5],
        ["--markdown-quote", 4.5],
        ["--markdown-list", 4.5],
        ["--markdown-table", 4.5],
        ["--markdown-image", 4.5],
      ];
      const backgrounds = [
        "--surface-panel",
        "--surface-panel-raised",
        "--surface-rail",
        "--surface-document",
        "--surface-document-soft",
        "--surface-source",
        "--surface-popover-core",
        "--surface-code",
        "--surface-table-head",
      ];
      const failed: string[] = [];
      for (const [fgName, threshold] of foregrounds) {
        const fg = parseColor(read(fgName));
        if (!fg) {
          failed.push(`${fgName} is not parseable`);
          continue;
        }
        for (const bgName of backgrounds) {
          const bg = parseColor(read(bgName));
          if (!bg) {
            failed.push(`${bgName} is not parseable`);
            continue;
          }
          const ratio = contrast(fg, bg);
          if (ratio < threshold) failed.push(`${fgName} on ${bgName}: ${ratio.toFixed(2)}`);
        }
      }
      return failed;
    });
    expect(failures).toEqual([]);
  });

  test("settings changes theme immediately and persists the enum", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/settings.html");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.locator("#ui-theme").selectOption("high-contrast");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high-contrast");
    await page.locator("#save-settings").click();

    const savedTheme = await page.evaluate(() => (window as any).__settingsThemeMock.saved.ui.theme);
    expect(savedTheme).toBe("high-contrast");
  });
});
