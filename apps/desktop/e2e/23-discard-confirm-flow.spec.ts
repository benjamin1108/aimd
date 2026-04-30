/**
 * 23-discard-confirm-flow.spec.ts
 *
 * 钉用户实际报告：
 *
 * A. 顶部主按钮在草稿状态下也显示「保存」（之前是「创建文件」），
 *    防止下次再退到含义不一致的旧文案。
 *
 * B. dirty 文档点击关闭时，必须走 Rust 端的 confirm_discard_changes
 *    （Tauri 2 webview 把 window.confirm 吞掉，旧实现导致点关闭无反应）。
 *    三分支：save → 走保存流；discard → 直接关闭；cancel → 留在文档里。
 */
import { test, expect, Page } from "@playwright/test";

async function installMock(
  page: Page,
  opts: { discardChoice?: "save" | "discard" | "cancel" } = {},
) {
  const choice = opts.discardChoice ?? "discard";
  await page.addInitScript((c: string) => {
    type Args = Record<string, unknown> | undefined;
    const w = window as any;
    w.__discardCalls = [] as string[];
    w.__discardChoice = c;
    const docs: Record<string, any> = {
      "/mock/saved.aimd": {
        path: "/mock/saved.aimd",
        title: "已保存文档",
        markdown: "# 已保存文档\n\n正文。\n",
        html: "<h1>已保存文档</h1><p>正文。</p>",
        assets: [],
        dirty: false,
      },
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => "/mock/saved.aimd",
      choose_doc_file: () => "/mock/saved.aimd",
      open_aimd: () => docs["/mock/saved.aimd"],
      render_markdown_standalone: () => ({ html: "<h1>未命名文档</h1>" }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      list_aimd_assets: () => [],
      choose_save_aimd_file: () => "/mock/new-saved.aimd",
      save_aimd_as: (a: any) => ({
        path: "/mock/new-saved.aimd",
        title: "未命名文档",
        markdown: a?.markdown ?? "",
        html: "<h1>未命名文档</h1>",
        assets: [],
        dirty: false,
      }),
      confirm_discard_changes: (a: any) => {
        w.__discardCalls.push(String(a?.message ?? ""));
        return w.__discardChoice;
      },
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
      transformCallback: (cb: Function) => cb,
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, choice);
}

test.describe("A. 顶部主按钮 label", () => {
  test("草稿与已保存状态下都显示「保存」", async ({ page }) => {
    await installMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#save-label")).toHaveText("保存");

    // 已保存文档下也是「保存」
    await page.locator("#close").click();
    await expect(page.locator("#empty")).toBeVisible();
    await page.locator("#empty-open").click();
    await expect(page.locator("#save-label")).toHaveText("保存");
  });
});

test.describe("B. ensureCanDiscardChanges 走 Rust 对话框", () => {
  test("dirty 文档点关闭时调用一次 confirm_discard_changes", async ({ page }) => {
    await installMock(page, { discardChoice: "discard" });
    await page.goto("/");
    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.locator("#close").click();
    await expect(page.locator("#empty")).toBeVisible();

    const calls = await page.evaluate(() => (window as any).__discardCalls);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("未保存的修改");
    expect(calls[0]).toContain("关闭当前文档");
  });

  test("选择「取消」：文档保留，doc-actions 仍显示", async ({ page }) => {
    await installMock(page, { discardChoice: "cancel" });
    await page.goto("/");
    await page.locator("#empty-new").click();

    await page.locator("#close").click();

    await expect(page.locator("#inline-editor")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeVisible();
    await expect(page.locator("#empty")).toBeHidden();
  });

  test("选择「不保存」：文档关闭", async ({ page }) => {
    await installMock(page, { discardChoice: "discard" });
    await page.goto("/");
    await page.locator("#empty-new").click();

    await page.locator("#close").click();

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeHidden();
  });

  test("选择「保存」：先走保存流（choose_save_aimd_file 被调用），再关闭", async ({ page }) => {
    await installMock(page, { discardChoice: "save" });
    await page.goto("/");
    await page.locator("#empty-new").click();

    // 给 save_aimd_as 路径加个计数器
    await page.evaluate(() => {
      const w = window as any;
      w.__savedAs = 0;
      const orig = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: unknown) => {
        if (cmd === "save_aimd_as") w.__savedAs += 1;
        return orig(cmd, a);
      };
    });

    await page.locator("#close").click();

    await expect.poll(() => page.evaluate(() => (window as any).__savedAs)).toBe(1);
    // 落盘后 isDraft=false / dirty=false，关闭照常进行
    await expect(page.locator("#empty")).toBeVisible();
  });

  test("non-dirty 文档点关闭：不调用 confirm_discard_changes", async ({ page }) => {
    await installMock(page, { discardChoice: "cancel" });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("已保存文档");

    await page.locator("#close").click();
    await expect(page.locator("#empty")).toBeVisible();

    const calls = await page.evaluate(() => (window as any).__discardCalls);
    expect(calls.length).toBe(0);
  });
});
