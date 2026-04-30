/**
 * 27-inline-code-toggle.spec.ts
 *
 * Bug A (P1): 行内代码按钮 <> 行为异常
 *
 * 现象：
 *   1. 连续点击 code 按钮，文字出现 <code><code>...</code></code> 多层嵌套，
 *      因为 CSS 对 code 字号有缩小（约 0.875em），多层后字体越来越小。
 *   2. 某次点击后光标飞出编辑区（activeElement 不再是 inline-editor）。
 *
 * 根因分析（main.ts wrapSelectionInTag, 1430-1451 行）：
 *   unwrap 检测逻辑：
 *     const parent = range.commonAncestorContainer.parentElement;
 *     if (parent && parent.tagName.toLowerCase() === tag) { unwrap; }
 *   这对于"选中整个 code 元素内的文字"有效，但当 selection 已经是
 *   一个 <code> 元素节点（commonAncestorContainer 是 <code> 本身），
 *   .parentElement 是其父节点而非 <code>，检测失败，再次 wrap 一层。
 *   此外，wrapSelectionInTag 在 catch 里静默吞掉错误，没有恢复焦点，
 *   导致光标在某些浏览器版本下飞出编辑区。
 *
 * 本 spec 断言：
 *   1. 连续点 code 5 次后，不出现 <code><code> 嵌套
 *   2. 每次点击后，光标始终在 inline-editor 内（activeElement 检查）
 *   3. 点一次 wrap，再点一次 unwrap，最终无 <code> 残留
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "行内代码测试",
      markdown: "这是一段测试文字。\n",
      html: "<p>这是一段测试文字。</p>",
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
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
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

/** 在 contenteditable 里选中第 0 个 p 的全部内容 */
async function selectParagraph(page: Page, index = 0) {
  await page.evaluate((i: number) => {
    const p = document.querySelectorAll("#inline-editor > p")[i];
    if (!p) throw new Error(`paragraph ${i} not found`);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, index);
}

test.describe("Bug A — 行内代码按钮 toggle 逻辑与光标稳定性", () => {
  /**
   * 点击一次 code 按钮：选中文字应被包进单层 <code>，且不出现嵌套。
   */
  test("单次点击 code 按钮：产生单层 <code>，无嵌套", async ({ page }) => {
    await enterEditMode(page);
    await selectParagraph(page, 0);
    await page.locator('[data-cmd="code"]').click();

    // 应该存在恰好一个 code 标签
    const codeCount = await page.locator("#inline-editor code").count();
    expect(codeCount).toBe(1);

    // 不应出现 code 嵌套
    const nestedCode = await page
      .locator("#inline-editor code code")
      .count();
    expect(nestedCode).toBe(0);
  });

  /**
   * 连续点击 code 按钮 5 次：
   *   - 第 1 次：wrap -> 1 个 <code>
   *   - 第 2 次（再次选中同一节点后）：unwrap -> 0 个 <code>
   *   - ...交替 toggle，但绝不产生 <code><code> 嵌套
   *
   * 注意：每次点击前需要重新选中，因为 selection 在 wrap/unwrap 后可能变为
   * 整个 code 元素，或文字节点。
   *
   * 本用例的核心断言：任何时刻都不出现 code 嵌套；点 5 次后光标在编辑区内。
   */
  test("连续点击 code 按钮 5 次：不出现 code 嵌套，光标始终在编辑区", async ({
    page,
  }) => {
    await enterEditMode(page);

    for (let i = 0; i < 5; i++) {
      // 每次点击前，先选中编辑区内现有的 code 或 p（无论当前状态如何）
      await page.evaluate(() => {
        // 选中 inline-editor 内的第一个叶子块（code 或 p）
        const editor = document.querySelector("#inline-editor")!;
        const first = editor.querySelector("code, p") as HTMLElement | null;
        if (!first) return;
        const range = document.createRange();
        range.selectNodeContents(first);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
      });

      await page.locator('[data-cmd="code"]').click();

      // 断言：不出现嵌套
      const nested = await page
        .locator("#inline-editor code code")
        .count();
      expect(nested).toBe(0);

      // 断言：光标仍在 inline-editor 内
      const activeId = await page.evaluate(
        () => document.activeElement?.id ?? "",
      );
      expect(activeId).toBe("inline-editor");
    }
  });

  /**
   * wrap -> unwrap 的完整往返：
   *   第 1 次点击后有 <code>；重新选中 <code> 内文字，第 2 次点击后 <code> 消失。
   */
  test("第 1 次 wrap、第 2 次 unwrap，最终无 code 残留", async ({ page }) => {
    await enterEditMode(page);

    // 第 1 次：wrap
    await selectParagraph(page, 0);
    await page.locator('[data-cmd="code"]').click();
    const afterWrap = await page.locator("#inline-editor code").count();
    expect(afterWrap).toBe(1);

    // 选中 code 内的文字，再点一次
    await page.evaluate(() => {
      const code = document.querySelector("#inline-editor code");
      if (!code) return;
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.locator('[data-cmd="code"]').click();

    // 第 2 次：应该 unwrap，无 code
    const afterUnwrap = await page.locator("#inline-editor code").count();
    expect(afterUnwrap).toBe(0);

    // 原始文字仍然存在（没有丢失内容）
    await expect(page.locator("#inline-editor")).toContainText(
      "这是一段测试文字",
    );
  });
});
