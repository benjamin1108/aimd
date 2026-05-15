import { test, expect, Page } from "@playwright/test";

type MockMode = "none" | "available" | "fail-check" | "fail-install" | "progress" | "unknown-size";

type MockOptions = {
  autoDelayMs?: number;
  autoIntervalMs?: number;
};

async function installUpdaterMock(page: Page, mode: MockMode = "none", opts: MockOptions = {}) {
  await page.addInitScript(({ initialMode, options }: { initialMode: MockMode; options: MockOptions }) => {
    const w = window as any;
    const listeners = new Map<number, { event: string; handler: Function }>();
    let nextListenerId = 1;
    w.__updaterMode = initialMode;
    w.__checkCount = 0;
    w.__installCount = 0;
    w.__focusCount = 0;
    w.__dirtyWindows = [] as Array<{ label: string; title: string; path: string }>;
    w.__clipboardText = "";
    w.__nativeOpenCalls = [] as Array<{ cmd: string; args?: any }>;
    w.__aimdUpdaterAutoCheckDelayMs = options.autoDelayMs ?? 60_000;
    w.__aimdUpdaterAutoCheckIntervalMs = options.autoIntervalMs ?? 24 * 60 * 60 * 1000;
    w.__aimdUpdaterAutoCheckJitterMs = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__clipboardText = text;
        },
      },
    });
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
      "plugin:event|listen": (a) => {
        const id = nextListenerId++;
        listeners.set(id, { event: String(a?.event ?? ""), handler: a?.handler });
        return id;
      },
      "plugin:app|version": () => "1.0.1",
      initial_open_path: () => null,
      initial_draft_path: () => null,
      load_settings: () => null,
      updater_platform: () => "darwin-aarch64",
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
      updater_focus_dirty_window: () => {
        w.__focusCount += 1;
        return true;
      },
      open_aimd_release_url: (a) => {
        w.__nativeOpenCalls.push({ cmd: "open_aimd_release_url", args: a });
        return null;
      },
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: any) => {
        if (handlers[cmd]) return handlers[cmd](a);
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__aimdEmitTauriEvent = (event: string, payload: unknown) => {
      for (const item of listeners.values()) {
        if (item.event === event) item.handler({ event, payload });
      }
    };
    w.__aimd_updater_mock = {
      check: async () => {
        w.__checkCount += 1;
        if (w.__updaterMode === "fail-check") throw new Error("network offline");
        if (w.__updaterMode === "none") return null;
        if (w.__updaterMode === "progress") {
          return {
            version: "1.0.2",
            body: "修复更新流程\n改进安装保护\nhttps://github.com/benjamin1108/aimd/releases",
            contentLength: 10 * 1024 * 1024,
            progressEvents: [
              { chunkLength: 4 * 1024 * 1024, delayMs: 500, timeMs: 1000 },
              { chunkLength: 3 * 1024 * 1024, delayMs: 500, timeMs: 2000 },
              { chunkLength: 3 * 1024 * 1024, delayMs: 500, timeMs: 3000 },
            ],
          };
        }
        if (w.__updaterMode === "unknown-size") {
          return {
            version: "1.0.2",
            body: "修复更新流程\n改进安装保护",
            unknownSize: true,
            progressEvents: [
              { chunkLength: 2 * 1024 * 1024, delayMs: 500, timeMs: 1000 },
              { chunkLength: 2 * 1024 * 1024, delayMs: 500, timeMs: 2000 },
            ],
          };
        }
        return {
          version: "1.0.2",
          body: "修复更新流程\n改进安装保护\nhttps://github.com/benjamin1108/aimd/releases",
          failInstall: w.__updaterMode === "fail-install" ? "download failed" : "",
        };
      },
      install: async () => {
        w.__installCount += 1;
      },
    };
  }, { initialMode: mode, options: opts });
}

async function waitForUpdater(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).__aimd_checkForUpdates));
}

