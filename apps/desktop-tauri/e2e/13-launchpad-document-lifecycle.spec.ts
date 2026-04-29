import { test, expect, Page } from "@playwright/test";

async function installTauriMock(
  page: Page,
  options: {
    initialPath?: string | null;
    restoreLastPath?: string | null;
    recentPaths?: string[];
  } = {},
) {
  const seed = {
    initialPath: options.initialPath ?? null,
    restoreLastPath: options.restoreLastPath ?? null,
    recentPaths: options.recentPaths ?? [],
    docs: {
      "/mock/sample.aimd": {
        path: "/mock/sample.aimd",
        title: "样例文档",
        markdown: "# 样例文档\n\n正文一段。\n",
        html: "<h1>样例文档</h1><p>正文一段。</p>",
        assets: [] as Array<unknown>,
        dirty: false,
      },
      "/mock/drop.aimd": {
        path: "/mock/drop.aimd",
        title: "拖入文档",
        markdown: "# 拖入文档\n\n来自拖放。\n",
        html: "<h1>拖入文档</h1><p>来自拖放。</p>",
        assets: [] as Array<unknown>,
        dirty: false,
      },
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    if (s.restoreLastPath) {
      window.localStorage.setItem("aimd.desktop.last", s.restoreLastPath);
    }
    if (s.recentPaths.length) {
      window.localStorage.setItem("aimd.desktop.recents", JSON.stringify(s.recentPaths));
    }

    const docs = { ...s.docs } as Record<string, any>;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => s.initialPath,
      choose_aimd_file: () => "/mock/sample.aimd",
      choose_markdown_file: () => "/mock/report.md",
      choose_image_file: () => null,
      choose_save_aimd_file: (a) => `/mock/${String((a as any)?.suggestedName ?? "untitled.aimd")}`,
      open_aimd: (a) => docs[String((a as any)?.path ?? "/mock/sample.aimd")] ?? docs["/mock/sample.aimd"],
      create_aimd: (a) => ({
        path: String((a as any)?.path ?? "/mock/new.aimd"),
        title: "未命名文档",
        markdown: String((a as any)?.markdown ?? ""),
        html: "<h1>未命名文档</h1>",
        assets: [],
        dirty: false,
      }),
      save_aimd: (a) => ({
        ...(docs[String((a as any)?.path)] ?? docs["/mock/sample.aimd"]),
        markdown: String((a as any)?.markdown ?? ""),
        dirty: false,
      }),
      save_aimd_as: (a) => {
        const savePath = String((a as any)?.savePath ?? "/mock/untitled.aimd");
        const title = "未命名文档";
        const doc = {
          path: savePath,
          title,
          markdown: String((a as any)?.markdown ?? ""),
          html: `<h1>${title}</h1><p>saved</p>`,
          assets: [],
          dirty: false,
        };
        docs[savePath] = doc;
        return doc;
      },
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      render_markdown_standalone: (a) => ({ html: `<h1>未命名文档</h1><p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      add_image: () => null,
      import_markdown: (a) => {
        const savePath = String((a as any)?.savePath ?? "/mock/report.aimd");
        const doc = {
          path: savePath,
          title: "report",
          markdown: "# report\n\nImported.\n",
          html: "<h1>report</h1><p>Imported.</p>",
          assets: [],
          dirty: false,
        };
        docs[savePath] = doc;
        return doc;
      },
      convert_md_to_draft: () => ({
        markdown: "# report\n\nImported.\n",
        title: "report",
        html: "<h1>report</h1><p>Imported.</p>",
      }),
      reveal_in_finder: () => null,
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

test.describe("Launchpad and document lifecycle", () => {
  test("new document enters draft flow and saves via save-as", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-new").click();

    await expect(page.locator("#doc-actions")).toBeVisible();
    await expect(page.locator("#save-label")).toHaveText("创建文件");
    await expect(page.locator("#doc-path")).toContainText("未保存草稿");

    await page.locator("#save").click();

    await expect(page.locator("#doc-path")).toContainText("/mock/未命名文档.aimd");
    await expect(page.locator("#save-label")).toHaveText("保存");
  });

  test("close action protects unsaved changes", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 样例文档\n\n已修改。\n");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#close").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#close").click();
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeHidden();
  });

  test("recent documents and restore-last-session work", async ({ page }) => {
    await installTauriMock(page, {
      restoreLastPath: "/mock/sample.aimd",
      recentPaths: ["/mock/sample.aimd"],
    });
    await page.goto("/");

    await expect(page.locator("#doc-title")).toHaveText("样例文档");
    await expect(page.locator("#reader h1")).toHaveText("样例文档");

    await page.locator("#close").click();
    await expect(page.locator("#recent-section")).toBeVisible();
    await expect(page.locator(".recent-item").first()).toContainText("sample");

    await page.locator(".recent-item").first().click();
    await expect(page.locator("#doc-title")).toHaveText("样例文档");
  });

  test("reload restores the last opened saved document", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("样例文档");

    await page.reload();

    await expect(page.locator("#doc-title")).toHaveText("样例文档");
    await expect(page.locator("#reader h1")).toHaveText("样例文档");
  });

  test("reload restores unsaved source edits for an opened document", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 样例文档\n\nreload dirty source\n");

    await page.reload();

    await expect(page.locator("#mode-source")).toHaveClass(/active/);
    await expect(page.locator("#markdown")).toHaveValue("# 样例文档\n\nreload dirty source\n");
    await expect(page.locator("#status")).toContainText("未保存");
  });

  test("reload restores unsaved inline edits by flushing before unload", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const p = document.createElement("p");
      p.textContent = "inline reload";
      el.appendChild(p);
      el.dispatchEvent(new Event("input"));
    });

    await page.reload();

    await expect(page.locator("#mode-edit")).toHaveClass(/active/);
    await expect(page.locator("#inline-editor")).toContainText("inline reload");
  });

  test("reload restores an unsaved draft document", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-new").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 草稿标题\n\ndraft reload\n");

    await page.reload();

    await expect(page.locator("#doc-path")).toContainText("未保存草稿");
    await expect(page.locator("#mode-source")).toHaveClass(/active/);
    await expect(page.locator("#markdown")).toHaveValue("# 草稿标题\n\ndraft reload\n");
  });

  test("import markdown loads as draft (no immediate save dialog)", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-import").click();

    await expect(page.locator("#doc-title")).toHaveText("report");
    await expect(page.locator("#reader h1")).toHaveText("report");
    await expect(page.locator("#save-label")).toHaveText("创建文件");
    await expect(page.locator("#doc-path")).toContainText("未保存草稿");
  });

  test("dropping an .aimd file opens it from the launchpad", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.evaluate(() => {
      const file = new File(["dummy"], "drop.aimd");
      Object.defineProperty(file, "path", { value: "/mock/drop.aimd" });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    });

    await expect(page.locator("#doc-title")).toHaveText("拖入文档");
    await expect(page.locator("#reader h1")).toHaveText("拖入文档");
  });
});
