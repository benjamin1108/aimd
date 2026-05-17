import { test, expect, Page } from "@playwright/test";

type TreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "document";
  format?: "aimd" | "markdown";
  children?: TreeNode[];
};

async function installWorkspaceMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/workspace";
    const docs = new Map<string, { title: string; markdown: string; format: "aimd" | "markdown" }>([
      [`${root}/Report.aimd`, { title: "Report", markdown: "# Report\n\nAlpha", format: "aimd" }],
    ]);
    const folders = new Set<string>([root]);
    const runtime = {
      saveMarkdownCalls: [] as Array<Record<string, unknown>>,
      openWindowPaths: [] as Array<string | null>,
    };
    const basename = (path: string) => path.split("/").filter(Boolean).at(-1) || path;
    const dirname = (path: string) => path.split("/").slice(0, -1).join("/") || "/";
    const join = (parent: string, name: string) => `${parent.replace(/\/+$/, "")}/${name}`;
    const formatFor = (path: string): "aimd" | "markdown" | undefined => {
      const lower = path.toLowerCase();
      if (lower.endsWith(".aimd")) return "aimd";
      if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) return "markdown";
      return undefined;
    };
    const render = (markdown: string) => ({
      html: markdown
        .replace(/^# (.*)$/m, "<h1>$1</h1>")
        .replace(/\n\n([^#\n].*)/g, "<p>$1</p>"),
    });
    const buildTree = (path: string): TreeNode => {
      const folderChildren = [...folders]
        .filter((item) => dirname(item) === path && item !== path)
        .map((item) => buildTree(item));
      const docChildren = [...docs.keys()]
        .filter((item) => dirname(item) === path)
        .map((item) => ({
          id: item,
          name: basename(item),
          path: item,
          kind: "document" as const,
          format: formatFor(item),
          modifiedAt: "2026-05-14T00:00:00Z",
        }));
      return {
        id: path,
        name: basename(path),
        path,
        kind: "folder",
        children: [...folderChildren, ...docChildren].sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
        modifiedAt: "2026-05-14T00:00:00Z",
      };
    };
    const workspace = () => ({ root, tree: buildTree(root) });
    const docDto = (path: string) => {
      const doc = docs.get(path);
      if (!doc) throw new Error(`missing document: ${path}`);
      return {
        path,
        title: doc.title,
        markdown: doc.markdown,
        html: render(doc.markdown).html,
        assets: [],
        dirty: false,
        format: doc.format,
      };
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({
        isRepo: false,
        root,
        clean: true,
        conflicted: false,
        files: [],
      }),
      open_aimd: (a) => docDto(String(a?.path)),
      convert_md_to_draft: (a) => {
        const doc = docs.get(String(a?.markdownPath));
        if (!doc) throw new Error("missing markdown");
        return { title: doc.title, markdown: doc.markdown, html: render(doc.markdown).html };
      },
      render_markdown: (a) => render(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String(a?.markdown ?? "")),
      focus_doc_window: () => null,
      register_window_path: () => null,
      update_window_path: () => null,
      unregister_current_window_path: () => null,
      confirm_discard_changes: () => "discard",
      create_workspace_folder: (a) => {
        folders.add(join(String(a?.parent), String(a?.name)));
        return workspace();
      },
      create_workspace_file: (a) => {
        const path = join(String(a?.parent), String(a?.name));
        const title = basename(path).replace(/\.(aimd|md|markdown|mdx)$/i, "");
        docs.set(path, {
          title,
          markdown: `# ${title}\n\n`,
          format: String(a?.kind) === "markdown" ? "markdown" : "aimd",
        });
        return workspace();
      },
      rename_workspace_entry: (a) => {
        const from = String(a?.path);
        const to = join(dirname(from), String(a?.newName));
        if (docs.has(from)) {
          const doc = docs.get(from)!;
          docs.delete(from);
          docs.set(to, { ...doc, title: basename(to).replace(/\.(aimd|md|markdown|mdx)$/i, "") });
        } else if (folders.has(from)) {
          folders.delete(from);
          folders.add(to);
        }
        return workspace();
      },
      move_workspace_entry: (a) => {
        const from = String(a?.from);
        const to = join(String(a?.toParent), basename(from));
        if (docs.has(from)) {
          const doc = docs.get(from)!;
          docs.delete(from);
          docs.set(to, doc);
        }
        return workspace();
      },
      trash_workspace_entry: (a) => {
        docs.delete(String(a?.path));
        folders.delete(String(a?.path));
        return workspace();
      },
      save_markdown: (a) => {
        runtime.saveMarkdownCalls.push({ ...a });
        const path = String(a?.path);
        const doc = docs.get(path);
        if (doc) docs.set(path, { ...doc, markdown: String(a?.markdown ?? "") });
        return null;
      },
      open_in_new_window: (a) => {
        runtime.openWindowPaths.push((a?.path ?? null) as string | null);
        return null;
      },
    };
    (window as any).__aimdWorkspaceMock = {
      saveMarkdownCalls: () => runtime.saveMarkdownCalls,
      openWindowPaths: () => runtime.openWindowPaths,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI__ = { core: { invoke: (cmd: string, args?: Args) => handlers[cmd]?.(args) } };
  });
}

test.describe("Workspace directory management", () => {
  test("closes the current directory from the workspace toolbar", async ({ page }) => {
    await installWorkspaceMock(page);
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator(".workspace-row", { hasText: "Report.aimd" })).toBeVisible();

    await expect(page.locator("#workspace-close")).toBeEnabled();
    await page.locator("#workspace-close").click();

    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator(".workspace-row", { hasText: "Report.aimd" })).toHaveCount(0);
    await expect(page.locator("#workspace-tree")).toHaveText("打开目录");
    await expect(page.locator("#workspace-refresh")).toBeDisabled();
    await expect(page.locator("#workspace-new-doc")).toBeDisabled();
    await expect(page.locator("#project-create-menu")).toBeHidden();
    await expect(page.locator("#workspace-close")).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("aimd.desktop.workspace.root"))).toBeNull();
  });

  test("opens a directory, creates markdown in a folder, renames, saves, and deletes it", async ({ page }) => {
    await installWorkspaceMock(page);
    await page.goto("/");

    await expect(page.locator("#empty-open-workspace")).toContainText("打开项目目录");
    await page.locator("#empty-open-workspace").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#workspace-count")).toHaveCount(0);
    await expect(page.locator(".workspace-row", { hasText: "Report.aimd" })).toBeVisible();

    await page.locator(".workspace-row", { hasText: "Report.aimd" }).click();
    await expect(page.locator("#doc-title")).toHaveText("Report");
    await expect(page.locator(".workspace-row.is-active", { hasText: "Report.aimd" })).toBeVisible();
    await expect(page.locator(".outline-item")).toHaveCount(1);
    await expect(page.locator(".outline-item.is-active")).toHaveCount(0);
    await page.locator(".outline-item").first().click();
    await expect(page.locator(".outline-item").first()).toHaveClass(/is-active/);
    await expect.poll(() => page.evaluate(() => {
      const outline = document.querySelector(".outline-item.is-active");
      const workspace = document.querySelector(".workspace-row.is-active");
      if (!outline || !workspace) return false;
      const outlineStyle = window.getComputedStyle(outline);
      const workspaceStyle = window.getComputedStyle(workspace);
      return outlineStyle.backgroundColor === workspaceStyle.backgroundColor
        && outlineStyle.color === workspaceStyle.color;
    })).toBe(true);

    await page.locator("#workspace-new-doc").click();
    await page.locator("#project-new-folder").click();
    await page.locator("#workspace-prompt-input").fill("Notes");
    await page.locator(".link-popover [data-action='confirm']").click();
    await expect(page.locator(".workspace-row", { hasText: "Notes" })).toBeVisible();

    await page.locator("#workspace-new-doc").click();
    await page.locator("#project-new-markdown").click();
    await page.locator("#workspace-prompt-input").fill("Daily.md");
    await page.locator(".link-popover [data-action='confirm']").click();
    await expect(page.locator("#doc-title")).toHaveText("Daily");
    await expect(page.locator(".workspace-row.is-active", { hasText: "Daily.md" })).toBeVisible();

    await page.locator(".workspace-row", { hasText: "Daily.md" }).click({ button: "right" });
    await page.locator(".file-ctx-item", { hasText: "重命名" }).click();
    await page.locator("#workspace-prompt-input").fill("Daily Renamed.md");
    await page.locator(".link-popover [data-action='confirm']").click();
    await expect(page.locator("#doc-title")).toHaveText("Daily Renamed");

    await page.locator("#mode-edit").click();
    await page.locator("#markdown").fill("# Daily Renamed\n\nSaved after rename");
    await page.locator("#more-menu-toggle").click();
    await page.locator("#save").click();
    const saveCalls = await page.evaluate(() => (window as any).__aimdWorkspaceMock.saveMarkdownCalls());
    expect(saveCalls.at(-1)).toMatchObject({
      path: "/mock/workspace/Notes/Daily Renamed.md",
      markdown: "# Daily Renamed\n\nSaved after rename",
    });

    await page.locator(".workspace-row", { hasText: "Daily Renamed.md" }).click({ button: "right" });
    await page.locator(".file-ctx-item", { hasText: "删除" }).click();
    await page.locator(".link-popover [data-action='confirm']").click();
    await expect(page.locator(".workspace-row", { hasText: "Daily Renamed.md" })).toHaveCount(0);
    await expect(page.locator(".open-tab", { hasText: "Daily Renamed" })).toHaveCount(0);
    await expect(page.locator(".open-tab", { hasText: "Report" })).toBeVisible();
    await expect(page.locator("#doc-title")).toHaveText("Report");
  });
});
