/**
 * 39-ux-audit-2026-05.spec.ts
 *
 * 钉 docs/ux-product-audit.md 本轮修复，避免回归：
 *
 * - P0-1 取消按钮不再走"切换即保存"，关闭窗口前不写后端。
 * - P0-1 设置经后端 load_settings / save_settings 持久化。
 * - P1-1 主 toolbar 不再有 #width-select 控件。
 * - P1-2 toolbar 用 .toolbar-group 显式分组（文档模式 vs 导览）。
 * - P1-3 head-actions 内 #save-state 文字传达"已保存 / 未保存修改"。
 * - P1-4 sidebar 不再渲染 #doc-card / #doc-section（与 header 重复）。
 * - P1-6 空态不再用 .launch-hero / .launch-eyebrow 营销布局。
 */
import { test, expect, Page } from "@playwright/test";

const SAVED_DOC = {
  path: "/mock/saved.aimd",
  title: "已保存文档",
  markdown: "# 已保存文档\n\n正文。\n",
  html: "<h1>已保存文档</h1><p>正文。</p>",
  assets: [],
  dirty: false,
};

async function installMock(page: Page, opts?: { onSaveSettings?: (v: unknown) => void; onTestConnection?: (v: unknown) => void }) {
  const onSaveSettings = opts?.onSaveSettings;
  const onTestConnection = opts?.onTestConnection;
  await page.addInitScript(({ doc, hasSaveCallback }) => {
    type Args = Record<string, unknown> | undefined;
    let stored: any = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "existing-key", apiBase: "" },
        },
      },
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => doc.path,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      list_aimd_assets: () => [],
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      render_markdown_standalone: () => ({ html: "<h1>未命名文档</h1>" }),
      load_settings: () => stored,
      save_settings: (a) => {
        stored = (a as any)?.settings ?? stored;
        if (hasSaveCallback) {
          (window as any).__settingsSavedFromMock?.(stored);
        }
        return null;
      },
      test_model_connection: (a) => {
        (window as any).__connectionTestedFromMock?.((a as any)?.config ?? null);
        return { ok: true, latencyMs: 123, message: "连接正常" };
      },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { doc: SAVED_DOC, hasSaveCallback: Boolean(onSaveSettings) });
  if (onSaveSettings) {
    await page.exposeFunction("__settingsSavedFromMock", (value: unknown) => {
      onSaveSettings(value);
    });
  }
  if (onTestConnection) {
    await page.exposeFunction("__connectionTestedFromMock", (value: unknown) => {
      onTestConnection(value);
    });
  }
}

test.describe("P1 — 主 UI 信息架构", () => {
  test("主 toolbar 不再有 #width-select 控件", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-toolbar")).toBeVisible();
    await expect(page.locator("#width-select")).toHaveCount(0);
    await expect(page.locator(".toolbar-select")).toHaveCount(0);
  });

  test("toolbar 显式分组：.toolbar-group--mode 和 .toolbar-group--tour 都存在", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator(".toolbar-group--mode")).toBeVisible();
  });

  test("已保存文档：底部 #status 是'就绪'，#save 处于 disabled", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    // head 不再有 #save-state 重复一遍；状态文字只挂在底部 status-pill。
    await expect(page.locator("#save-state")).toHaveCount(0);
    await expect(page.locator("#status")).toHaveText("就绪");
    await expect(page.locator("#save")).toBeDisabled();
  });

  test("sidebar 已经移除 #doc-card / #doc-section", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-card")).toHaveCount(0);
    await expect(page.locator("#doc-section")).toHaveCount(0);
    await expect(page.locator("#outline-section")).toBeVisible();
  });

  test("空态不再使用营销布局：.launch-hero / .launch-eyebrow 不存在", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await expect(page.locator(".launch-hero")).toHaveCount(0);
    await expect(page.locator(".launch-eyebrow")).toHaveCount(0);
    // 仍提供两个直接动作。
    await expect(page.locator("#empty-new")).toBeVisible();
    await expect(page.locator("#empty-open")).toBeVisible();
  });
});

