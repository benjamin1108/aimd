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

async function expectCommandStripAndTabsStable(page: Page) {
  const metrics = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const intersects = (a?: DOMRect, b?: DOMRect) => Boolean(a && b
      && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const find = box("#find-toggle");
    const width = box("#viewport-width-toggle");
    const mode = box(".toolbar-group--mode");
    const more = box("#more-menu-toggle");
    const tab = box(".open-tab");
    const close = box(".open-tab-close");
    const tabStrip = box("#document-tab-strip");
    const strip = box("#document-command-strip");
    return {
      findModeOverlap: intersects(find, mode),
      findWidthOverlap: intersects(find, width),
      widthModeOverlap: intersects(width, mode),
      modeMoreOverlap: intersects(mode, more),
      tabCommandOverlap: intersects(tab, strip),
      tabStripBottom: tabStrip?.bottom || 0,
      commandStripTop: strip?.top || 0,
      tabHeight: tab?.height || 0,
      closeWidth: close?.width || 0,
      closeHeight: close?.height || 0,
      stripHeight: strip?.height || 0,
      widthToggleWidth: width?.width || 0,
    };
  });
  expect(metrics.findModeOverlap).toBe(false);
  expect(metrics.findWidthOverlap).toBe(false);
  expect(metrics.widthModeOverlap).toBe(false);
  expect(metrics.modeMoreOverlap).toBe(false);
  expect(metrics.tabCommandOverlap).toBe(false);
  expect(metrics.commandStripTop).toBeGreaterThanOrEqual(metrics.tabStripBottom - 1);
  expect(metrics.tabHeight).toBeGreaterThanOrEqual(30);
  expect(metrics.tabHeight).toBeLessThanOrEqual(36);
  expect(metrics.closeWidth).toBeGreaterThanOrEqual(24);
  expect(metrics.closeHeight).toBeGreaterThanOrEqual(24);
  expect(metrics.stripHeight).toBeLessThanOrEqual(62);
  expect(metrics.widthToggleWidth).toBeGreaterThanOrEqual(28);
  expect(metrics.widthToggleWidth).toBeLessThanOrEqual(34);
}

type VisualState =
  | "no-project-no-tabs"
  | "project-no-tabs"
  | "project-three-tabs"
  | "dirty-markdown-requires-aimd"
  | "aimd-git-conflict"
  | "git-inspector"
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
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").fill("# Daily with an intentionally long project filename for ellipsis checks\n\n![local](asset://img-001)");
    await expect(page.locator("#doc-state-badges")).toBeHidden();
    await expect(page.locator("#status")).toContainText("保存时需选择格式");
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
  await page.locator("#mode-edit").click();
  await expect(page.locator("#editor-wrap")).toBeVisible();
}

