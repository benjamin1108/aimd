import { test, expect, Page } from "@playwright/test";

type GitMode = "none" | "repo" | "crowded" | "clean" | "conflict";

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
      if (runtime.mode === "clean") {
        return {
          isRepo: true,
          root,
          branch: "main",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          clean: true,
          conflicted: false,
          files: [],
        };
      }
      const files = [
        { path: "apps/foo.ts", staged: "modified", unstaged: "none", kind: "modified" },
        { path: "docs/draft.md", staged: "none", unstaged: "untracked", kind: "untracked" },
      ];
      if (runtime.mode === "crowded") {
        for (let index = 1; index <= 30; index += 1) {
          files.push({
            path: `docs/archive/2026/release-note-${String(index).padStart(2, "0")}.md`,
            staged: index === 1 ? "modified" : "none",
            unstaged: index === 1 ? "none" : "modified",
            kind: "modified",
          });
        }
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
        files,
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

async function openWorkspaceDocument(page: Page) {
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();
  await expect(page.locator("#reader")).toContainText("Document body");
}

async function expectUsesNavActiveStyle(page: Page, selector: string) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) return false;
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--nav-active-bg)";
    probe.style.color = "var(--nav-active-fg)";
    document.body.append(probe);
    const expected = window.getComputedStyle(probe);
    const actual = window.getComputedStyle(target);
    const matches = actual.backgroundColor === expected.backgroundColor
      && actual.color === expected.color;
    probe.remove();
    return matches;
  }, selector)).toBe(true);
}

