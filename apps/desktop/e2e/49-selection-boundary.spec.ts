import { test, expect, Page } from "@playwright/test";

async function installMainMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/repo";
    const doc = {
      path: `${root}/Readme.aimd`,
      title: "Selection Boundary Doc",
      markdown: "# Selection Boundary Doc\n\nReader unique body text.\n\n## Chapter\n\nInline unique body text.",
      html: "<h1>Selection Boundary Doc</h1><p>Reader unique body text.</p><h2>Chapter</h2><p>Inline unique body text.</p>",
      assets: [],
      dirty: false,
      format: "aimd",
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
        .replace(/^## (.*)$/m, "<h2>$1</h2>")
        .replace(/\n\n([^#\n].*)/g, "<p>$1</p>"),
    });
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => ({ ui: { showAssetPanel: false, debugMode: false } }),
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      choose_doc_file: () => doc.path,
      choose_aimd_file: () => doc.path,
      choose_markdown_file: () => null,
      choose_image_file: () => null,
      choose_save_aimd_file: () => `${root}/Saved.aimd`,
      open_aimd: () => doc,
      save_aimd: (a) => ({ ...doc, markdown: String(a?.markdown ?? doc.markdown), dirty: false }),
      render_markdown: (a) => render(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String(a?.markdown ?? "")),
      list_aimd_assets: () => [],
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({
        isRepo: true,
        root,
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        clean: false,
        conflicted: false,
        files: [{ path: "apps/foo.ts", staged: "modified", unstaged: "modified", kind: "modified" }],
      }),
      get_git_file_diff: () => ({
        path: "apps/foo.ts",
        stagedDiff: "diff --git a/apps/foo.ts b/apps/foo.ts\n@@ -1 +1 @@\n-old chrome leak\n+diff unique selectable line",
        unstagedDiff: "",
        isBinary: false,
        truncated: false,
      }),
      git_stage_file: () => null,
      git_unstage_file: () => null,
      git_stage_all: () => null,
      git_unstage_all: () => null,
      git_commit: () => null,
      git_pull: () => null,
      git_push: () => null,
    };
    window.localStorage.clear();
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

async function installSettingsMock(page: Page) {
  await page.addInitScript(() => {
    const settings = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "sk-selection-boundary", apiBase: "https://example.test/v1" },
          gemini: { model: "gemini-3-pro-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "load_settings") return settings;
        if (cmd === "save_settings" || cmd === "close_current_window") return null;
        if (cmd === "git_integration_status") {
          return {
            gitInstalled: true,
            cliInPath: true,
            stableCliExists: true,
            stableCliExecutable: true,
            repoIsGit: false,
            gitattributesPresent: false,
            gitattributesConfigured: false,
            repoDriverConfigured: false,
            globalDriverConfigured: false,
            expectedTextconv: "aimd git-diff",
            expectedMergeDriver: "aimd git-merge",
          };
        }
        return null;
      },
      transformCallback: (callback: unknown) => callback,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

async function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() || "");
}

async function clearSelection(page: Page) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

async function pressSelectAll(page: Page, mod: "Control" | "Meta" = "Control") {
  await page.keyboard.press(`${mod}+A`);
}

async function pressNativeSelectAll(page: Page) {
  await page.keyboard.press("ControlOrMeta+A");
}

function expectNoChrome(text: string) {
  expect(text).not.toContain("保存");
  expect(text).not.toContain("目录");
  expect(text).not.toContain("大纲");
  expect(text).not.toContain("Git");
  expect(text).not.toContain("Readme.aimd");
  expect(text).not.toContain("一键格式化");
  expect(text).not.toContain("关闭文档");
}

test.describe("selection boundary and select-all shortcuts", () => {
  test("reader mode selects document text after toolbar focus, not app chrome", async ({ page }) => {
    await installMainMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-read").click();
    await pressSelectAll(page, "Control");
    let text = await selectedText(page);
    expect(text).toContain("Reader unique body text");
    expectNoChrome(text);

    await clearSelection(page);
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#more-menu")).toBeVisible();
    await pressSelectAll(page, "Control");
    text = await selectedText(page);
    expect(text).toContain("Reader unique body text");
    expectNoChrome(text);

    await clearSelection(page);
    await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("#web-clip-panel");
      if (panel) panel.hidden = false;
    });
    await expect(page.locator("#web-clip-panel")).toBeVisible();
    await page.locator(".web-clip-panel-head").click();
    await pressSelectAll(page, "Control");
    text = await selectedText(page);
    expect(text).toBe("");
  });

  test("edit and source modes keep select-all inside their editing surfaces", async ({ page }) => {
    await installMainMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-edit").click();
    await page.locator("#format-toolbar").click();
    await pressSelectAll(page, "Control");
    let text = await selectedText(page);
    expect(text).toContain("Inline unique body text");
    expectNoChrome(text);

    await page.locator("#mode-source").click();
    await page.locator("#doc-toolbar").click();
    await pressSelectAll(page, "Control");
    const sourceSelection = await page.locator("#markdown").evaluate((el: HTMLTextAreaElement) => ({
      selected: el.value.slice(el.selectionStart, el.selectionEnd),
      value: el.value,
    }));
    expect(sourceSelection.selected).toBe(sourceSelection.value);
    expect(sourceSelection.selected).toContain("Reader unique body text");
  });

  test("workspace, outline, Git panel, and Git diff do not leak chrome into selection", async ({ page }) => {
    await installMainMock(page);
    await page.goto("/");
    await page.locator("#empty-open-workspace").click();
    await page.locator(".workspace-row", { hasText: "Readme.aimd" }).click();

    await page.locator("#workspace-tree").click();
    await pressNativeSelectAll(page);
    let text = await selectedText(page);
    expect(text).toContain("Reader unique body text");
    expectNoChrome(text);

    await clearSelection(page);
    await page.locator("#outline-list").click();
    await pressSelectAll(page);
    text = await selectedText(page);
    expect(text).toContain("Reader unique body text");
    expectNoChrome(text);

    await clearSelection(page);
    await page.locator("#sidebar-tab-git").click();
    await page.locator("#git-panel").click();
    await pressSelectAll(page);
    text = await selectedText(page);
    expect(text).toContain("Reader unique body text");
    expectNoChrome(text);

    await clearSelection(page);
    await page.locator(".git-file-row[data-path='apps/foo.ts']").locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await page.locator(".git-diff-scroll").click();
    await pressSelectAll(page);
    text = await selectedText(page);
    expect(text).toContain("diff unique selectable line");
    expect(text).not.toContain("返回文档");
    expectNoChrome(text);
  });

  test("settings chrome blocks full-page select-all while inputs keep native selection", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/settings.html");

    await page.locator(".settings-nav-item", { hasText: "网页导入" }).click();
    await pressSelectAll(page);
    let text = await selectedText(page);
    expect(text).toBe("");

    await page.locator(".settings-nav-item", { hasText: "AI / 模型" }).click();
    await page.locator("#api-base").click();
    await pressSelectAll(page);
    const inputSelection = await page.locator("#api-base").evaluate((el: HTMLInputElement) => ({
      selected: el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
      value: el.value,
    }));
    expect(inputSelection.selected).toBe(inputSelection.value);
    expect(inputSelection.selected).toBe("https://example.test/v1");

    expect(inputSelection.selected).not.toContain("AI / 模型");
  });
});
