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
};

const ROOT = "/mock/inspector";
const ALPHA_PATH = `${ROOT}/Alpha.aimd`;
const BETA_PATH = `${ROOT}/Beta.aimd`;

function markdown(title: string, section: string) {
  return [`# ${title}`, "", `## ${section}`, "", ...Array.from({ length: 160 }, (_, i) => `${title} body ${i + 1}`)].join("\n\n");
}

function render(md: string) {
  return md
    .split(/\n\n+/)
    .map((block) => {
      if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
      if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
      if (block.includes("asset://")) return `<p><img src="${block.match(/\(([^)]+)\)/)?.[1] || ""}" alt=""></p>`;
      return `<p>${block}</p>`;
    })
    .join("");
}

const ALPHA_DOC: Doc = {
  path: ALPHA_PATH,
  title: "Alpha",
  markdown: `${markdown("Alpha", "Alpha Details")}\n\n![alpha](asset://alpha-img)`,
  html: `${render(markdown("Alpha", "Alpha Details"))}<p><img src="asset://alpha-img" alt="alpha"></p>`,
  assets: [{
    id: "alpha-img",
    path: "assets/alpha.png",
    mime: "image/png",
    size: 2048,
    sha256: "alpha",
    role: "content-image",
    url: "/mock/alpha.png",
    localPath: "/mock/alpha.png",
  }],
  dirty: false,
  format: "aimd",
};

const BETA_DOC: Doc = {
  path: BETA_PATH,
  title: "Beta",
  markdown: `${markdown("Beta", "Beta Scope")}\n\n![beta](asset://beta-img)`,
  html: `${render(markdown("Beta", "Beta Scope"))}<p><img src="asset://beta-img" alt="beta"></p>`,
  assets: [{
    id: "beta-img",
    path: "assets/beta.png",
    mime: "image/png",
    size: 3072,
    sha256: "beta",
    role: "content-image",
    url: "/mock/beta.png",
    localPath: "/mock/beta.png",
  }],
  dirty: false,
  format: "aimd",
};

async function installInspectorMock(page: Page) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    const docs = new Map<string, Doc>(seed.docs.map((doc: Doc) => [doc.path, doc]));
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const renderLocal = (md: string) => md
      .split(/\n\n+/)
      .map((block) => {
        if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
        if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
        if (block.includes("asset://")) return `<p><img src="${block.match(/\(([^)]+)\)/)?.[1] || ""}" alt=""></p>`;
        return `<p>${block}</p>`;
      })
      .join("");
    const workspace = () => ({
      root: seed.root,
      tree: {
        id: seed.root,
        name: "inspector",
        path: seed.root,
        kind: "folder",
        children: [...docs.values()].map((doc) => ({
          id: doc.path,
          name: doc.path.split("/").at(-1),
          path: doc.path,
          kind: "document",
          format: "aimd",
        })),
      },
    });
    const healthReport = async (path: string) => {
      await delay(260);
      const alpha = path.includes("Alpha");
      return {
        status: alpha ? "risk" : "offline_ready",
        summary: alpha ? "Alpha health" : "Beta health",
        counts: { errors: 0, warnings: alpha ? 1 : 0, infos: alpha ? 0 : 1 },
        issues: alpha
          ? [{ kind: "local_image", severity: "warning", message: "Alpha local image", path: "alpha.png" }]
          : [{ kind: "info", severity: "info", message: "Beta clean" }],
      };
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => ({ ui: { showAssetPanel: true, debugMode: false } }),
      initial_open_path: () => null,
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({
        isRepo: true,
        root: seed.root,
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        clean: false,
        conflicted: false,
        files: [{ path: "Alpha.aimd", staged: "modified", unstaged: "none", kind: "modified" }],
      }),
      get_git_file_diff: () => ({
        path: "Alpha.aimd",
        stagedDiff: "diff --git a/Alpha.aimd b/Alpha.aimd\n@@ -1 +1 @@\n-# Alpha\n+# Alpha reviewed",
        unstagedDiff: "",
        isBinary: false,
        truncated: false,
      }),
      open_aimd: (a) => ({ ...docs.get(String(a?.path))! }),
      focus_doc_window: () => null,
      register_window_path: () => null,
      unregister_window_path: () => null,
      document_file_fingerprint: (a) => ({ mtimeMs: String(a?.path).includes("Alpha") ? 10 : 20, size: 100 }),
      render_markdown: async (a) => {
        const md = String(a?.markdown ?? "");
        if (md.includes("slow-alpha")) await delay(320);
        return { html: renderLocal(md) };
      },
      render_markdown_standalone: (a) => ({ html: renderLocal(String(a?.markdown ?? "")) }),
      package_local_images: async (a) => {
        await delay(260);
        const path = String(a?.path ?? "");
        const doc = docs.get(path)!;
        const packed = {
          id: "packed-alpha",
          path: "assets/packed-alpha.png",
          mime: "image/png",
          size: 4096,
          sha256: "packed",
          role: "content-image",
          url: "/mock/packed-alpha.png",
          localPath: "/mock/packed-alpha.png",
        };
        const next = {
          ...doc,
          markdown: `${doc.markdown}\n\n![packed](asset://packed-alpha)`,
          html: `${doc.html}<p><img src="asset://packed-alpha" alt="packed"></p>`,
          assets: [...doc.assets, packed],
          dirty: false,
        };
        docs.set(path, next);
        return next;
      },
      package_remote_images: () => null,
      check_document_health: (a) => healthReport(String(a?.path ?? "")),
    };
    window.localStorage.clear();
    (window as any).__aimdInspectorMock = { calls: () => calls };
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
  }, { root: ROOT, docs: [ALPHA_DOC, BETA_DOC] });
}

