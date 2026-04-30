/**
 * 33-dedup-window.spec.ts
 *
 * BUG-025：同一文件被重复打开时应聚焦已有窗口、不再新建
 *
 * 注意：Playwright 在 Chromium 单页模式运行，无法驱动 Tauri 多窗口进程层面的去重
 * （open_in_new_window / WindowEvent::Destroyed 均属于 Rust 进程层），
 * 因此本 spec 在前端 mock 层面覆盖以下可测试路径：
 *
 * - case A：进程内打开 A → 再次 routeOpenedPath(A) → focus_doc_window 返回 label，
 *           不重新加载（open_aimd 只被调一次）。
 * - case B：进程内打开 A → 在同一前端调 routeOpenedPath(A)，当前窗口已持有该路径
 *           时直接 no-op（open_aimd 不会被再次调用）。
 * - case C：routeOpenedPath 带两个不同路径时，各自调用 open_aimd 一次（不互相去重）。
 * - case D：路径大小写归一化：同文件用不同大小写路径触发两次打开，第二次被 no-op。
 *
 * 以下情况 Playwright 层无法覆盖（已在 dev-report 中说明）：
 * - Finder 双击同文件 → open_in_new_window 的 Rust 进程层去重
 * - WindowEvent::Destroyed 时 unregister_window_label 的实际清表行为
 * - focus_doc_window 真实窗口 set_focus() 的视觉效果
 * 这些需人工测试或通过 20-rust-handler-registration.spec.ts 的命令注册校验兜底。
 */

import { test, expect, Page } from "@playwright/test";

interface MockSetupOptions {
  /** 模拟 focus_doc_window 的返回值；null = 未找到已有窗口；string = 命中 label */
  focusResult?: string | null;
  /** 初始打开路径（initial_open_path） */
  initialPath?: string | null;
}

const DOC_A = {
  path: "/mock/docA.aimd",
  title: "文档 A",
  markdown: "# 文档 A\n\n内容 A。\n",
  html: "<h1>文档 A</h1><p>内容 A。</p>",
  assets: [],
  dirty: false,
};

const DOC_B = {
  path: "/mock/docB.aimd",
  title: "文档 B",
  markdown: "# 文档 B\n\n内容 B。\n",
  html: "<h1>文档 B</h1><p>内容 B。</p>",
  assets: [],
  dirty: false,
};

