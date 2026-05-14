import { test, expect, Page } from "@playwright/test";

type GitMode = "none" | "repo" | "conflict";

async function installGitWorkspaceMock(page: Page, initialMode: GitMode) {
  await page.addInitScript((mode: GitMode) => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/repo";
    const runtime = {
      mode,
      calls: [] as Array<{ cmd: string; args?: Args }>,
    };
    const workspace = () => ({
      root,
      tree: {
        id: root,
        name: "repo",
        path: root,
        kind: "folder",
        children: [{
          id: `${root}/Readme.aimd`,
          name: "Readme.aimd",
          path: `${root}/Readme.aimd`,
          kind: "document",
          format: "aimd",
          modifiedAt: "2026-05-14T00:00:00Z",
        }],
        modifiedAt: "2026-05-14T00:00:00Z",
      },
    });
    const render = (markdown: string) => ({
      html: markdown
        .replace(/^# (.*)$/m, "<h1>$1</h1>")
        .replace(/\n\n([^#\n].*)/g, "<p>$1</p>"),
    });
    const status = () => {
      if (runtime.mode === "none") {
        return {
          isRepo: false,
          root,
          clean: true,
          conflicted: false,
          files: [],
        };
      }
      if (runtime.mode === "conflict") {
        return {
          isRepo: true,
          root,
          branch: "main",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          clean: false,
          conflicted: true,
          files: [{
            path: "docs/conflict.md",
            staged: "conflicted",
            unstaged: "conflicted",
            kind: "conflicted",
          }],
        };
      }
      return {
        isRepo: true,
        root,
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
        clean: false,
        conflicted: false,
        files: [
          { path: "apps/foo.ts", staged: "modified", unstaged: "none", kind: "modified" },
          { path: "docs/draft.md", staged: "none", unstaged: "untracked", kind: "untracked" },
        ],
      };
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => ({ ui: { showAssetPanel: false } }),
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      open_aimd: () => ({
        path: `${root}/Readme.aimd`,
        title: "Readme",
        markdown: "# Readme\n\nDocument body",
        html: "<h1>Readme</h1><p>Document body</p>",
        assets: [],
        dirty: false,
        format: "aimd",
      }),
      get_git_repo_status: () => status(),
      get_git_file_diff: (a) => ({
        path: String(a?.path),
        stagedDiff: String(a?.path).includes("foo")
          ? "diff --git a/apps/foo.ts b/apps/foo.ts\nindex abc..def 100644\n--- a/apps/foo.ts\n+++ b/apps/foo.ts\n@@ -1,2 +1,2 @@\n-old line\n+changed line with a very very very very very very very very very very very very very very very very very very very very very very very very very very very very long value that must scroll horizontally inside the viewer instead of stretching the layout"
          : "",
        unstagedDiff: String(a?.path).includes("draft")
          ? "diff --git a/docs/draft.md b/docs/draft.md\n@@ -0,0 +1 @@\n+new file"
          : "",
        isBinary: false,
        truncated: false,
      }),
      git_stage_file: () => null,
      git_unstage_file: () => null,
      git_stage_all: () => null,
      git_unstage_all: () => null,
      git_commit: () => {
        runtime.mode = "none";
        return status();
      },
      git_pull: () => status(),
      git_push: () => status(),
      render_markdown: (a) => render(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String(a?.markdown ?? "")),
    };
    window.localStorage.clear();
    (window as any).__aimdGitMock = {
      calls: () => runtime.calls,
      setMode: (next: GitMode) => { runtime.mode = next; },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        runtime.calls.push({ cmd, args });
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI__ = { core: { invoke: (cmd: string, args?: Args) => handlers[cmd]?.(args) } };
  }, initialMode);
}

test.describe("Git workspace panel", () => {
  test("does not show Git tab for a non-Git workspace", async ({ page }) => {
    await installGitWorkspaceMock(page, "none");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("repo");
    await expect(page.locator("#sidebar-tab-git")).toBeHidden();
  });

  test("shows Git tab for repo while keeping outline selected by default", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await expect(page.locator("#sidebar-tab-git")).toBeVisible();
    await expect(page.locator("#sidebar-tab-outline")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#outline-panel")).toBeVisible();

    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator("#git-panel")).toBeVisible();
    await expect(page.locator(".git-branch")).toContainText("main");
    await expect(page.locator(".git-meta")).toContainText("origin/main ↑1 ↓2");
    await expect(page.locator(".git-file-row", { hasText: "apps/foo.ts" })).toBeVisible();
    await expect(page.locator(".git-file-row", { hasText: "docs/draft.md" })).toContainText("NEW");
    await expect(page.locator("#git-panel")).not.toContainText("diff --git");
    await expect(page.locator("#git-panel")).not.toContainText("??");

    await page.locator(".git-file-row", { hasText: "apps/foo.ts" }).locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await expect(page.locator("#doc-toolbar")).toBeHidden();
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#git-diff-back")).toBeDisabled();
    await expect(page.locator(".git-diff-title")).toContainText("apps/foo.ts");
    await expect(page.locator(".git-diff-line.is-add")).toContainText("+changed line");
    await expect(page.locator(".git-diff-line.is-del")).toContainText("-old line");
    await expect(page.locator(".git-diff-line.is-hunk")).toContainText("@@");
    await expect(page.locator(".git-diff-line.is-meta").first()).toContainText("diff --git");
    const overflows = await page.locator(".git-diff-code").first().evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBeTruthy();
  });

  test("stages, unstages, and commits through fixed commands", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row", { hasText: "docs/draft.md" }).locator("[data-git-action='stage-file']").click();
    await page.locator(".git-file-row", { hasText: "apps/foo.ts" }).locator("[data-git-action='unstage-file']").click();
    await expect(page.locator("#git-commit-submit")).toBeDisabled();
    await page.locator("#git-commit-message").fill("Update docs");
    await expect(page.locator("#git-commit-submit")).toBeEnabled();
    await page.locator("#git-commit-submit").click();

    const calls = await page.evaluate(() => (window as any).__aimdGitMock.calls());
    expect(calls.some((call: any) => call.cmd === "git_stage_file" && call.args.path === "docs/draft.md")).toBeTruthy();
    expect(calls.some((call: any) => call.cmd === "git_unstage_file" && call.args.path === "apps/foo.ts")).toBeTruthy();
    expect(calls.some((call: any) => call.cmd === "git_commit" && call.args.message === "Update docs")).toBeTruthy();
    expect(calls.filter((call: any) => call.cmd === "get_git_repo_status").length).toBeGreaterThan(1);
  });

  test("disables commit, pull, and push while conflicted", async ({ page }) => {
    await installGitWorkspaceMock(page, "conflict");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator(".git-warning")).toContainText("存在冲突文件");
    await expect(page.locator("[data-git-action='pull']")).toBeDisabled();
    await expect(page.locator("[data-git-action='push']")).toBeDisabled();
    await expect(page.locator("#git-commit-message")).toBeDisabled();
    await expect(page.locator("#git-commit-submit")).toBeDisabled();
  });

  test("returns from diff to document and document tree clicks restore document view", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();
    await expect(page.locator("#reader")).toContainText("Document body");
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row", { hasText: "apps/foo.ts" }).locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await page.locator("#git-diff-back").click();
    await expect(page.locator("#reader")).toBeVisible();

    await page.locator(".git-file-row", { hasText: "docs/draft.md" }).locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#git-diff-view")).toBeHidden();
  });

  test("collapses sidebar sections and resizes workspace versus doc panel", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await page.locator("#empty-open-workspace").click();
    await page.locator("#workspace-collapse").click();
    await expect(page.locator("#workspace-section")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#workspace-tree")).toBeHidden();
    let handle = await page.locator("#sb-resizer-workspace-doc").boundingBox();
    expect(handle).toBeTruthy();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 36);
    await page.mouse.up();
    await expect(page.locator("#workspace-section")).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("#workspace-tree")).toBeVisible();

    await page.locator("#workspace-collapse").click();
    await page.locator("#workspace-collapse").click();
    await expect(page.locator("#workspace-section")).not.toHaveClass(/is-collapsed/);

    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).toHaveClass(/is-collapsed/);
    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).not.toHaveClass(/is-collapsed/);

    const before = await page.locator("#workspace-section").boundingBox();
    handle = await page.locator("#sb-resizer-workspace-doc").boundingBox();
    expect(before && handle).toBeTruthy();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 42);
    await page.mouse.up();
    const after = await page.locator("#workspace-section").boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height + 20);
  });
});
