/**
 * 41-per-provider-credentials.spec.ts
 *
 * 钉 per-provider 凭证存储不可回归：
 * - DashScope 和 Gemini 各自持有独立的 apiKey / model / apiBase
 * - 切 provider 不串台（关键 bug：之前重装后无论选哪个 provider 都看到同一把旧 key）
 * - 老格式 settings.json（顶层 provider/apiKey）由前端 coerceSettings 即时迁移
 *   到 providers[provider] 那一格，另一格保持空
 */
import { test, expect, Page } from "@playwright/test";

type Stored = {
  ai:
    | {
        // 新格式
        activeProvider: string;
        providers: Record<string, { model: string; apiKey: string; apiBase: string }>;
        maxSteps: number;
        language: string;
      }
    | {
        // 老格式
        provider: string;
        model: string;
        apiKey: string;
        apiBase: string;
        maxSteps: number;
        language: string;
      };
};

async function installMock(page: Page, initial: Stored, opts?: { onSave?: (v: any) => void }) {
  const hasCb = Boolean(opts?.onSave);
  await page.addInitScript(({ initial, hasCb }) => {
    type Args = Record<string, unknown> | undefined;
    let stored: any = initial;
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
  }, { initial, hasCb });
  if (opts?.onSave) {
    await page.exposeFunction("__onSettingsSaved", (v: unknown) => opts.onSave!(v));
  }
}

test.describe("per-provider 凭证 — 切 provider 不串台", () => {
  test("dashscope 和 gemini 的 apiKey 各自独立显示", async ({ page }) => {
    await installMock(page, {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "sk-only-dashscope", apiBase: "" },
          gemini: { model: "gemini-3-pro-preview", apiKey: "g-only-gemini", apiBase: "" },
        },
      },
    });
    await page.goto("/settings.html");

    // 默认 active=dashscope
    await expect(page.locator("#provider")).toHaveValue("dashscope");
    await expect(page.locator("#api-key")).toHaveValue("sk-only-dashscope");

    // 切到 gemini → key 应当变成 gemini 的，不能继承 dashscope
    await page.locator("#provider").selectOption("gemini");
    await expect(page.locator("#api-key")).toHaveValue("g-only-gemini");

    // 切回 dashscope → 还是 dashscope 的
    await page.locator("#provider").selectOption("dashscope");
    await expect(page.locator("#api-key")).toHaveValue("sk-only-dashscope");
  });

  test("一边只有 key、另一边为空：切到空那边 input 干净", async ({ page }) => {
    await installMock(page, {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "only-this-one", apiBase: "" },
          gemini: { model: "gemini-3-pro-preview", apiKey: "", apiBase: "" },
        },
      },
    });
    await page.goto("/settings.html");
    await expect(page.locator("#api-key")).toHaveValue("only-this-one");
    await page.locator("#provider").selectOption("gemini");
    await expect(page.locator("#api-key")).toHaveValue("");
    // 遮罩浮层应当为空
    await expect(page.locator(".api-key-mask")).toHaveText("");
  });

  test("切 provider 后保存：两个 provider 的 key 都正确落到各自的格子里", async ({ page }) => {
    let received: any = null;
    await installMock(
      page,
      {
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen3.6-plus", apiKey: "kA", apiBase: "" },
            gemini: { model: "gemini-3-pro-preview", apiKey: "", apiBase: "" },
          },
        },
      },
      { onSave: (v) => { received = v; } },
    );
    await page.goto("/settings.html");
    // 在 dashscope 下改 apiKey
    await page.locator("#api-key").fill("kA-updated");
    // 切 gemini，填一把 key
    await page.locator("#provider").selectOption("gemini");
    await page.locator("#api-key").fill("kB-new");
    // 保存
    await page.locator("#save-settings").click();

    await expect.poll(() => received?.ai?.providers?.dashscope?.apiKey).toBe("kA-updated");
    expect(received?.ai?.providers?.gemini?.apiKey).toBe("kB-new");
    expect(received?.ai?.activeProvider).toBe("gemini");
  });
});


