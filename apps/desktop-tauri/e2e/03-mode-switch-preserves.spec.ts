import { test, expect, Page } from "@playwright/test";

/**
 * Mode switching must not lose edits.
 *
 * The app supports three modes: read / edit (inline WYSIWYG) / source (raw markdown).
 * Users routinely jump between modes mid-edit. The contract is:
 *  1. Edits made in `edit` mode survive a hop to `source` (and back).
 *  2. Edits made in `source` mode survive a hop to `edit` (and back).
 * If either direction silently drops content, the user can lose work just by
 * clicking a tab — that is a P0 data-loss regression.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "# AIMD 样例\n\n这是一段用于 QA 自动化测试的正文。\n",
      html: "<h1>AIMD 样例</h1><p>这是一段用于 QA 自动化测试的正文。</p>",
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
      // The render mock approximates what the Go renderer does: the HTML is
      // derived from the *current* markdown payload. It must keep the inline
      // editor and the source pane consistent across mode hops.
      render_markdown: (a) => {
        const md = String((a as any)?.markdown ?? "");
        // Minimal markdown→html conversion for the cases this spec exercises:
        // headings (#, ##) and paragraphs. Anything else falls through as <p>.
        const lines = md.split(/\n/);
        const blocks: string[] = [];
        let buf: string[] = [];
        const flush = () => {
          if (!buf.length) return;
          const text = buf.join(" ").trim();
          if (text) blocks.push(`<p>${text}</p>`);
          buf = [];
        };
        for (const line of lines) {
          if (line.startsWith("# ")) {
            flush();
            blocks.push(`<h1>${line.slice(2).trim()}</h1>`);
          } else if (line.startsWith("## ")) {
            flush();
            blocks.push(`<h2>${line.slice(3).trim()}</h2>`);
          } else if (line.trim() === "") {
            flush();
          } else {
            buf.push(line);
          }
        }
        flush();
        return { html: blocks.join("") };
      },
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

test.describe("Mode switching preserves edits", () => {
  test("edits in source mode survive switching to edit mode", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader h1")).toHaveText("AIMD 样例");

    // Move into source mode and append a sentinel paragraph.
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const sentinel = "SOURCE_MODE_SENTINEL_TEXT";
    await page.locator("#markdown").evaluate((el: HTMLTextAreaElement, text: string) => {
      el.value = el.value + "\n\n" + text + "\n";
      el.dispatchEvent(new Event("input"));
    }, sentinel);

    // Wait past the 220ms render debounce so applyHTML fires.
    await page.waitForTimeout(400);

    // Sanity: the live preview reflects the new sentinel.
    await expect(page.locator("#preview")).toContainText(sentinel);

    // Now hop into edit mode. The inline editor should show the sentinel too;
    // currently the app re-seeds the inline editor from a stale state.doc.html
    // that was captured at open time, so the new paragraph is missing.
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();
    await expect(page.locator("#inline-editor")).toContainText(sentinel);
  });

  test("edits in edit mode survive a round-trip through source mode", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // Use a sentinel that turndown won't try to "markdown-escape" so the
    // round-trip is byte-identical and we can assert on raw substring match.
    // (Underscore-heavy strings get escaped to `EDIT\_MODE\_…`, which is fine
    // markdown but noisy in tests.)
    const sentinel = "edit mode sentinel paragraph";
    await page.locator("#inline-editor").evaluate((el: HTMLElement, text: string) => {
      const p = document.createElement("p");
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new Event("input"));
    }, sentinel);

    // Hop to source mode — setMode flushes inline edits before switching.
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();
    const md = await page.locator("#markdown").inputValue();
    expect(md).toContain(sentinel);

    // Round-trip back to edit mode: the sentinel must still be visible.
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toContainText(sentinel);
  });

  test("dirty flag remains set across mode hops", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const p = document.createElement("p");
      p.textContent = "DIRTY_SENTINEL";
      el.appendChild(p);
      el.dispatchEvent(new Event("input"));
    });

    // Save button enables only when state.doc.dirty is true.
    await expect(page.locator("#save")).not.toBeDisabled();

    await page.locator("#mode-source").click();
    await expect(page.locator("#save")).not.toBeDisabled();

    await page.locator("#mode-read").click();
    await expect(page.locator("#save")).not.toBeDisabled();
  });

  test("mode hops without edits do not rebuild the destination pane's innerHTML", async ({ page }) => {
    // Perf regression: setMode used to re-set innerHTML + tagAssetImages on
    // every mode entry, which on long documents shows up as ~1s of click
    // latency. The version-skip guard means an unchanged pane keeps its DOM.
    // We verify by stuffing a sentinel child into reader / inline-editor /
    // preview after their first paint and asserting it survives further
    // hops as long as no edits happen.
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader h1")).toHaveText("AIMD 样例");

    // Visit every mode once so each pane is freshly painted at the same
    // html-version, then plant sentinels.
    await page.locator("#mode-edit").click();
    await page.locator("#mode-source").click();
    await page.locator("#mode-read").click();

    await page.evaluate(() => {
      for (const id of ["reader", "inline-editor", "preview"]) {
        const host = document.getElementById(id)!;
        const mark = document.createElement("span");
        mark.className = "perf-sentinel";
        mark.dataset.host = id;
        host.appendChild(mark);
      }
    });

    // Hop through every mode again. No edits ⇒ no innerHTML reset ⇒ all
    // three sentinels still present.
    await page.locator("#mode-edit").click();
    await page.locator("#mode-source").click();
    await page.locator("#mode-read").click();
    await page.locator("#mode-edit").click();

    const survivors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".perf-sentinel"))
        .map((n) => (n as HTMLElement).dataset.host);
    });
    expect(survivors.sort()).toEqual(["inline-editor", "preview", "reader"]);
  });
});
