/**
 * 25-format-button-cursor-escape.spec.ts
 *
 * Bug 2 (P0): 重复点击同一格式按钮，光标飞出可编辑区
 *
 * 现象：选中或不选中文本，连续点击同一个工具栏样式按钮（bold/italic/heading
 * 等），第 2~3 次点击后光标移动到编辑区外面——通常飞到页面左上角。
 *
 * 排查思路：
 *   - applyBlockFormat 在 block.tagName === target 且 target === "P" 时直接
 *     return，没有恢复 selection，也没有重新调 focus()。如果此前 focus 已经
 *     从 inlineEditorEl 上跑掉，光标就会落到 body 层级。
 *   - replaceBlockTag 用 document.createRange()/sel.addRange() 手动恢复
 *     selection，但 Chromium 下 contenteditable focus + range 有时序竞争。
 *   - execCommand("bold") 在第二次点击（文字已经加粗）时会 unwrap，可能
 *     产生 selection 落到 inlineEditorEl 根节点之外的情况。
 *
 * 本 spec 复现：对每个按钮连点 3 次，每次断言
 *   1. document.activeElement 仍然是 #inline-editor
 *   2. selection 的 anchorNode 仍然在 #inline-editor 内部
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "光标测试",
      markdown:
        "第一段用于粗体/斜体/删除线测试。\n\n" +
        "第二段用于标题测试。\n\n" +
        "第三段用于列表/引用测试。\n",
      html:
        "<p>第一段用于粗体/斜体/删除线测试。</p>" +
        "<p>第二段用于标题测试。</p>" +
        "<p>第三段用于列表/引用测试。</p>",
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

async function selectParagraph(page: Page, index: number) {
  await page.evaluate((i: number) => {
    // 选取当前编辑器里的块级元素（p 或 h1/h2/ul/li/blockquote 都可能）
    const editor = document.getElementById("inline-editor")!;
    const blocks = editor.querySelectorAll("p, h1, h2, h3, li, blockquote");
    const el = blocks[i];
    if (!el) {
      // fallback: 选第一个子节点
      const first = editor.children[i];
      if (!first) throw new Error(`block ${i} not found`);
      const range = document.createRange();
      range.selectNodeContents(first);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, index);
}

/**
 * 断言光标仍在 inline-editor 内部
 * 返回详细诊断信息供测试失败时阅读
 */
async function assertCursorInsideEditor(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const editor = document.getElementById("inline-editor");
    const active = document.activeElement;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode ?? null;

    const isEditorFocused =
      active === editor || (editor?.contains(active) ?? false);
    const isSelectionInEditor = anchor
      ? (editor?.contains(anchor) ?? false) || anchor === editor
      : false;

    return {
      activeElementId: (active as HTMLElement)?.id ?? active?.nodeName ?? "null",
      activeElementTag: active?.tagName ?? "null",
      isEditorFocused,
      isSelectionInEditor,
      anchorNodeType: anchor?.nodeType ?? -1,
      anchorNodeName: anchor?.nodeName ?? "null",
      anchorNodeParentId:
        (anchor?.parentElement as HTMLElement)?.id ?? "null",
      selectionString: sel?.toString().slice(0, 30) ?? "",
    };
  });

  // 光标必须在编辑器内（activeElement === inline-editor 或其子节点）
  expect(
    result.isEditorFocused,
    `光标飞出编辑器！activeElement=${result.activeElementTag}#${result.activeElementId}`,
  ).toBe(true);

  // selection 锚点必须在编辑器内
  expect(
    result.isSelectionInEditor,
    `Selection anchor 飞出编辑器！anchorNode=${result.anchorNodeName}，` +
      `parent#id=${result.anchorNodeParentId}`,
  ).toBe(true);
}

test.describe("Bug 2 — 重复点击格式按钮光标不得飞出编辑区", () => {
  /**
   * bold 连点 3 次
   * 第 1 次：普通文字 → <b>
   * 第 2 次：<b> → 解包回普通文字（toggle off）
   * 第 3 次：普通文字 → <b>（再次加粗）
   */
  test("bold 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 0);
      await page.locator('[data-cmd="bold"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * italic 连点 3 次
   */
  test("italic 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 0);
      await page.locator('[data-cmd="italic"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * H1 连点 3 次（applyBlockFormat + toggle to P 路径）
   * 第 1 次：P → H1
   * 第 2 次：H1 → P（toggle off：block.tagName === target → replaceBlockTag(block, "P")）
   * 第 3 次：P → H1
   */
  test("H1 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      // 选的是第 1 段；点完 h1 后段落变成 h1，下次 selectParagraph 仍能选到它
      await selectParagraph(page, 0);
      await page.locator('[data-cmd="h1"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * H2 连点 3 次（与 H1 同路径，但 target 不同）
   */
  test("H2 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 1);
      await page.locator('[data-cmd="h2"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * quote（blockquote）连点 3 次
   * 第 1 次：P → blockquote（toggleBlockquote：createRange + wrapper）
   * 第 2 次：blockquote → P（unwrap：while bq.firstChild...）
   * 第 3 次：P → blockquote
   */
  test("quote 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 2);
      await page.locator('[data-cmd="quote"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * paragraph（"正文"按钮）连点 3 次
   * applyBlockFormat("P") 的特殊路径：block.tagName === "P" → 直接 return，
   * 不做任何事，但 focus() 已经在 runFormatCommand 开头被调过了，
   * 这里检查 selection 是否丢失。
   */
  test("paragraph 按钮连点 3 次后，光标仍在 inline-editor 内", async ({
    page,
  }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 0);
      await page.locator('[data-cmd="paragraph"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * strikethrough 连点 3 次（使用 execCommand("strikeThrough")，行为类似 bold）
   */
  test("strike 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 0);
      await page.locator('[data-cmd="strike"]').click();
      await assertCursorInsideEditor(page);
    }
  });

  /**
   * ul（无序列表）连点 3 次
   * execCommand("insertUnorderedList") 第 2 次会解除列表（toggle off）
   */
  test("ul 连点 3 次后，光标仍在 inline-editor 内", async ({ page }) => {
    await enterEditMode(page);

    for (let i = 0; i < 3; i++) {
      await selectParagraph(page, 2);
      await page.locator('[data-cmd="ul"]').click();
      await assertCursorInsideEditor(page);
    }
  });
});
