import { expect, test } from "@playwright/test";

test("keeps split diff block placeholders aligned when wrapped", async ({ page }) => {
  const insertedLines = [
    `const wrapTwo = "${"two line placeholder alignment ".repeat(18)}";`,
    `const wrapFour = "${"four line placeholder alignment ".repeat(36)}";`,
    `const wrapSix = "${"six line placeholder alignment ".repeat(58)}";`,
  ];
  const diff = [
    "diff --git a/apps/foo.ts b/apps/foo.ts",
    "index abc..def 100644",
    "--- a/apps/foo.ts",
    "+++ b/apps/foo.ts",
    "@@ -3,3 +3,6 @@",
    " function run() {",
    "-  return \"old\";",
    "+  return \"new\";",
    " }",
    ...insertedLines.map((line) => `+${line}`),
  ].join("\n");

  await page.addInitScript((rawDiff) => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/repo";
    const workspace = () => ({
      root,
      tree: { id: root, name: "repo", path: root, kind: "folder", children: [{ id: `${root}/Readme.aimd`, name: "Readme.aimd", path: `${root}/Readme.aimd`, kind: "document", format: "aimd" }] },
    });
    const handlers: Record<string, (args: Args) => unknown> = {
      load_settings: () => ({ ui: { showAssetPanel: false, theme: "dark" } }),
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      open_aimd: () => ({ path: `${root}/Readme.aimd`, title: "Readme", markdown: "# Readme", html: "<h1>Readme</h1>", assets: [], dirty: false, format: "aimd" }),
      get_git_repo_status: () => ({ isRepo: true, root, branch: "main", clean: false, conflicted: false, aimdDriverConfigured: true, gitattributesConfigured: true, files: [{ path: "apps/foo.ts", staged: "modified", unstaged: "none", kind: "modified" }] }),
      get_git_file_diff: () => ({ path: "apps/foo.ts", stagedDiff: rawDiff, unstagedDiff: "", isBinary: false, truncated: false }),
      render_markdown: () => ({ html: "<h1>Readme</h1>" }),
      render_markdown_standalone: () => ({ html: "<h1>Readme</h1>" }),
    };
    window.localStorage.clear();
    (window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args?: Args) => handlers[cmd]?.(args), transformCallback: (callback: unknown) => callback };
  }, diff);

  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();
  await page.locator("#sidebar-tab-git").click();
  await page.locator(".git-file-row[data-path='apps/foo.ts'] [data-git-action='select']").click();
  await expect(page.locator("#git-diff-view")).not.toContainText("const boot = true;");

  await page.locator("#git-diff-view-mode-toggle").click();
  await expect(page.locator(".git-diff-split")).not.toContainText("@@");
  await expect(page.locator(".git-diff-split")).not.toContainText("const boot = true;");

  await page.locator("#git-diff-wrap-toggle").click();
  const addedRows = page.locator(".git-diff-split-row.is-add");
  await expect(addedRows).toHaveCount(insertedLines.length);
  const readGeometry = () => addedRows.evaluateAll((rows) => rows.map((row) => {
    const oldCell = row.querySelector<HTMLElement>(".git-diff-split-cell--old")!;
    const newCell = row.querySelector<HTMLElement>(".git-diff-split-cell--new")!;
    const newText = newCell.querySelector<HTMLElement>(".git-diff-text")!;
    const lineHeight = parseFloat(getComputedStyle(newText).lineHeight) || 18;
    const rowHeight = row.getBoundingClientRect().height;
    const placeholderHeight = oldCell.getBoundingClientRect().height;
    const codeHeight = newCell.getBoundingClientRect().height;
    return {
      visualLines: Math.round(newText.getBoundingClientRect().height / lineHeight),
      rowHeight,
      placeholderHeight,
      placeholderInnerHeight: oldCell.querySelector<HTMLElement>(".git-diff-split-cell-inner")!.getBoundingClientRect().height,
      codeHeight,
      placeholderText: oldCell.textContent?.trim() || "",
      background: getComputedStyle(oldCell, "::before").backgroundImage,
    };
  }));
  await expect.poll(async () => {
    const rows = await readGeometry();
    return rows.length === insertedLines.length
      && rows.some((row) => row.visualLines >= 4)
      && rows.some((row) => row.visualLines >= 6)
      && rows.every((row) => Math.abs(row.rowHeight - row.placeholderHeight) <= 1)
      && rows.every((row) => Math.abs(row.codeHeight - row.placeholderHeight) <= 1)
      && rows.every((row) => Math.abs(row.placeholderHeight - row.placeholderInnerHeight) <= 1);
  }).toBe(true);
  const geometries = await readGeometry();
  expect(Math.max(...geometries.map((row) => row.visualLines))).toBeGreaterThanOrEqual(6);
  geometries.forEach((row) => {
    expect(row.placeholderText).toBe("");
    expect(row.background).toContain("repeating-linear-gradient");
  });
});
