/**
 * 21-editor-frame-stability.spec.ts
 *
 * 钉两条用户实际报告的回归：
 *
 * A. 新建草稿后输入正文时，inline-editor 不会随内容增长向左漂移
 *    （`.reader` 缺 `width: 100%`，grid 项 shrink-to-content + auto margin
 *    会让标题居中再随正文变宽，整段视觉左移）
 *
 * B. 拖宽 sidebar 后关闭文档回 launch shell，panel 不会被内联
 *    `grid-template-columns` 卡在两列，导致 workspace 落入空 sidebar 列、
 *    右半屏空白
 */
import { test, expect, Page } from "@playwright/test";

async function clickClose(page: Page) {
  await page.locator("#more-menu-toggle").click();
  await page.locator("#close").click();
}

async function installMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
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

test.describe("A. inline editor 横向位置在内容增长时保持稳定", () => {
  test("editor box uses available column width without left/right drift", async ({ page }) => {
    await installMock(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    const measure = () =>
      page.locator("#inline-editor").evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, width: r.width };
      });

    const m0 = await measure();
    expect(m0.width).toBeGreaterThan(700);
    expect(m0.width).toBeLessThanOrEqual(880);

    // 把光标放进 H1 末尾，敲一段标题
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const h1 = el.querySelector("h1")!;
      h1.focus();
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(false);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.press("End");
    for (let i = 0; i < 10; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("我的文档标题");

    const m1 = await measure();
    expect(m1.width).toBe(m0.width);
    expect(m1.left).toBe(m0.left);

    // Enter 切到正文，连续追加多段，触发 onInlineInput / 重排
    await page.keyboard.press("Enter");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.type("一段正文，验证宽度稳定。");
      await page.keyboard.press("Enter");
    }

    const m2 = await measure();
    expect(m2.width).toBe(m0.width);
    expect(m2.left).toBe(m0.left);

    // 继续追加直到出现纵向滚动条
    for (let i = 0; i < 30; i++) {
      await page.keyboard.type("更多正文。再追加一行。");
      await page.keyboard.press("Enter");
    }

    const m3 = await measure();
    expect(m3.width).toBe(m0.width);
    expect(m3.left).toBe(m0.left);
  });
});

test.describe("B. 关闭文档回 launch shell 时，panel 必须恢复单列布局", () => {
  test("内联 grid-template-columns 在切回 launch 时被清空", async ({ page }) => {
    await installMock(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page.locator("#empty-new").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // 模拟用户拖宽 sidebar
    await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      panel.style.gridTemplateColumns = "460px minmax(0, 1fr)";
    });

    expect(
      await page.evaluate(() => document.getElementById("panel")!.style.gridTemplateColumns),
    ).toContain("460px");

    // newDocument() 把 dirty 标为 true，会调 confirm_discard_changes（mock 返回 "discard"）
    await clickClose(page);
    await expect(page.locator("#empty")).toBeVisible();

    const state = await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      const ws = document.querySelector(".workspace") as HTMLElement;
      return {
        shell: panel.dataset.shell,
        inline: panel.style.gridTemplateColumns,
        computedCols: getComputedStyle(panel).gridTemplateColumns,
        wsLeft: ws.getBoundingClientRect().left,
        wsRight: ws.getBoundingClientRect().right,
        panelLeft: panel.getBoundingClientRect().left,
        panelRight: panel.getBoundingClientRect().right,
      };
    });

    expect(state.shell).toBe("launch");
    expect(state.inline).toBe("");
    // 单列：computed 只剩一段，且 workspace 占满整个 panel
    expect(state.computedCols.split(" ").length).toBe(1);
    expect(Math.abs(state.wsLeft - state.panelLeft)).toBeLessThan(2);
    expect(Math.abs(state.wsRight - state.panelRight)).toBeLessThan(2);
  });
});
