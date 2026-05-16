import { test, expect, Page } from "@playwright/test";

/**
 * Title region guard regression.
 *
 * Bug report: pressing Backspace at the very start of the body paragraph
 * (cursor immediately after the heading) merges that paragraph into the H1.
 * The H1 then grows arbitrarily long; the H1 inside the editor previously
 * pushed document chrome actions off the right edge of the viewport. Layout
 * broke.
 *
 * Two contracts to pin:
 *  A. Backspace at the start of a non-heading block whose previous sibling
 *     is a heading must NOT merge them. The default contenteditable behaviour
 *     is preventDefault'd in paste.ts#onInlineKeydown.
 *  B. The H1 text length is hard-capped at MAX_TITLE_LENGTH (100). Typing
 *     beyond it is a no-op; pasting beyond it is truncated by the input
 *     safety net in inline.ts#enforceTitleLength.
 *  C. command-strip document actions stay inside the viewport even if
 *     (somehow) the H1 grew huge.
 */

async function installTauriMock(page: Page) {
  const doc = {
    path: "/mock/sample.aimd",
    title: "样例文档",
    markdown: "# 样例文档\n\n正文一段。\n",
    html: "<h1>样例文档</h1><p>正文一段。</p>",
    assets: [] as Array<unknown>,
    dirty: false,
  };
  await page.addInitScript((d: typeof doc) => {
    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_doc_file: () => d.path,
      choose_image_file: () => null,
      open_aimd: () => d,
      save_aimd: () => ({ ...d, dirty: false }),
      render_markdown: () => ({ html: d.html }),
      render_markdown_standalone: () => ({ html: d.html }),
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
  }, doc);
}

async function openInEditMode(page: Page) {
  await page.setViewportSize({ width: 1100, height: 720 });
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toBeVisible();
}

test.describe("Title region: backspace cannot merge body into H1", () => {
  test("Backspace at start of body paragraph leaves H1 and P intact", async ({ page }) => {
    await openInEditMode(page);

    // Park caret at the very start of the <p>.
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      const p = editor.querySelector("p") as HTMLElement;
      const range = document.createRange();
      range.setStart(p, 0);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
    });

    // Hit Backspace via real key event.
    await page.keyboard.press("Backspace");

    // The H1 and P must still be siblings; the H1 must be unchanged.
    const shape = await page.locator("#inline-editor").evaluate((el) => {
      const h1 = el.querySelector("h1");
      const p = el.querySelector("p");
      return {
        hasH1: !!h1,
        hasP: !!p,
        h1Text: h1?.textContent ?? null,
        pText: p?.textContent ?? null,
        h1Then: h1?.nextElementSibling?.tagName ?? null,
      };
    });
    expect(shape.hasH1).toBe(true);
    expect(shape.hasP).toBe(true);
    expect(shape.h1Text).toBe("样例文档");
    expect(shape.pText).toBe("正文一段。");
    expect(shape.h1Then).toBe("P");
  });

  test("Backspace inside the body paragraph still works normally", async ({ page }) => {
    await openInEditMode(page);

    // Place caret AFTER the first character of the <p>, then Backspace.
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      const p = editor.querySelector("p") as HTMLElement;
      const text = p.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
    });
    await page.keyboard.press("Backspace");

    const pText = await page.locator("#inline-editor p").first().textContent();
    expect(pText).toBe("文一段。");
  });
});

test.describe("Title region: H1 length is capped", () => {
  test("typing past MAX_TITLE_LENGTH in H1 is blocked", async ({ page }) => {
    await openInEditMode(page);

    // Move caret to end of H1.
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      const h1 = editor.querySelector("h1") as HTMLElement;
      const text = h1.lastChild as Text;
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
    });

    // Type 200 chars; the cap (100) should let only ~96 more through (start at 4).
    await page.keyboard.type("a".repeat(200), { delay: 0 });

    const len = await page
      .locator("#inline-editor h1")
      .first()
      .evaluate((el) => (el.textContent ?? "").length);
    expect(len).toBeLessThanOrEqual(100);
    expect(len).toBeGreaterThan(50);
  });

  test("paste-injected over-long H1 is truncated by the input safety net", async ({ page }) => {
    await openInEditMode(page);

    // Forcibly inflate the H1 textContent and then dispatch an input event,
    // simulating what a paste / dictation / IME-commit path can produce.
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      const h1 = editor.querySelector("h1") as HTMLElement;
      h1.textContent = "X".repeat(500);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const len = await page
      .locator("#inline-editor h1")
      .first()
      .evaluate((el) => (el.textContent ?? "").length);
    expect(len).toBe(100);
  });
});

test.describe("Title region: command-strip actions never get pushed off-viewport", () => {
  test("even with a huge H1 the action buttons stay inside the viewport", async ({ page }) => {
    await openInEditMode(page);

    // Force a pathological H1 length by writing past the cap before the input
    // listener can fire — simulating the worst case (e.g. an OS-level paste
    // we couldn't intercept). The command strip should still keep document
    // actions reachable.
    await page.evaluate(() => {
      const editor = document.querySelector("#inline-editor") as HTMLElement;
      const h1 = editor.querySelector("h1") as HTMLElement;
      h1.textContent = "Z".repeat(600);
      // Skip dispatching input so the truncation safety net does not run —
      // we want to assert pure CSS resilience here.
    });

    const layout = await page.evaluate(() => {
      const save = document.querySelector("#save") as HTMLElement;
      const menu = document.querySelector("#more-menu-toggle") as HTMLElement;
      const strip = document.querySelector("#document-command-strip") as HTMLElement;
      const saveBox = save.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const stripBox = strip.getBoundingClientRect();
      return {
        saveRight: saveBox.right,
        menuRight: menuBox.right,
        stripRight: stripBox.right,
        vw: window.innerWidth,
      };
    });
    expect(layout.saveRight).toBeLessThanOrEqual(layout.vw + 1);
    expect(layout.menuRight).toBeLessThanOrEqual(layout.vw + 1);
    expect(layout.stripRight).toBeLessThanOrEqual(layout.vw + 1);
  });
});
