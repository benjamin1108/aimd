import { mkdir } from "node:fs/promises";
import { test, expect, Page } from "@playwright/test";

type Doc = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: Array<{
    id: string;
    path: string;
    mime: string;
    size: number;
    sha256: string;
    role: string;
    url?: string;
    localPath?: string;
  }>;
  dirty: boolean;
  format: "aimd" | "markdown";
  requiresAimdSave?: boolean;
  hasGitConflicts?: boolean;
};

const ROOT = "/mock/three-column";
const DAILY = `${ROOT}/Daily with an intentionally long project filename for ellipsis checks.md`;
const REPORT = `${ROOT}/Quarterly Report.aimd`;
const CONFLICT = `${ROOT}/Conflict Review.aimd`;

function render(markdown: string) {
  return markdown
    .split(/\n\n+/)
    .map((block) => {
      if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
      if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
      if (block.includes("asset://")) return `<p><img src="${block.match(/\(([^)]+)\)/)?.[1] || ""}" alt=""></p>`;
      return `<p>${block}</p>`;
    })
    .join("");
}

const docs: Record<string, Doc> = {
  [DAILY]: {
    path: DAILY,
    title: "Daily with an intentionally long project filename for ellipsis checks",
    markdown: "# Daily with an intentionally long project filename for ellipsis checks\n\nMarkdown body.",
    html: render("# Daily with an intentionally long project filename for ellipsis checks\n\nMarkdown body."),
    assets: [],
    dirty: false,
    format: "markdown",
  },
  [REPORT]: {
    path: REPORT,
    title: "Quarterly Report",
    markdown: "# Quarterly Report\n\n## Summary\n\nBody.\n\n![chart](asset://chart-001)",
    html: render("# Quarterly Report\n\n## Summary\n\nBody.\n\n![chart](asset://chart-001)"),
    assets: [{
      id: "chart-001",
      path: "assets/chart.png",
      mime: "image/png",
      size: 4096,
      sha256: "chart",
      role: "content-image",
      url: "/mock/chart.png",
      localPath: "/mock/chart.png",
    }],
    dirty: false,
    format: "aimd",
  },
  [CONFLICT]: {
    path: CONFLICT,
    title: "Conflict Review",
    markdown: "# Conflict Review\n\n<<<<<<< HEAD\nLocal\n=======\nRemote\n>>>>>>> branch",
    html: render("# Conflict Review\n\n<<<<<<< HEAD\nLocal\n=======\nRemote\n>>>>>>> branch"),
    assets: [],
    dirty: false,
    format: "aimd",
    hasGitConflicts: true,
  },
};

async function installThreeColumnMock(page: Page) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    const docs = new Map<string, Doc>(Object.entries(seed.docs));
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const workspace = () => ({
      root: seed.root,
      tree: {
        id: seed.root,
        name: "three-column",
        path: seed.root,
        kind: "folder",
        children: [...docs.values()].map((doc) => ({
          id: doc.path,
          name: doc.path.split("/").at(-1),
          path: doc.path,
          kind: "document",
          format: doc.format,
        })),
      },
    });
    const renderLocal = (markdown: string) => markdown
      .split(/\n\n+/)
      .map((block) => {
        if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
        if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
        if (block.includes("asset://")) return `<p><img src="${block.match(/\(([^)]+)\)/)?.[1] || ""}" alt=""></p>`;
        return `<p>${block}</p>`;
      })
      .join("");
    const settings = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: true, debugMode: false },
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => settings,
      initial_open_path: () => null,
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      focus_doc_window: () => null,
      register_window_path: () => null,
      unregister_window_path: () => null,
      update_window_path: () => null,
      open_aimd: (a) => ({ ...docs.get(String(a?.path))! }),
      convert_md_to_draft: (a) => {
        const doc = docs.get(String(a?.markdownPath))!;
        return { title: doc.title, markdown: doc.markdown, html: doc.html };
      },
      document_file_fingerprint: (a) => ({ mtimeMs: String(a?.path).length, size: 120 }),
      render_markdown: (a) => ({ html: renderLocal(String(a?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: renderLocal(String(a?.markdown ?? "")) }),
      check_document_health: () => ({
        status: "risk",
        summary: "发现 1 个可优化资源",
        counts: { errors: 0, warnings: 1, infos: 0 },
        issues: [{ kind: "local_image", severity: "warning", message: "本地图片尚未嵌入", path: "chart.png" }],
      }),
      package_local_images: (a) => ({ ...docs.get(String(a?.path))! }),
      get_git_repo_status: () => ({
        isRepo: true,
        root: seed.root,
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
        clean: false,
        conflicted: true,
        files: [
          { path: "Quarterly Report.aimd", staged: "modified", unstaged: "none", kind: "modified" },
          { path: "Conflict Review.aimd", staged: "conflicted", unstaged: "conflicted", kind: "conflicted" },
        ],
      }),
      get_git_file_diff: () => ({
        path: "Quarterly Report.aimd",
        stagedDiff: "diff --git a/Quarterly Report.aimd b/Quarterly Report.aimd\n@@ -1 +1 @@\n-# Old\n+# Quarterly Report",
        unstagedDiff: "",
        isBinary: false,
        truncated: false,
      }),
    };
    window.localStorage.clear();
    (window as any).__aimdThreeColumnMock = { calls: () => calls };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        calls.push({ cmd, args });
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, { root: ROOT, docs });
}

