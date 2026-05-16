import { mkdir } from "node:fs/promises";
import { test, expect, Page } from "@playwright/test";

const ROOT = "/mock/high-end-visual";
const DOC = `${ROOT}/Premium Surface Audit.aimd`;
const LONG_DOC = `${ROOT}/A very long document title that must never squeeze the header controls.aimd`;

async function installHighEndMock(page: Page) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    const listeners = new Map<number, { event: string; handler: Function }>();
    let nextListenerId = 1;
    const markdown = [
      "# Premium Surface Audit",
      "",
      "AIMD keeps reading, visual editing, source editing, assets, Git, and health in one quiet desktop surface.",
      "",
      "## Material System",
      "",
      "- document canvas",
      "- source editor",
      "- inspector rail",
      "",
      "```ts",
      "const surface = createRefinedSurface(markdown);",
      "```",
    ].join("\n");
    const html = [
      "<h1>Premium Surface Audit</h1>",
      "<p>AIMD keeps reading, visual editing, source editing, assets, Git, and health in one quiet desktop surface.</p>",
      "<h2>Material System</h2>",
      "<ul><li>document canvas</li><li>source editor</li><li>inspector rail</li></ul>",
      "<pre><code>const surface = createRefinedSurface(markdown);</code></pre>",
    ].join("");
    const docs = new Map<string, any>([
      [seed.doc, {
        path: seed.doc,
        title: "Premium Surface Audit",
        markdown,
        html,
        assets: [{
          id: "surface.png",
          path: "assets/surface.png",
          mime: "image/png",
          size: 2048,
          sha256: "surface",
          role: "content-image",
          url: "/mock/surface.png",
        }],
        dirty: false,
        format: "aimd",
      }],
      [seed.longDoc, {
        path: seed.longDoc,
        title: "A very long document title that must never squeeze the header controls",
        markdown: "# A very long document title that must never squeeze the header controls\n\nBody.",
        html: "<h1>A very long document title that must never squeeze the header controls</h1><p>Body.</p>",
        assets: [],
        dirty: true,
        format: "aimd",
        hasGitConflicts: true,
      }],
    ]);
    const settings = {
      ai: { activeProvider: "dashscope", providers: { dashscope: { model: "qwen3.6-plus", apiKey: "sk-test-1234567890abcdef", apiBase: "" } } },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: true, debugMode: true },
    };
    const workspace = () => ({
      root: seed.root,
      tree: {
        id: seed.root,
        name: "high-end-visual",
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
    const renderLocal = (text: string) => text
      .split(/\n\n+/)
      .map((block) => {
        if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
        if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
        if (block.startsWith("```")) return "<pre><code>const surface = createRefinedSurface(markdown);</code></pre>";
        return `<p>${block}</p>`;
      })
      .join("");
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => settings,
      save_settings: () => null,
      "plugin:event|listen": (a) => {
        const id = nextListenerId++;
        listeners.set(id, { event: String(a?.event ?? ""), handler: a?.handler });
        return id;
      },
      initial_open_path: () => null,
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      choose_doc_file: () => seed.doc,
      focus_doc_window: () => null,
      register_window_path: () => null,
      unregister_window_path: () => null,
      update_window_path: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      open_aimd: (a) => ({ ...docs.get(String(a?.path ?? seed.doc)) }),
      list_aimd_assets: () => [],
      document_file_fingerprint: () => ({ mtimeMs: 1, size: 120 }),
      render_markdown: (a) => ({ html: renderLocal(String(a?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: renderLocal(String(a?.markdown ?? "")) }),
      confirm_discard_changes: () => "discard",
      get_git_repo_status: () => ({
        isRepo: true,
        root: seed.root,
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        clean: false,
        conflicted: true,
        files: [{ path: "Premium Surface Audit.aimd", staged: "modified", unstaged: "none", kind: "modified" }],
      }),
      get_git_file_diff: () => ({
        path: "Premium Surface Audit.aimd",
        stagedDiff: "diff --git a/Premium Surface Audit.aimd b/Premium Surface Audit.aimd\n@@ -1 +1 @@\n-# Old\n+# Premium Surface Audit",
        unstagedDiff: "",
        isBinary: false,
        truncated: false,
      }),
      check_document_health: () => ({
        status: "ok",
        summary: "资源状态正常",
        counts: { errors: 0, warnings: 0, infos: 1 },
        issues: [{ kind: "asset", severity: "info", message: "资源已嵌入", path: "surface.png" }],
      }),
    };
    window.localStorage.clear();
    (window as any).__aimdEmitTauriEvent = (event: string, payload: unknown) => {
      for (const item of listeners.values()) {
        if (item.event === event) item.handler({ event, payload });
      }
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, { root: ROOT, doc: DOC, longDoc: LONG_DOC });
}

async function openProjectAndDoc(page: Page, long = false) {
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  const target = long ? "A very long document title" : "Premium Surface Audit";
  const row = page.locator(".workspace-row", { hasText: target }).first();
  if (await row.isVisible()) {
    await row.click();
  } else {
    await page.evaluate(async ({ path }) => {
      const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
      await routeOpenedPath(path);
    }, { path: long ? LONG_DOC : DOC });
  }
  await expect(page.locator("#reader")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function maybeCapture(page: Page, name: string) {
  const dir = process.env.AIMD_HIGH_END_SCREENSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir.replace(/\/$/, "")}/${name}.png`, fullPage: true });
}

async function expectInsideViewport(page: Page, selector: string) {
  const bounds = await page.locator(selector).first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

async function showUpdaterPanel(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#update-panel")!.hidden = false;
    document.querySelector<HTMLElement>("#update-title")!.textContent = "AIMD 更新";
    document.querySelector<HTMLElement>("#update-message")!.textContent = "正在准备下载高端视觉验证版本";
    document.querySelector<HTMLElement>("#update-progress-wrap")!.hidden = false;
    document.querySelector<HTMLElement>("#update-progress")!.textContent = "42%";
    document.querySelector<HTMLElement>("#update-progress-detail")!.textContent = "18.4 MB / 43.8 MB";
    document.querySelector<HTMLElement>("#update-progress-fill")!.style.setProperty("--update-progress-scale", "0.42");
    document.querySelector<HTMLElement>("#update-progress-bar")!.classList.remove("is-indeterminate");
  });
  await expect(page.locator("#update-panel")).toBeVisible();
  await expectInsideViewport(page, "#update-panel");
}

async function showWebClipPanel(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#web-clip-panel")!.hidden = false;
    document.querySelector<HTMLInputElement>("#web-clip-url")!.value = "https://example.com/premium-editor-audit";
  });
  await expect(page.locator("#web-clip-panel")).toBeVisible();
  await expectInsideViewport(page, "#web-clip-panel");
}

async function showSaveFormatPanel(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#save-format-panel")!.hidden = false;
  });
  await expect(page.locator("#save-format-panel")).toBeVisible();
  await expectInsideViewport(page, "#save-format-panel");
}

async function showLinkPopover(page: Page) {
  await page.evaluate(() => {
    const popover = document.querySelector<HTMLElement>("#link-popover")!;
    popover.hidden = false;
    document.querySelector<HTMLInputElement>("#link-popover-input")!.value = "https://aimd.local/visual-refactor";
  });
  await expect(page.locator("#link-popover")).toBeVisible();
  await expectInsideViewport(page, "#link-popover");
}

async function showLightbox(page: Page) {
  await page.evaluate(() => {
    document.querySelector("[data-lightbox='true']")?.remove();
    const lightbox = document.createElement("div");
    lightbox.className = "aimd-lightbox";
    lightbox.dataset.lightbox = "true";
    lightbox.innerHTML = `
      <img class="aimd-lightbox-img" alt="visual verification" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%23fffdf9'/%3E%3Crect x='72' y='66' width='816' height='408' rx='24' fill='%23f1eadf' stroke='%2320160b' stroke-opacity='.14'/%3E%3Crect x='120' y='120' width='328' height='300' rx='18' fill='%23fcf7ef'/%3E%3Crect x='492' y='120' width='300' height='46' rx='12' fill='%232f6f63' fill-opacity='.82'/%3E%3Crect x='492' y='194' width='254' height='24' rx='8' fill='%2320160b' fill-opacity='.18'/%3E%3Crect x='492' y='238' width='318' height='24' rx='8' fill='%2320160b' fill-opacity='.12'/%3E%3Crect x='492' y='282' width='216' height='24' rx='8' fill='%2320160b' fill-opacity='.1'/%3E%3C/svg%3E" />
      <button class="aimd-lightbox-close" type="button" aria-label="关闭">×</button>
    `;
    document.body.append(lightbox);
  });
  await expect(page.locator("[data-lightbox='true']")).toBeVisible();
  await expectInsideViewport(page, "[data-lightbox='true']");
}

async function showDebugConsole(page: Page) {
  await page.evaluate(() => console.error("high-end visual verification error"));
  await expect(page.locator("#debug-indicator")).toBeVisible();
  await page.locator("#debug-indicator").click();
  await expect(page.locator(".debug-modal")).toBeVisible();
  await expectInsideViewport(page, ".debug-modal");
}

test.describe("high-end visual refactor contract", () => {
  test("main shell exposes refined surface, size, motion, and layer tokens", async ({ page }) => {
    await installHighEndMock(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProjectAndDoc(page);

    const metrics = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const panel = getComputedStyle(document.querySelector(".panel")!);
      const workspace = getComputedStyle(document.querySelector(".workspace")!);
      const sidebar = getComputedStyle(document.querySelector(".sidebar")!);
      return {
        surfacePanel: root.getPropertyValue("--surface-panel").trim(),
        controlSize: root.getPropertyValue("--size-control").trim(),
        popoverZ: root.getPropertyValue("--z-popover").trim(),
        motion: root.getPropertyValue("--ease-out-mass").trim(),
        panelRadius: panel.borderRadius,
        panelShadow: panel.boxShadow,
        workspaceBg: workspace.backgroundColor,
        sidebarBg: sidebar.backgroundColor,
      };
    });
    expect(metrics.surfacePanel).toBeTruthy();
    expect(metrics.controlSize).toBe("32px");
    expect(Number(metrics.popoverZ)).toBeGreaterThan(0);
    expect(metrics.motion).toContain("cubic-bezier");
    expect(parseFloat(metrics.panelRadius)).toBeGreaterThanOrEqual(18);
    expect(metrics.panelShadow).not.toBe("none");
    expect(metrics.workspaceBg).not.toBe(metrics.sidebarBg);
  });

  test("core controls meet high-end hit-area thresholds", async ({ page }) => {
    await installHighEndMock(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProjectAndDoc(page, true);
    await page.locator("#more-menu-toggle").click();

    const sizes = await page.evaluate(() => {
      const one = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };
      return {
        saveMenuItem: one("#save"),
        more: one("#more-menu-toggle"),
        tabClose: one(".open-tab-close"),
        inspectorCollapse: one("#doc-panel-collapse"),
        inspectorTab: one(".doc-panel-tab:not([hidden])"),
        projectIcon: one("#workspace-open"),
      };
    });
    expect(sizes.saveMenuItem.height).toBeGreaterThanOrEqual(30);
    expect(sizes.more.width).toBeGreaterThanOrEqual(32);
    expect(sizes.tabClose.width).toBeGreaterThanOrEqual(28);
    expect(sizes.inspectorCollapse.width).toBeGreaterThanOrEqual(28);
    expect(sizes.inspectorTab.height).toBeGreaterThanOrEqual(26);
    expect(sizes.projectIcon.width).toBeGreaterThanOrEqual(30);
  });

  test("medium-width source mode collapses inspector pressure before split panes become unusable", async ({ page }) => {
    await installHighEndMock(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openProjectAndDoc(page);
    await page.locator("#mode-source").click();
    await expect(page.locator("#editor-wrap")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        mode: document.querySelector("#panel")!.getAttribute("data-mode"),
        sourcePressure: document.querySelector("#panel")!.getAttribute("data-source-pressure"),
        workspace: box(".workspace").width,
        inspector: box("#inspector").width,
        editor: box("#editor-wrap").width,
        sourcePane: box(".editor-pane").width,
      };
    });
    expect(metrics.mode).toBe("source");
    expect(metrics.sourcePressure).toBe("true");
    expect(metrics.inspector).toBeLessThanOrEqual(52);
    expect(metrics.workspace).toBeGreaterThanOrEqual(900);
    expect(metrics.sourcePane).toBeGreaterThanOrEqual(430);
    await expectNoHorizontalOverflow(page);
  });

  test("command strip, compact state, tabs, and updater progress use stable refined geometry", async ({ page }) => {
    await installHighEndMock(page);
    await page.setViewportSize({ width: 1180, height: 760 });
    await openProjectAndDoc(page, true);
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill([
      "# A very long document title that must never squeeze the header controls",
      "",
      "<<<<<<< HEAD",
      "Local",
      "=======",
      "Remote",
      ">>>>>>> branch",
    ].join("\n"));
    await expect(page.locator("#doc-state-badges")).toBeHidden();
    await expect(page.locator("#status")).toContainText("Git 冲突");
    await page.locator("#mode-read").click();
    await page.locator("#check-updates").evaluate((el) => {
      document.querySelector<HTMLElement>("#update-panel")!.hidden = false;
      document.querySelector<HTMLElement>("#update-progress-wrap")!.hidden = false;
      document.querySelector<HTMLElement>("#update-progress-fill")!.style.setProperty("--update-progress-scale", "0.42");
      document.querySelector<HTMLElement>("#update-progress-bar")!.classList.remove("is-indeterminate");
      el.removeAttribute("hidden");
    });

    const metrics = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const tab = rect(".open-tab.is-active");
      const find = rect("#find-toggle");
      const mode = rect(".toolbar-group--mode");
      const more = rect("#more-menu-toggle");
      const status = rect("#status-pill");
      const tabStrip = rect("#document-tab-strip");
      const strip = rect("#document-command-strip");
      const surface = rect(".workspace-body");
      const fill = getComputedStyle(document.querySelector("#update-progress-fill")!);
      return {
        tabCommandOverlap: intersects(tab, strip),
        findModeOverlap: intersects(find, mode),
        modeMoreOverlap: intersects(mode, more),
        statusHeight: status.height,
        tabHeight: rect(".open-tab").height,
        tabStripBottom: tabStrip.bottom,
        commandStripTop: strip.top,
        stripBottom: strip.bottom,
        surfaceTop: surface.top,
        progressTransition: fill.transitionProperty,
        progressTransform: fill.transform,
      };
    });
    expect(metrics.tabCommandOverlap).toBe(false);
    expect(metrics.findModeOverlap).toBe(false);
    expect(metrics.modeMoreOverlap).toBe(false);
    expect(metrics.commandStripTop).toBeGreaterThanOrEqual(metrics.tabStripBottom - 1);
    expect(metrics.statusHeight).toBeGreaterThanOrEqual(20);
    expect(metrics.tabHeight).toBeGreaterThanOrEqual(34);
    expect(Math.abs(metrics.surfaceTop - metrics.stripBottom)).toBeLessThanOrEqual(1);
    expect(metrics.progressTransition).toContain("transform");
    expect(metrics.progressTransition).not.toContain("width");
    expect(metrics.progressTransform).not.toBe("none");
    await maybeCapture(page, "1180x760-long-header-updater");
  });

  test("narrow viewport keeps commands reachable and screenshots can be captured", async ({ page }) => {
    await installHighEndMock(page);
    for (const size of [{ width: 760, height: 700 }, { width: 600, height: 700 }]) {
      await page.setViewportSize(size);
      await openProjectAndDoc(page);
      await expect(page.locator("#more-menu-toggle")).toBeVisible();
      await page.locator("#more-menu-toggle").click();
      await expect(page.locator("#more-menu #save")).toBeVisible();
      await page.keyboard.press("Escape");
      await expectNoHorizontalOverflow(page);
      await maybeCapture(page, `${size.width}x${size.height}-document`);
    }
  });

  test("secondary surfaces stay in the same premium system and can be screenshot-reviewed", async ({ page }) => {
    test.skip(!process.env.AIMD_HIGH_END_SCREENSHOT_DIR, "set AIMD_HIGH_END_SCREENSHOT_DIR for visual screenshot review");
    test.setTimeout(180_000);
    await installHighEndMock(page);

    const viewports = [
      { width: 1728, height: 1117 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1180, height: 760 },
      { width: 1024, height: 720 },
      { width: 900, height: 720 },
      { width: 760, height: 700 },
      { width: 600, height: 700 },
    ];
    const documentStates = [
      "document-reading",
      "visual-editing-format-toolbar",
      "source-markdown-mode",
      "asset-inspector",
      "more-menu",
      "web-import-panel",
      "save-format-panel",
      "link-popover",
      "updater-panel",
      "debug-console",
      "lightbox",
    ];

    for (const viewport of viewports) {
      for (const stateName of documentStates) {
        await page.setViewportSize(viewport);
        await openProjectAndDoc(page, stateName === "more-menu");

        if (stateName === "visual-editing-format-toolbar") {
          await page.locator("#mode-edit").click();
          await expect(page.locator("#format-toolbar")).toBeVisible();
        } else if (stateName === "source-markdown-mode") {
          await page.locator("#mode-source").click();
          await expect(page.locator("#editor-wrap")).toBeVisible();
        } else if (stateName === "asset-inspector") {
          if (await page.locator("#sidebar-tab-assets").isVisible()) {
            await page.locator("#sidebar-tab-assets").click();
            await expect(page.locator("#asset-panel")).toBeVisible();
          }
        } else if (stateName === "more-menu") {
          await page.locator("#more-menu-toggle").click();
          await expect(page.locator("#more-menu")).toBeVisible();
          await expectInsideViewport(page, "#more-menu");
        } else if (stateName === "web-import-panel") {
          await showWebClipPanel(page);
        } else if (stateName === "save-format-panel") {
          await showSaveFormatPanel(page);
        } else if (stateName === "link-popover") {
          await showLinkPopover(page);
        } else if (stateName === "updater-panel") {
          await showUpdaterPanel(page);
        } else if (stateName === "debug-console") {
          await showDebugConsole(page);
        } else if (stateName === "lightbox") {
          await showLightbox(page);
        }

        await expectNoHorizontalOverflow(page);
        await maybeCapture(page, `${viewport.width}x${viewport.height}-${stateName}`);
      }
    }

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/settings.html");
      await page.locator(".settings-nav-item[data-section='model']").click();
      await expect(page.locator(".api-key-wrap")).toHaveAttribute("data-state", "masked");
      await expectNoHorizontalOverflow(page);
      await maybeCapture(page, `${viewport.width}x${viewport.height}-settings-model-api-masked`);

      await page.locator("#api-key-reveal").click();
      await expect(page.locator("#api-key")).toHaveAttribute("type", "text");
      await expectNoHorizontalOverflow(page);
      await maybeCapture(page, `${viewport.width}x${viewport.height}-settings-model-api-revealed`);
    }
  });
});
