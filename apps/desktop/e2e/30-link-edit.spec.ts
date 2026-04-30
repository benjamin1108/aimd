/**
 * 30-link-edit.spec.ts
 *
 * 链接编辑功能：光标在已有 <a> 内时点击链接按钮，走"编辑模式"而非"创建模式"。
 *
 * 覆盖场景：
 *  1. 光标在 <a> 中间点链接按钮 → 浮层 input value 等于现有 href
 *  2. 编辑 href 后确认 → a 文本不变、href 变了、无嵌套 <a>
 *  3. 编辑模式下取消 → href 不变
 *  4. 编辑模式下清空 URL 确认 → a 被解掉，文本保留
 *  5. 点击"删除链接"按钮 → a 被解掉，文本保留
 *  6. 光标在 <a> 末尾（collapsed）点链接 → 也走编辑模式
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/link-edit-test.aimd",
      title: "链接编辑测试",
      markdown: "这是普通文字。\n",
      html: "<p>这是普通文字。</p>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => s.doc,
      save_aimd: (a) => ({
        ...s.doc,
        markdown: (a as any)?.markdown ?? s.doc.markdown,
        dirty: false,
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 200)}</p>`,
      }),
      add_image: () => null,
      list_aimd_assets: () => [],
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
  }, seed);
}

async function enterEditMode(page: Page) {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toBeVisible();
}

/** 在编辑区注入一个已有 <a>，返回其文本内容 */
async function injectLink(page: Page, href: string, text: string) {
  await page.evaluate(
    ({ href, text }) => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      editor.innerHTML = `<p><a href="${href}">${text}</a> 后面的文字</p>`;
    },
    { href, text },
  );
}

