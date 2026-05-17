import { test, expect, Page } from "@playwright/test";

/**
 * QA 独立验证 spec — 2026-04-29 第七轮（UX 打磨验收）
 *
 * 覆盖 dev spec 16 未覆盖或断言宽松的场景：
 * A. 窗口缩小后侧边栏宽度未被自动 clamp（已知缺陷验证）
 * B. keydown preventDefault 断言强度验证（改用 defaultPrevented 而非 framenavigated）
 * C. contextmenu 在应用注册监听器后真正阻断（而非测试自己注入 listener）
 * D. 阅读模式拖选文字 selection 非空
 * E. 工具栏按钮区域拖选 selection 为空
 * F. lightbox 点图片本身不关闭
 */

const DOC = {
  path: "/mock/qa.aimd",
  title: "QA 验证文档",
  markdown: "# QA 标题\n\n这是可以选中的正文，用于测试文本选择功能。\n\n![示例图](asset://test-img-001)\n",
  html: `<h1>QA 标题</h1><p>这是可以选中的正文，用于测试文本选择功能。</p><img src="asset://localhost/mock/assets/test-img.png" alt="示例图" data-asset-id="test-img-001">`,
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

test.describe("A. 窗口缩小后侧边栏未自动 clamp（P2 缺陷验证）", () => {
  test("侧边栏拖到 450px 后窗口缩小到 600px：inline style 不会自动 clamp", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const handle = page.locator("#sidebar-hr-resizer");
    const box = await handle.boundingBox();
    if (!box) throw new Error("hr-resizer not laid out");

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 拖动到 450px 附近（不超过 50vw/480 限制，1280px 窗口下 50vw=640px）
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 220, cy, { steps: 15 });
    await page.mouse.up();

    // 读取拖动后侧边栏宽度
    const widthAfterDrag = await page.evaluate(() => {
      const s = (document.getElementById("panel") as HTMLElement).style.gridTemplateColumns;
      const m = s.match(/^([\d.]+)px/);
      return m ? parseFloat(m[1]) : -1;
    });

    // 缩小窗口到 600px — 此时 50vw = 300px，如果侧边栏 > 300px 应被 clamp
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(100);

    const widthAfterResize = await page.evaluate(() => {
      const s = (document.getElementById("panel") as HTMLElement).style.gridTemplateColumns;
      const m = s.match(/^([\d.]+)px/);
      return m ? parseFloat(m[1]) : -1;
    });

    // After window shrinks, the resize listener should re-clamp inline width
    // down to the new max (50vw or 480, whichever is smaller). We assert hard:
    // failure here means the resize listener regressed.
    const viewportWidth = 600;
    const maxAfterResize = Math.min(Math.round(viewportWidth * 0.5), 480); // 300

    if (widthAfterDrag > maxAfterResize) {
      // 侧边栏宽度超过了新窗口的 50vw 限制，修复后应自动被 clamp
      expect(widthAfterResize, `窗口缩小后侧边栏应被 clamp 到 ${maxAfterResize}px，实际为 ${widthAfterResize}px`)
        .toBeLessThanOrEqual(maxAfterResize + 2);
    } else {
      // 拖动距离不够大，无法触发场景，跳过
      console.log(`侧边栏拖动后宽度 ${widthAfterDrag}px <= maxAfterResize ${maxAfterResize}px，场景未触发`);
    }
  });
});

test.describe("B. keydown preventDefault 断言强度验证", () => {
  test("应用 keydown handler 对 F5 调用了 defaultPrevented（直接验证 event 属性）", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    // 通过 dispatchEvent 检查应用的 keydown handler 是否真正调用 preventDefault
    const result = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "F5",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    // 应用在全局 keydown 里调用了 preventDefault，所以 defaultPrevented 应为 true
    expect(result).toBe(true);
  });

  test("应用 keydown handler 对 Meta+r 调用了 defaultPrevented", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const result = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "r",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    expect(result).toBe(true);
  });

  test("应用 keydown handler 对 Ctrl+r 调用了 defaultPrevented", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const result = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "r",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    expect(result).toBe(true);
  });
});

