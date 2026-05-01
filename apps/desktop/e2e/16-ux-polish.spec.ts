import { test, expect, Page } from "@playwright/test";

/**
 * UX polish regression suite — 2026-04-29 第七轮
 *
 * 1. Sidebar horizontal resizer clamps at max width
 * 2. ⌘R / F5 keydown does not trigger page navigation
 * 3. contextmenu is prevented globally (production build path)
 * 4. Reader text is selectable; toolbar text is not
 * 5. Image click in read mode opens lightbox; ESC closes it
 */

const DOC = {
  path: "/mock/ux.aimd",
  title: "UX 测试文档",
  markdown: "# 标题\n\n这是一段可以选中的正文内容，用于测试文本选择功能。\n\n![示例图](asset://test-img-001)\n",
  html: `<h1>标题</h1><p>这是一段可以选中的正文内容，用于测试文本选择功能。</p><img src="asset://localhost/mock/assets/test-img.png" alt="示例图" data-asset-id="test-img-001">`,
  assets: [
    {
      id: "test-img-001",
      path: "/mock/assets/test-img.png",
      mime: "image/png",
      size: 5000,
      sha256: "deadbeef",
      role: "content-image",
      url: "asset://localhost/mock/assets/test-img.png",
    },
  ],
  dirty: false,
};

async function installTauriMock(page: Page) {
  await page.addInitScript((d: typeof DOC) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_doc_file: () => d.path,
      choose_image_file: () => null,
      open_aimd: () => d,
      save_aimd: (a) => ({ ...d, markdown: (a as any)?.markdown ?? d.markdown, dirty: false }),
      render_markdown: () => ({ html: d.html }),
      render_markdown_standalone: () => ({ html: d.html }),
      add_image: () => null,
      list_aimd_assets: () => [],
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    (window as any).__TAURI__ = {
      ...(window as any).__TAURI__,
      core: { invoke: (cmd: string, a?: Args) => (window as any).__TAURI_INTERNALS__.invoke(cmd, a) },
    };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, DOC);
}

test.describe("1. Sidebar horizontal resizer max-width clamp", () => {
  test("dragging past max width clamps at min(50vw, 480px)", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const handle = page.locator("#sidebar-hr-resizer");
    await expect(handle).toBeVisible();

    const box = await handle.boundingBox();
    if (!box) throw new Error("hr-resizer not laid out");

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Drag far to the right — should be clamped.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 800, cy, { steps: 20 });
    await page.mouse.up();

    const columns = await page.evaluate(() =>
      getComputedStyle(document.getElementById("panel")!).gridTemplateColumns
    );
    // Parse the first column pixel value
    const match = columns.match(/^([\d.]+)px/);
    expect(match).toBeTruthy();
    const sidebarW = parseFloat(match![1]);

    const maxExpected = Math.min(Math.round(page.viewportSize()!.width * 0.5), 480);
    // Allow 2px tolerance for sub-pixel rounding
    expect(sidebarW).toBeLessThanOrEqual(maxExpected + 2);
  });

  test("double-click hr-resizer resets sidebar to default CSS width", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const handle = page.locator("#sidebar-hr-resizer");
    const box = await handle.boundingBox();
    if (!box) throw new Error("hr-resizer not laid out");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // First drag to a custom width
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 8 });
    await page.mouse.up();

    // Double-click to reset
    await handle.dblclick();

    const inlineColumns = await page.evaluate(() =>
      (document.getElementById("panel") as HTMLElement).style.gridTemplateColumns
    );
    expect(inlineColumns).toBe("");
  });
});

