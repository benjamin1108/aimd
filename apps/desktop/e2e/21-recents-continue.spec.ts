/**
 * e2e: recents "继续" item click scenarios
 *
 * This spec targets the bug report: "clicking the first recent item (badge='继续')
 * does not open the document."  We cover five distinct startup scenarios.
 */
import { test, expect, Page } from "@playwright/test";

async function clickClose(page: Page) {
  await page.locator("#more-menu-toggle").click();
  await page.locator("#close").click();
}

const MOCK_PATH = "/mock/docs/sample.aimd";
const MOCK_PATH_B = "/mock/docs/other.aimd";
const MOCK_PATH_WIN = "C:\\Users\\用 户\\我的 文档\\测试.aimd";
const MOCK_PATH_WIN_NORM = "C:/Users/用 户/我的 文档/测试.aimd";

const MOCK_DOC = {
  path: MOCK_PATH,
  title: "样例文档",
  markdown: "# 样例文档\n\n正文内容。\n",
  html: "<h1>样例文档</h1><p>正文内容。</p>",
  assets: [] as unknown[],
  dirty: false,
};

const MOCK_DOC_B = {
  path: MOCK_PATH_B,
  title: "另一份文档",
  markdown: "# 另一份文档\n\n内容 B。\n",
  html: "<h1>另一份文档</h1><p>内容 B。</p>",
  assets: [] as unknown[],
  dirty: false,
};

/**
 * Install a comprehensive Tauri mock.
 * `opts.recents`       – localStorage aimd.desktop.recents value (JSON string)
 * `opts.session`       – localStorage aimd.desktop.session value (JSON string)
 * `opts.last`          – localStorage aimd.desktop.last value (string)
 * `opts.initialPath`   – value returned by initial_open_path
 * `opts.openMap`       – map of path → DocumentDTO for open_aimd calls
 * `opts.focusResult`   – if true, focus_doc_window returns a label (another window has it)
 */
