import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown: "Alpha text\nBeta line\nGamma line\n",
      html: "<p>Alpha text</p><p>Beta line</p><p>Gamma line</p>",
      assets: [] as Array<unknown>,
      dirty: false,
      format: "aimd" as const,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const render = (markdown: string) => ({
      html: markdown
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\n/g, "<br>"),
    });
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => s.doc,
      save_aimd: (a) => ({ ...s.doc, markdown: String((a as any)?.markdown ?? s.doc.markdown), dirty: false }),
      render_markdown: (a) => render(String((a as any)?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String((a as any)?.markdown ?? "")),
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
  await expect(page.locator("#markdown")).toBeVisible();
}

async function setMarkdownSelection(page: Page, value: string, start: number, end = start) {
  await page.locator("#markdown").evaluate(
    (textarea: HTMLTextAreaElement, next) => {
      textarea.value = next.value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      textarea.focus();
      textarea.setSelectionRange(next.start, next.end);
    },
    { value, start, end },
  );
}

test.describe("Markdown format toolbar", () => {
  test("inline commands write Markdown around textarea selection", async ({ page }) => {
    await enterEditMode(page);
    await setMarkdownSelection(page, "Alpha text\n", 0, 5);
    await page.locator('[data-cmd="bold"]').click();
    await expect(page.locator("#markdown")).toHaveValue("**Alpha** text\n");

    await setMarkdownSelection(page, "Alpha text\n", 0, 5);
    await page.locator('[data-cmd="italic"]').click();
    await expect(page.locator("#markdown")).toHaveValue("*Alpha* text\n");

    await setMarkdownSelection(page, "Alpha text\n", 0, 5);
    await page.locator('[data-cmd="strike"]').click();
    await expect(page.locator("#markdown")).toHaveValue("~~Alpha~~ text\n");

    await setMarkdownSelection(page, "Alpha text\n", 0, 5);
    await page.locator('[data-cmd="code"]').click();
    await expect(page.locator("#markdown")).toHaveValue("`Alpha` text\n");
  });

  test("block commands transform selected lines", async ({ page }) => {
    await enterEditMode(page);
    await setMarkdownSelection(page, "Alpha\nBeta\n", 0, 5);
    await page.locator('[data-cmd="h1"]').click();
    await expect(page.locator("#markdown")).toHaveValue("# Alpha\nBeta\n");

    await setMarkdownSelection(page, "Alpha\nBeta\n", 0, 11);
    await page.locator('[data-cmd="h2"]').click();
    await expect(page.locator("#markdown")).toHaveValue("## Alpha\n## Beta\n");

    await setMarkdownSelection(page, "Alpha\nBeta\n", 0, 11);
    await page.locator('[data-cmd="h3"]').click();
    await expect(page.locator("#markdown")).toHaveValue("### Alpha\n### Beta\n");

    await page.locator('[data-cmd="paragraph"]').click();
    await expect(page.locator("#markdown")).toHaveValue("Alpha\nBeta\n");
  });

  test("list, quote, task, table and code block commands stay in Markdown", async ({ page }) => {
    await enterEditMode(page);
    await setMarkdownSelection(page, "Alpha\nBeta\n", 0, 11);
    await page.locator('[data-cmd="ul"]').click();
    await expect(page.locator("#markdown")).toHaveValue("- Alpha\n- Beta\n");

    await setMarkdownSelection(page, "Alpha\nBeta\n", 0, 11);
    await page.locator('[data-cmd="ol"]').click();
    await expect(page.locator("#markdown")).toHaveValue("1. Alpha\n2. Beta\n");

    await setMarkdownSelection(page, "Alpha\n", 0, 5);
    await page.locator('[data-cmd="quote"]').click();
    await expect(page.locator("#markdown")).toHaveValue("> Alpha\n");

    await setMarkdownSelection(page, "Alpha\n", 0, 5);
    await page.locator('[data-cmd="task"]').click();
    await expect(page.locator("#markdown")).toHaveValue("- [ ] Alpha\n");

    await setMarkdownSelection(page, "", 0);
    await page.locator('[data-cmd="table"]').click();
    await expect(page.locator("#markdown")).toHaveValue(/\| 列 1 \| 列 2 \| 列 3 \|/);

    await setMarkdownSelection(page, "console.log('x')", 0, 16);
    await page.locator('[data-cmd="codeblock"]').click();
    await expect(page.locator("#markdown")).toHaveValue(/```text\nconsole\.log\('x'\)\n```/);
  });

  test("link popover updates Markdown and preserves textarea focus", async ({ page }) => {
    await enterEditMode(page);
    await setMarkdownSelection(page, "Alpha text\n", 0, 5);
    await page.locator('[data-cmd="link"]').click();
    await expect(page.locator("#link-popover")).toBeVisible();
    await page.locator("#link-popover-input").fill("https://example.com");
    await page.locator("#link-popover-confirm").click();
    await expect(page.locator("#markdown")).toHaveValue("[Alpha](https://example.com) text\n");
    await expect(page.locator("#markdown")).toBeFocused();
  });
});