test.describe("2. Reload keydown is blocked", () => {
  test("Cmd+R keydown: app handler calls preventDefault", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "r",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test("F5 keydown: app handler calls preventDefault", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "F5",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test("Ctrl+R keydown: app handler calls preventDefault", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "r",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});

test.describe("3. Context menu is prevented (production mode)", () => {
  async function installTauriMockWithContextmenuForce(page: Page) {
    await page.addInitScript((d: typeof DOC) => {
      // 在 Tauri mock 注册之前设置测试钩子，让生产 contextmenu listener 在 DEV 模式下也注册
      (window as any).__aimd_force_contextmenu_block = true;
      type Args = Record<string, unknown> | undefined;
      const convertFileSrc = (path: string, protocol = "asset") =>
        `${protocol}://localhost${encodeURI(path)}`;
      const handlers: Record<string, (a: Args) => unknown> = {
        initial_open_path: () => null,
        choose_aimd_file: () => d.path,
        choose_doc_file: () => d.path,
        choose_image_file: () => null,
        open_aimd: () => d,
        save_aimd: (a) => ({ ...d, markdown: (a as any)?.markdown ?? d.markdown, dirty: false }),
        render_markdown: () => ({ html: d.html }),
        render_markdown_standalone: () => ({ html: d.html }),
        add_image: () => null,
        list_aimd_assets: () => [],
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, a?: Args) => {
          const fn = handlers[cmd];
          if (!fn) throw new Error(`mock: unknown command ${cmd}`);
          return fn(a);
        },
        transformCallback: (cb: Function) => cb,
        convertFileSrc,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      (window as any).__TAURI__ = {
        ...(window as any).__TAURI__,
        core: { invoke: (cmd: string, a?: Args) => (window as any).__TAURI_INTERNALS__.invoke(cmd, a) },
      };
      (window as any).__aimd_e2e_disable_auto_optimize = true;
    }, DOC);
  }

  test("contextmenu event default is prevented when __aimd_force_contextmenu_block is set", async ({ page }) => {
    await installTauriMockWithContextmenuForce(page);
    await page.goto("/");

    // 生产 listener 通过 __aimd_force_contextmenu_block 钩子已注册，dispatch 后验证 defaultPrevented
    const prevented = await page.evaluate(() => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test("contextmenu listener registered via production code path prevents default on any element", async ({ page }) => {
    await installTauriMockWithContextmenuForce(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    // 在文档内容区域触发 contextmenu，应被生产 listener 拦截
    const prevented = await page.evaluate(() => {
      const target = document.body;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test("contextmenu 在 textarea / input / 源码 #markdown 上不被拦截（保留原生剪切/复制/粘贴菜单）", async ({ page }) => {
    // 历史版本一刀切 preventDefault，连 input 的"粘贴"菜单都被吞掉，
    // 用户会以为应用禁用了 copy/paste。例外要把输入控件透出来。
    await installTauriMockWithContextmenuForce(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();

    const result = await page.evaluate(() => {
      function fire(target: Element) {
        const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        target.dispatchEvent(ev);
        return ev.defaultPrevented;
      }
      const md = document.querySelector("#markdown");
      const sourceMd = md ? fire(md) : null;
      const tmpInput = document.createElement("input");
      document.body.appendChild(tmpInput);
      const inputPrevented = fire(tmpInput);
      tmpInput.remove();
      const tmpTextarea = document.createElement("textarea");
      document.body.appendChild(tmpTextarea);
      const textareaPrevented = fire(tmpTextarea);
      tmpTextarea.remove();
      return { sourceMd, inputPrevented, textareaPrevented };
    });
    expect(result.sourceMd).toBe(false);
    expect(result.inputPrevented).toBe(false);
    expect(result.textareaPrevented).toBe(false);
  });
});

test.describe("4. Text selectability", () => {
  test("reader has user-select: text in read mode", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const readerEl = page.locator("#reader");
    await expect(readerEl).toBeVisible();

    // Verify that the reader element has user-select: text (CSS computed value)
    const userSelectValue = await page.evaluate(() => {
      const el = document.getElementById("reader");
      return el ? getComputedStyle(el).userSelect : "unknown";
    });
    expect(userSelectValue).toBe("text");
  });

  test("reader paragraph has user-select:text and not none", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const readerEl = page.locator("#reader");
    await expect(readerEl).toBeVisible();

    // Inject a paragraph and check its effective user-select value
    const result = await page.evaluate(() => {
      const reader = document.getElementById("reader");
      if (!reader) return { readerSel: "missing", pSel: "missing" };
      const p = document.createElement("p");
      p.textContent = "这是可以选中的测试文字内容";
      p.className = "test-selectable-p";
      reader.appendChild(p);
      return {
        readerSel: getComputedStyle(reader).userSelect,
        pSel: getComputedStyle(p).userSelect,
      };
    });
    expect(result.readerSel).toBe("text");
    expect(result.pSel).toBe("text");
  });

  test("toolbar buttons are not text-selectable", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    // Switch to edit mode to make the format toolbar visible
    await page.locator("#mode-edit").click();
    await expect(page.locator("#format-toolbar")).toBeVisible();

    const userSelectValue = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(".ft-btn");
      if (!btn) return "unknown";
      return getComputedStyle(btn).userSelect;
    });
    // Buttons should have user-select: none (or browser-equivalent "none")
    expect(userSelectValue).toBe("none");
  });
});

test.describe("5. Image lightbox in read mode", () => {
  test("clicking img in reader opens lightbox overlay", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const readerEl = page.locator("#reader");
    await expect(readerEl).toBeVisible();

    // Inject a real img into the reader so we can click it
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/test.png";
      img.alt = "test image";
      img.className = "test-lightbox-img";
      document.getElementById("reader")!.appendChild(img);
    });

    const img = page.locator("#reader .test-lightbox-img");
    await expect(img).toBeAttached();

    await img.click();

    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();
  });

  test("pressing ESC closes the lightbox", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/test.png";
      img.alt = "test";
      img.className = "test-esc-img";
      document.getElementById("reader")!.appendChild(img);
    });

    await page.locator("#reader .test-esc-img").click();
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(lightbox).not.toBeAttached();
  });

  test("clicking overlay backdrop closes lightbox", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/test.png";
      img.alt = "test";
      img.className = "test-backdrop-img";
      document.getElementById("reader")!.appendChild(img);
    });

    await page.locator("#reader .test-backdrop-img").click();
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();

    // Click on the overlay (not the image itself) — top-left corner of the overlay
    const box = await lightbox.boundingBox();
    if (!box) throw new Error("lightbox not found");
    await page.mouse.click(box.x + 10, box.y + 10);
    await expect(lightbox).not.toBeAttached();
  });

  test("lightbox close button works", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/test.png";
      img.alt = "test";
      img.className = "test-closebtn-img";
      document.getElementById("reader")!.appendChild(img);
    });

    await page.locator("#reader .test-closebtn-img").click();
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();

    await page.locator(".aimd-lightbox-close").click();
    await expect(lightbox).not.toBeAttached();
  });

  test("lightbox img src matches original image src (no base64)", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const testSrc = "asset://localhost/mock/no-base64.png";
    await page.evaluate((src) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "test";
      img.className = "test-src-img";
      document.getElementById("reader")!.appendChild(img);
    }, testSrc);

    await page.locator("#reader .test-src-img").click();
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();

    const lightboxImgSrc = await page.locator(".aimd-lightbox-img").getAttribute("src");
    expect(lightboxImgSrc).toBe(testSrc);
    expect(lightboxImgSrc).not.toMatch(/^data:/);
  });

  test("lightbox does not open in edit mode", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    // In edit mode, #reader is hidden and #inline-editor is visible.
    // The lightbox handler checks state.mode === "read" before opening.
    // Simulate a click on an img inside #reader (even though hidden)
    // via evaluate to verify no lightbox opens.
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/edit.png";
      img.alt = "test";
      img.className = "test-edit-img";
      document.getElementById("reader")!.appendChild(img);
      // Dispatch a click event — the handler checks mode before opening lightbox
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Lightbox should NOT open in edit mode
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).not.toBeAttached();
  });
});