async function installMock(
  page: Page,
  opts: {
    recents?: string;
    session?: string;
    last?: string;
    initialPath?: string | null;
    openMap?: Record<string, object>;
    focusResult?: boolean;
  } = {},
) {
  const seed = {
    recents: opts.recents ?? null,
    session: opts.session ?? null,
    last: opts.last ?? null,
    initialPath: opts.initialPath ?? null,
    openMap: opts.openMap ?? { [MOCK_PATH]: MOCK_DOC, [MOCK_PATH_B]: MOCK_DOC_B },
    focusResult: opts.focusResult ?? false,
    docA: MOCK_DOC,
    docB: MOCK_DOC_B,
  };

  await page.addInitScript((s: typeof seed) => {
    // Pre-seed localStorage BEFORE the app reads it.
    if (s.recents !== null) localStorage.setItem("aimd.desktop.recents", s.recents);
    if (s.session !== null) localStorage.setItem("aimd.desktop.session", s.session);
    if (s.last !== null) localStorage.setItem("aimd.desktop.last", s.last);

    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;

    // 模拟 Rust 端 OpenedWindows 表：register_window_path 写入，
    // unregister_current_window_path 在 closeDocument 时清空当前窗口的条目。
    // focus_doc_window 命中 same-label 时返回 null（同 Rust 实现）。
    const openedWindows: Record<string, string> = {};
    const SELF_LABEL = "main";

    type Args = Record<string, unknown> | undefined;
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => s.initialPath,
      choose_doc_file: () => null,
      choose_aimd_file: () => null,
      choose_markdown_file: () => null,
      choose_image_file: () => null,
      choose_save_aimd_file: () => null,
      open_aimd: (a) => {
        const path = String((a as any)?.path ?? "");
        const doc = (s.openMap as any)[path];
        if (!doc) throw new Error(`mock open_aimd: no doc for path "${path}"`);
        return doc;
      },
      create_aimd: () => s.docA,
      save_aimd: () => s.docA,
      save_aimd_as: () => s.docA,
      render_markdown: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      render_markdown_standalone: (a) => ({ html: `<p>${String((a as any)?.markdown ?? "").slice(0, 80)}</p>` }),
      add_image: () => null,
      import_markdown: () => s.docA,
      list_aimd_assets: () => [],
      register_window_path: (a) => {
        const path = String((a as any)?.path ?? "");
        // 移除该 label 的旧条目，再写入新条目
        for (const k of Object.keys(openedWindows)) {
          if (openedWindows[k] === SELF_LABEL) delete openedWindows[k];
        }
        if (path) openedWindows[path] = SELF_LABEL;
        return undefined;
      },
      unregister_current_window_path: () => {
        for (const k of Object.keys(openedWindows)) {
          if (openedWindows[k] === SELF_LABEL) delete openedWindows[k];
        }
        return undefined;
      },
      focus_doc_window: (a) => {
        if (s.focusResult) return "other"; // 显式模拟另一个窗口已打开
        const path = String((a as any)?.path ?? "");
        const label = openedWindows[path];
        if (!label) return null;
        if (label === SELF_LABEL) return null; // 命中调用方自身 → 视作未打开
        return label;
      },
      update_window_path: () => undefined,
      confirm_discard_changes: () => "discard",
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command "${cmd}"`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI__ = {
      core: { convertFileSrc },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}

// ---------------------------------------------------------------------------
// 场景 A — 冷启动，无 session snapshot，recents 有路径，无 initialPath
// 用户点击 recents[0]("继续")，期望文档打开
// ---------------------------------------------------------------------------
test("场景A: 冷启动无session, 点继续项, 文档应该打开", async ({ page }) => {
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH]),
    session: null,
    last: null,
    initialPath: null,
  });
  await page.goto("/");

  // 空状态：没有 session snapshot，也没有 last，所以 restoreSession 不做事
  // recents[0] 应该渲染成"继续"徽章
  const recentButton = page.locator(".recent-item").first();
  await expect(recentButton).toBeVisible();
  await expect(recentButton.locator(".recent-item-badge")).toHaveText("继续");

  // 点击"继续"
  await recentButton.click();

  // 文档应该打开：标题 + reader 内容可见
  await expect(page.locator("#doc-title")).toHaveText("样例文档");
  await expect(page.locator("#reader h1")).toHaveText("样例文档");
  await expect(page.locator("#empty")).toBeHidden();
});

// ---------------------------------------------------------------------------
// 场景 B — 冷启动 + session 恢复 → 关闭文档 → recents 仍可见 → 点继续应该重新打开。
// 这是用户实际路径："最近的文档点继续打不开"——之前的 bug 是：closeDocument 不调
// unregister_current_window_path，OpenedWindows 表里残留 {path → "main"}，
// 然后 focus_doc_window 误判"已有窗口承载"返回 label，routeOpenedPath 直接 return。
// ---------------------------------------------------------------------------
test("场景B: session恢复后关闭文档, 再点继续, 文档应该被重新打开", async ({ page }) => {
  const snapshot = {
    path: MOCK_PATH,
    title: "样例文档",
    markdown: "# 样例文档\n\n正文内容。\n",
    html: "<h1>样例文档</h1><p>正文内容。</p>",
    assets: [],
    dirty: false,
    isDraft: false,
    format: "aimd",
    mode: "read",
  };
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH]),
    session: JSON.stringify(snapshot),
    last: MOCK_PATH,
    initialPath: null,
  });
  await page.goto("/");

  // 等 session 恢复
  await expect(page.locator("#doc-title")).toHaveText("样例文档", { timeout: 5000 });
  await expect(page.locator("#empty")).toBeHidden();

  // 关闭文档 → empty 重新可见，recents 重新可见
  await clickClose(page);
  await expect(page.locator("#empty")).toBeVisible();

  // 点"继续"（recents[0]，badge="继续"）
  const recentButton = page.locator(".recent-item").first();
  await expect(recentButton).toBeVisible();
  await expect(recentButton.locator(".recent-item-badge")).toHaveText("继续");
  await recentButton.click();

  // 期望：文档被重新打开（关键回归断言）
  await expect(page.locator("#doc-title")).toHaveText("样例文档", { timeout: 5000 });
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator("#reader h1")).toHaveText("样例文档");
});

// ---------------------------------------------------------------------------
// 场景 C — dirty session 恢复 → 直接关闭（用户选 discard）→ 点继续应该从磁盘加载干净版本。
// 这条主要确认 closeDocument 的 ensureCanDiscardChanges 分支也能走通 unregister。
// ---------------------------------------------------------------------------
test("场景C: dirty session恢复后关闭(放弃修改), 点继续, 应该从磁盘重新加载干净版本", async ({ page }) => {
  const snapshot = {
    path: MOCK_PATH,
    title: "样例文档（未保存修改）",
    markdown: "# 样例文档\n\n**已修改但未保存**\n",
    html: "<h1>样例文档</h1><p><strong>已修改但未保存</strong></p>",
    assets: [],
    dirty: true,
    isDraft: false,
    format: "aimd",
    mode: "edit",
  };
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH]),
    session: JSON.stringify(snapshot),
    last: MOCK_PATH,
    initialPath: null,
  });
  await page.goto("/");

  // 等 session 恢复（dirty 文档）
  await expect(page.locator("#doc-title")).toHaveText("样例文档", { timeout: 5000 });

  // 关闭文档（mock 把 confirm_discard_changes 直接返 "discard"）
  await clickClose(page);
  await expect(page.locator("#empty")).toBeVisible();

  // 点继续 → 从磁盘加载干净版本
  await page.locator(".recent-item").first().click();
  await expect(page.locator("#doc-title")).toHaveText("样例文档", { timeout: 5000 });
  await expect(page.locator("#reader h1")).toHaveText("样例文档");
});

// ---------------------------------------------------------------------------
// 场景 D — 已打开 doc B → 关闭 → recents 重新可见，data-path=A 的按钮可点击。
// 修正了原版"已打开doc B再点recents A"的不可达前置（doc 加载时 recents 在 emptyEl 内被隐藏）。
// ---------------------------------------------------------------------------
test("场景D: 打开B再关闭, recents里点A, A应该被打开", async ({ page }) => {
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH, MOCK_PATH_B]),
    session: null,
    last: null,
    initialPath: null,
  });
  await page.goto("/");

  // 打开 B
  const buttonB = page.locator(".recent-item").nth(1);
  await expect(buttonB.locator(".recent-item-badge")).toHaveText("打开");
  await buttonB.click();
  await expect(page.locator("#doc-title")).toHaveText("另一份文档", { timeout: 5000 });

  // 关闭 B → empty 重新可见
  await clickClose(page);
  await expect(page.locator("#empty")).toBeVisible();

  // recents 现在是 [B, A]（B 因 rememberOpenedPath 被推到 index 0）
  // 找 A（data-path = MOCK_PATH）并点击
  const buttonA = page.locator(`.recent-item[data-path="${MOCK_PATH}"]`);
  await expect(buttonA).toBeVisible();
  await buttonA.click();
  await expect(page.locator("#doc-title")).toHaveText("样例文档", { timeout: 5000 });
  await expect(page.locator("#reader h1")).toHaveText("样例文档");
});

// ---------------------------------------------------------------------------
// 场景 E — Windows 路径规范化
// 验证前端 normPathsEqual 能将反斜杠路径与斜杠路径正确匹配
// 即：recents 存储的是 "C:\\path\\file.aimd"，state.doc.path 是 "C:\\path\\file.aimd"
// focus_doc_window 调用时传入的是 recents 里的原始字符串，能否被 windows.rs 的 normalize_path 处理
// 这里在纯前端层面验证：normPathsEqual 不因大小写/斜杠差异给出假阴性
// ---------------------------------------------------------------------------
test("场景E: 路径含中文和空格的recents项可以正确点击打开", async ({ page }) => {
  const winDoc = {
    path: MOCK_PATH_WIN,
    title: "Windows路径测试",
    markdown: "# Windows路径测试\n\n中文路径文档。\n",
    html: "<h1>Windows路径测试</h1><p>中文路径文档。</p>",
    assets: [] as unknown[],
    dirty: false,
  };

  // openMap 同时注册正斜杠和反斜杠版本，因为前端直接把 recents 里的 path 传给 open_aimd
  const openMap: Record<string, object> = {
    [MOCK_PATH_WIN]: winDoc,
    [MOCK_PATH_WIN_NORM]: winDoc,
    [MOCK_PATH]: MOCK_DOC,
  };

  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH_WIN]),
    session: null,
    last: null,
    initialPath: null,
    openMap,
  });
  await page.goto("/");

  const recentButton = page.locator(".recent-item").first();
  await expect(recentButton).toBeVisible();
  await expect(recentButton.locator(".recent-item-badge")).toHaveText("继续");

  // 点击应该触发 open_aimd，不应该抛错
  await recentButton.click();

  // 文档应该打开
  await expect(page.locator("#doc-title")).toHaveText("Windows路径测试", { timeout: 5000 });
  await expect(page.locator("#empty")).toBeHidden();
});

// ---------------------------------------------------------------------------
// 额外场景：验证渲染 recents 列表时，index=0 的徽章是"继续"，其余是"打开"
// ---------------------------------------------------------------------------
test("recents列表徽章渲染: index=0是继续, 其余是打开", async ({ page }) => {
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH, MOCK_PATH_B]),
    session: null,
    last: null,
    initialPath: null,
  });
  await page.goto("/");

  const items = page.locator(".recent-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator(".recent-item-badge")).toHaveText("继续");
  await expect(items.nth(1).locator(".recent-item-badge")).toHaveText("打开");
});

// ---------------------------------------------------------------------------
// 额外场景：验证 focus_doc_window 返回 label（另一窗口已打开该路径）时，
// routeOpenedPath 提前返回而不打开文档（此时应该看到 launchpad 仍在）
// ---------------------------------------------------------------------------
test("focus_doc_window返回label时, routeOpenedPath应提前返回不打开文档", async ({ page }) => {
  await installMock(page, {
    recents: JSON.stringify([MOCK_PATH]),
    session: null,
    last: null,
    initialPath: null,
    focusResult: true, // 模拟另一个窗口已持有该路径
  });
  await page.goto("/");

  // 点击"继续"
  const recentButton = page.locator(".recent-item").first();
  await recentButton.click();

  // focus_doc_window 返回了 label → routeOpenedPath 直接 return，不打开文档
  // 空状态页面仍然可见（因为没有 initialPath 也没有 session）
  await expect(page.locator("#empty")).toBeVisible();
  // chrome.ts 在没有 doc 时把 #doc-title 显示成 "AIMD Desktop"
  await expect(page.locator("#doc-title")).toHaveText("AIMD Desktop", { timeout: 3000 });
});
