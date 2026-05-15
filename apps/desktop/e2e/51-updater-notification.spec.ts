import { test, expect, Page } from "@playwright/test";

type MockMode = "none" | "available" | "fail-check" | "fail-install";

async function installUpdaterMock(page: Page, mode: MockMode = "none") {
  await page.addInitScript((initialMode: MockMode) => {
    const w = window as any;
    w.__updaterMode = initialMode;
    w.__installCount = 0;
    w.__dirtyWindows = [] as Array<{ label: string; title: string; path: string }>;
    const savedDoc = {
      path: "/mock/update-test.aimd",
      title: "更新测试",
      markdown: "# 更新测试\n\n正文。",
      html: "<h1>更新测试</h1><p>正文。</p>",
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const handlers: Record<string, (a?: any) => unknown> = {
      "plugin:app|version": () => "1.0.1",
      initial_open_path: () => null,
      initial_draft_path: () => null,
      load_settings: () => null,
      choose_doc_file: () => "/mock/update-test.aimd",
      open_aimd: () => ({ ...savedDoc }),
      render_markdown_standalone: (a) => ({ html: `<h1>${String(a?.markdown || "").replace(/^#\s*/, "").slice(0, 20)}</h1>` }),
      render_markdown: (a) => ({ html: `<p>${String(a?.markdown || "").slice(0, 80)}</p>` }),
      list_aimd_assets: () => [],
      register_window_path: () => null,
      updater_set_dirty_state: (a) => {
        const dirty = Boolean(a?.dirty);
        w.__dirtyWindows = dirty
          ? [{ label: "main", title: String(a?.title || "未命名文档"), path: String(a?.path || "") }]
          : [];
        return null;
      },
      updater_dirty_documents: () => w.__dirtyWindows,
      updater_focus_dirty_window: () => true,
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: any) => {
        if (handlers[cmd]) return handlers[cmd](a);
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__aimd_updater_mock = {
      check: async () => {
        if (w.__updaterMode === "fail-check") throw new Error("network offline");
        if (w.__updaterMode === "none") return null;
        return {
          version: "1.0.2",
          body: "修复更新流程\n改进安装保护",
          failInstall: w.__updaterMode === "fail-install" ? "download failed" : "",
        };
      },
      install: async () => {
        w.__installCount += 1;
      },
    };
  }, mode);
}

test.describe("production updater UX", () => {
  test("startup no-update path stays quiet", async ({ page }) => {
    await installUpdaterMock(page, "none");
    await page.goto("/");
    await page.waitForTimeout(2600);
    await expect(page.locator("#update-panel")).toBeHidden();
    await expect(page.locator("#status")).toHaveText("就绪");
  });

  test("manual check shows up-to-date state", async ({ page }) => {
    await installUpdaterMock(page, "none");
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-panel")).toBeVisible();
    await expect(page.locator("#update-title")).toHaveText("AIMD 已是最新版本");
    await expect(page.locator("#status")).toHaveText("已是最新版本");
  });

  test("newer update shows versions, notes, and can be dismissed for the session", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-title")).toHaveText("AIMD 1.0.2 可更新");
    await expect(page.locator("#update-message")).toContainText("1.0.1");
    await expect(page.locator("#update-message")).toContainText("1.0.2");
    await expect(page.locator("#update-notes")).toContainText("修复更新流程");

    await page.locator("#update-later").click();
    await expect(page.locator("#update-panel")).toBeHidden();
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: false }));
    await expect(page.locator("#update-panel")).toBeHidden();
  });

  test("dirty document blocks install before download starts", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await page.locator("#empty-new").click();
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-install")).toBeVisible();
    await page.locator("#update-install").click();

    await expect(page.locator("#update-title")).toHaveText("安装更新前需要保存文档");
    await expect(page.locator("#update-message")).toContainText("未命名文档");
    await expect.poll(() => page.evaluate(() => (window as any).__installCount)).toBe(0);
  });

  test("download failure shows an actionable error and preserves document state", async ({ page }) => {
    await installUpdaterMock(page, "fail-install");
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();

    await expect(page.locator("#update-title")).toHaveText("更新安装失败");
    await expect(page.locator("#update-message")).toContainText("download failed");
    await expect(page.locator("#doc-title")).toHaveText("更新测试");
  });
});