async function openProject(page: Page) {
  const emptyOpen = page.locator("#empty-open-workspace");
  if (await emptyOpen.isVisible()) await emptyOpen.click();
  else await page.locator("#workspace-open").click();
  await expect(page.locator("#workspace-root-label")).toHaveText("项目");
  await expect(page.locator("#workspace-tree")).toContainText("Quarterly Report.aimd");
}

async function openDoc(page: Page, label: string) {
  const path = label.includes("Daily") ? DAILY : label.includes("Conflict") ? CONFLICT : REPORT;
  const row = page.locator(".workspace-row", { hasText: label }).first();
  if (await row.isVisible()) {
    await row.click();
  } else {
    await page.evaluate(async (targetPath) => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath(targetPath);
    }, path);
  }
  await expect(page.locator("#doc-title")).toContainText(label.replace(/\.(aimd|md)$/i, "").slice(0, 18));
}

async function openThreeTabs(page: Page) {
  await openProject(page);
  await openDoc(page, "Daily with an intentionally long project filename");
  await openDoc(page, "Quarterly Report.aimd");
  await openDoc(page, "Conflict Review.aimd");
  await expect(page.locator(".open-tab")).toHaveCount(3);
}

async function forceDirtyMarkdownRequiresAimd(page: Page) {
  await page.evaluate(async () => {
    const { state } = await import("/src/core/state.ts");
    const { updateChrome } = await import("/src/ui/chrome.ts");
    if (!state.doc) throw new Error("expected active doc");
    state.doc.dirty = true;
    state.doc.requiresAimdSave = true;
    state.doc.needsAimdSave = true;
    updateChrome();
  });
}

async function ensureInspectorTabReachable(page: Page, tabSelector: string) {
  const inspectorDisplay = await page.locator("#inspector").evaluate((el) => getComputedStyle(el).display);
  if (inspectorDisplay === "none") return false;
  if (!await page.locator(tabSelector).isVisible()) {
    await page.locator("#doc-panel-collapse").click();
  }
  return page.locator(tabSelector).isVisible();
}