test.describe("Git workspace panel", () => {
  test("keeps fixed inspector tabs for a non-Git workspace document", async ({ page }) => {
    await installGitWorkspaceMock(page, "none");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#doc-panel-tabs [role='tab']:not([hidden])")).toHaveText(["大纲", "Git", "资源"]);
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator("#git-panel")).toBeVisible();
    await expect(page.locator("#sidebar-tab-git")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#git-content")).toContainText("当前项目不是 Git 仓库");
  });

  test("shows Git tab for repo while keeping outline selected by default for the active document", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await expect(page.locator("#sidebar-tab-git")).toBeVisible();
    await expect(page.locator("#sidebar-tab-outline")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#outline-panel")).toBeVisible();

    const tabsBeforeGitContent = await page.locator("#sidebar-tab-outline").boundingBox();
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator("#git-panel")).toBeVisible();
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts']")).toBeVisible();
    await expectUsesNavActiveStyle(page, "#sidebar-tab-git");
    await expectUsesNavActiveStyle(page, ".git-file-row[data-path='apps/foo.ts']");
    const tabsAfterGitContent = await page.locator("#sidebar-tab-outline").boundingBox();
    expect(tabsBeforeGitContent && tabsAfterGitContent).toBeTruthy();
    expect(Math.abs(tabsAfterGitContent!.y - tabsBeforeGitContent!.y)).toBeLessThanOrEqual(1);
    await expect(page.locator(".git-branch")).toContainText("main");
    await expect(page.locator(".git-meta")).toContainText("origin/main ↑1 ↓2");
    const branchBox = await page.locator(".git-branch").boundingBox();
    const syncBox = await page.locator(".git-sync-actions").boundingBox();
    expect(branchBox && syncBox).toBeTruthy();
    expect(syncBox!.y).toBeGreaterThanOrEqual(branchBox!.y + branchBox!.height - 1);
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts']")).toBeVisible();
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts'] .git-file-name")).toHaveText("foo.ts");
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts'] .git-file-dir")).toHaveText("apps");
    await expect(page.locator(".git-file-row[data-path='docs/draft.md']")).toContainText("NEW");
    await expect(page.locator(".git-file-row[data-path='docs/draft.md'] .git-mini-btn")).toHaveText(["s", "u"]);
    await expect(page.locator(".git-file-row[data-path='docs/draft.md'] .git-file-status")).toBeVisible();
    const columns = await page.locator(".git-file-row[data-path='docs/draft.md']").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(columns).toContain("64px");
    await expect(page.locator("#git-panel")).not.toContainText("diff --git");
    await expect(page.locator("#git-panel")).not.toContainText("??");

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await expect(page.locator("#doc-toolbar")).toBeVisible();
    await expect(page.locator(".toolbar-group--mode")).toBeHidden();
    await expect(page.locator("#mode-read")).toBeHidden();
    await expect(page.locator("#mode-edit")).toBeHidden();
    await expect(page.locator("#mode-edit")).toBeHidden();
    await expect(page.locator("#find-toggle")).toBeEnabled();
    await expect(page.locator("#doc-actions")).toBeHidden();
    await expect(page.locator("#more-menu-toggle")).toBeHidden();
    await expect(page.locator("#save")).toBeHidden();
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#git-diff-back")).toHaveCount(0);
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");
    await expectUsesNavActiveStyle(page, ".open-tab.is-active");
    await expect(page.locator(".open-tab.is-active")).toContainText("Git");
    await expect(page.locator("#doc-title")).toHaveText("foo.ts");
    await expect(page.locator("#doc-path")).toHaveText("Git Diff · apps");
    await expect(page.locator(".git-diff-scope")).toHaveCount(0);
    await expect(page.locator("#git-diff-rendered-surface")).toHaveCount(0);
    await expect(page.locator("#git-diff-view")).not.toContainText("Markdown 渲染预览");
    await expect(page.locator(".git-diff-line.is-add")).toContainText("+changed line");
    await expect(page.locator(".git-diff-line.is-del")).toContainText("-old line");
    await expect(page.locator(".git-diff-line.is-hunk")).toContainText("@@");
    await expect(page.locator(".git-diff-line.is-meta").first()).toContainText("diff --git");
    const overflows = await page.locator(".git-diff-code").first().evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBeTruthy();

    await page.locator("#find-toggle").click();
    await expect(page.locator("#find-bar")).toBeVisible();
    await expect(page.locator(".find-replace-group")).toBeHidden();
    await page.locator("#find-input").fill("changed line");
    await page.keyboard.press("Enter");
    await expect(page.locator("#find-count")).toHaveText("1/1");
    await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toContain("changed line");

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab", { hasText: "foo.ts" })).toHaveCount(1);
  });

  test("stages, unstages, and commits through fixed commands", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row[data-path='docs/draft.md']").hover();
    await page.locator(".git-file-row[data-path='docs/draft.md']").locator("[data-git-action='stage-file']").click();
    await page.locator(".git-file-row[data-path='apps/foo.ts']").hover();
    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='unstage-file']").click();
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

  test("keeps commit composer reachable when many files changed", async ({ page }) => {
    await installGitWorkspaceMock(page, "crowded");
    await page.setViewportSize({ width: 1400, height: 560 });
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator(".git-file-row")).toHaveCount(32);

    const listScrolls = await page.locator(".git-file-list").evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(listScrolls).toBeTruthy();
    const commitBefore = await page.locator(".git-commit").boundingBox();
    await page.locator(".git-file-list").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator(".git-file-row[data-path='docs/archive/2026/release-note-30.md']")).toBeVisible();
    const commitAfter = await page.locator(".git-commit").boundingBox();
    expect(commitBefore && commitAfter).toBeTruthy();
    expect(Math.abs(commitBefore!.y - commitAfter!.y)).toBeLessThan(1);
    await expect(page.locator("#git-commit-message")).toBeVisible();
  });

  test("disables commit, pull, and push while conflicted", async ({ page }) => {
    await installGitWorkspaceMock(page, "conflict");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator(".git-warning")).toContainText("存在冲突文件");
    await expect(page.locator("[data-git-action='pull']")).toBeDisabled();
    await expect(page.locator("[data-git-action='push']")).toBeDisabled();
    await expect(page.locator("#git-commit-message")).toBeDisabled();
    await expect(page.locator("#git-commit-submit")).toBeDisabled();
  });

  test("opens Git diff as a readonly tab without taking over the document tab", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator(".open-tab.is-active")).toContainText("Git");
    await page.locator(".open-tab.is-active .open-tab-close").click();
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator(".open-tab.is-active")).toContainText("Readme");

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+W" : "Control+W");
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator(".open-tab.is-active")).toContainText("Readme");
    await expect(page.locator(".open-tab", { hasText: "foo.ts" })).toHaveCount(0);

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");
    await page.locator(".open-tab", { hasText: "Readme" }).locator(".open-tab-main").click();
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#git-diff-view")).toBeHidden();

    await page.locator(".git-file-row[data-path='docs/draft.md']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#git-diff-view")).toBeHidden();

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");
    await page.locator(".open-tab.is-active .open-tab-close").click();
    await expect(page.locator(".open-tab", { hasText: "Readme" })).toBeVisible();
  });

  test("keeps an existing Git diff tab open when the file no longer has changes", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");

    await page.evaluate(() => (window as any).__aimdGitMock.setMode("clean"));
    await page.locator("[data-git-action='refresh']").click();
    await expect(page.locator(".open-tab.is-active")).toContainText("foo.ts");
    await expect(page.locator("#git-diff-view")).toContainText("该文件已无待 review 变更");
  });

  test("collapses project and inspector rails while keeping their widths independent", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await expect(page.locator("#workspace-collapse")).toHaveCount(0);

    await page.locator("#project-rail-collapse").click();
    await expect(page.locator(".sidebar")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#workspace-tree")).toBeHidden();
    const projectCollapsed = await page.locator(".sidebar").boundingBox();
    expect(projectCollapsed!.width).toBeLessThanOrEqual(36);

    await page.locator("#project-rail-collapse").click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-collapsed/);

    const projectBefore = await page.locator(".sidebar").boundingBox();
    const projectHandle = await page.locator("#sidebar-hr-resizer").boundingBox();
    expect(projectBefore && projectHandle).toBeTruthy();
    await page.mouse.move(projectHandle!.x + projectHandle!.width / 2, projectHandle!.y + projectHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(projectHandle!.x + projectHandle!.width / 2 + 38, projectHandle!.y + projectHandle!.height / 2);
    await page.mouse.up();
    const projectAfter = await page.locator(".sidebar").boundingBox();
    expect(projectAfter!.width).toBeGreaterThan(projectBefore!.width + 20);

    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).toHaveClass(/is-collapsed/);
    await expect(page.locator("#inspector")).toHaveClass(/is-collapsed/);
    const inspectorCollapsed = await page.locator("#inspector").boundingBox();
    expect(inspectorCollapsed!.width).toBeLessThanOrEqual(36);
    await page.locator("#doc-panel-collapse").click();
    await expect(page.locator("#outline-section")).not.toHaveClass(/is-collapsed/);

    const inspectorBefore = await page.locator("#inspector").boundingBox();
    const inspectorHandle = await page.locator("#inspector-hr-resizer").boundingBox();
    expect(inspectorBefore && inspectorHandle).toBeTruthy();
    await page.mouse.move(inspectorHandle!.x + inspectorHandle!.width / 2, inspectorHandle!.y + inspectorHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(inspectorHandle!.x + inspectorHandle!.width / 2 - 38, inspectorHandle!.y + inspectorHandle!.height / 2);
    await page.mouse.up();
    const inspectorAfter = await page.locator("#inspector").boundingBox();
    expect(inspectorAfter!.width).toBeGreaterThan(inspectorBefore!.width + 20);
  });
});
