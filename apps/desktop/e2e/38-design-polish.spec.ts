/**
 * 38-design-polish.spec.ts
 *
 * 钉住设计打磨这一轮的视觉/IA 决策，避免下一轮回归：
 * - 文档命令栏合并为：Markdown 编辑栏 / 查找 / 预览-编辑-MD / 竖向三点。
 * - 保存收进竖向三点菜单，命令栏不再外露保存主按钮。
 * - 查找使用浮层，点击外部自动关闭，不占据命令栏高度。
 * - 模式切换段控件改短文字（不再渲染 .mode-btn-icon SVG）
 * - ⋯ 菜单不再用"危险"分组（关闭文档不是破坏性操作）
 * - 旧导览菜单 / 状态点 / 按钮不再出现。
 * - source 模式不为 frontmatter 常驻显示 #source-banner，避免源码/预览标题栏错位
 */
import { test, expect, Page } from "@playwright/test";

async function installTauriMock(page: Page, opts: { withTour?: boolean } = {}) {
  const tour = opts.withTour ?? false;
  await page.addInitScript((withTour) => {
    type Args = Record<string, unknown> | undefined;
    // base64(JSON({ version:1, title:"x", steps:[{targetId:"h",narration:"n"}] }))
    // 用 btoa 现场构造，免得在 spec 里硬编码字符串
    const payload = JSON.stringify({
      version: 1,
      title: "x",
      steps: [{ targetId: "demo-h1", narration: "演示" }],
    });
    const b64 = (window as any).btoa(unescape(encodeURIComponent(payload)));
    const wrapped = (b64.match(/.{1,92}/g) || []).map((l: string) => `  ${l}`).join("\n");
    const tourBlock = `aimd_docu_tour: |\n${wrapped}`;
    const markdown = withTour
      ? `---\ntitle: 样例\n${tourBlock}\n---\n\n# 样例文档 {#demo-h1}\n\n正文。\n`
      : `# 样例文档 {#demo-h1}\n\n正文。\n`;
    const doc = {
      path: "/mock/sample.aimd",
      title: "样例文档",
      markdown,
      html: '<h1 id="demo-h1">样例文档</h1><p>正文。</p>',
      assets: [],
      dirty: false,
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      list_aimd_assets: () => [],
      confirm_discard_changes: () => "discard",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, tour);
}

async function expectUsesNavActiveStyle(page: Page, selector: string) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) return false;
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--nav-active-bg)";
    probe.style.color = "var(--nav-active-fg)";
    document.body.append(probe);
    const expected = window.getComputedStyle(probe);
    const actual = window.getComputedStyle(target);
    const matches = actual.backgroundColor === expected.backgroundColor
      && actual.color === expected.color;
    probe.remove();
    return matches;
  }, selector)).toBe(true);
}