test.describe("three-column CSS production polish", () => {
  test("desktop renders project, document workspace, and inspector as independent columns", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openThreeTabs(page);
    await expectDesktopThreeColumns(page);
    await expectCommandStripAndTabsStable(page);
    await expectNoHorizontalOverflow(page);

    const inspectorChrome = await page.evaluate(() => {
      const projectLabel = document.querySelector("#workspace-root-label")!.getBoundingClientRect();
      const owner = document.querySelector("#inspector-owner")!.getBoundingClientRect();
      const collapse = document.querySelector("#doc-panel-collapse")!.getBoundingClientRect();
      const tabs = document.querySelector("#doc-panel-tabs")!.getBoundingClientRect();
      const section = document.querySelector("#outline-section")!.getBoundingClientRect();
      return {
        projectLabelTop: projectLabel.top,
        ownerTop: owner.top,
        ownerCenterY: owner.top + owner.height / 2,
        collapseCenterY: collapse.top + collapse.height / 2,
        collapseBottom: collapse.bottom,
        tabsTop: tabs.top,
        tabsCenterOffset: Math.abs((tabs.left + tabs.width / 2) - (section.left + section.width / 2)),
      };
    });
    expect(Math.abs(inspectorChrome.projectLabelTop - inspectorChrome.ownerTop)).toBeLessThanOrEqual(3);
    expect(Math.abs(inspectorChrome.ownerCenterY - inspectorChrome.collapseCenterY)).toBeLessThanOrEqual(2);
    expect(inspectorChrome.collapseBottom).toBeLessThanOrEqual(inspectorChrome.tabsTop);
    expect(inspectorChrome.tabsCenterOffset).toBeLessThanOrEqual(2);
  });

  test("medium desktop collapses the inspector before controls squeeze", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openProject(page);
    await openDoc(page, "Quarterly Report.aimd");
    await expect(page.locator("#inspector")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#doc-panel-collapse")).toBeVisible();
    const inspectorBefore = await page.locator("#inspector").boundingBox();
    expect(inspectorBefore!.width).toBeGreaterThanOrEqual(18);
    expect(inspectorBefore!.width).toBeLessThanOrEqual(22);
    await page.setViewportSize({ width: 980, height: 720 });
    const inspectorAfter = await page.locator("#inspector").boundingBox();
    expect(Math.abs(inspectorAfter!.width - inspectorBefore!.width)).toBeLessThanOrEqual(1);
    await expectCommandStripAndTabsStable(page);
    await expectNoHorizontalOverflow(page);
  });

  test("narrow desktop keeps project and inspector collapsed rails stable", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 720 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openProject(page);
    await openDoc(page, "Quarterly Report.aimd");

    await expect(page.locator(".sidebar")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#project-rail-collapse")).toBeVisible();
    await expect(page.locator("#inspector")).toHaveClass(/is-collapsed/);

    const before = await page.evaluate(() => {
      const project = document.querySelector(".sidebar")!.getBoundingClientRect();
      const projectToggle = document.querySelector("#project-rail-collapse")!.getBoundingClientRect();
      const inspector = document.querySelector("#inspector")!.getBoundingClientRect();
      const inspectorToggle = document.querySelector("#doc-panel-collapse")!.getBoundingClientRect();
      return {
        project: project.width,
        inspector: inspector.width,
        projectCenterOffset: Math.abs((projectToggle.top + projectToggle.height / 2) - (project.top + project.height / 2)),
        inspectorCenterOffset: Math.abs((inspectorToggle.top + inspectorToggle.height / 2) - (inspector.top + inspector.height / 2)),
      };
    });
    expect(before.project).toBeGreaterThanOrEqual(18);
    expect(before.project).toBeLessThanOrEqual(22);
    expect(before.inspector).toBeGreaterThanOrEqual(18);
    expect(before.inspector).toBeLessThanOrEqual(22);
    expect(before.projectCenterOffset).toBeLessThanOrEqual(2);
    expect(before.inspectorCenterOffset).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 840, height: 720 });
    const after = await page.evaluate(() => {
      const project = document.querySelector(".sidebar")!.getBoundingClientRect();
      const inspector = document.querySelector("#inspector")!.getBoundingClientRect();
      return { project: project.width, inspector: inspector.width };
    });
    expect(Math.abs(after.project - before.project)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.inspector - before.inspector)).toBeLessThanOrEqual(1);

    await page.locator(".workspace").hover();
    const projectHoverBefore = await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).backgroundImage);
    await page.locator(".sidebar").hover();
    const projectHover = await page.locator(".sidebar").evaluate((el) => ({
      cursor: getComputedStyle(el).cursor,
      backgroundImage: getComputedStyle(el).backgroundImage,
      toggleBackground: getComputedStyle(document.querySelector("#project-rail-collapse")!).backgroundColor,
    }));
    expect(projectHover.cursor).toBe("pointer");
    expect(projectHover.backgroundImage).not.toBe(projectHoverBefore);
    expect(projectHover.toggleBackground).toBe("rgba(0, 0, 0, 0)");

    const projectRail = await page.locator(".sidebar").boundingBox();
    await page.mouse.click(projectRail!.x + projectRail!.width / 2, projectRail!.y + projectRail!.height * 0.75);
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("#project-rail-collapse")).toHaveAttribute("title", "折叠项目栏");
    await expect(page.locator("#project-rail-collapse svg")).toHaveCount(1);
    const projectCloseIcon = await page.locator("#project-rail-collapse svg").boundingBox();
    expect(projectCloseIcon!.width).toBeLessThanOrEqual(13);
    expect(projectCloseIcon!.height).toBeLessThanOrEqual(13);
    const expanded = await page.evaluate(() => {
      const project = document.querySelector(".sidebar")!.getBoundingClientRect();
      const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
      return { projectRight: project.right, workspaceLeft: workspace.left, projectWidth: project.width };
    });
    expect(expanded.projectWidth).toBeGreaterThan(180);
    expect(expanded.workspaceLeft).toBeGreaterThanOrEqual(expanded.projectRight - 1);

    await page.locator(".workspace").hover();
    const inspectorHoverBefore = await page.locator("#inspector").evaluate((el) => getComputedStyle(el).backgroundImage);
    await page.locator("#inspector").hover();
    const inspectorHover = await page.locator("#inspector").evaluate((el) => ({
      cursor: getComputedStyle(el).cursor,
      backgroundImage: getComputedStyle(el).backgroundImage,
      toggleBackground: getComputedStyle(document.querySelector("#doc-panel-collapse")!).backgroundColor,
    }));
    expect(inspectorHover.cursor).toBe("pointer");
    expect(inspectorHover.backgroundImage).not.toBe(inspectorHoverBefore);
    expect(inspectorHover.toggleBackground).toBe("rgba(0, 0, 0, 0)");

    const inspectorRail = await page.locator("#inspector").boundingBox();
    await page.mouse.click(inspectorRail!.x + inspectorRail!.width / 2, inspectorRail!.y + inspectorRail!.height * 0.75);
    await expect(page.locator("#inspector")).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("#doc-panel-collapse")).toHaveAttribute("title", "折叠检查器");
    await expect(page.locator("#doc-panel-collapse svg")).toHaveCount(1);
    const inspectorCloseIcon = await page.locator("#doc-panel-collapse svg").boundingBox();
    expect(inspectorCloseIcon!.width).toBeLessThanOrEqual(13);
    expect(inspectorCloseIcon!.height).toBeLessThanOrEqual(13);
    await expectNoHorizontalOverflow(page);
  });

  test("narrow viewports avoid horizontal overflow and keep primary commands reachable", async ({ page }) => {
    for (const size of [{ width: 760, height: 700 }, { width: 600, height: 700 }]) {
      await page.setViewportSize(size);
      await installThreeColumnMock(page);
      await page.goto("/");
      await openProject(page);
      await openDoc(page, "Daily with an intentionally long project filename");
      await expect(page.locator("#more-menu-toggle")).toBeVisible();
      await page.locator("#more-menu-toggle").click();
      await expect(page.locator("#more-menu #save")).toBeVisible();
      await page.keyboard.press("Escape");
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
    await expectCommandStripAndTabsStable(page);
  });

  test("truncated project rows expand through a body portal without resizing the tree", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await installThreeColumnMock(page);
    await page.goto("/");
    await openProject(page);

    const untruncatedRowIndex = await page.locator(".workspace-row").evaluateAll((rows) => rows.findIndex((row) => {
      const name = row.querySelector<HTMLElement>(".workspace-name");
      return Boolean(name && name.scrollWidth <= name.clientWidth + 1);
    }));
    expect(untruncatedRowIndex).toBeGreaterThanOrEqual(0);
    const shortRow = page.locator(".workspace-row").nth(untruncatedRowIndex);
    await shortRow.hover();
    await page.waitForTimeout(170);
    await expect(page.locator(".workspace-row-overflow-overlay")).toHaveCount(0);

    await openDoc(page, "Daily with an intentionally long project filename");
    const longRow = page.locator(".workspace-row", { hasText: "Daily with an intentionally long project filename" }).first();
    const before = await longRow.evaluate((el) => {
      const name = el.querySelector<HTMLElement>(".workspace-name")!;
      const row = el.getBoundingClientRect();
      return {
        rowWidth: row.width,
        rowTop: row.top,
        rowLeft: row.left,
        rowHeight: row.height,
        railWidth: el.closest(".sidebar")!.getBoundingClientRect().width,
        nameClientWidth: name.clientWidth,
        nameScrollWidth: name.scrollWidth,
        paddingLeft: getComputedStyle(el).paddingLeft,
      };
    });
    expect(before.nameScrollWidth).toBeGreaterThan(before.nameClientWidth);

    await longRow.hover();
    await page.waitForTimeout(20);
    await page.locator(".workspace").hover();
    await page.waitForTimeout(100);
    await expect(page.locator(".workspace-row-overflow-overlay")).toHaveCount(0);

    await longRow.hover();
    const overlay = page.locator(".workspace-row-overflow-overlay");
    await page.waitForTimeout(90);
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveClass(/is-open/);

    const metrics = await overlay.evaluate((el) => {
      const name = el.querySelector<HTMLElement>(".workspace-name")!;
      const source = document.querySelector<HTMLElement>(".workspace-row[data-workspace-path$='ellipsis checks.md']")!;
      const portal = document.querySelector("#workspace-row-overflow-portal-root");
      const overlayRect = el.getBoundingClientRect();
      return {
        parentId: el.parentElement?.id || "",
        portalParentIsBody: portal?.parentElement === document.body,
        pointerEvents: getComputedStyle(el).pointerEvents,
        zIndex: Number.parseInt(getComputedStyle(el).zIndex, 10),
        sourceWidth: source.getBoundingClientRect().width,
        overlayWidth: overlayRect.width,
        overlayTop: overlayRect.top,
        overlayLeft: overlayRect.left,
        overlayHeight: overlayRect.height,
        overlayPaddingLeft: getComputedStyle(el).paddingLeft,
        backgroundColor: getComputedStyle(el).backgroundColor,
        opacity: getComputedStyle(el).opacity,
        textOverflow: getComputedStyle(name).textOverflow,
        nameClientWidth: name.clientWidth,
        nameScrollWidth: name.scrollWidth,
      };
    });
    expect(metrics.parentId).toBe("workspace-row-overflow-portal-root");
    expect(metrics.portalParentIsBody).toBe(true);
    expect(metrics.pointerEvents).toBe("none");
    expect(metrics.zIndex).toBeGreaterThan(200);
    expect(metrics.sourceWidth).toBeLessThanOrEqual(before.railWidth);
    expect(metrics.overlayWidth).toBeGreaterThan(before.rowWidth + 20);
    expect(metrics.overlayWidth).toBeLessThanOrEqual(before.rowWidth + 190);
    expect(Math.abs(metrics.overlayTop - before.rowTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.overlayLeft - before.rowLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.overlayHeight - before.rowHeight)).toBeLessThanOrEqual(1);
    expect(metrics.overlayPaddingLeft).toBe(before.paddingLeft);
    expect(metrics.backgroundColor.startsWith("rgba(")).toBe(false);
    expect(metrics.opacity).toBe("1");
    expect(metrics.textOverflow).toBe("clip");

    await page.locator(".workspace").hover();
    await expect(overlay).toHaveCount(0);
    const afterWidth = await longRow.evaluate((el) => el.getBoundingClientRect().width);
    expect(afterWidth).toBe(before.rowWidth);
    await expectNoHorizontalOverflow(page);
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
      "source-markdown-mode",
    ];

    for (const viewport of viewports) {
      for (const stateName of states) {
        await page.setViewportSize(viewport);
        await setupVisualState(page, stateName);
        await expectNoHorizontalOverflow(page);
        if (viewport.width >= 1180 && !["no-project-no-tabs", "project-no-tabs"].includes(stateName)) {
          await expectDesktopThreeColumns(page, viewport.width === 1180 ? 500 : 560);
        }
        await capture(page, `${viewport.width}x${viewport.height}`, stateName);
      }
    }
  });
});
