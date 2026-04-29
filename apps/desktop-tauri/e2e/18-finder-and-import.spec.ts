import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, unknown> | undefined;

    const docs: Record<string, any> = {
      "/mock/sample.aimd": {
        path: "/mock/sample.aimd",
        title: "样例文档",
        markdown: "# 样例文档\n\n正文一段。\n",
        html: "<h1>样例文档</h1><p>正文一段。</p>",
        assets: [],
        dirty: false,
      },
    };

    const revealLog: string[] = [];
    (window as any).__aimd_revealLog = revealLog;

    const mdDraft = {
      markdown: "# 测试报告\n\n内容段落。\n",
      title: "测试报告",
      html: "<h1>测试报告</h1><p>内容段落。</p>",
    };

    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => "/mock/sample.aimd",
      choose_markdown_file: () => "/mock/report.md",
      choose_image_file: () => null,
      choose_save_aimd_file: (a) =>
        `/mock/${String((a as any)?.suggestedName ?? "untitled.aimd")}`,
      open_aimd: (a) =>
        docs[String((a as any)?.path ?? "/mock/sample.aimd")] ??
        docs["/mock/sample.aimd"],
      save_aimd: (a) => ({
        ...(docs[String((a as any)?.path)] ?? docs["/mock/sample.aimd"]),
        markdown: String((a as any)?.markdown ?? ""),
        dirty: false,
      }),
      save_aimd_as: (a) => {
        const savePath = String((a as any)?.savePath ?? "/mock/untitled.aimd");
        const doc = {
          path: savePath,
          title: "测试报告",
          markdown: String((a as any)?.markdown ?? ""),
          html: "<h1>测试报告</h1><p>saved</p>",
          assets: [],
          dirty: false,
        };
        docs[savePath] = doc;
        return doc;
      },
      create_aimd: (a) => ({
        path: String((a as any)?.path ?? "/mock/new.aimd"),
        title: "未命名文档",
        markdown: "",
        html: "<h1>未命名文档</h1>",
        assets: [],
        dirty: false,
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      render_markdown_standalone: (a) => ({
        html: `<h1>未命名文档</h1><p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      add_image: () => null,
      add_image_bytes: () => null,
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
      convert_md_to_draft: (_a) => mdDraft,
      reveal_in_finder: (a) => {
        revealLog.push(String((a as any)?.path ?? ""));
        return null;
      },
      list_aimd_assets: () => [],
      confirm_discard_changes: () => "discard",
      save_markdown: () => undefined,
      confirm_upgrade_to_aimd: () => false,
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
  });
}

test.describe("1. Finder context menu", () => {
  test("right-click on recent item shows context menu with expected items", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd"]),
      );
    });
    await page.goto("/");

    const recentItem = page.locator(".recent-item").first();
    await expect(recentItem).toBeVisible();

    await recentItem.dispatchEvent("contextmenu", { clientX: 100, clientY: 200 });

    const menu = page.locator("[data-file-ctx-menu]");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("在 Finder 中显示")).toBeVisible();
    await expect(menu.getByText("复制路径")).toBeVisible();
    await expect(menu.getByText("从最近列表移除")).toBeVisible();
  });

  test("click 在 Finder 中显示 invokes reveal_in_finder with correct path", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd"]),
      );
    });
    await page.goto("/");

    const recentItem = page.locator(".recent-item").first();
    await recentItem.dispatchEvent("contextmenu", { clientX: 100, clientY: 200 });

    await expect(page.locator("[data-file-ctx-menu]")).toBeVisible();

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(
        "[data-file-ctx-menu] .file-ctx-item",
      );
      btn?.click();
    });

    await expect(page.locator("[data-file-ctx-menu]")).not.toBeVisible();

    const revealed = await page.evaluate(
      () => (window as any).__aimd_revealLog as string[],
    );
    expect(revealed).toContain("/mock/sample.aimd");
  });

  test("pressing Escape closes the context menu", async ({ page }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd"]),
      );
    });
    await page.goto("/");

    const recentItem = page.locator(".recent-item").first();
    await recentItem.dispatchEvent("contextmenu", { clientX: 100, clientY: 200 });

    await expect(page.locator("[data-file-ctx-menu]")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator("[data-file-ctx-menu]")).not.toBeVisible();
  });

  test("clicking outside closes the context menu", async ({ page }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd"]),
      );
    });
    await page.goto("/");

    const recentItem = page.locator(".recent-item").first();
    await recentItem.dispatchEvent("contextmenu", { clientX: 100, clientY: 200 });

    await expect(page.locator("[data-file-ctx-menu]")).toBeVisible();

    await page.locator("body").click({ position: { x: 10, y: 10 } });

    await expect(page.locator("[data-file-ctx-menu]")).not.toBeVisible();
  });

  test("从最近列表移除 removes item from recent list", async ({ page }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd", "/mock/other.aimd"]),
      );
    });
    await page.goto("/");

    await expect(page.locator(".recent-item")).toHaveCount(2);

    const recentItem = page.locator(".recent-item").first();
    await recentItem.dispatchEvent("contextmenu", { clientX: 100, clientY: 200 });

    await expect(page.locator("[data-file-ctx-menu]")).toBeVisible();

    await page.evaluate(() => {
      const btns = document.querySelectorAll<HTMLElement>(
        "[data-file-ctx-menu] .file-ctx-item",
      );
      const removeBtn = Array.from(btns).find((b) =>
        b.textContent?.includes("移除"),
      );
      removeBtn?.click();
    });

    await expect(page.locator(".recent-item")).toHaveCount(1);
  });
});

test.describe("2. Open Markdown as document", () => {
  test("open markdown loads as formal document (not draft), shows .md path", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-import").click();

    await expect(page.locator("#doc-title")).toHaveText("测试报告");
    await expect(page.locator("#reader h1")).toHaveText("测试报告");

    const saveLabel = page.locator("#save-label");
    await expect(saveLabel).toHaveText("保存");
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#doc-path")).not.toContainText("未保存草稿");
  });

  test("after open, ⌘S saves back to .md (save_markdown path)", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-import").click();
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");

    // 切换到编辑模式，输入内容使 dirty
    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor").click();
    await page.keyboard.type("x");
    await page.waitForFunction(() => {
      const pill = document.querySelector("#status-pill");
      return pill && pill.getAttribute("data-tone") === "warn";
    }, { timeout: 3000 });

    await page.locator("#save").click();

    // doc-path 仍是 .md（未升级）
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#save-label")).toHaveText("保存");
  });

  test("open markdown doc can be closed without forced save prompt", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator("#empty-import").click();
    await expect(page.locator("#doc-actions")).toBeVisible();

    await page.locator("#close").click();

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#doc-actions")).toBeHidden();
  });

  test("drop .md file opens as formal document, shows .md path", async ({ page }) => {
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("aimd.desktop.recents", JSON.stringify([]));
    });
    await page.goto("/");

    await page.evaluate(() => {
      const file = new File(["# 测试报告\n\n内容段落。\n"], "report.md", {
        type: "text/markdown",
      });
      Object.defineProperty(file, "path", { value: "/mock/report.md" });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.body.dispatchEvent(
        new DragEvent("drop", { dataTransfer: dt, bubbles: true }),
      );
    });

    await expect(page.locator("#doc-title")).toHaveText("测试报告");
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#save-label")).toHaveText("保存");
  });
});

test.describe("3. Inline editor — heading Enter behavior", () => {
  async function openDocInEditMode(page: Page) {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();
  }

  test("Enter at end of H1 — app calls preventDefault() and creates a new paragraph", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h1>标题一</h1>";
      const h1 = el.querySelector("h1")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // dispatchEvent + defaultPrevented — 变异敏感：删除 event.preventDefault() 则 prevented=false
    const prevented = await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);

    // 同时断言 DOM 状态：H1 之后应有 <p>，不出现 <br> 在 H1 内
    const html = await page.locator("#inline-editor").innerHTML();
    expect(html.toLowerCase()).toContain("<p");
    expect(html.toLowerCase()).not.toMatch(/<h1[^>]*>.*<br.*<\/h1>/s);
  });

  test("Enter at end of H2 — app calls preventDefault() and creates a paragraph, not another H2", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h2>二级标题</h2>";
      const h2 = el.querySelector("h2")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h2);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // dispatchEvent + defaultPrevented — 变异敏感
    const prevented = await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);

    // 同时断言 DOM 状态：应有 <p>，不出现第二个 H2
    const html = await page.locator("#inline-editor").innerHTML();
    expect(html.toLowerCase()).toContain("<p");
    const h2count = (html.match(/<h2/gi) || []).length;
    expect(h2count).toBe(1);
  });

  test("flushInline strips inline style from heading elements", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = '<h1 style="color:red"><span style="font-weight:bold">脏标题</span></h1>';
      el.dispatchEvent(new Event("input"));
    });

    await page.locator("#mode-read").click();
    await page.locator("#mode-edit").click();

    const html = await page.locator("#inline-editor").innerHTML();
    expect(html).not.toContain('style="color:red"');
    expect(html).not.toContain('style="font-weight:bold"');
  });

  test("H1 to H2 toggle via toolbar does not create orphan span with inline style", async ({
    page,
  }) => {
    await openDocInEditMode(page);

    await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
      el.innerHTML = "<h1>切换测试</h1>";
      const h1 = el.querySelector("h1")!;
      const sel = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new Event("input"));
    });

    await page.locator('[data-cmd="h2"]').click();

    const html = await page.locator("#inline-editor").innerHTML();
    expect(html.toLowerCase()).toContain("<h2");
    expect(html).not.toMatch(/style=/i);
  });
});

test.describe("4. contextmenu capture 顺序（BUG-003）", () => {
  // 用 __aimd_force_contextmenu_block=true 激活生产路径的全局 capture listener。
  // 验证：文件项右键 contextmenu 不被全局 listener preventDefault，非文件项被 prevent。

  async function setupWithContextBlock(page: Page) {
    await page.addInitScript(() => {
      (window as any).__aimd_force_contextmenu_block = true;
    });
    await installTauriMock(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/sample.aimd"]),
      );
    });
    await page.goto("/");
  }

  test("文件项 contextmenu 不被全局 capture listener preventDefault", async ({
    page,
  }) => {
    await setupWithContextBlock(page);

    const recentItem = page.locator(".recent-item").first();
    await expect(recentItem).toBeVisible();

    const prevented = await recentItem.evaluate((el: HTMLElement) => {
      const ev = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    // 文件项有 data-file-item，全局 listener 应放行，由文件项自己 preventDefault
    // 文件项的 handler 里调 e.preventDefault()，所以 defaultPrevented 应为 true
    // 但关键是：自定义菜单应该出现（文件项处理正常，没被全局 capture 吞掉）
    const menu = page.locator("[data-file-ctx-menu]");
    await expect(menu).toBeVisible();
  });

  test("非文件项 contextmenu 被全局 capture listener preventDefault", async ({
    page,
  }) => {
    await setupWithContextBlock(page);

    const prevented = await page.evaluate(() => {
      const ev = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      // 在 body 上（非 data-file-item 元素）触发
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    expect(prevented).toBe(true);
  });
});