test.describe("顶部工具栏视觉权重", () => {
  test("命令栏顺序为编辑栏 / 查找 / 模式 / 竖向三点", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#format-toolbar")).toBeVisible();

    const directChildren = await page.locator("#doc-toolbar").evaluate((toolbar) =>
      Array.from(toolbar.children).map((child) => ({
        id: child.id,
        cls: child.className,
      })),
    );
    expect(directChildren.map((child) => child.id || child.cls)).toEqual([
      "format-toolbar",
      "find-cluster",
      "toolbar-group toolbar-group--mode",
      "doc-actions",
    ]);

    await expect(page.locator("#format-toolbar .ft-btn")).toHaveCount(17);
    const toolbarMetrics = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>("#format-toolbar")!;
      const separator = document.querySelector<HTMLElement>("#format-toolbar .ft-sep")!;
      const toolbarStyle = getComputedStyle(toolbar);
      const separatorStyle = getComputedStyle(separator);
      const separatorLineStyle = getComputedStyle(separator, "::after");
      return {
        scrollbarWidth: toolbarStyle.scrollbarWidth,
        overflowX: toolbarStyle.overflowX,
        overflowY: toolbarStyle.overflowY,
        alignItems: toolbarStyle.alignItems,
        separatorCursor: separatorStyle.cursor,
        separatorTouchAction: separatorStyle.touchAction,
        separatorWidth: separator.getBoundingClientRect().width,
        separatorLineWidth: separatorLineStyle.width,
      };
    });
    expect(toolbarMetrics.scrollbarWidth).toBe("none");
    expect(toolbarMetrics.overflowX).toBe("auto");
    expect(toolbarMetrics.overflowY).toBe("hidden");
    expect(toolbarMetrics.alignItems).toBe("flex-start");
    expect(toolbarMetrics.separatorCursor).toBe("ew-resize");
    expect(toolbarMetrics.separatorTouchAction).toBe("none");
    expect(toolbarMetrics.separatorWidth).toBeGreaterThan(1);
    expect(toolbarMetrics.separatorLineWidth).toBe("1px");

    await page.setViewportSize({ width: 560, height: 720 });
    await expect(page.locator("#format-toolbar")).toBeVisible();
    const beforeDrag = await page.locator("#format-toolbar").evaluate((toolbar) => {
      toolbar.scrollLeft = 0;
      return {
        clientWidth: toolbar.clientWidth,
        scrollLeft: toolbar.scrollLeft,
        scrollWidth: toolbar.scrollWidth,
      };
    });
    expect(beforeDrag.scrollWidth).toBeGreaterThan(beforeDrag.clientWidth);
    const sepBox = await page.locator("#format-toolbar .ft-sep").first().boundingBox();
    expect(sepBox).not.toBeNull();
    await page.mouse.move(sepBox!.x + sepBox!.width / 2, sepBox!.y + sepBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sepBox!.x - 120, sepBox!.y + sepBox!.height / 2);
    await page.mouse.up();
    await expect.poll(() => page.locator("#format-toolbar").evaluate((toolbar) => toolbar.scrollLeft)).toBeGreaterThan(beforeDrag.scrollLeft);

    const more = page.locator("#more-menu-toggle");
    await expect(more).toHaveClass(/ghost-btn/);
    await expect(more).toHaveClass(/icon-only/);
    await expect(more).toHaveClass(/document-menu-btn/);
    await expect(more).not.toHaveClass(/secondary-btn/);
    await expect(more).not.toContainText("文档");
    await expect(more.locator(".vertical-dots span")).toHaveCount(3);
  });

  test("保存收进竖向三点菜单，命令栏不再外露保存按钮", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator(".command-save-btn")).toHaveCount(0);

    await page.locator("#more-menu-toggle").click();
    const save = page.locator("#save");
    await expect(save).toBeVisible();
    await expect(save).toHaveClass(/action-menu-item/);
    await expect(save).not.toHaveClass(/primary-btn/);
    await expect(save).toContainText("保存");
  });

  test("查找使用极简图标入口和紧凑浮层", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    const find = page.locator("#find-toggle");
    await expect(find).toHaveClass(/ghost-btn/);
    await expect(find).toHaveClass(/icon-only/);
    await expect(find).toHaveAttribute("aria-label", "查找");
    await expect(find).not.toContainText("查找");

    await find.click();
    await expect(page.locator("#find-bar")).toBeVisible();
    await expectUsesNavActiveStyle(page, "#find-toggle");
    const metrics = await page.evaluate(() => {
      const toggle = document.querySelector("#find-toggle")!.getBoundingClientRect();
      const bar = document.querySelector("#find-bar")!.getBoundingClientRect();
      const prev = document.querySelector("#find-prev")!;
      return {
        toggleWidth: toggle.width,
        barWidth: bar.width,
        barTop: bar.top,
        toggleBottom: toggle.bottom,
        prevHasIcon: Boolean(prev.querySelector("svg")),
        prevText: prev.textContent?.trim() || "",
      };
    });
    expect(metrics.toggleWidth).toBeLessThanOrEqual(32);
    expect(metrics.barWidth).toBeLessThanOrEqual(310);
    expect(metrics.barTop).toBeGreaterThanOrEqual(metrics.toggleBottom);
    expect(metrics.prevHasIcon).toBe(true);
    expect(metrics.prevText).toBe("");

    await page.locator("#reader").click({ position: { x: 10, y: 10 } });
    await expect(page.locator("#find-bar")).toBeHidden();
  });

  test("文本输入焦点框保持克制，不再用粗高亮抢注意力", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-source").click();
    await page.locator("#markdown").focus();
    const sourceFocus = await page.locator("#markdown").evaluate((input) => {
      const style = getComputedStyle(input);
      return {
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
      };
    });
    expect(sourceFocus.outlineWidth).toBe("1px");
    expect(sourceFocus.outlineOffset).toBe("-1px");

    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor").focus();
    const inlineFocus = await page.locator("#inline-editor").evaluate((editor) => {
      const style = getComputedStyle(editor);
      return {
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
      };
    });
    expect(inlineFocus.outlineWidth).toBe("1px");
    expect(inlineFocus.outlineOffset).toBe("-1px");

    await page.locator("#find-toggle").click();
    await page.locator("#find-input").focus();
    const findFocus = await page.locator("#find-input").evaluate((input) => {
      const style = getComputedStyle(input);
      return {
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow,
      };
    });
    expect(findFocus.outlineWidth).toBe("1px");
    expect(findFocus.outlineOffset).toBe("1px");
    expect(findFocus.boxShadow).toBe("none");
  });
});

