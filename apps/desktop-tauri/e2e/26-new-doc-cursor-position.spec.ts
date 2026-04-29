/**
 * 26-new-doc-cursor-position.spec.ts
 *
 * Bug 3 (P1，偶发): 打开新文档时光标飞出可编辑区
 *
 * 现象：偶发，新建文档刚打开时光标就在不该在的位置。
 *
 * 排查思路：
 *   newDocument() 调用链：
 *     1. state.doc = doc
 *     2. render_markdown_standalone → applyHTML(out.html)
 *        applyHTML 在 state.mode === "edit" 时直接 innerHTML = html，
 *        但此时 setMode("edit") 还没调——state.mode 仍是 "read"
 *     3. setMode("edit") → paintPaneIfStale("edit")
 *        因为 applyHTML 设了 paintedVersion.edit = htmlVersion，
 *        paintPaneIfStale 认为 edit 不陈旧，直接跳过！
 *        → inlineEditorEl.innerHTML 保持上次的内容（或空）
 *        → 然而 applyHTML 在 mode!=="edit" 时没有 set inlineEditorEl.innerHTML
 *   但上面的分析依赖 mode 的先后顺序，需要实测。
 *
 *   另一个风险：连续多次 newDocument()，每次都不 setSelection/focus，
 *   浏览器的默认 focus 位置不确定。
 *
 * 本 spec：
 *   A. 单次新建：断言 inline-editor 可见、selection 在编辑器内部
 *   B. 连续新建 10 次：每次都断言光标在编辑器内（压测偶发）
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    let callCount = 0;
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      render_markdown_standalone: () => ({
        html: "<h1>未命名文档</h1><p>初始段落</p>",
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      list_aimd_assets: () => [],
      choose_save_aimd_file: () => null,
      confirm_discard_changes: () => "discard",
      save_aimd: (a) => ({
        path: "/mock/doc.aimd",
        title: "未命名文档",
        markdown: (a as any)?.markdown ?? "# 未命名文档\n\n",
        html: "<h1>未命名文档</h1>",
        assets: [],
        dirty: false,
      }),
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        callCount++;
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

/**
 * 断言光标在 inline-editor 内，并返回详细诊断
 */
async function assertCursorInsideEditorOrReport(
  page: Page,
  round: number,
): Promise<{
  ok: boolean;
  detail: string;
}> {
  return page.evaluate((r: number) => {
    const editor = document.getElementById("inline-editor");
    if (!editor) return { ok: false, detail: `round ${r}: #inline-editor not found` };

    const active = document.activeElement;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode ?? null;

    const isEditorFocused =
      active === editor || (editor.contains(active) ?? false);
    const isSelectionInEditor = anchor
      ? (editor.contains(anchor) ?? false) || anchor === editor
      : false;

    const detail =
      `round=${r} ` +
      `active=${active?.tagName ?? "null"}#${(active as HTMLElement)?.id ?? ""} ` +
      `isEditorFocused=${isEditorFocused} ` +
      `isSelectionInEditor=${isSelectionInEditor} ` +
      `anchor=${anchor?.nodeName ?? "null"} ` +
      `anchorParent=${(anchor?.parentElement as HTMLElement)?.id ?? anchor?.parentElement?.tagName ?? "null"}`;

    return { ok: isEditorFocused && isSelectionInEditor, detail };
  }, round);
}

test.describe("Bug 3 — 新建文档时光标位置正确性", () => {
  /**
   * A. 单次新建文档：inline-editor 可见后，selection 必须在编辑器内。
   *
   * newDocument() 不显式调用 focus() 或 setSelection()，
   * 这意味着光标位置完全取决于浏览器默认行为。
   */
  test("单次新建文档后，inline-editor 应获得焦点且光标在编辑区内", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // 等待一帧让浏览器完成 DOM 绘制
    await page.waitForTimeout(100);

    const result = await assertCursorInsideEditorOrReport(page, 1);

    // 如果 ok 为 false，说明光标没有正确落在编辑器里
    expect(result.ok, `光标飞出编辑器：${result.detail}`).toBe(true);
  });

  /**
   * B. 连续新建 10 次：压测偶发 race condition。
   *
   * 每次新建前，之前的文档被 "confirm_discard_changes" 丢弃。
   * 注意：dirty 草稿状态下 #sidebar-new 被隐藏，改用 ⌘N 快捷键触发新建。
   */
  test("连续新建 10 次，每次 inline-editor 光标都在编辑区内", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    const failures: string[] = [];

    for (let round = 1; round <= 10; round++) {
      // 第 1 次从 empty state CTA 点；之后用 ⌘N 快捷键（dirty 草稿下 sidebar-new 被隐藏）
      if (round === 1) {
        await page.locator("#empty-new").click();
      } else {
        await page.keyboard.press("Meta+n");
      }

      await expect(page.locator("#inline-editor")).toBeVisible();
      // 等一帧让 DOM 稳定
      await page.waitForTimeout(80);

      const result = await assertCursorInsideEditorOrReport(page, round);
      if (!result.ok) {
        failures.push(result.detail);
      }
    }

    // 报告所有失败轮次（而不是在第一个失败处中断）
    expect(
      failures.length,
      `以下 ${failures.length} 轮光标飞出编辑器：\n${failures.join("\n")}`,
    ).toBe(0);
  });

  /**
   * C. 新建文档后，inline-editor 的 innerHTML 必须包含正文内容（不为空）。
   *
   * applyHTML 的 mode 时序问题可能导致 inline-editor 在 edit 模式下内容为空
   * （paintPaneIfStale 误判为不陈旧、跳过写入）。
   */
  test("新建文档后 inline-editor 内容不为空", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    const html = await page
      .locator("#inline-editor")
      .evaluate((el: HTMLElement) => el.innerHTML.trim());

    expect(html.length, "inline-editor 内容为空，可能是 paintPaneIfStale 跳过了写入").toBeGreaterThan(0);
  });

  /**
   * D. 新建文档后 inline-editor 显示 H1 标题（而非上一个文档的内容）。
   *
   * 如果 session 恢复时遗留了上一个文档的 HTML，新建文档时
   * inline-editor 可能显示旧内容。
   */
  test("新建文档后 inline-editor 显示 H1 标题，不含旧文档残留内容", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // mock 的 render_markdown_standalone 返回 "<h1>未命名文档</h1><p>初始段落</p>"
    await expect(page.locator("#inline-editor h1")).toHaveCount(1);
    await expect(page.locator("#inline-editor h1")).toContainText("未命名文档");
  });
});