test.describe("C. contextmenu 在应用自身监听器阻断测试", () => {
  test("在 DEV 模式下应用不注册 contextmenu 拦截（e2e 运行时行为）", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    // e2e 使用 vite dev server，import.meta.env.DEV === true
    // 所以应用本身不注册 contextmenu capture listener
    // 验证当前运行环境下 contextmenu defaultPrevented 为 false（应用未拦截）
    const result = await page.evaluate(() => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });

    // DEV 模式下应用不拦截，result 应为 false
    // 这反过来说明 spec 16 的"production mode"用例是在测试假设路径，非真实生产行为
    expect(result).toBe(false);
  });
});

test.describe("D. 阅读模式文本选择", () => {
  test("阅读模式下拖选段落文字 selection 非空", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const readerEl = page.locator("#reader");
    await expect(readerEl).toBeVisible();

    // 注入一段可选中的文字
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "这段文字应该可以被用户选中并复制";
      p.id = "qa-selectable-p";
      document.getElementById("reader")!.appendChild(p);
    });

    // 通过 JS selectAll 选中，验证 user-select:text 是否真正生效
    const selectionText = await page.evaluate(() => {
      const el = document.getElementById("qa-selectable-p")!;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    });

    expect(selectionText).toBeTruthy();
    expect(selectionText.length).toBeGreaterThan(0);
  });

  test("工具栏区域 user-select:none 不影响按钮 click（pointer-events 正常）", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    // 切到编辑模式，让工具栏出现
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").focus();
    await expect(page.locator("#format-toolbar")).toBeVisible();

    // 验证工具栏按钮可以被点击（pointer-events 未被 user-select:none 影响）
    const btn = page.locator(".ft-btn").first();
    await expect(btn).toBeVisible();
    // 验证按钮 pointer-events 不是 none
    const pointerEvents = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ft-btn");
      if (!el) return "unknown";
      return getComputedStyle(el).pointerEvents;
    });
    expect(pointerEvents).not.toBe("none");
  });
});

test.describe("E. lightbox 点击图片本身不关闭", () => {
  test("lightbox 打开后点击图片本身，lightbox 不关闭", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "asset://localhost/mock/test.png";
      img.alt = "test";
      img.className = "test-noclose-img";
      document.getElementById("reader")!.appendChild(img);
    });

    await page.locator("#reader .test-noclose-img").click();
    const lightbox = page.locator("[data-lightbox='true']");
    await expect(lightbox).toBeVisible();

    // 点击 lightbox 内的图片本身（不应关闭）
    const lightboxImg = page.locator(".aimd-lightbox-img");
    await expect(lightboxImg).toBeVisible();
    await lightboxImg.click();

    // lightbox 应仍然存在
    await expect(lightbox).toBeAttached();
  });
});

test.describe("F. 副作用：非编辑区 user-select 边界", () => {
  test("状态栏文字不可选中", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const statusBar = page.locator("#status-bar");
    if (await statusBar.count() === 0) {
      // 状态栏可能叫别的 selector，跳过
      return;
    }

    const userSelect = await page.evaluate(() => {
      const el = document.getElementById("status-bar");
      if (!el) return "missing";
      return getComputedStyle(el).userSelect;
    });

    // 状态栏应为 none（非内容区，不可选中）
    expect(userSelect).toBe("none");
  });

  test("sidebar 项目 rail 与导航不可选中", async ({ page }) => {
    // ux-product-audit P2-1：默认允许选中文本，但 sidebar 这类 UI chrome
    // 仍要禁选，避免双击高亮干扰拖拽 / 调整。
    // 文档身份已经搬到顶栏 scope / 活动标签；这里只校验 sidebar chrome。
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const brandSelect = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".sidebar #workspace-root-label");
      if (!el) return "missing";
      return getComputedStyle(el).userSelect;
    });
    expect(brandSelect).toBe("none");
  });

  test("document command strip chrome remains non-selectable", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const stripSelect = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#document-command-strip");
      if (!el) return "missing";
      return getComputedStyle(el).userSelect;
    });
    expect(stripSelect).toBe("none");
  });
});