test.describe("模式切换 — 纯文字分段控件", () => {
  test("预览 / 编辑 / MD 三个按钮不渲染 SVG 图标，同时保留完整语义", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-toolbar")).toBeVisible();

    // 模板里已删除 .mode-btn-icon span，断言计数为 0
    await expect(page.locator(".mode-btn-icon")).toHaveCount(0);

    // 文字仍然在
    await expect(page.locator("#mode-read")).toContainText("预览");
    await expect(page.locator("#mode-edit")).toHaveText("编辑");
    await expect(page.locator("#mode-edit")).toHaveAttribute("aria-label", "可视编辑");
    await expect(page.locator("#mode-source")).toHaveText("MD");
    await expect(page.locator("#mode-source")).toHaveAttribute("aria-label", "Markdown");
    await expectUsesNavActiveStyle(page, "#mode-read");
  });
});

test.describe("⋯ 菜单：不再用危险分组", () => {
  test('展开后没有"危险"分组标题，关闭文档不带 --danger class', async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu .action-menu-group-label")).toHaveCount(0);
    await expect(page.locator("#close")).not.toHaveClass(/action-menu-item--danger/);
    await expect(page.locator("#more-menu .action-menu-divider").first()).toBeVisible();
  });

  test("窄窗口下长状态和菜单文字不会撑坏按钮形状", async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 620 });
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("#status")!.textContent = "网页导入失败: ".repeat(20);
      document.querySelector<HTMLElement>("#status-pill")!.dataset.tone = "warn";
    });

    const footBox = await page.locator(".workspace-foot").boundingBox();
    const statusBox = await page.locator("#status-pill").boundingBox();
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(footBox!.x + footBox!.width + 1);
    await expect(page.locator("#status")).toHaveCSS("text-overflow", "ellipsis");

    await page.locator("#more-menu-toggle").click();
    const menuBox = await page.locator("#more-menu").boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(520);
    await expect(page.locator("#more-menu .action-menu-item").first()).toHaveCSS("overflow", "hidden");
  });
});

test.describe("已移除的导览入口", () => {
  test("旧的 tour-menu / tour-status-dot 元素已经不存在", async ({ page }) => {
    await installTauriMock(page, { withTour: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#tour-menu-toggle")).toHaveCount(0);
    await expect(page.locator("#tour-menu")).toHaveCount(0);
    await expect(page.locator("#tour-status-dot")).toHaveCount(0);
    await expect(page.locator(".tour-status-dot")).toHaveCount(0);
  });
});

test.describe("源码模式提示条", () => {
  test("无 frontmatter 时进入源码模式不显示 banner", async ({ page }) => {
    await installTauriMock(page, { withTour: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeHidden();
  });

  test("frontmatter 不再在源码模式显示常驻保护 banner", async ({ page }) => {
    await installTauriMock(page, { withTour: true });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeHidden();
    const editorTag = await page.locator(".editor-pane .pane-tag").boundingBox();
    const previewTag = await page.locator(".preview-pane .pane-tag").boundingBox();
    expect(editorTag && previewTag).toBeTruthy();
    expect(Math.abs(editorTag!.y - previewTag!.y)).toBeLessThanOrEqual(1);
    await page.locator("#mode-read").click();
    await expect(page.locator("#source-banner")).toBeHidden();
  });
});