async function openWorkspaceAndDocs(page: Page) {
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();
  await page.locator(".workspace-row", { hasText: "Beta.aimd" }).click();
}

test.describe("Document inspector ownership", () => {
  test("outline and assets describe the active tab", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await expect(page.locator("#inspector-owner")).toContainText("Beta");
    await expect(page.locator("#outline-list")).toContainText("Beta Scope");
    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator("#inspector-owner")).toContainText("Alpha");
    await expect(page.locator("#outline-list")).toContainText("Alpha Details");
    await expect(page.locator("#outline-list")).not.toContainText("Beta Scope");

    await page.locator("#sidebar-tab-assets").click();
    await expect(page.locator("#asset-panel")).toBeVisible();
    await expect(page.locator("#asset-list")).toContainText("alpha-img");
    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await expect(page.locator("#asset-list")).toContainText("beta-img");
    await expect(page.locator("#asset-list")).not.toContainText("alpha-img");
  });

  test("stale outline render from a previous tab is ignored", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Alpha stale\n\n## slow-alpha");
    await page.evaluate(async () => {
      const { renderPreview } = await import("/src/ui/outline.ts");
      (window as any).__slowOutline = renderPreview();
    });
    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await page.evaluate(() => (window as any).__slowOutline);

    await expect(page.locator("#outline-list")).toContainText("Beta Scope");
    await expect(page.locator("#outline-list")).not.toContainText("Alpha stale");
  });

  test("asset packaging applies to the launching tab after switching away", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    const packageTask = page.evaluate(async () => {
      const { packageLocalImages } = await import("/src/document/health.ts");
      await packageLocalImages({ refreshHealth: false });
    });
    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await packageTask;

    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await page.locator("#sidebar-tab-assets").click();
    await expect(page.locator("#asset-list")).not.toContainText("packed-alpha");
    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator("#asset-list")).toContainText("packed-alpha");
  });

  test("health inspector is not exposed as a document tab", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.evaluate(async () => {
      const { runHealthCheck } = await import("/src/document/health.ts");
      await runHealthCheck();
    });

    await expect(page.locator("#sidebar-tab-health")).toBeHidden();
    await expect(page.locator("#health-panel")).toBeHidden();
    await expect(page.locator("#sidebar-tab-outline")).toHaveAttribute("aria-selected", "true");
  });

  test("Git review stays project-scoped and returns to the active document mode", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row[data-path='Alpha.aimd']").locator("[data-git-action='select']").click();

    await expect(page.locator("#git-diff-view")).toBeVisible();
    await expect(page.locator(".git-diff-scope")).toHaveCount(0);
    await expect(page.locator("#git-diff-back")).toHaveCount(0);
    await expect(page.locator("#doc-title")).toHaveText("Alpha.aimd");
    await expect(page.locator(".open-tab.is-active")).toContainText("Git Diff");
    await expect(page.locator(".open-tab.is-active")).toContainText("Alpha");
    await expect(page.locator(".git-diff-line.is-add")).toContainText("+# Alpha reviewed");
    await expect(page.locator("#sidebar-tab-assets")).toBeHidden();
    await page.locator("#sidebar-tab-outline").click();
    await expect(page.locator("#outline-list")).toContainText("Git Diff 没有文档大纲");

    await page.locator(".open-tab", { hasText: "Alpha" }).first().locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    await expect(page.locator("#mode-read")).toHaveClass(/active/);
  });

  test("closing the project keeps the inspector on the active document", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator("#workspace-close").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#inspector-owner")).toContainText("Beta");
    await expect(page.locator("#outline-list")).toContainText("Beta Scope");
    await expect(page.locator("#sidebar-tab-git")).toBeHidden();
  });

  test("narrow viewport can collapse the inspector without covering tabs or content", async ({ page }) => {
    await installInspectorMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);
    await page.setViewportSize({ width: 800, height: 720 });

    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#open-tabs")).toBeVisible();
    await expect(page.locator("#reader")).toBeVisible();
  });
});