async function capture(page: Page, viewport: string, stateName: string) {
  const dir = process.env.AIMD_THREE_COLUMN_SCREENSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir.replace(/\/$/, "")}/${viewport}-${stateName}.png`,
    fullPage: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectDesktopThreeColumns(page: Page, minWorkspace = 560) {
  const [project, workspace, inspector] = await Promise.all([
    page.locator(".sidebar").boundingBox(),
    page.locator(".workspace").boundingBox(),
    page.locator("#inspector").boundingBox(),
  ]);
  expect(project && workspace && inspector).toBeTruthy();
  expect(project!.x + project!.width).toBeLessThanOrEqual(workspace!.x + 1);
  expect(workspace!.x + workspace!.width).toBeLessThanOrEqual(inspector!.x + 1);
  expect(workspace!.width).toBeGreaterThanOrEqual(minWorkspace);
  await expect(page.locator(".workspace-scroll")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator(".inspector-scroll")).toHaveCSS("overflow-y", "auto");
}

async function expectHeaderAndTabsStable(page: Page) {
  const metrics = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const intersects = (a?: DOMRect, b?: DOMRect) => Boolean(a && b
      && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const title = box("#doc-title");
    const save = box("#save");
    const more = box("#more-menu-toggle");
    const tab = box(".open-tab");
    const close = box(".open-tab-close");
    const head = box(".workspace-head");
    return {
      titleSaveOverlap: intersects(title, save),
      saveMoreOverlap: intersects(save, more),
      tabHeight: tab?.height || 0,
      closeWidth: close?.width || 0,
      closeHeight: close?.height || 0,
      headHeight: head?.height || 0,
    };
  });
  expect(metrics.titleSaveOverlap).toBe(false);
  expect(metrics.saveMoreOverlap).toBe(false);
  expect(metrics.tabHeight).toBeGreaterThanOrEqual(30);
  expect(metrics.tabHeight).toBeLessThanOrEqual(36);
  expect(metrics.closeWidth).toBeGreaterThanOrEqual(24);
  expect(metrics.closeHeight).toBeGreaterThanOrEqual(24);
  expect(metrics.headHeight).toBeLessThanOrEqual(82);
}

type VisualState =
  | "no-project-no-tabs"
  | "project-no-tabs"
  | "project-three-tabs"
  | "dirty-markdown-requires-aimd"
  | "aimd-git-conflict"
  | "git-inspector"
  | "health-inspector"
  | "source-markdown-mode";

async function setupVisualState(page: Page, stateName: VisualState) {
  await installThreeColumnMock(page);
  await page.goto("/");
  if (stateName === "no-project-no-tabs") return;
  await openProject(page);
  if (stateName === "project-no-tabs") return;
  if (stateName === "project-three-tabs") {
    await openDoc(page, "Daily with an intentionally long project filename");
    await openDoc(page, "Quarterly Report.aimd");
    await openDoc(page, "Conflict Review.aimd");
    return;
  }
  if (stateName === "dirty-markdown-requires-aimd") {
    await openDoc(page, "Daily with an intentionally long project filename");
    await forceDirtyMarkdownRequiresAimd(page);
    return;
  }
  if (stateName === "aimd-git-conflict") {
    await openDoc(page, "Conflict Review.aimd");
    return;
  }
  await openDoc(page, "Quarterly Report.aimd");
  if (stateName === "git-inspector") {
    if (!await ensureInspectorTabReachable(page, "#sidebar-tab-git")) return;
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator("#git-panel")).toBeVisible();
    return;
  }
  if (stateName === "health-inspector") {
    await page.evaluate(async () => {
      const { runHealthCheck } = await import("/src/document/health.ts");
      await runHealthCheck();
    });
    if (!await ensureInspectorTabReachable(page, "#sidebar-tab-health")) return;
    await page.locator("#sidebar-tab-health").click();
    await expect(page.locator("#health-panel")).toBeVisible();
    return;
  }
  await page.locator("#mode-source").click();
  await expect(page.locator("#editor-wrap")).toBeVisible();
}

test.describe("three-column CSS production polish", () => {
  test("desktop renders project, document workspace, and inspector as independent columns", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openThreeTabs(page);
    await expectDesktopThreeColumns(page);
    await expectHeaderAndTabsStable(page);
    await expectNoHorizontalOverflow(page);
  });

  test("medium desktop collapses the inspector before controls squeeze", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openProject(page);
    await openDoc(page, "Quarterly Report.aimd");
    await expect(page.locator("#inspector")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#doc-panel-collapse")).toBeVisible();
    await expectHeaderAndTabsStable(page);
    await expectNoHorizontalOverflow(page);
  });

  test("narrow viewports avoid horizontal overflow and keep primary commands reachable", async ({ page }) => {
    for (const size of [{ width: 760, height: 700 }, { width: 600, height: 700 }]) {
      await page.setViewportSize(size);
      await installThreeColumnMock(page);
      await page.goto("/");
      await openProject(page);
      await openDoc(page, "Daily with an intentionally long project filename");
      await expect(page.locator("#save")).toBeVisible();
      await expect(page.locator("#more-menu-toggle")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("long project rows and long document titles ellipsize without changing rail geometry", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openProject(page);
    await openDoc(page, "Daily with an intentionally long project filename");

    const rowMetrics = await page.locator(".workspace-row", { hasText: "Daily with an intentionally long project filename" })
      .first()
      .evaluate((el) => {
        const name = el.querySelector<HTMLElement>(".workspace-name")!;
        return {
          railWidth: el.closest(".sidebar")!.getBoundingClientRect().width,
          rowWidth: el.getBoundingClientRect().width,
          textOverflow: getComputedStyle(name).textOverflow,
          whiteSpace: getComputedStyle(name).whiteSpace,
        };
      });
    expect(rowMetrics.rowWidth).toBeLessThanOrEqual(rowMetrics.railWidth);
    expect(rowMetrics.textOverflow).toBe("ellipsis");
    expect(rowMetrics.whiteSpace).toBe("nowrap");
    await expectHeaderAndTabsStable(page);
  });

  test("captures visual QA matrix when AIMD_THREE_COLUMN_SCREENSHOT_DIR is set", async ({ page }) => {
    test.setTimeout(120_000);
    const viewports = [
      { width: 1728, height: 1117 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1180, height: 760 },
      { width: 1024, height: 720 },
      { width: 760, height: 700 },
      { width: 600, height: 700 },
    ];
    const states: VisualState[] = [
      "no-project-no-tabs",
      "project-no-tabs",
      "project-three-tabs",
      "dirty-markdown-requires-aimd",
      "aimd-git-conflict",
      "git-inspector",
      "health-inspector",
      "source-markdown-mode",
    ];

    for (const viewport of viewports) {
      for (const stateName of states) {
        await page.setViewportSize(viewport);
        await setupVisualState(page, stateName);
        await expectNoHorizontalOverflow(page);
        if (viewport.width >= 1180 && stateName !== "no-project-no-tabs") {
          await expectDesktopThreeColumns(page, viewport.width === 1180 ? 500 : 560);
        }
        await capture(page, `${viewport.width}x${viewport.height}`, stateName);
      }
    }
  });
});
