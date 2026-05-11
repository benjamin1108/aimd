/**
 * 40-redesign-2026-05.spec.ts
 *
 * 钉本轮 taste-skill 重设计的不可回归点：
 * - 工具栏：旧导览菜单 / 状态点 / eyebrow 标签不再出现
 * - ⋯ 菜单：删除"危险"分组 + 关闭文档不再红
 * - 保存按钮：干净文档 disabled；脏文档 enabled；保存成功瞬间显示"已保存"后清空
 * - 设置：双栏 IA（左导航 / 右分节）；API Key 半遮罩；
 *   合法尺寸约束（前端 max-width 固定，避免被拉成大白屏）
 * - 调试控制台：常驻收集 + 折叠成底部 pill
 */
import { test, expect, Page } from "@playwright/test";

type SetupOpts = {
  withTour?: boolean;
  dirty?: boolean;
};

async function installMock(page: Page, opts: SetupOpts = {}) {
  const tour = opts.withTour ?? false;
  const dirty = opts.dirty ?? false;
  await page.addInitScript(({ withTour, isDirty }) => {
    type Args = Record<string, unknown> | undefined;
    const tourPayload = JSON.stringify({
      version: 1,
      title: "演示导览",
      steps: [
        { targetId: "demo-h1", narration: "第一段" },
        { targetId: "demo-h1", narration: "第二段" },
      ],
    });
    const b64 = (window as any).btoa(unescape(encodeURIComponent(tourPayload)));
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
      dirty: isDirty,
    };
    let stored: any = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "sk-test-1234567890abcdef", apiBase: "" },
        },
      },
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      choose_aimd_file: () => doc.path,
      open_aimd: () => doc,
      save_aimd: () => ({ ...doc, dirty: false }),
      save_markdown: () => null,
      list_aimd_assets: () => [],
      render_markdown: () => ({ html: "<h1>样例</h1>" }),
      render_markdown_standalone: () => ({ html: "<h1>未命名</h1>" }),
      load_settings: () => stored,
      save_settings: (a) => { stored = (a as any)?.settings ?? stored; return null; },
      confirm_discard_changes: () => "discard",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, { withTour: tour, isDirty: dirty });
}

test.describe("工具栏：旧导览入口已移除", () => {
  test("旧 tour-menu / tour-status-dot 元素已被删除", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#tour-menu-toggle")).toHaveCount(0);
    await expect(page.locator("#tour-menu")).toHaveCount(0);
    await expect(page.locator("#tour-status-dot")).toHaveCount(0);
    await expect(page.locator(".tour-status-dot")).toHaveCount(0);
  });

  test("toolbar-group 不再渲染 eyebrow 文字", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator(".toolbar-group-label")).toHaveCount(0);
    // 模式开关分组仍在。
    await expect(page.locator(".toolbar-group--mode")).toBeVisible();
  });
});

test.describe("⋯ 菜单：去掉危险分组", () => {
  test("展开 ⋯ 菜单不存在 group label，#close 不带危险 class", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu .action-menu-group-label")).toHaveCount(0);
    await expect(page.locator("#close")).toBeVisible();
    await expect(page.locator("#close")).not.toHaveClass(/action-menu-item--danger/);
  });
});

