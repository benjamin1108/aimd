import { test, expect, Page } from "@playwright/test";

type Doc = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: unknown[];
  dirty: boolean;
  format: "aimd" | "markdown";
};

const ROOT = "/mock/workspace";
const DOC_A_PATH = `${ROOT}/Alpha.aimd`;
const DOC_B_PATH = `${ROOT}/Beta.aimd`;

async function installTabsMock(page: Page) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    const docs = new Map<string, Doc>([
      [seed.docAPath, {
        path: seed.docAPath,
        title: "Alpha",
        markdown: "# Alpha\n\nA body",
        html: "<h1>Alpha</h1><p>A body</p>",
        assets: [],
        dirty: false,
        format: "aimd",
      }],
      [seed.docBPath, {
        path: seed.docBPath,
        title: "Beta",
        markdown: "# Beta\n\nB body",
        html: "<h1>Beta</h1><p>B body</p>",
        assets: [],
        dirty: false,
        format: "aimd",
      }],
    ]);
    const runtime = {
      discardChoice: "cancel" as "save" | "discard" | "cancel",
      confirms: [] as string[],
      saves: [] as Array<{ path: string; markdown: string }>,
      registered: [] as string[],
      unregistered: [] as string[],
    };
    const render = async (markdown: string) => {
      if (markdown.includes("slow-stale")) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        return { html: "<h1>Alpha stale render</h1><p>late</p>" };
      }
      const h1 = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled";
      return { html: `<h1>${h1}</h1><p>${markdown.split("\n\n")[1] || ""}</p>` };
    };
    const workspace = () => ({
      root: seed.root,
      tree: {
        id: seed.root,
        name: "workspace",
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
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({ isRepo: false, root: seed.root, clean: true, conflicted: false, files: [] }),
      focus_doc_window: () => null,
      open_aimd: (a) => {
        const doc = docs.get(String(a?.path));
        if (!doc) throw new Error(`missing doc ${String(a?.path)}`);
        return { ...doc };
      },
      render_markdown: (a) => render(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String(a?.markdown ?? "")),
      save_aimd: (a) => {
        const path = String(a?.path);
        const markdown = String(a?.markdown ?? "");
        runtime.saves.push({ path, markdown });
        const current = docs.get(path)!;
        const next = { ...current, markdown, html: `<h1>${markdown.match(/^#\s+(.+)$/m)?.[1] || current.title}</h1>`, dirty: false };
        docs.set(path, next);
        return next;
      },
      register_window_path: (a) => {
        runtime.registered.push(String(a?.path ?? ""));
        return null;
      },
      unregister_window_path: (a) => {
        runtime.unregistered.push(String(a?.path ?? ""));
        return null;
      },
      update_window_path: () => null,
      confirm_discard_changes: (a) => {
        runtime.confirms.push(String(a?.message ?? ""));
        return runtime.discardChoice;
      },
    };
    (window as any).__aimdTabsMock = {
      confirms: () => runtime.confirms,
      saves: () => runtime.saves,
      registered: () => runtime.registered,
      unregistered: () => runtime.unregistered,
      setDiscardChoice: (choice: typeof runtime.discardChoice) => { runtime.discardChoice = choice; },
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
  }, { root: ROOT, docAPath: DOC_A_PATH, docBPath: DOC_B_PATH });
}

async function openWorkspaceAndDocs(page: Page) {
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();
  await page.locator(".workspace-row", { hasText: "Beta.aimd" }).click();
}

test.describe("Open Documents tabs", () => {
  test("opens two project files, reuses an already-open path, and keeps per-tab dirty state", async ({ page }) => {
    await installTabsMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await expect(page.locator("#reader h1")).toHaveText("Beta");

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    await expect(page.locator("#reader h1")).toHaveText("Alpha");

    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await expect(page.locator("#reader h1")).toHaveText("Beta");

    await page.locator(".workspace-row", { hasText: "Beta.aimd" }).click();
    await expect(page.locator(".open-tab")).toHaveCount(2);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Alpha\n\nChanged A");
    await expect(page.locator(".open-tab.is-dirty", { hasText: "Alpha" })).toBeVisible();
    await expect(page.locator(".open-tab.is-dirty", { hasText: "Beta" })).toHaveCount(0);

    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await expect(page.locator("#status")).toHaveText("就绪");

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#save").click();
    await expect(page.locator(".open-tab.is-dirty", { hasText: "Alpha" })).toHaveCount(0);
    const saves = await page.evaluate(() => (window as any).__aimdTabsMock.saves());
    expect(saves.at(-1)).toMatchObject({ path: DOC_A_PATH, markdown: "# Alpha\n\nChanged A" });
  });

  test("dirty active and inactive tab close cancellation leaves the tab set unchanged", async ({ page }) => {
    await installTabsMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Alpha\n\nDirty A");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#close").click();
    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Alpha");

    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-close").click();
    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Beta");
  });

  test("closing the project clears the tree but keeps open document tabs", async ({ page }) => {
    await installTabsMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator("#workspace-close").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#workspace-tree")).toHaveText("打开目录");
    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Beta");
  });

  test("Cmd+W on a dirty document tab shows close confirmation", async ({ page }) => {
    await installTabsMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Alpha\n\nDirty A");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+W" : "Control+W");

    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    const confirms = await page.evaluate(() => (window as any).__aimdTabsMock.confirms());
    expect(confirms.at(-1)).toContain("关闭当前标签页");
  });

  test("stale render result from a previous tab does not repaint the active tab", async ({ page }) => {
    await installTabsMock(page);
    await page.goto("/");
    await openWorkspaceAndDocs(page);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Alpha\n\nslow-stale");
    await page.evaluate(async () => {
      const { renderPreview } = await import("/src/ui/outline.ts");
      (window as any).__staleRender = renderPreview();
    });
    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await page.evaluate(() => (window as any).__staleRender);

    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await expect(page.locator("#reader h1")).toHaveText("Beta");
    await expect(page.locator("#reader h1")).not.toHaveText("Alpha stale render");
  });
});