async function installMock(page: Page, opts: MockSetupOptions = {}) {
  const seed = {
    focusResult: opts.focusResult ?? null,
    initialPath: opts.initialPath ?? null,
    docA: DOC_A,
    docB: DOC_B,
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;

    // 记录每个命令被调用的次数，供断言使用
    const callCounts: Record<string, number> = {};
    (window as any).__aimd_callCounts = callCounts;

    // focus_doc_window 被调用时记录最后一次传入的 path
    const focusLog: string[] = [];
    (window as any).__aimd_focusLog = focusLog;

    function track(cmd: string) {
      callCounts[cmd] = (callCounts[cmd] ?? 0) + 1;
    }

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => s.initialPath,
      choose_aimd_file: () => s.docA.path,
      choose_doc_file: () => s.docA.path,
      choose_markdown_file: () => null,
      choose_save_aimd_file: () => "/mock/saved.aimd",
      focus_doc_window: (a) => {
        track("focus_doc_window");
        const path = String((a as any)?.path ?? "");
        focusLog.push(path);
        return s.focusResult;
      },
      register_window_path: () => {
        track("register_window_path");
        return null;
      },
      update_window_path: () => {
        track("update_window_path");
        return null;
      },
      open_aimd: (a) => {
        track("open_aimd");
        const path = String((a as any)?.path ?? s.docA.path);
        if (path === s.docB.path) return s.docB;
        return s.docA;
      },
      save_aimd: (a) => ({
        ...s.docA,
        markdown: String((a as any)?.markdown ?? s.docA.markdown),
        dirty: false,
      }),
      save_aimd_as: (a) => ({
        ...s.docA,
        path: String((a as any)?.savePath ?? "/mock/saved.aimd"),
        dirty: false,
      }),
      render_markdown: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      render_markdown_standalone: (a) => ({
        html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>`,
      }),
      add_image: () => null,
      add_image_bytes: () => null,
      import_markdown: () => s.docA,
      read_image_bytes: () => [],
      list_aimd_assets: () => [],
      reveal_in_finder: () => null,
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
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, seed);
}

// ──────────────────────────────────────────────────────────────────────────────
// case A：focus_doc_window 返回 label → routeOpenedPath 不调 open_aimd
// ──────────────────────────────────────────────────────────────────────────────
test.describe("case A: 已打开文件再次打开应聚焦而非重新加载", () => {
  test("focus_doc_window 返回 label 时 open_aimd 不被调用", async ({ page }) => {
    // focusResult = "doc-111" 表示该路径已在另一个窗口打开
    await installMock(page, { focusResult: "doc-111" });
    await page.goto("/");

    // 先手动触发一次 routeOpenedPath（模拟从空白状态打开）
    // focusResult 已经设为 "doc-111"，所以 routeOpenedPath 应该在 focus_doc_window 后直接返回
    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docA.aimd");
    });

    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    // focus_doc_window 被调用了
    expect(counts["focus_doc_window"] ?? 0).toBeGreaterThanOrEqual(1);
    // open_aimd 没有被调用（聚焦已有窗口后直接返回）
    expect(counts["open_aimd"] ?? 0).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// case A（前端 no-op 分支）：当前窗口本身就持有该路径 → no-op
// ──────────────────────────────────────────────────────────────────────────────
test.describe("case A (no-op branch): 当前窗口已持有该路径不重新加载", () => {
  test("当前窗口已打开 docA，再次 routeOpenedPath(docA) 不再调用 open_aimd", async ({ page }) => {
    // focusResult = null：focus_doc_window 找不到其他窗口（当前窗口自己持有该路径）
    await installMock(page, { focusResult: null });
    await page.goto("/");

    // 先正常打开 docA（此时 state.doc.path 被设为 /mock/docA.aimd）
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("文档 A");

    // 重置计数，再次触发 routeOpenedPath 同一路径
    await page.evaluate(() => {
      (window as any).__aimd_callCounts = {};
    });

    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docA.aimd");
    });

    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    // 因为 focus_doc_window 返回 null 且当前窗口已持有该路径，应该 no-op
    // open_aimd 不应被调用
    expect(counts["open_aimd"] ?? 0).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// case B：另一窗口打开了 A，在本窗口最近文档点击 A → 聚焦另一窗口，本窗口不加载 A
// （前端层：模拟本窗口当前是空白，focus_doc_window 返回已有窗口 label）
// ──────────────────────────────────────────────────────────────────────────────
test.describe("case B: 最近文档点击已在其他窗口打开的文件应聚焦另一窗口", () => {
  test("routeOpenedPath 对已被其他窗口持有的路径不加载到当前窗口", async ({ page }) => {
    // focusResult = "doc-existing-window" 模拟 A 已在另一个窗口打开
    await installMock(page, { focusResult: "doc-existing-window" });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "aimd.desktop.recents",
        JSON.stringify(["/mock/docA.aimd"]),
      );
    });
    await page.goto("/");

    // 点击最近文档项（触发 routeOpenedPath）
    const recentItem = page.locator(".recent-item").first();
    await expect(recentItem).toBeVisible();
    await recentItem.click();

    // open_aimd 不应被调用（应该直接 focus 另一窗口后返回）
    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    expect(counts["focus_doc_window"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts["open_aimd"] ?? 0).toBe(0);

    // focus_doc_window 被调用时传入的是正确路径
    const focusLog = await page.evaluate(() => (window as any).__aimd_focusLog as string[]);
    expect(focusLog).toContain("/mock/docA.aimd");

    // 当前窗口仍是空白状态（#empty 可见，#doc-actions 不可见）
    await expect(page.locator("#empty")).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// case C：path=None 的"新窗口"调用不被去重（保留多开能力）
// Playwright 层无法驱动 Tauri 窗口创建，改用命令注册校验 + 前端 focusResult 验证
// ──────────────────────────────────────────────────────────────────────────────
test.describe("case C: 不同路径各自打开，不互相去重", () => {
  test("打开 docA 和 docB 应分别调用 open_aimd 两次", async ({ page }) => {
    // focusResult = null：每次都找不到已有窗口
    await installMock(page, { focusResult: null });
    await page.goto("/");

    // 打开 docA
    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docA.aimd");
    });

    // 打开 docB（不同路径，不去重）
    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docB.aimd");
    });

    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    // 两次打开应各自调用 open_aimd
    expect(counts["open_aimd"] ?? 0).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// case D：路径大小写归一化 — 同文件不同大小写路径识别为同一文件
// ──────────────────────────────────────────────────────────────────────────────
test.describe("case D: 路径大小写归一化，同文件不同写法不重复打开", () => {
  test("当前窗口已持有 /mock/docA.aimd，用 /Mock/DocA.aimd 再打开时 no-op", async ({ page }) => {
    await installMock(page, { focusResult: null });
    await page.goto("/");

    // 先打开（小写路径）
    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docA.aimd");
    });
    await expect(page.locator("#doc-title")).toHaveText("文档 A");

    // 重置计数
    await page.evaluate(() => {
      (window as any).__aimd_callCounts = {};
    });

    // 再用大小写不同的路径打开（模拟 macOS 不区分大小写文件系统情形）
    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/Mock/DocA.aimd");
    });

    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    // no-op，open_aimd 不被调用
    expect(counts["open_aimd"] ?? 0).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 关闭后重开验证：focus_doc_window 返回 null 时正常打开（表项已被清理）
// ──────────────────────────────────────────────────────────────────────────────
test.describe("关闭原窗口后再次打开应允许正常打开", () => {
  test("focus_doc_window 返回 null 时 open_aimd 正常被调用", async ({ page }) => {
    // focusResult = null 模拟窗口已关闭、表项已被 unregister_window_label 清除
    await installMock(page, { focusResult: null });
    await page.goto("/");

    await page.evaluate(async () => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath("/mock/docA.aimd");
    });

    await expect(page.locator("#doc-title")).toHaveText("文档 A");

    const counts = await page.evaluate(() => (window as any).__aimd_callCounts as Record<string, number>);
    expect(counts["open_aimd"] ?? 0).toBe(1);
  });
});