/** 把光标放到 <a> 元素中间 */
async function placeCursorInsideAnchor(page: Page) {
  await page.evaluate(() => {
    const a = document.querySelector("#inline-editor a") as HTMLAnchorElement;
    if (!a) throw new Error("anchor not found");
    const textNode = a.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error("no text node in anchor");
    const range = document.createRange();
    // 放到文本中间
    const mid = Math.floor((textNode as Text).length / 2);
    range.setStart(textNode, mid);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

/** 把光标放到 <a> 末尾（collapsed，紧贴最后一个字符之后） */
async function placeCursorAtAnchorEnd(page: Page) {
  await page.evaluate(() => {
    const a = document.querySelector("#inline-editor a") as HTMLAnchorElement;
    if (!a) throw new Error("anchor not found");
    const textNode = a.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error("no text node in anchor");
    const range = document.createRange();
    range.setStart(textNode, (textNode as Text).length);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

test.describe("链接编辑功能（光标在 <a> 内时编辑现有链接）", () => {
  test("场景1：光标在 <a> 中间点链接按钮 → 浮层 input 预填现有 href", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://original.com", "原始链接文字");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();

    await expect(page.locator("#link-popover")).toBeVisible();
    // 输入框应预填现有 href
    const inputValue = await page.locator("#link-popover-input").inputValue();
    expect(inputValue).toBe("https://original.com");
    // 标题应为"编辑链接"
    await expect(page.locator("#link-popover-title")).toHaveText("编辑链接");
    // "删除链接"按钮应可见
    await expect(page.locator("#link-popover-unlink")).toBeVisible();

    // 取消关闭
    await page.locator("#link-popover-cancel").click();
    await expect(page.locator("#link-popover")).toBeHidden();
  });

  test("场景2：编辑 href 后确认 → a 文本不变、href 更新、无嵌套 <a>", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://old.com", "链接文字");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 修改 href
    await page.locator("#link-popover-input").fill("https://new.com");
    await page.locator("#link-popover-confirm").click();

    await expect(page.locator("#link-popover")).toBeHidden();

    // href 已更新
    await expect(page.locator('#inline-editor a[href="https://new.com"]')).toHaveCount(1);
    // 文本内容不变
    const linkText = await page.locator("#inline-editor a").textContent();
    expect(linkText).toBe("链接文字");
    // 无嵌套 <a><a>
    const nestedCount = await page.locator("#inline-editor a a").count();
    expect(nestedCount).toBe(0);
    // 旧 href 不再存在
    const oldCount = await page.locator('#inline-editor a[href="https://old.com"]').count();
    expect(oldCount).toBe(0);
  });

  test("场景3：编辑模式下取消 → href 不变", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://keep.com", "保持不变");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 修改输入但点取消
    await page.locator("#link-popover-input").fill("https://discard.com");
    await page.locator("#link-popover-cancel").click();

    await expect(page.locator("#link-popover")).toBeHidden();

    // 原 href 不变
    await expect(page.locator('#inline-editor a[href="https://keep.com"]')).toHaveCount(1);
    // 新 href 未生效
    const discardCount = await page.locator('#inline-editor a[href="https://discard.com"]').count();
    expect(discardCount).toBe(0);
  });

  test("场景4：编辑模式下清空 URL 确认 → a 被解链接，文本保留", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://remove.com", "要解除的链接");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 清空 URL
    await page.locator("#link-popover-input").fill("");
    await page.locator("#link-popover-confirm").click();

    await expect(page.locator("#link-popover")).toBeHidden();

    // <a> 应该不存在了
    const aCount = await page.locator("#inline-editor a").count();
    expect(aCount).toBe(0);

    // 文字内容应该保留在 DOM 中
    const editorText = await page.locator("#inline-editor").textContent();
    expect(editorText).toContain("要解除的链接");
  });

  test("场景5：点击【删除链接】按钮 → a 被解链接，文本保留", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://unlink.com", "点删除按钮解除");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 点"删除链接"
    await page.locator("#link-popover-unlink").click();

    await expect(page.locator("#link-popover")).toBeHidden();

    // <a> 应该不存在
    const aCount = await page.locator("#inline-editor a").count();
    expect(aCount).toBe(0);

    // 文字保留
    const editorText = await page.locator("#inline-editor").textContent();
    expect(editorText).toContain("点删除按钮解除");
  });

  test("场景6：光标在 <a> 末尾（collapsed）点链接 → 也走编辑模式", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://end-cursor.com", "末尾光标测试");
    await placeCursorAtAnchorEnd(page);

    await page.locator('[data-cmd="link"]').click();

    await expect(page.locator("#link-popover")).toBeVisible();
    // 应预填现有 href（不是 https://）
    const inputValue = await page.locator("#link-popover-input").inputValue();
    expect(inputValue).toBe("https://end-cursor.com");
    // 标题为"编辑链接"
    await expect(page.locator("#link-popover-title")).toHaveText("编辑链接");

    await page.locator("#link-popover-cancel").click();
  });

  test("场景7：编辑模式下按 Escape 取消 → href 不变", async ({ page }) => {
    await enterEditMode(page);
    await injectLink(page, "https://esc-test.com", "Escape 取消测试");
    await placeCursorInsideAnchor(page);

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    await page.locator("#link-popover-input").fill("https://escape-modified.com");
    await page.locator("#link-popover-input").press("Escape");

    await expect(page.locator("#link-popover")).toBeHidden();
    // 原 href 不变
    await expect(page.locator('#inline-editor a[href="https://esc-test.com"]')).toHaveCount(1);
  });

  test("普通文本上点链接按钮 → 浮层默认值为 https://（创建模式不受影响）", async ({ page }) => {
    await enterEditMode(page);

    // 注入普通文本，不含 <a>
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      editor.innerHTML = "<p>普通文字，没有链接</p>";
    });

    // 选中文字
    await page.evaluate(() => {
      const p = document.querySelector("#inline-editor p") as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();

    // 默认值应为 https://
    const inputValue = await page.locator("#link-popover-input").inputValue();
    expect(inputValue).toBe("https://");
    // 标题应为"链接地址"
    await expect(page.locator("#link-popover-title")).toHaveText("链接地址");
    // "删除链接"按钮应隐藏
    await expect(page.locator("#link-popover-unlink")).toBeHidden();

    await page.locator("#link-popover-cancel").click();
  });
});
