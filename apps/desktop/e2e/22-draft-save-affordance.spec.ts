/**
 * 22-draft-save-affordance.spec.ts
 *
 * 钉用户的两条 UX 要求：
 *
 * A. 新建草稿一旦输入了内容（dirty），当前文档头部露出可用的 "保存"。
 *    全局 "新建" 始终只在 topbar，已落盘且干净的文档禁用保存按钮。
 *
 * B. 编辑模式下点击 inline-editor 内的图片，应弹出 lightbox
 *    （和阅读模式行为对齐）。
 */
import { test, expect, Page } from "@playwright/test";

async function clickClose(page: Page) {
  await page.locator("#more-menu-toggle").click();
  await page.locator("#close").click();
}

async function installMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, unknown> | undefined;
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
      choose_save_aimd_file: () => null,
      confirm_discard_changes: () => "discard",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

test.describe("A. 当前文档头部承载 dirty draft 保存入口", () => {
  test("已保存文档：topbar 保留新建入口，当前文档保存按钮禁用", async ({ page }) => {
    await installMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // 已落盘且干净的文档：全局新建仍在 topbar；当前文档没有可保存变化。
    await clickClose(page);
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("已保存文档");

    await expect(page.locator("#global-new-toggle")).toBeVisible();
    await expect(page.locator("#save")).toBeVisible();
    await expect(page.locator("#save")).toBeDisabled();
    await expect(page.locator("#sidebar-foot")).toBeHidden();
  });

  test("dirty 草稿：当前文档保存按钮显示并能保存", async ({ page }) => {
    await installMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // newDocument 自带 dirty=true（草稿即"已输入"语义），因此即刻满足条件。
    await expect(page.locator("#global-new-toggle")).toBeVisible();
    await expect(page.locator("#save")).toBeVisible();
    await expect(page.locator("#save")).toBeEnabled();
    await expect(page.locator("#save")).toContainText("保存");

    // 点当前文档保存走 saveDocument()，模拟 cancel 文件选择，仅断言行为分发。
    let askedSavePath = false;
    await page.exposeFunction("__markSavePath", () => {
      askedSavePath = true;
    });
    await page.evaluate(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, a: unknown) => {
        if (cmd === "choose_save_aimd_file") {
          (window as any).__markSavePath();
          return null;
        }
        return orig(cmd, a);
      };
    });

    await page.locator("#save").click();
    await expect(page.locator("#save-format-panel")).toBeVisible();
    await page.locator("#save-format-aimd").click();
    await expect.poll(() => askedSavePath).toBe(true);
  });

  test("草稿保存为正式文件后，当前文档保存按钮回到禁用态", async ({ page }) => {
    await installMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#save")).toBeEnabled();

    // 模拟 saveDocumentAs 流程通过：替换 choose_save_aimd_file + save_aimd_as
    await page.evaluate(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__TAURI_INTERNALS__.invoke = async (cmd: string, a: any) => {
        if (cmd === "choose_save_aimd_file") return "/mock/new-doc.aimd";
        if (cmd === "save_aimd_as") {
          return {
            path: "/mock/new-doc.aimd",
            title: "未命名文档",
            markdown: a?.markdown ?? "",
            html: "<h1>未命名文档</h1>",
            assets: [],
            dirty: false,
          };
        }
        return orig(cmd, a);
      };
    });

    await page.locator("#save").click();
    await expect(page.locator("#save-format-panel")).toBeVisible();
    await page.locator("#save-format-aimd").click();

    await expect(page.locator("#save")).toBeDisabled();
    await expect(page.locator("#global-new-toggle")).toBeVisible();
  });
});

test.describe("B. 编辑模式下点击图片打开 lightbox", () => {
  test("inline-editor 内的图片 click 开 lightbox", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/edit.png";
      img.alt = "edit-test";
      img.className = "test-edit-img";
      el.appendChild(img);
    });

    await page.locator("#inline-editor .test-edit-img").click();

    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();
    await expect(page.locator(".aimd-lightbox-img")).toHaveAttribute(
      "src",
      "asset://localhost/mock/edit.png",
    );

    await page.keyboard.press("Escape");
    await expect(lightbox).not.toBeAttached();
  });

  test("阅读模式下 #reader 内的 img 仍按原行为开 lightbox", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#mode-read")).toHaveClass(/active/);

    await page.locator("#reader").evaluate((el: HTMLElement) => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/read.png";
      img.alt = "read-test";
      img.className = "test-read-img";
      el.appendChild(img);
    });

    await page.locator("#reader .test-read-img").click();
    await expect(page.locator("[data-lightbox='true']")).toBeVisible();
  });

  test("source 模式 + #reader 隐藏时点 #reader img 不开 lightbox", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();

    await page.evaluate(() => {
      const reader = document.getElementById("reader")!;
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/src.png";
      img.alt = "src";
      reader.appendChild(img);
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await expect(page.locator("[data-lightbox='true']")).not.toBeAttached();
  });
});