test.describe("保存按钮：干净时灰，脏时亮", () => {
  // 状态文字唯一显示位是底部 #status-pill / #status，head 不再额外挂状态。
  // 奥卡姆剃刀：两套状态文字会让用户视线在 head 和 footer 之间来回跳。
  test("已保存文档：#save disabled，底部 status 是'就绪'", async ({ page }) => {
    await installMock(page, { dirty: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#save")).toBeDisabled();
    await expect(page.locator("#status")).toHaveText("就绪");
    await expect(page.locator("#status-pill")).toHaveAttribute("data-tone", "idle");
  });

  test("用户输入产生脏状态：#save 启用，底部 status 显示'未保存的修改'", async ({ page }) => {
    await installMock(page, { dirty: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    const textarea = page.locator("#markdown");
    await textarea.fill("# 修改后\n");
    await expect(page.locator("#save")).toBeEnabled();
    await expect(page.locator("#status")).toHaveText("未保存的修改");
    await expect(page.locator("#status-pill")).toHaveAttribute("data-tone", "warn");
  });

  test("保存后底部 status 短暂显示'已保存'，1.8s 内回到'就绪'", async ({ page }) => {
    await installMock(page, { dirty: false });
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 修改后\n");
    await page.locator("#save").click();
    await expect(page.locator("#status")).toHaveText("已保存");
    await expect(page.locator("#status")).toHaveText("就绪", { timeout: 3000 });
  });
});

test.describe("设置：双栏 IA + API Key 半遮罩", () => {
  test("API Key 默认半遮罩：mask 文本含 prefix4 + ••• + suffix4", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    const wrap = page.locator(".api-key-wrap");
    await expect(wrap).toHaveAttribute("data-state", "masked");
    const mask = page.locator(".api-key-mask");
    const masked = await mask.textContent();
    expect(masked || "").toContain("sk-t");
    expect(masked || "").toContain("cdef");
    expect(masked || "").toMatch(/•+/);
  });

  test("聚焦 input 不会暴露明文：仍是 type=password；只有点眼睛才切 type=text", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    const input = page.locator("#api-key");

    // 默认 password
    await expect(input).toHaveAttribute("type", "password");

    // 聚焦 → overlay 让位，但 input 仍是 password（不会泄露明文）
    await input.focus();
    await expect(input).toHaveAttribute("type", "password");
    await expect(page.locator(".api-key-wrap")).toHaveAttribute("data-state", "visible");

    // 失焦回 masked overlay
    await page.locator("#api-base").focus();
    await expect(page.locator(".api-key-wrap")).toHaveAttribute("data-state", "masked");

    // 点眼睛才真正显示明文
    await page.locator("#api-key-reveal").click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(page.locator("#api-key-reveal")).toHaveAttribute("aria-pressed", "true");

    // 再点回收
    await page.locator("#api-key-reveal").click();
    await expect(input).toHaveAttribute("type", "password");
  });

  test("API Key 为空时不显示遮罩，输入框就是普通空", async ({ page }) => {
    await page.addInitScript(() => {
      type Args = Record<string, unknown> | undefined;
      let stored: any = {
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen3.6-plus", apiKey: "   ", apiBase: "" },
          },
        },
      };
      const handlers: Record<string, (a: Args) => unknown> = {
        load_settings: () => stored,
        save_settings: (a) => { stored = (a as any)?.settings ?? stored; return null; },
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, a?: Args) => (handlers[cmd] ? handlers[cmd](a) : null),
        transformCallback: (cb: Function) => cb,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    });
    await page.goto("/settings.html");
    // coerceConfig 把 "   " trim 成空，UI 表现为真实空，不出现"看着像空但 caret 卡中间"。
    await expect(page.locator("#api-key")).toHaveValue("");
    await expect(page.locator(".api-key-wrap")).toHaveAttribute("data-state", "visible");
    await expect(page.locator(".api-key-mask")).toHaveText("");
  });

  test("无修改时保存按钮 disabled；编辑后 enabled", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    await expect(page.locator("#save-settings")).toBeDisabled();
    await page.locator("#api-key").fill("sk-different-value");
    await expect(page.locator("#save-settings")).toBeEnabled();
  });

  test("内容超长时 .settings-content 撑开滚动而非把页脚顶出可视区", async ({ page }) => {
    await installMock(page);
    await page.setViewportSize({ width: 760, height: 480 });
    await page.goto("/settings.html");
    // 故意把视口高度压低，强制内容溢出。
    const overflow = await page.locator(".settings-content").evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { overflowY: style.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(overflow.overflowY).toMatch(/auto|scroll/);
    // 页脚必须仍可见 —— 之前的 bug 就是 actions 被挤出窗口外。
    await expect(page.locator(".settings-actions")).toBeVisible();
    await expect(page.locator("#cancel")).toBeVisible();
    await expect(page.locator("#save-settings")).toBeVisible();
  });
});

test.describe("调试：状态栏隐式指示器", () => {
  test("默认无错时 #debug-indicator hidden", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await expect(page.locator("#debug-indicator")).toBeHidden();
  });

  test("出现 console.error 后指示器浮现，点击直接打开调试控制台", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.evaluate(() => { console.error("e2e: 模拟错误"); });
    await expect(page.locator("#debug-indicator")).toBeVisible();
    await expect(page.locator("#debug-indicator-count")).toHaveText("1");
    await page.locator("#debug-indicator").click();
    await expect(page.locator(".debug-panel")).toBeVisible();
    // 关闭就是关闭：没有"最小化"按钮，只有 [清空] [关闭] 两个。
    await expect(page.locator("[data-debug-minimize]")).toHaveCount(0);
    await expect(page.locator(".debug-dock-pill")).toHaveCount(0);
  });

  test('点"清空"后指示器归零并隐藏', async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.evaluate(() => { console.error("err1"); console.warn("warn1"); });
    await expect(page.locator("#debug-indicator-count")).toHaveText("2");
    await page.locator("#debug-indicator").click();
    await page.locator("[data-debug-clear]").click();
    await expect(page.locator("#debug-indicator")).toBeHidden();
  });
});
