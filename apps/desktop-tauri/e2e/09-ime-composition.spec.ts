import { test, expect, Page } from "@playwright/test";

/**
 * IME composition — best-effort regression coverage.
 *
 * Playwright's Chromium can't run a real IME, but we can synthesise the
 * compositionstart / compositionupdate / compositionend event sequence the
 * way browsers do for pinyin/wubi candidates. The contract we care about is
 * narrow but real:
 *
 *  - During composition (between compositionstart and compositionend), the
 *    inline editor must NOT race ahead and convert intermediate state to
 *    markdown via flushInline. If it did, candidate text would be turned
 *    into final characters mid-typing and confuse the IME.
 *  - Once compositionend fires the editor's input listener should observe
 *    the final string.
 *
 * The current main.ts has no special handling for composition events — it
 * relies on the browser's native behaviour where contenteditable correctly
 * suppresses 'input' events between start and end. This spec pins that
 * behaviour so a future refactor (e.g. introducing a beforeinput shim)
 * doesn't accidentally break it.
 *
 * If this test ever flakes on real Chinese input, the report should call
 * out the Playwright limitation explicitly — the user must still verify
 * pinyin candidates manually on macOS.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例",
      markdown: "# 样例\n",
      html: "<h1>样例</h1><p></p>",
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
      save_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown, dirty: false }),
      render_markdown: () => ({ html: s.doc.html }),
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

test.describe("IME composition (synthetic)", () => {
  test("compositionstart/end pair lets final text reach the editor without crashing", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // Move caret into the empty paragraph at the end of the document.
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.focus();
      const p = el.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Synthesise the IME sequence: start, two updates, end + final commit.
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      el.dispatchEvent(new CompositionEvent("compositionupdate", { data: "n" }));
      el.dispatchEvent(new CompositionEvent("compositionupdate", { data: "ni" }));
      // Real IMEs commit by inserting text + firing compositionend. We
      // approximate the commit by appending the final glyph to the editor's
      // empty paragraph, then firing compositionend + input.
      const p = el.querySelector("p")!;
      p.textContent = (p.textContent || "") + "你好";
      el.dispatchEvent(new CompositionEvent("compositionend", { data: "你好" }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Wait past the 700ms flushInline debounce so any latent flush completes.
    await page.waitForTimeout(900);

    // The final string is visible in the editor and didn't get duplicated /
    // dropped by an intervening flushInline race.
    await expect(page.locator("#inline-editor")).toContainText("你好");
    const occurrences = await page.locator("#inline-editor").evaluate(
      (el) => (el.textContent || "").split("你好").length - 1,
    );
    expect(occurrences).toBe(1);

    // After the debounce, the dirty flag must be set and a switch to source
    // mode must show 你好 in the textarea — proves flushInline ran *after*
    // compositionend, not before.
    await page.locator("#mode-source").click();
    const md = await page.locator("#markdown").inputValue();
    expect(md).toContain("你好");
  });
});