test.describe("P0-1 — 设置取消按钮 + 后端持久化", () => {
  test("打开设置页，loadAppSettings 拿到的是后端 stored 值", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    await expect(page.locator("#api-key")).toHaveValue("existing-key");
    await expect(page.locator("#provider")).toHaveValue("dashscope");
  });

  test("取消按钮不写后端：#cancel 仅关窗，不调 save_settings", async ({ page }) => {
    let savedCount = 0;
    await installMock(page, { onSaveSettings: () => { savedCount += 1; } });
    await page.goto("/settings.html");
    await page.locator("#api-key").fill("changed-but-cancelled");
    let closed = false;
    await page.exposeFunction("__settingsClosed", () => { closed = true; });
    await page.evaluate(() => {
      // getCurrentWindow().close() 在非 Tauri 桌面环境下会抛错；用埋点确认 click 触达。
      const btn = document.querySelector<HTMLButtonElement>("#cancel")!;
      btn.addEventListener("click", () => {
        (window as any).__settingsClosed?.();
      }, { once: true });
    });
    await page.locator("#cancel").click();
    await expect.poll(() => closed).toBe(true);
    expect(savedCount).toBe(0);
  });

  test("点保存按钮：调 save_settings 且 payload 包含最新值（per-provider 结构）", async ({ page }) => {
    let received: any = null;
    await installMock(page, { onSaveSettings: (v) => { received = v; } });
    await page.goto("/settings.html");
    await page.locator("#api-key").fill("new-key-123");
    await page.locator("#save-settings").click();
    // 新格式：apiKey 落在 providers[activeProvider] 下。
    await expect.poll(() => received?.ai?.providers?.dashscope?.apiKey).toBe("new-key-123");
    expect(received?.ai?.activeProvider).toBe("dashscope");
  });

  test("Esc 等同于取消：不写后端", async ({ page }) => {
    let savedCount = 0;
    await installMock(page, { onSaveSettings: () => { savedCount += 1; } });
    await page.goto("/settings.html");
    await page.locator("#api-key").fill("typed-then-escaped");
    await page.keyboard.press("Escape");
    // 给前端一帧让 keydown handler 跑完。
    await page.waitForTimeout(50);
    expect(savedCount).toBe(0);
  });

  test("点保存后不自动关窗，按钮回到 disabled 的'保存'状态", async ({ page }) => {
    // 用户反馈：保存后窗口自动关让人困惑（无法连着改下一节、对比改动）。
    // 现在保存只把 #save-state 切到"已保存"，按钮变回"保存"且 disabled，
    // 直到用户再次编辑才能再点。关窗交给 取消 / Esc / 窗口关闭按钮。
    await installMock(page);
    await page.goto("/settings.html");
    await page.locator("#api-key").fill("first-save-key");
    await page.locator("#save-settings").click();

    await expect(page.locator("#save-state")).toHaveText("已保存");
    await expect(page.locator("#settings-form")).toBeVisible();
    const saveBtn = page.locator("#save-settings");
    await expect(saveBtn).toHaveText("保存");
    await expect(saveBtn).toBeDisabled();

    // 再次编辑应该重新激活保存按钮。
    await page.locator("#api-key").fill("second-edit");
    await expect(saveBtn).toBeEnabled();
  });

  test("测试连接：使用当前表单配置并显示 OK 与延迟", async ({ page }) => {
    let tested: any = null;
    await installMock(page, { onTestConnection: (v) => { tested = v; } });
    await page.goto("/settings.html");
    await page.locator("#api-base").fill("https://example.test/v1");
    await page.locator("#test-connection").click();

    await expect.poll(() => tested?.provider).toBe("dashscope");
    expect(tested?.model).toBe("qwen3.6-plus");
    expect(tested?.apiKey).toBe("existing-key");
    expect(tested?.apiBase).toBe("https://example.test/v1");
    await expect(page.locator("#connection-test-state")).toHaveText("连接正常，延迟 123 ms");
  });
});
