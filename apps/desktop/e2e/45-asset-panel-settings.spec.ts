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
    const listeners = new Map<number, { event: string; handler: Function }>();
    let nextListenerId = 1;
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
      "plugin:event|listen": (a) => {
        const id = nextListenerId++;
        listeners.set(id, { event: String((a as any)?.event ?? ""), handler: (a as any)?.handler });
        return id;
      },
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
    (window as any).__aimdEmitTauriEvent = (event: string, payload: unknown) => {
      for (const item of listeners.values()) {
        if (item.event === event) item.handler({ event, payload });
      }
    };
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
    await expect(page.locator("#sidebar-tab-assets")).toBeHidden();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#health-check")).toBeHidden();
  });

  test("resource preference keeps the asset tab target-scoped", async ({ page }) => {
    await installMainMock(page, true);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#sidebar-tab-assets")).toBeVisible();
    await expect(page.locator("#asset-section")).toBeHidden();
    await page.locator("#sidebar-tab-assets").click();
    await expect(page.locator("#asset-section")).toBeVisible();
    await expect(page.locator("#asset-count")).toHaveCount(0);
  });

  test("asset panel can be selected from the inspector and collapsed", async ({ page }) => {
    await installMainMock(page, true);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#asset-section")).toBeHidden();
    await page.locator("#sidebar-tab-assets").click();
    await expect(page.locator("#asset-panel")).toBeVisible();
    await expect(page.locator("#asset-list")).toContainText("img-001");
    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).toHaveClass(/is-collapsed/);
    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).not.toHaveClass(/is-collapsed/);
  });

  test("settings update event toggles the resource tab immediately without blanking the page", async ({ page }) => {
    await installMainMock(page, false);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await expect(page.locator("#reader img")).toHaveCount(1);
    await expect(page.locator("#sidebar-tab-assets")).toBeHidden();

    await page.evaluate(() => (window as any).__aimdEmitTauriEvent("aimd-settings-updated", {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: true, debugMode: false },
    }));

    await expect(page.locator("#sidebar-tab-assets")).toBeVisible();
    await expect(page.locator("#asset-section")).toBeHidden();
    await page.locator("#sidebar-tab-assets").click();
    await expect(page.locator("#asset-section")).toBeVisible();
    await expect(page.locator("#asset-list")).toContainText("img-001");

    await page.evaluate(() => (window as any).__aimdEmitTauriEvent("aimd-settings-updated", {
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
    }));

    await expect(page.locator("#sidebar-tab-assets")).toBeHidden();
    await expect(page.locator("#asset-section")).toBeHidden();
    await expect(page.locator("#outline-panel")).toBeVisible();
    await expect(page.locator("#reader img")).toHaveCount(1);
  });

  test("settings page saves the resource panel preference", async ({ page }) => {
    let saved: any = null;
    await installSettingsMock(page, { onSave: (settings) => { saved = settings; } });
    await page.goto("/settings.html");

    await expect(page.locator(".settings-head h1")).toHaveText("AIMD 设置");
    await expect(page.locator(".settings-nav-item")).toHaveText(["常规", "AI / 模型", "网页导入", "格式化", "Git 集成"]);
    await expect(page.locator("#ui-show-asset-panel")).not.toBeChecked();
    await expect(page.locator("#ui-debug-mode")).not.toBeChecked();

    await page.locator("#ui-show-asset-panel").check();
    await page.locator("#ui-debug-mode").check();
    await page.locator("#save-settings").click();

    await expect.poll(() => saved?.ui?.showAssetPanel).toBe(true);
    await expect.poll(() => saved?.ui?.debugMode).toBe(true);
  });
});
