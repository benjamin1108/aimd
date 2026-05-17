import { test, expect, Page } from "@playwright/test";

type GitMode = "none" | "repo" | "crowded" | "clean" | "conflict";

async function installGitWorkspaceMock(page: Page, initialMode: GitMode) {
  await page.addInitScript((mode: GitMode) => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/repo";
    const runtime = {
      mode,
      driverWarning: false,
      calls: [] as Array<{ cmd: string; args?: Args }>,
    };
    const withDriver = (value: Record<string, any>) => ({
      aimdDriverConfigured: !runtime.driverWarning,
      gitattributesConfigured: !runtime.driverWarning,
      aimdDriverWarning: runtime.driverWarning
        ? ".aimd Git diff 尚未启用，设置页启用 Git 集成后才能看到语义 diff"
        : undefined,
      ...value,
    });
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
        return withDriver({
          isRepo: false,
          root,
          clean: true,
          conflicted: false,
          files: [],
        });
      }
      if (runtime.mode === "conflict") {
        return withDriver({
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
        });
      }
      if (runtime.mode === "clean") {
        return withDriver({
          isRepo: true,
          root,
          branch: "main",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          clean: true,
          conflicted: false,
          files: [],
        });
      }
      const files = [
        { path: "apps/foo.ts", staged: "modified", unstaged: "none", kind: "modified" },
        { path: "docs/draft.md", staged: "none", unstaged: "untracked", kind: "untracked" },
      ];
      if (runtime.mode === "repo") {
        files.push(
          { path: "assets/logo.png", staged: "modified", unstaged: "none", kind: "modified" },
          { path: "docs/empty.md", staged: "modified", unstaged: "none", kind: "modified" },
          { path: "docs/large.md", staged: "modified", unstaged: "none", kind: "modified" },
        );
      }
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
      return withDriver({
        isRepo: true,
        root,
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
        clean: false,
        conflicted: false,
        files,
      });
    };
    const longChangedLine = "changed line with a very very very very very very very very very very very very very very very very very very very very very very very very very very very very long value that must scroll horizontally inside the viewer instead of stretching the layout";
    const longOldLine = "old line with a very very very very very very very very very very very very very very very very very very very very very very long value that must not push the new column out of view";
    const stagedFooDiff = [
      "diff --git a/apps/foo.ts b/apps/foo.ts",
      "index abc..def 100644",
      "--- a/apps/foo.ts",
      "+++ b/apps/foo.ts",
      "@@ -1,5 +1,5 @@",
      " context line",
      "-old only line",
      " unchanged anchor",
      "+new only line",
      `-${longOldLine}`,
      `+${longChangedLine}`,
      " tail line",
    ].join("\n");
    const unstagedDraftDiff = [
      "diff --git a/docs/draft.md b/docs/draft.md",
      "@@ -0,0 +1 @@",
      "+new file",
    ].join("\n");
    const truncatedLargeDiff = [
      "diff --git a/docs/large.md b/docs/large.md",
      "@@ -1 +1 @@",
      "-old large",
      "+new large",
    ].join("\n");
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
        stagedDiff: String(a?.path).includes("foo") ? stagedFooDiff : "",
        unstagedDiff: String(a?.path).includes("draft") ? unstagedDraftDiff : "",
        ...(String(a?.path).includes("large") ? { stagedDiff: truncatedLargeDiff, truncated: true } : {}),
        isBinary: String(a?.path).includes("logo.png"),
        truncated: String(a?.path).includes("large"),
      }),
      git_stage_file: () => null,
      git_unstage_file: () => null,
      confirm_git_discard_operation: () => true,
      git_discard_file: () => null,
      git_discard_all: () => status(),
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
      setDriverWarning: (next: boolean) => { runtime.driverWarning = next; },
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
    window.confirm = (message?: string) => {
      runtime.calls.push({ cmd: "window_confirm", args: { message } });
      return false;
    };
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
    await expect(page.locator("#git-diff-view-mode-cluster")).toBeHidden();
    await expect(page.locator("#git-diff-wrap-toggle")).toBeHidden();
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
    await expect(page.locator("[data-git-action='pull']")).toBeDisabled();
    await expect(page.locator(".git-tooltip-host:has([data-git-action='pull'])")).toHaveAttribute("data-tip", "需先提交");
    const pullBox = await page.locator("[data-git-action='pull']").boundingBox();
    const pushBox = await page.locator("[data-git-action='push']").boundingBox();
    expect(pullBox && pushBox).toBeTruthy();
    expect(pushBox!.x - (pullBox!.x + pullBox!.width)).toBeLessThanOrEqual(8);
    const branchBox = await page.locator(".git-branch").boundingBox();
    const syncBox = await page.locator(".git-sync-actions").boundingBox();
    expect(branchBox && syncBox).toBeTruthy();
    expect(syncBox!.y).toBeGreaterThanOrEqual(branchBox!.y + branchBox!.height - 1);
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts']")).toBeVisible();
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts'] .git-file-name")).toHaveText("foo.ts");
    await expect(page.locator(".git-file-row[data-path='apps/foo.ts'] .git-file-dir")).toHaveText("apps");
    await expect(page.locator(".git-file-row[data-path='docs/draft.md']")).toContainText("NEW");
    await expect(page.locator(".git-file-row[data-path='docs/draft.md'] .git-mini-btn")).toHaveCount(2);
    await expect(page.locator(".git-file-row[data-path='docs/draft.md'] .git-file-status")).toBeVisible();
    const columns = await page.locator(".git-file-row[data-path='docs/draft.md']").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(columns).toContain("64px");
    await expect(page.locator("[data-git-action='discard-all']")).toBeEnabled();
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
    await expect(page.locator("#git-diff-view-mode-cluster")).toBeVisible();
    await expect(page.locator("#git-diff-view-mode-toggle")).toBeEnabled();
    await expect(page.locator("#git-diff-view-mode-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#git-diff-view-mode-toggle")).toHaveAttribute("data-tooltip", "当前：统一 Diff");
    await expect(page.locator("#git-diff-wrap-toggle")).toBeEnabled();
    await expect(page.locator("#git-diff-wrap-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#git-diff-wrap-toggle")).toHaveAttribute("data-tooltip", "自动换行：关闭");
    const viewModeBox = await page.locator("#git-diff-view-mode-toggle").boundingBox();
    const wrapBox = await page.locator("#git-diff-wrap-toggle").boundingBox();
    const findBox = await page.locator("#find-toggle").boundingBox();
    expect(viewModeBox && wrapBox && findBox).toBeTruthy();
    expect(viewModeBox!.x + viewModeBox!.width).toBeLessThanOrEqual(wrapBox!.x + 2);
    expect(wrapBox!.x + wrapBox!.width).toBeLessThanOrEqual(findBox!.x + 2);
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
    await expect(page.locator(".git-diff-code")).toBeVisible();
    await expect(page.locator(".git-diff-line.is-add").filter({ hasText: "+changed line" })).toBeVisible();
    await expect(page.locator(".git-diff-line.is-del").filter({ hasText: "-old line" })).toBeVisible();
    await expect(page.locator(".git-diff-line.is-hunk")).toContainText("@@");
    await expect(page.locator(".git-diff-line.is-meta").first()).toContainText("diff --git");
    const overflows = await page.locator(".git-diff-code").first().evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBeTruthy();

    const diffCallsBeforeToggle = await page.evaluate(() => (window as any).__aimdGitMock.calls()
      .filter((call: any) => call.cmd === "get_git_file_diff").length);
    await page.locator("#git-diff-view-mode-toggle").click();
    await expect(page.locator("#git-diff-scroll")).toHaveAttribute("data-diff-view-mode", "side-by-side");
    await expect(page.locator("#git-diff-view-mode-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#git-diff-view-mode-toggle")).toHaveAttribute("data-tooltip", "当前：左右对比");
    await expect(page.locator(".git-diff-split")).toBeVisible();
    await expect(page.locator(".git-diff-code")).toHaveCount(0);
    await expect(page.locator(".git-diff-split-row.is-meta")).toHaveCount(0);
    await expect(page.locator(".git-diff-split-row.is-hunk")).toHaveCount(0);
    await expect(page.locator(".git-diff-split")).not.toContainText("@@");
    const contextRow = page.locator(".git-diff-split-row.is-context", { hasText: "context line" });
    await expect(contextRow.locator(".git-diff-split-cell--old")).toContainText("context line");
    await expect(contextRow.locator(".git-diff-split-cell--new")).toContainText("context line");
    await expect(contextRow.locator(".git-diff-split-cell--old .git-diff-gutter")).toHaveText("1");
    await expect(contextRow.locator(".git-diff-split-cell--new .git-diff-gutter")).toHaveText("1");
    const splitGeometry = await page.locator(".git-diff-split").first().evaluate((split) => {
      const splitRect = split.getBoundingClientRect();
      const scroller = split.closest<HTMLElement>("#git-diff-scroll");
      const headings = Array.from(split.querySelectorAll<HTMLElement>(".git-diff-split-heading"))
        .map((heading) => heading.getBoundingClientRect());
      const changeRow = split.querySelector<HTMLElement>(".git-diff-split-row.is-change");
      const oldCell = changeRow?.querySelector<HTMLElement>(".git-diff-split-cell--old");
      const newCell = changeRow?.querySelector<HTMLElement>(".git-diff-split-cell--new");
      const oldText = oldCell?.querySelector<HTMLElement>(".git-diff-text");
      const newText = newCell?.querySelector<HTMLElement>(".git-diff-text");
      const oldViewport = oldCell?.querySelector<HTMLElement>(".git-diff-text-viewport");
      const newViewport = newCell?.querySelector<HTMLElement>(".git-diff-text-viewport");
      const oldXScroll = split.querySelector<HTMLElement>("[data-diff-x-scroll='old']");
      const newXScroll = split.querySelector<HTMLElement>("[data-diff-x-scroll='new']");
      const scrollbars = split.querySelector<HTMLElement>(".git-diff-split-scrollbars");
      const oldRect = oldCell?.getBoundingClientRect();
      const newRect = newCell?.getBoundingClientRect();
      return {
        splitLeft: splitRect.left,
        splitRight: splitRect.right,
        splitWidth: splitRect.width,
        scrollerWidth: scroller?.clientWidth || 0,
        scrollerPaddingTop: scroller ? getComputedStyle(scroller).paddingTop : "",
        splitBorderRadius: getComputedStyle(split).borderRadius,
        oldHeadingWidth: headings[0]?.width || 0,
        newHeadingLeft: headings[1]?.left || 0,
        newHeadingWidth: headings[1]?.width || 0,
        rowHeight: changeRow?.getBoundingClientRect().height || 0,
        rowLineHeight: oldText ? getComputedStyle(oldText).lineHeight : "",
        oldCellWidth: oldRect?.width || 0,
        oldCellBorderTopWidth: oldCell ? getComputedStyle(oldCell).borderTopWidth : "",
        newCellLeft: newRect?.left || 0,
        newCellWidth: newRect?.width || 0,
        rowDisplay: changeRow ? getComputedStyle(changeRow).display : "",
        rowGrid: changeRow ? getComputedStyle(changeRow).gridTemplateColumns : "",
        cellWhiteSpace: oldCell ? getComputedStyle(oldCell).whiteSpace : "",
        oldTextWhiteSpace: oldText ? getComputedStyle(oldText).whiteSpace : "",
        newTextWhiteSpace: newText ? getComputedStyle(newText).whiteSpace : "",
        oldTextScrolls: oldViewport ? oldViewport.scrollWidth > oldViewport.clientWidth : false,
        newTextScrolls: newViewport ? newViewport.scrollWidth > newViewport.clientWidth : false,
        oldXScrolls: oldXScroll ? oldXScroll.scrollWidth > oldXScroll.clientWidth : false,
        newXScrolls: newXScroll ? newXScroll.scrollWidth > newXScroll.clientWidth : false,
        scrollbarsPosition: scrollbars ? getComputedStyle(scrollbars).position : "",
      };
    });
    expect(splitGeometry.scrollerPaddingTop).toBe("0px");
    expect(splitGeometry.splitBorderRadius).toBe("0px");
    expect(splitGeometry.splitWidth).toBeGreaterThanOrEqual(splitGeometry.scrollerWidth - 2);
    expect(splitGeometry.newHeadingLeft).toBeLessThan(splitGeometry.splitRight - 80);
    expect(Math.abs(splitGeometry.oldHeadingWidth - splitGeometry.newHeadingWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(splitGeometry.oldCellWidth - splitGeometry.newCellWidth)).toBeLessThanOrEqual(2);
    expect(splitGeometry.newCellLeft).toBeGreaterThan(splitGeometry.splitLeft + 200);
    expect(splitGeometry.oldCellBorderTopWidth).toBe("0px");
    expect(splitGeometry.cellWhiteSpace).toBe("normal");
    expect(splitGeometry.oldTextWhiteSpace).toBe("pre");
    expect(splitGeometry.newTextWhiteSpace).toBe("pre");
    expect(splitGeometry.rowLineHeight).toBe("18px");
    expect(splitGeometry.rowHeight).toBeLessThanOrEqual(20);
    expect(splitGeometry.oldTextScrolls || splitGeometry.newTextScrolls).toBeTruthy();
    expect(splitGeometry.oldXScrolls && splitGeometry.newXScrolls).toBeTruthy();
    expect(splitGeometry.scrollbarsPosition).toBe("sticky");
    const deletedOnly = page.locator(".git-diff-split-row.is-del", { hasText: "old only line" });
    await expect(deletedOnly.locator(".git-diff-split-cell--old")).toContainText("old only line");
    await expect(deletedOnly.locator(".git-diff-split-cell--new")).not.toContainText("old only line");
    const addedOnly = page.locator(".git-diff-split-row.is-add", { hasText: "new only line" });
    await expect(addedOnly.locator(".git-diff-split-cell--new")).toContainText("new only line");
    await expect(addedOnly.locator(".git-diff-split-cell--old")).not.toContainText("new only line");
    const changedRow = page.locator(".git-diff-split-row.is-change", { hasText: "changed line" });
    await expect(changedRow.locator(".git-diff-split-cell--old")).toContainText("old line");
    await expect(changedRow.locator(".git-diff-split-cell--new")).toContainText("changed line");
    const visibleAddText = await addedOnly.locator(".git-diff-split-cell--new .git-diff-text").boundingBox();
    const visibleAddCell = await addedOnly.locator(".git-diff-split-cell--new").boundingBox();
    expect(visibleAddText && visibleAddCell).toBeTruthy();
    expect(visibleAddText!.y).toBeGreaterThanOrEqual(visibleAddCell!.y - 1);
    expect(visibleAddText!.y + visibleAddText!.height).toBeLessThanOrEqual(
      visibleAddCell!.y + visibleAddCell!.height + 2,
    );
    const splitOverflows = await page.locator(".git-diff-split").first().evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(splitOverflows).toBeFalsy();
    const shiftedTextTransform = await page.locator("[data-diff-x-scroll='new']").first().evaluate((scroll) => {
      scroll.scrollLeft = 80;
      scroll.dispatchEvent(new Event("scroll"));
      return getComputedStyle(scroll.closest(".git-diff-split")!.querySelector<HTMLElement>(".git-diff-split-cell--new .git-diff-text")!).transform;
    });
    expect(shiftedTextTransform).not.toBe("none");
    const stickyScrollbarGap = await page.locator("#git-diff-scroll").evaluate((scroller) => {
      scroller.scrollTop = 220;
      const viewport = scroller.getBoundingClientRect();
      const scrollbars = scroller.querySelector<HTMLElement>(".git-diff-split-scrollbars")!.getBoundingClientRect();
      return Math.round(viewport.bottom - scrollbars.bottom);
    });
    expect(Math.abs(stickyScrollbarGap)).toBeLessThanOrEqual(1);

    await page.locator("#git-diff-wrap-toggle").click();
    await expect(page.locator("#git-diff-wrap-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#git-diff-wrap-toggle")).toHaveAttribute("data-tooltip", "自动换行：开启");
    await expect(page.locator("#git-diff-scroll")).toHaveAttribute("data-diff-word-wrap", "on");
    const wrappedLongRow = await page.locator(".git-diff-split-row.is-change", { hasText: "very very very" }).evaluate((row) => {
      const text = row.querySelector<HTMLElement>(".git-diff-split-cell--new .git-diff-text");
      const scroll = row.closest(".git-diff-split")?.querySelector<HTMLElement>(".git-diff-split-scrollbars");
      return {
        rowHeight: row.getBoundingClientRect().height,
        textWhiteSpace: text ? getComputedStyle(text).whiteSpace : "",
        textScrolls: text ? text.scrollWidth > text.clientWidth : true,
        scrollbarsDisplay: scroll ? getComputedStyle(scroll).display : "",
      };
    });
    expect(wrappedLongRow.textWhiteSpace).toBe("pre-wrap");
    expect(wrappedLongRow.rowHeight).toBeGreaterThan(20);
    expect(wrappedLongRow.textScrolls).toBeFalsy();
    expect(wrappedLongRow.scrollbarsDisplay).toBe("none");
    const diffCallsAfterToggle = await page.evaluate(() => (window as any).__aimdGitMock.calls()
      .filter((call: any) => call.cmd === "get_git_file_diff").length);
    expect(diffCallsAfterToggle).toBe(diffCallsBeforeToggle);

    await page.locator("#find-toggle").click();
    await expect(page.locator("#find-bar")).toBeVisible();
    await expect(page.locator(".find-replace-group")).toBeHidden();
    await page.locator("#find-input").fill("changed line");
    await page.keyboard.press("Enter");
    await expect(page.locator("#find-count")).toHaveText("1/1");
    await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toContain("changed line");

    await page.locator("#git-diff-view-mode-toggle").click();
    await expect(page.locator("#find-bar")).toBeVisible();
    await expect(page.locator("#git-diff-scroll")).toHaveAttribute("data-diff-view-mode", "unified");
    await expect(page.locator("#git-diff-view-mode-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".git-diff-code")).toBeVisible();
    const diffCallsAfterUnified = await page.evaluate(() => (window as any).__aimdGitMock.calls()
      .filter((call: any) => call.cmd === "get_git_file_diff").length);
    expect(diffCallsAfterUnified).toBe(diffCallsBeforeToggle);
    await page.locator("#find-input").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#find-count")).toHaveText("1/1");
    await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toContain("changed line");

    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator(".open-tab", { hasText: "foo.ts" })).toHaveCount(1);
  });

  test("keeps binary, empty, and truncated Git diff states readable", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();

    await page.locator(".git-file-row[data-path='assets/logo.png']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toContainText("二进制文件无文本 diff");
    await expect(page.locator(".git-diff-code")).toHaveCount(0);
    await expect(page.locator(".git-diff-split")).toHaveCount(0);

    await page.locator(".git-file-row[data-path='docs/empty.md']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toContainText("没有可显示的文本 diff");
    await expect(page.locator(".git-diff-code")).toHaveCount(0);
    await expect(page.locator(".git-diff-split")).toHaveCount(0);

    await page.locator(".git-file-row[data-path='docs/large.md']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toContainText("diff 过大，已截断");
    await expect(page.locator(".git-diff-line.is-add").filter({ hasText: "+new large" })).toBeVisible();
    await page.locator("#git-diff-view-mode-toggle").click();
    await expect(page.locator("#git-diff-view")).toContainText("diff 过大，已截断");
    await expect(page.locator(".git-diff-split-row.is-change", { hasText: "new large" })).toBeVisible();
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
    await page.locator(".git-file-row[data-path='docs/draft.md']").click({ button: "right" });
    await expect(page.locator(".file-ctx-menu")).toBeVisible();
    await page.locator(".file-ctx-item", { hasText: "删除未跟踪文件" }).click();
    await page.locator("[data-git-action='discard-all']").click();
    await expect(page.locator("#git-commit-submit")).toBeDisabled();
    await page.locator("#git-commit-message").fill("Update docs");
    await expect(page.locator("#git-commit-submit")).toBeEnabled();
    await page.locator("#git-commit-submit").click();

    const calls = await page.evaluate(() => (window as any).__aimdGitMock.calls());
    expect(calls.some((call: any) => call.cmd === "git_stage_file" && call.args.path === "docs/draft.md")).toBeTruthy();
    expect(calls.some((call: any) => call.cmd === "git_unstage_file" && call.args.path === "apps/foo.ts")).toBeTruthy();
    expect(calls.filter((call: any) => call.cmd === "confirm_git_discard_operation").length).toBe(2);
    expect(calls.some((call: any) => call.cmd === "window_confirm")).toBeFalsy();
    expect(calls.some((call: any) => call.cmd === "git_discard_file" && call.args.path === "docs/draft.md")).toBeTruthy();
    expect(calls.some((call: any) => call.cmd === "git_discard_all")).toBeTruthy();
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
    await expect(page.locator("[data-git-action='discard-all']")).toBeDisabled();
    await expect(page.locator("#git-commit-message")).toBeDisabled();
    await expect(page.locator("#git-commit-submit")).toBeDisabled();
  });

  test("does not let discard-all tooltip block sync buttons", async ({ page }) => {
    await installGitWorkspaceMock(page, "conflict");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#sidebar-tab-git").click();
    const discardTip = page.locator(".git-tooltip-host:has([data-git-action='discard-all'])");
    const pullTip = page.locator(".git-tooltip-host:has([data-git-action='pull'])");

    await expect(discardTip).toHaveAttribute("data-tip", "冲突未解决");
    await expect(pullTip).toHaveAttribute("data-tip", "冲突未解决");
    await discardTip.hover();
    await expect.poll(() => discardTip.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("1");
    await expect.poll(() => discardTip.evaluate((el) => getComputedStyle(el, "::after").pointerEvents)).toBe("none");

    await pullTip.hover();
    await expect.poll(() => discardTip.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("0");
    await expect.poll(() => pullTip.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("1");
  });

  test("blocks risky Git actions while documents have unsaved edits", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").fill("# Readme\n\nUnsaved body");
    await page.locator("#sidebar-tab-git").click();

    await expect(page.locator("#git-content")).toContainText("未保存修改");
    await expect(page.locator(".git-file-row[data-path='docs/draft.md']").locator("[data-git-action='stage-file']")).toBeDisabled();
    await expect(page.locator(".git-file-row[data-path='docs/draft.md']").locator("[data-git-action='discard-file']")).toHaveCount(0);
    await expect(page.locator("[data-git-action='discard-all']")).toBeDisabled();
    await page.locator(".git-file-row[data-path='docs/draft.md']").click({ button: "right" });
    await expect(page.locator(".file-ctx-item", { hasText: "删除未跟踪文件" })).toBeDisabled();
    await expect(page.locator("#git-commit-message")).toBeDisabled();
    await expect(page.locator("[data-git-action='pull']")).toBeDisabled();
    await expect(page.locator("[data-git-action='push']")).toBeDisabled();
  });

  test("surfaces AIMD driver warnings without expanding the Git panel chrome", async ({ page }) => {
    await installGitWorkspaceMock(page, "repo");
    await page.goto("/");

    await openWorkspaceDocument(page);
    await page.evaluate(() => (window as any).__aimdGitMock.setDriverWarning(true));
    await page.locator("#sidebar-tab-git").click();
    await page.locator("[data-git-action='refresh']").click();

    await expect(page.locator("#git-content")).toContainText(".aimd Git diff 尚未启用");
    await expect(page.locator("#git-content")).not.toContainText("项目变更");
    await expect(page.locator(".git-summary")).toBeVisible();
    await expect(page.locator(".git-stage-row")).toBeVisible();
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
    await expect(page.locator(".git-diff-block-title")).toHaveText("未暂存差异");
    await expect(page.locator("#git-diff-view")).toContainText("+new file");
    await expect(page.locator("#git-diff-view")).not.toContainText("没有 已暂存差异");
    const draftDiffCallsBeforeToggle = await page.evaluate(() => (window as any).__aimdGitMock.calls()
      .filter((call: any) => call.cmd === "get_git_file_diff").length);
    await page.locator("#git-diff-view-mode-toggle").click();
    await expect(page.locator(".git-diff-split")).toBeVisible();
    await expect(page.locator(".git-diff-block-title")).toHaveText("未暂存差异");
    const draftAddRow = page.locator(".git-diff-split-row.is-add", { hasText: "new file" });
    await expect(draftAddRow.locator(".git-diff-split-cell--new")).toContainText("new file");
    await expect(draftAddRow.locator(".git-diff-split-cell--old")).not.toContainText("new file");
    const draftDiffCallsAfterToggle = await page.evaluate(() => (window as any).__aimdGitMock.calls()
      .filter((call: any) => call.cmd === "get_git_file_diff").length);
    expect(draftDiffCallsAfterToggle).toBe(draftDiffCallsBeforeToggle);
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
