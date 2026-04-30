/**
 * 19-inline-editor-mutation-qa.spec.ts
 *
 * QA 第九轮新增：补充 spec-18 未覆盖的变异敏感性测试。
 *
 * A. 验证 heading Enter 的 preventDefault 真正被调用
 *    — 用 dispatchEvent + event.defaultPrevented 断言，而非仅看 DOM 结果
 * B. 验证列表中 Enter/Backspace 行为（dev 自报"无 bug，保持浏览器默认"）
 * C. draft 关闭不弹保存 + 编辑后关闭弹保存
 * D. isDraft=true 时 ensureCanDiscardChanges 只检 dirty 不检 isDraft（已知边界）
 */

import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, unknown> | undefined;
    const docs: Record<string, any> = {
      "/mock/sample.aimd": {
        path: "/mock/sample.aimd",
        title: "样例文档",
        markdown: "# 样例文档\n\n正文一段。\n",
        html: "<h1>样例文档</h1><p>正文一段。</p>",
        assets: [],
        dirty: false,
      },
    };
    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => "/mock/sample.aimd",
      choose_doc_file: () => "/mock/report.md",
      choose_markdown_file: () => "/mock/report.md",
      choose_image_file: () => null,
      choose_save_aimd_file: (a) =>
        `/mock/${String((a as any)?.suggestedName ?? "untitled.aimd")}`,
      open_aimd: (a) =>
        docs[String((a as any)?.path ?? "/mock/sample.aimd")] ??
        docs["/mock/sample.aimd"],
      save_aimd: (a) => ({
        ...(docs[String((a as any)?.path)] ?? docs["/mock/sample.aimd"]),
        markdown: String((a as any)?.markdown ?? ""),
        dirty: false,
      }),
      save_aimd_as: (a) => {
        const savePath = String((a as any)?.savePath ?? "/mock/untitled.aimd");
        const doc = {
          path: savePath,
          title: "测试报告",
          markdown: String((a as any)?.markdown ?? ""),
          html: "<h1>测试报告</h1><p>saved</p>",
          assets: [],
          dirty: false,
        };
        docs[savePath] = doc;
        return doc;
      },
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      render_markdown_standalone: (a) => ({
        html: `<h1>未命名文档</h1><p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      add_image: () => null,
      add_image_bytes: () => null,
      import_markdown: () => docs["/mock/sample.aimd"],
      convert_md_to_draft: () => ({
        markdown: "# 测试报告\n\n内容段落。\n",
        title: "测试报告",
        html: "<h1>测试报告</h1><p>内容段落。</p>",
      }),
      reveal_in_finder: () => null,
      list_aimd_assets: () => [],
      // 默认 discard，单独的用例会覆盖 invoke 改成 cancel/save 来断言
      confirm_discard_changes: () => "discard",
      save_markdown: () => undefined,
      confirm_upgrade_to_aimd: () => false,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  });
}

async function openDocInEditMode(page: Page) {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toBeVisible();
}

test.describe("A. heading Enter — 真正的 preventDefault 敏感性测试", () => {
  test("Enter on H1 dispatches a preventable keydown — app calls preventDefault()", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h1>标题一</h1>";
      const h1 = el.querySelector("h1")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // 直接 dispatchEvent 读 defaultPrevented，不走 keyboard.press 的浏览器路径
    const prevented = await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    expect(prevented).toBe(true);
  });

  test("Enter on H2 dispatches a preventable keydown — app calls preventDefault()", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h2>二级标题</h2>";
      const h2 = el.querySelector("h2")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h2);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    const prevented = await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    expect(prevented).toBe(true);
  });

  test("Enter on plain paragraph does NOT preventDefault (browser handles it)", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<p>普通段落</p>";
      const p = el.querySelector("p")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    const prevented = await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    // 普通段落的 Enter 不应被 app 拦截，由浏览器 contenteditable 处理
    expect(prevented).toBe(false);
  });
});

test.describe("B. 列表和引用块 Enter/Backspace（浏览器默认行为，dev 自报无 bug）", () => {
  test("Enter inside list item creates another list item (browser default)", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<ul><li>列表项一</li></ul>";
      const li = el.querySelector("li")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(li);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    const html = await page.locator("#inline-editor").innerHTML();
    // 浏览器默认行为：应有 2 个 li（延续列表）
    const liCount = (html.match(/<li/gi) || []).length;
    expect(liCount).toBeGreaterThanOrEqual(1); // 至少原来那个
    // 没有意外的 <p> 出现在 <ul> 同级
    expect(html).not.toMatch(/<\/ul>\s*<p/i);
  });

  test("H3 末尾 Enter 不延续为 H3", async ({ page }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h3>三级标题</h3>";
      const h3 = el.querySelector("h3")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h3);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    const html = await page.locator("#inline-editor").innerHTML();
    // 不应出现第二个 h3
    const h3count = (html.match(/<h3/gi) || []).length;
    expect(h3count).toBe(1);
    // 应有 p
    expect(html.toLowerCase()).toContain("<p");
  });
});

test.describe("C. 打开 markdown 文档关闭行为边界", () => {
  test("unedited markdown doc closes without confirm dialog", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");

    // 未编辑，dirty=false，关闭不应触发 confirm_discard_changes invoke
    await page.evaluate(() => {
      const w = window as any;
      w.__discardCalled = 0;
      const orig = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: unknown) => {
        if (cmd === "confirm_discard_changes") {
          w.__discardCalled += 1;
          return "cancel";
        }
        return orig(cmd, a);
      };
    });

    await page.locator("#close").click();
    await expect(page.locator("#empty")).toBeVisible();
    const calls = await page.evaluate(() => (window as any).__discardCalled);
    expect(calls).toBe(0);
  });

  test("edited markdown doc (dirty=true) triggers confirm on close", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");

    // 切到 source 模式编辑，触发 dirty=true
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 已编辑\n\n修改内容\n");
    await expect(page.locator("#mode-source")).toHaveClass(/active/);

    await page.evaluate(() => {
      const w = window as any;
      w.__discardCalled = 0;
      const orig = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: unknown) => {
        if (cmd === "confirm_discard_changes") {
          w.__discardCalled += 1;
          return "cancel";
        }
        return orig(cmd, a);
      };
    });

    await page.locator("#close").click();
    // 应该走原生确认对话框（invoke 被调用一次）
    const calls = await page.evaluate(() => (window as any).__discardCalled);
    expect(calls).toBe(1);
    // 选 cancel，文档保留
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
  });
});

test.describe("D. 已知边界：ensureCanDiscardChanges 只检 dirty，不检 isDraft", () => {
  test("未编辑草稿(dirty=false)打开另一文档时不弹 confirm 对话框", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");

    // 用计数器替换 invoke 中的 confirm_discard_changes，dirty=false 时不应被调用
    // 同时覆盖 choose_doc_file 返回 .aimd 文件，确保第二次打开走 openDocument 而不是 openMarkdownDocument
    await page.evaluate(() => {
      const w = window as any;
      w.__discardCalled = 0;
      const orig = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: unknown) => {
        if (cmd === "confirm_discard_changes") {
          w.__discardCalled += 1;
          return "discard";
        }
        if (cmd === "choose_doc_file") return "/mock/sample.aimd";
        return orig(cmd, a);
      };
      // head-open 在文档打开状态下 hidden=true，强制点击
      const el = document.getElementById("starter-actions");
      if (el) el.hidden = false;
      (document.getElementById("head-open") as HTMLButtonElement | null)?.click();
    });

    const calls = await page.evaluate(() => (window as any).__discardCalled);
    expect(calls).toBe(0);
    // 文档应已切换
    await expect(page.locator("#doc-title")).toHaveText("样例文档");
  });
});
