import { test, expect, Page } from "@playwright/test";

const ASSET_DOC = {
  path: "/mock/assets.aimd",
  title: "含资源文档",
  markdown: "# 含资源文档\n\n![cover](asset://img-001)\n",
  html: '<h1>含资源文档</h1><p><img src="asset://img-001" alt="cover"></p>',
  assets: [{
    id: "img-001",
    path: "assets/cover.png",
    mime: "image/png",
    size: 1024,
    sha256: "hash",
    role: "content-image",
    url: "/mock/cover.png",
    localPath: "/mock/cover.png",
  }],
  dirty: false,
  format: "aimd",
};

async function installMainMock(page: Page, showAssetPanel?: boolean) {
  await page.addInitScript(({ doc, showAssetPanel }) => {
    type Args = Record<string, unknown> | undefined;
    const settings = showAssetPanel === undefined
      ? {
          ai: {
            activeProvider: "dashscope",
            providers: {
              dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
              gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
            },
          },
          webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
          ui: { showAssetPanel: false, debugMode: false },
        }
      : {
          ai: {
            activeProvider: "dashscope",
            providers: {
              dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
              gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
            },
          },
          webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
          ui: { showAssetPanel, debugMode: false },
        };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => settings,
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      focus_doc_window: () => null,
      register_window_path: () => null,
      check_document_health: () => ({
        status: "offline_ready",
        summary: "资源完整，可离线打开",
        counts: { errors: 0, warnings: 0, infos: 0 },
        issues: [],
      }),
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { doc: ASSET_DOC, showAssetPanel });
}

async function installSettingsMock(page: Page, opts?: { onSave?: (settings: any) => void }) {
  const hasCb = Boolean(opts?.onSave);
  await page.addInitScript(({ hasCb }) => {
    type Args = Record<string, unknown> | undefined;
    let stored: any = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => stored,
      save_settings: (a) => {
        stored = (a as any)?.settings ?? stored;
        if (hasCb) (window as any).__onSettingsSaved?.(stored);
        return null;
      },
      close_current_window: () => null,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { hasCb });
  if (opts?.onSave) {
    await page.exposeFunction("__onSettingsSaved", (settings: unknown) => opts.onSave!(settings));
  }
}

test.describe("asset panel visibility preference", () => {
  test("asset panel is hidden by default even when the document has assets", async ({ page }) => {
    await installMainMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#reader img")).toHaveCount(1);
    await expect(page.locator("#asset-section")).toBeHidden();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#health-check")).toBeEnabled();
  });

  test("asset panel is visible when showAssetPanel is enabled", async ({ page }) => {
    await installMainMock(page, true);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#asset-section")).toBeVisible();
    await expect(page.locator("#asset-count")).toHaveCount(0);
  });

  test("asset panel can be resized against outline", async ({ page }) => {
    await installMainMock(page, true);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#asset-section")).toBeVisible();
    const before = await page.locator("#asset-section").boundingBox();
    const handle = await page.locator("#sb-resizer-outline-asset").boundingBox();
    expect(before && handle).toBeTruthy();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 - 42);
    await page.mouse.up();
    const after = await page.locator("#asset-section").boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height + 20);
  });

  test("settings page saves the resource panel preference", async ({ page }) => {
    let saved: any = null;
    await installSettingsMock(page, { onSave: (settings) => { saved = settings; } });
    await page.goto("/settings.html");

    await expect(page.locator(".settings-head h1")).toHaveText("AIMD 设置");
    await expect(page.locator(".settings-nav-item")).toHaveText(["常规", "AI / 模型", "网页导入", "格式化"]);
    await expect(page.locator("#ui-show-asset-panel")).not.toBeChecked();
    await expect(page.locator("#ui-debug-mode")).not.toBeChecked();

    await page.locator("#ui-show-asset-panel").check();
    await page.locator("#ui-debug-mode").check();
    await page.locator("#save-settings").click();

    await expect.poll(() => saved?.ui?.showAssetPanel).toBe(true);
    await expect.poll(() => saved?.ui?.debugMode).toBe(true);
  });
});
