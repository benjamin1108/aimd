/**
 * 38-design-polish.spec.ts
 *
 * 钉住设计打磨这一轮的视觉/IA 决策，避免下一轮回归：
 * - 顶部 ⋯ 改 ghost-btn（无 secondary-btn class），保存按钮 primary-btn 视觉权重明确高于 ⋯
 * - 模式切换段控件改纯文字（不再渲染 .mode-btn-icon SVG）
 * - ⋯ 菜单加了 action-menu-group-label 分组标题
 * - 导览按钮带 #tour-status-dot，文档无导览时 data-state="none"，有导览时 "ready"
 * - 进入 source 模式且文档含 frontmatter 时 #source-banner 可见，否则 hidden
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
      check_litellm_deps: () => ({
        python3Found: true,
        litellmFound: true,
        python3Version: "Python 3.11",
        installHint: "pip install litellm",
      }),
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
  test("阅读 / 编辑 / 源码三个按钮不渲染 SVG 图标", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-toolbar")).toBeVisible();

    // 模板里已删除 .mode-btn-icon span，断言计数为 0
    await expect(page.locator(".mode-btn-icon")).toHaveCount(0);

    // 文字仍然在
    await expect(page.locator("#mode-read")).toContainText("阅读");
    await expect(page.locator("#mode-edit")).toContainText("编辑");
    await expect(page.locator("#mode-source")).toContainText("源码");
  });
});

test.describe("⋯ 菜单分组标题", () => {
  test("展开后存在 action-menu-group-label 分组标题", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu .action-menu-group-label")).toHaveCount(2);
    await expect(page.locator("#more-menu .action-menu-group-label").first()).toContainText("文件");
    await expect(page.locator("#more-menu .action-menu-group-label").last()).toContainText("危险");
  });
});

test.describe("导览状态点", () => {
  test("无导览的文档：tour-status-dot data-state=none", async ({ page }) => {
    await installTauriMock(page, { withTour: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#tour-status-dot")).toHaveAttribute("data-state", "none");
  });

  test("含导览的文档：tour-status-dot data-state=ready", async ({ page }) => {
    await installTauriMock(page, { withTour: true });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#tour-status-dot")).toHaveAttribute("data-state", "ready");
  });
});

test.describe("源码模式 metadata banner", () => {
  test("无 frontmatter 时进入源码模式不显示 banner", async ({ page }) => {
    await installTauriMock(page, { withTour: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeHidden();
  });

  test("含 frontmatter + Docu-Tour 时进入源码模式显示 banner，文案包含 Docu-Tour 步数", async ({ page }) => {
    await installTauriMock(page, { withTour: true });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeVisible();
    await expect(page.locator("#source-banner-text")).toContainText("Front-matter");
    await expect(page.locator("#source-banner-text")).toContainText("Docu-Tour");
    await expect(page.locator("#source-banner-text")).toContainText("步");
  });

  test("从源码模式切回阅读模式后 banner 自动隐藏", async ({ page }) => {
    await installTauriMock(page, { withTour: true });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeVisible();
    await page.locator("#mode-read").click();
    await expect(page.locator("#source-banner")).toBeHidden();
  });
});