test.describe("low-interruption updater UX", () => {
  test("about opens the unified panel without auto-checking", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_showAboutAimd());
    await expect(page.locator("#update-panel")).toBeVisible();
    await expect(page.locator("#update-panel")).toHaveAttribute("data-surface", "about");
    await expect(page.locator("#update-title")).toHaveText("AIMD");
    await expect(page.locator("#about-version")).toHaveText("版本 1.0.1 · stable");
    await expect(page.locator("#about-platform")).toHaveText("macOS arm64");
    await expect(page.locator("#about-update-summary")).toContainText("未检查");
    await expect(page.locator("#about-release-url")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__checkCount)).toBe(0);
  });

  test("about check switches the same panel to update view", async ({ page }) => {
    await installUpdaterMock(page, "none");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_showAboutAimd());
    await page.locator("#about-check-updates").click();
    await expect(page.locator("#update-panel")).toHaveAttribute("data-surface", "update");
    await expect(page.locator("#about-body")).toBeHidden();
    await expect(page.locator("#update-title")).toHaveText("AIMD 已是最新版本");
    await expect.poll(() => page.evaluate(() => (window as any).__checkCount)).toBe(1);
  });

  test("native check updates opens the same update view", async ({ page }) => {
    await installUpdaterMock(page, "none");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimdEmitTauriEvent("aimd-menu", "check-updates"));
    await expect(page.locator("#update-panel")).toHaveAttribute("data-surface", "update");
    await expect(page.locator("#update-title")).toHaveText("AIMD 已是最新版本");
  });

  test("manual no-update check is visible, startup no-update stays quiet", async ({ page }) => {
    await installUpdaterMock(page, "none", { autoDelayMs: 20 });
    await page.goto("/");
    await waitForUpdater(page);
    await page.waitForTimeout(120);
    await expect(page.locator("#update-panel")).toBeHidden();
    await expect(page.locator("#status")).toHaveText("就绪");

    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-panel")).toBeVisible();
    await expect(page.locator("#update-title")).toHaveText("AIMD 已是最新版本");
  });

  test("scheduled update found only writes status first, then status click restores panel", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_runScheduledUpdateCheck({ force: true }));
    await expect(page.locator("#update-panel")).toBeHidden();
    await expect(page.locator("#status-pill")).toHaveAttribute("data-action", "updater");
    await expect(page.locator("#status")).toHaveText("有新版本 1.0.2");

    await page.locator("#status-pill").click();
    await expect(page.locator("#update-panel")).toBeVisible();
    await expect(page.locator("#update-title")).toHaveText("AIMD 1.0.2 可用");
  });

  test("available update is concise and release action uses native browser command", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-title")).toHaveText("AIMD 1.0.2 可用");
    await expect(page.locator("#update-message")).toHaveText("当前 1.0.1 → 最新 1.0.2");
    await expect(page.locator("#update-notes")).toContainText("修复更新流程");
    await expect(page.locator("#update-notes")).not.toContainText("github.com");
    await expect(page.locator("#update-release")).toBeVisible();
    await expect(page.locator("#update-remind-later")).toBeVisible();
    await expect(page.locator("#update-install")).toBeVisible();

    await page.locator("#update-release").click();
    const calls = await page.evaluate(() => (window as any).__nativeOpenCalls);
    expect(calls).toEqual([{ cmd: "open_aimd_release_url", args: { url: "https://github.com/benjamin1108/aimd/releases" } }]);
  });

  test("about release action also uses native browser command", async ({ page }) => {
    await installUpdaterMock(page, "none");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_showAboutAimd());
    await page.locator("#about-release").click();
    await expect.poll(() => page.evaluate(() => (window as any).__nativeOpenCalls.length)).toBe(1);
    const call = await page.evaluate(() => (window as any).__nativeOpenCalls[0]);
    expect(call.cmd).toBe("open_aimd_release_url");
  });

  test("download progress shows determinate bar, speed, and eta", async ({ page }) => {
    await installUpdaterMock(page, "progress");
    await page.goto("/");
    await waitForUpdater(page);
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();

    await expect(page.locator("#update-progress-wrap")).toBeVisible();
    await expect(page.locator("#update-progress-bar")).toHaveAttribute("aria-valuenow", /^(40|70|100)$/);
    await expect(page.locator("#update-progress")).toContainText("%");
    await expect(page.locator("#update-progress")).toContainText("MB /");
    await expect(page.locator("#update-progress")).toContainText("MB/s");
    await expect(page.locator("#update-progress")).toContainText("约");
  });

  test("unknown-size download stays indeterminate and avoids fake eta", async ({ page }) => {
    await installUpdaterMock(page, "unknown-size");
    await page.goto("/");
    await waitForUpdater(page);
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();

    await expect(page.locator("#update-progress-wrap")).toBeVisible();
    await expect(page.locator("#update-progress-bar")).not.toHaveAttribute("aria-valuenow", /.+/);
    await expect(page.locator("#update-progress")).toContainText("已下载");
    await expect(page.locator("#update-progress")).toContainText("MB/s");
    await expect(page.locator("#update-progress")).not.toContainText("%");
    await expect(page.locator("#update-progress")).not.toContainText("约");
  });

  test("background mode uses status bar and restoring does not duplicate download", async ({ page }) => {
    await installUpdaterMock(page, "progress");
    await page.goto("/");
    await waitForUpdater(page);
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();
    await expect(page.locator("#update-background")).toBeVisible();
    await page.locator("#update-background").click();

    await expect(page.locator("#update-panel")).toBeHidden();
    await expect(page.locator("#update-status-chip")).toHaveCount(0);
    await expect(page.locator("#status-pill")).toHaveAttribute("data-action", "updater");
    await expect(page.locator("#status")).toContainText("正在下载 1.0.2");
    await page.locator("#status-pill").click();
    await expect(page.locator("#update-panel")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__installCount)).toBe(1);
  });

  test("dirty document blocks install and can focus dirty document", async ({ page }) => {
    await installUpdaterMock(page, "available");
    await page.goto("/");
    await waitForUpdater(page);
    await page.locator("#empty-new").click();
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();

    await expect(page.locator("#update-title")).toHaveText("需要先保存文档");
    await expect(page.locator("#update-message")).toContainText("有 1 个未保存文档");
    await expect.poll(() => page.evaluate(() => (window as any).__installCount)).toBe(0);
    await page.locator("#update-focus-dirty").click();
    await expect.poll(() => page.evaluate(() => (window as any).__focusCount)).toBe(1);
  });

  test("automatic failure stays quiet while manual failure shows diagnostics", async ({ page }) => {
    await installUpdaterMock(page, "fail-check");
    await page.goto("/");
    await waitForUpdater(page);

    await page.evaluate(() => (window as any).__aimd_runScheduledUpdateCheck({ force: true }));
    await expect(page.locator("#update-panel")).toBeHidden();
    await expect(page.locator("#status")).toHaveText("就绪");

    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await expect(page.locator("#update-title")).toHaveText("更新失败");
    await expect(page.locator("#update-message")).toContainText("无法连接更新服务");
    await expect(page.locator("#update-message")).not.toContainText("github.com");
    await page.locator("#update-copy-diagnostics").click();
    await expect.poll(() => page.evaluate(() => (window as any).__clipboardText as string)).toContain("network offline");
    await expect.poll(() => page.evaluate(() => (window as any).__clipboardText as string)).not.toContain("PRIVATE");
  });

  test("download failure shows compact error and preserves document state", async ({ page }) => {
    await installUpdaterMock(page, "fail-install");
    await page.goto("/");
    await waitForUpdater(page);
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();

    await expect(page.locator("#update-title")).toHaveText("更新失败");
    await expect(page.locator("#update-message")).toContainText("download failed");
    await expect(page.locator("#doc-title")).toHaveText("更新测试");
  });

  test("narrow viewport keeps update labels within the panel", async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 720 });
    await installUpdaterMock(page, "progress");
    await page.goto("/");
    await waitForUpdater(page);
    await page.evaluate(() => (window as any).__aimd_checkForUpdates({ manual: true }));
    await page.locator("#update-install").click();
    await expect(page.locator("#update-progress-wrap")).toBeVisible();

    const hasHorizontalOverflow = await page.locator("#update-panel").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(hasHorizontalOverflow).toBeFalsy();
  });
});
