/**
 * 38-design-polish.spec.ts
 *
 * 钉住设计打磨这一轮的视觉/IA 决策，避免下一轮回归：
 * - 顶部 ⋯ 改 ghost-btn（无 secondary-btn class），保存按钮 primary-btn 视觉权重明确高于 ⋯
 * - 模式切换段控件改纯文字（不再渲染 .mode-btn-icon SVG）
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

test.describe("顶部工具栏视觉权重", () => {
  test("⋯ 按钮使用 ghost-btn 而非 secondary-btn", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-actions")).toBeVisible();

    const more = page.locator("#more-menu-toggle");
    await expect(more).toHaveClass(/ghost-btn/);
    await expect(more).toHaveClass(/icon-only/);
    await expect(more).not.toHaveClass(/secondary-btn/);
  });

  test("保存按钮保留 primary-btn 主色权重", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    const save = page.locator("#save");
    await expect(save).toHaveClass(/primary-btn/);
  });
});

test.describe("模式切换 — 纯文字分段控件", () => {
  test("预览 / 可视编辑 / Markdown 三个按钮不渲染 SVG 图标", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-toolbar")).toBeVisible();

    // 模板里已删除 .mode-btn-icon span，断言计数为 0
    await expect(page.locator(".mode-btn-icon")).toHaveCount(0);

    // 文字仍然在
    await expect(page.locator("#mode-read")).toContainText("预览");
    await expect(page.locator("#mode-edit")).toContainText("可视编辑");
    await expect(page.locator("#mode-source")).toContainText("Markdown");
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
