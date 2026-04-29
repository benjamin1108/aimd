/**
 * 29-heading-enter-split.spec.ts
 *
 * Bug C (P1): H1/H2/H3 标题里按回车不分割文本
 *
 * 现象：光标在 H1 文本中间，按 Enter，期望把光标后的文字移到新段落（p），
 * 但实际行为是：heading 保持完整，新插入的是空段落（p br），光标后的文字
 * 仍然留在 heading 内——即内容没有被分割。
 *
 * 根因（main.ts:1161-1177）：
 *   onInlineKeydown 对 Enter in heading 的处理：
 *     event.preventDefault();
 *     const p = document.createElement("p");
 *     p.appendChild(document.createElement("br"));
 *     block.after(p);
 *     // 光标设到 p 开头
 *
 *   问题：代码总是在 heading 末尾插入空 <p><br>，没有提取光标后的内容。
 *   如果光标在 "Hello World" 的 "Hello " 和 "World" 之间，Enter 后应该：
 *     - H1 变为 "Hello "
 *     - 新 <p> 包含 "World"
 *   但当前实现 H1 保持 "Hello World"，新 <p> 是空的。
 *
 * 本 spec 断言：
 *   1. 光标在 H1 中间按 Enter -> heading 只保留光标前文字，新 p 包含光标后文字
 *   2. 光标在 H1 末尾按 Enter -> heading 保持完整，新 p 为空（合理行为）
 *   3. 光标在 H1 开头按 Enter -> heading 变为空，新 p 包含全部文字
 *   4. H2/H3 同样适用
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/heading-enter.aimd",
      title: "标题回车测试",
      markdown: "# Hello World\n\n## Second Heading\n\n### Third Heading\n",
      html:
        "<h1>Hello World</h1><h2>Second Heading</h2><h3>Third Heading</h3>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
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

test.describe("Bug C — H1/H2/H3 按 Enter 分割文本", () => {
  /**
   * 核心用例：光标在 H1 "Hello World" 中间 "World" 前面，按 Enter。
   * 期望：H1 = "Hello "（或"Hello"），新 <p> = "World"
   * 实际（bug）：H1 = "Hello World"，新 <p> = ""（空）
   */
  test("H1 中间按 Enter：光标前内容留在 H1，光标后内容移到新 p", async ({
    page,
  }) => {
    await enterEditMode(page);

    // 把光标放到 H1 文字 "Hello World" 中 "W" 之前（即 "Hello " 后）
    await page.evaluate(() => {
      const h1 = document.querySelector("#inline-editor h1");
      if (!h1 || !h1.firstChild) throw new Error("h1 not found");
      const textNode = h1.firstChild as Text;
      const pos = textNode.textContent!.indexOf("W"); // "World" 的 W
      if (pos < 0) throw new Error("W not found in h1");
      const range = document.createRange();
      range.setStart(textNode, pos);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    // H1 应该只包含 "Hello "（光标前的部分）
    const h1Text = await page.locator("#inline-editor h1").textContent();
    expect(
      (h1Text ?? "").includes("World"),
      `H1 不应包含 "World"，当前 H1 文本："${h1Text}"`,
    ).toBe(false);

    // 新段落应该包含 "World"（光标后的部分）
    // 新的 p 是在 h1 之后插入的
    const pAfterH1 = await page.evaluate(() => {
      const h1 = document.querySelector("#inline-editor h1");
      if (!h1) return null;
      const next = h1.nextElementSibling;
      return next ? next.textContent : null;
    });
    expect(
      (pAfterH1 ?? "").includes("World"),
      `H1 后面的段落应包含 "World"，当前为："${pAfterH1}"`,
    ).toBe(true);
  });

  /**
   * H1 末尾按 Enter：H1 保持完整，新段落为空（或只含 br）
   * 这是合理行为，此用例验证末尾 Enter 不会乱插内容。
   */
  test("H1 末尾按 Enter：H1 内容完整保留，后面插入新空段落", async ({
    page,
  }) => {
    await enterEditMode(page);

    // 把光标放到 H1 末尾
    await page.evaluate(() => {
      const h1 = document.querySelector("#inline-editor h1");
      if (!h1 || !h1.firstChild) throw new Error("h1 not found");
      const textNode = h1.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    // H1 仍然完整
    const h1Text = await page.locator("#inline-editor h1").textContent();
    expect(h1Text).toBe("Hello World");

    // H1 后面应有新的段落
    const hasNewBlock = await page.evaluate(() => {
      const h1 = document.querySelector("#inline-editor h1");
      return !!(h1 && h1.nextElementSibling);
    });
    expect(hasNewBlock).toBe(true);
  });

  /**
   * H2 中间按 Enter：同样应分割文本。
   * "Second Heading" -> 光标在 " " 后 "Heading" 前 -> Enter ->
   *   H2 = "Second ", 新 p = "Heading"
   */
  test("H2 中间按 Enter：文本被分割到新段落", async ({ page }) => {
    await enterEditMode(page);

    await page.evaluate(() => {
      const h2 = document.querySelector("#inline-editor h2");
      if (!h2 || !h2.firstChild) throw new Error("h2 not found");
      const textNode = h2.firstChild as Text;
      const text = textNode.textContent!;
      const pos = text.indexOf("H"); // "Heading" 的 H（在 Second 之后）
      if (pos < 0) throw new Error("H not found in h2");
      const range = document.createRange();
      range.setStart(textNode, pos);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    const h2Text = await page.locator("#inline-editor h2").textContent();
    expect(
      (h2Text ?? "").includes("Heading"),
      `H2 不应包含 "Heading"，当前："${h2Text}"`,
    ).toBe(false);

    const pAfterH2 = await page.evaluate(() => {
      const h2 = document.querySelector("#inline-editor h2");
      if (!h2) return null;
      const next = h2.nextElementSibling;
      return next ? next.textContent : null;
    });
    expect(
      (pAfterH2 ?? "").includes("Heading"),
      `H2 后段落应含 "Heading"，当前："${pAfterH2}"`,
    ).toBe(true);
  });

  /**
   * H1 开头按 Enter：所有内容移到新段落，H1 变为空（或 heading 上移）
   * 这个行为在 contenteditable 里各实现不同，本用例只验证文字不丢失。
   */
  test("H1 开头按 Enter：文字不丢失", async ({ page }) => {
    await enterEditMode(page);

    await page.evaluate(() => {
      const h1 = document.querySelector("#inline-editor h1");
      if (!h1 || !h1.firstChild) throw new Error("h1 not found");
      const textNode = h1.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    await page.keyboard.press("Enter");

    // "Hello World" 不应消失
    await expect(page.locator("#inline-editor")).toContainText("Hello World");
  });
});
