import { test, expect, Page } from "@playwright/test";

type Args = Record<string, any> | undefined;

type Doc = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: unknown[];
  dirty: boolean;
  format: "aimd" | "markdown";
};

const ROOT = "/mock/project";
const MD_PATH = `${ROOT}/Daily.md`;
const AIMD_PATH = `${ROOT}/Report.aimd`;
const CONFLICT_PATH = `${ROOT}/Conflict.aimd`;

const docs: Record<string, Doc> = {
  [MD_PATH]: {
    path: MD_PATH,
    title: "Daily",
    markdown: "# Daily\n\nMarkdown body",
    html: "<h1>Daily</h1><p>Markdown body</p>",
    assets: [],
    dirty: false,
    format: "markdown",
  },
  [AIMD_PATH]: {
    path: AIMD_PATH,
    title: "Report",
    markdown: "# Report\n\nAIMD body",
    html: "<h1>Report</h1><p>AIMD body</p>",
    assets: [],
    dirty: false,
    format: "aimd",
  },
  [CONFLICT_PATH]: {
    path: CONFLICT_PATH,
    title: "Conflict",
    markdown: "# Conflict\n\n<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> branch",
    html: "<h1>Conflict</h1><pre>&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</pre>",
    assets: [],
    dirty: false,
    format: "aimd",
  },
};

async function installNavigationMock(page: Page) {
  await page.addInitScript((seed) => {
    const docs = new Map<string, Doc>(Object.entries(seed.docs));
    const runtime = {
      confirmMessages: [] as string[],
      initialPathServed: false,
    };
    const workspace = () => ({
      root: seed.root,
      tree: {
        id: seed.root,
        name: "project",
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
    const render = (markdown: string) => {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled";
      const body = markdown.split(/\n\n+/).slice(1).map((part) => `<p>${part}</p>`).join("");
      return `<h1>${title}</h1>${body}`;
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => ({
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen3.6-plus", apiKey: "", apiBase: "" },
            gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
          },
        },
        webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
        ui: { showAssetPanel: false, debugMode: false },
      }),
      initial_open_path: () => {
        if (runtime.initialPathServed) return null;
        runtime.initialPathServed = true;
        return null;
      },
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      focus_doc_window: () => null,
      open_aimd: (a) => {
        const doc = docs.get(String(a?.path));
        if (!doc) throw new Error(`missing AIMD ${String(a?.path)}`);
        return { ...doc };
      },
      convert_md_to_draft: (a) => {
        const doc = docs.get(String(a?.markdownPath));
        if (!doc) throw new Error(`missing Markdown ${String(a?.markdownPath)}`);
        return { title: doc.title, markdown: doc.markdown, html: doc.html };
      },
      render_markdown: (a) => ({ html: render(String(a?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: render(String(a?.markdown ?? "")) }),
      document_file_fingerprint: () => ({ mtimeMs: 10, size: 20 }),
      register_window_path: () => null,
      unregister_window_path: () => null,
      update_window_path: () => null,
      save_markdown: (a) => {
        const path = String(a?.path);
        const markdown = String(a?.markdown ?? "");
        const current = docs.get(path)!;
        docs.set(path, { ...current, markdown, html: render(markdown), dirty: false });
        return null;
      },
      save_aimd: (a) => {
        const path = String(a?.path);
        const markdown = String(a?.markdown ?? "");
        const current = docs.get(path)!;
        const next = { ...current, markdown, html: render(markdown), dirty: false };
        docs.set(path, next);
        return next;
      },
      confirm_discard_changes: (a) => {
        runtime.confirmMessages.push(String(a?.message ?? ""));
        return "cancel";
      },
      get_git_repo_status: () => ({
        isRepo: true,
        root: seed.root,
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
        clean: false,
        conflicted: false,
        files: [
          { path: "src/app.ts", staged: "modified", unstaged: "none", kind: "modified" },
          { path: "docs/new.md", staged: "none", unstaged: "untracked", kind: "untracked" },
        ],
      }),
      get_git_file_diff: () => ({
        path: "src/app.ts",
        stagedDiff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        unstagedDiff: "",
        isBinary: false,
      }),
      git_stage_file: () => null,
      git_unstage_file: () => null,
      git_stage_all: () => null,
      git_unstage_all: () => null,
      git_commit: () => null,
      git_pull: () => null,
      git_push: () => null,
    };
    (window as any).__aimdNavigationMock = {
      confirmMessages: () => runtime.confirmMessages,
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
  }, { root: ROOT, docs });
}

async function openProject(page: Page) {
  if (await page.locator("#empty-open-workspace").isVisible()) {
    await page.locator("#empty-open-workspace").click();
  } else {
    await page.locator("#workspace-open").click();
  }
  await expect(page.locator("#workspace-root-label")).toHaveText("项目");
}

async function openDocumentFromProject(page: Page, fileName: string) {
  await page.locator(".workspace-row", { hasText: fileName }).click();
  await expect(page.locator("#doc-title")).toContainText(fileName.replace(/\.(aimd|md)$/i, ""));
}

async function forceRequiresAimdSave(page: Page) {
  await page.evaluate(async () => {
    const { state } = await import("/src/core/state.ts");
    const { updateChrome } = await import("/src/ui/chrome.ts");
    if (!state.doc) throw new Error("expected active doc");
    state.doc.requiresAimdSave = true;
    state.doc.needsAimdSave = true;
    state.doc.dirty = true;
    updateChrome();
  });
}

async function capturePhase4Screenshot(page: Page, name: string) {
  const dir = process.env.AIMD_PHASE4_SCREENSHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir.replace(/\/$/, "")}/${name}.png`, fullPage: true });
}

test.describe("Phase 4 navigation language and stable status", () => {
  test.beforeEach(async ({ page }) => {
    await installNavigationMock(page);
  });

  test("uses scoped labels for project, document modes, commands, and close confirmation", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#doc-path")).toHaveText("未打开文档");
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#workspace-close")).toHaveAttribute("title", "关闭项目");
    await expect(page.locator("#empty")).toContainText("新建文档、打开 AIMD / Markdown，或打开项目目录。");

    await openProject(page);
    await openDocumentFromProject(page, "Daily.md");
    await capturePhase4Screenshot(page, "phase4-navigation-desktop");

    await expect(page.locator("#mode-read")).toHaveText("预览");
    await expect(page.locator("#mode-edit")).toHaveText("可视编辑");
    await expect(page.locator("#mode-source")).toHaveText("Markdown");

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#health-check")).toContainText("检查当前文档资源");
    await expect(page.locator("#close")).toContainText("关闭当前标签页");
    await expect(page.locator("#more-menu")).toContainText("检查更新");
    await expect(page.locator("#more-menu")).toContainText("关于 AIMD");
    await page.keyboard.press("Escape");

    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Daily\n\nChanged");
    await page.locator("#more-menu-toggle").click();
    await page.locator("#close").click();
    const messages = await page.evaluate(() => (window as any).__aimdNavigationMock.confirmMessages());
    expect(messages.at(-1)).toContain("Daily");
    expect(messages.at(-1)).toContain("关闭当前标签页");
    await expect(page.locator("#doc-title")).toHaveText("Daily");
  });

  test("shows stable header badges for format, dirty, draft, requiresAimdSave, conflict, and project scope", async ({ page }) => {
    await page.goto("/");
    await openProject(page);
    await openDocumentFromProject(page, "Daily.md");

    await expect(page.locator("#doc-state-badges")).toContainText("Markdown");
    await expect(page.locator("#doc-state-badges")).toContainText("项目内");
    await expect(page.locator("#doc-state-badges")).not.toContainText("未保存");

    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Daily\n\nChanged");
    await expect(page.locator("#doc-state-badges")).toContainText("未保存");

    await forceRequiresAimdSave(page);
    await expect(page.locator("#doc-state-badges")).toContainText("保存需选格式");

    await page.locator("#workspace-close").click();
    await expect(page.locator("#workspace-root-label")).toHaveText("项目");
    await expect(page.locator("#workspace-tree")).toHaveText("打开目录");
    await expect(page.locator("#doc-state-badges")).not.toContainText("项目内");
    await expect(page.locator(".open-tab")).toHaveCount(1);

    await page.locator("#sidebar-new").click();
    await expect(page.locator("#doc-state-badges")).toContainText("草稿");
    await expect(page.locator("#doc-state-badges")).toContainText("未保存");

    await openProject(page);
    await openDocumentFromProject(page, "Conflict.aimd");
    await expect(page.locator("#doc-state-badges")).toContainText("AIMD");
    await expect(page.locator("#doc-state-badges")).toContainText("Git 冲突");
  });

  test("distinguishes Git project review from the active document", async ({ page }) => {
    await page.goto("/");
    await openProject(page);
    await openDocumentFromProject(page, "Report.aimd");

    await page.locator("#sidebar-tab-git").click();
    await expect(page.locator("#git-panel")).toContainText("项目变更");
    await expect(page.locator("#git-panel")).toContainText("全部暂存");
    await expect(page.locator("#git-panel")).toContainText("全部取消暂存");
    await expect(page.locator("#git-commit-message")).toHaveAttribute("placeholder", "提交说明");
    await expect(page.locator("[data-git-action='pull']")).toHaveText("拉取");
    await expect(page.locator("[data-git-action='push']")).toHaveText("推送");
    await expect(page.locator("#git-panel")).not.toContainText("Changes");

    await page.locator(".git-file-row", { hasText: "src/app.ts" }).locator("[data-git-action='select']").click();
    await expect(page.locator("#git-diff-view")).toBeVisible();
    await expect(page.locator(".git-diff-scope")).toHaveText("Git review · 项目变更");
    await expect(page.locator("#git-diff-back")).toContainText("返回当前文档：Report");
    await expect(page.locator("#doc-title")).toHaveText("Report");
  });

  test("covers empty states for no project, project without tabs, and tabs without project", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#doc-state-badges")).toBeHidden();
    await expect(page.locator("#workspace-tree")).toHaveText("打开目录");

    await openProject(page);
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator(".open-tab")).toHaveCount(0);
    await expect(page.locator("#workspace-tree")).toContainText("Daily.md");

    await openDocumentFromProject(page, "Report.aimd");
    await page.locator("#workspace-close").click();
    await expect(page.locator("#workspace-tree")).toHaveText("打开目录");
    await expect(page.locator(".open-tab")).toHaveCount(1);
    await expect(page.locator("#doc-title")).toHaveText("Report");
  });

  test("keeps key controls accessible and stable in a narrow viewport", async ({ page }) => {
    await page.goto("/");
    await openProject(page);
    await openDocumentFromProject(page, "Daily.md");
    await page.setViewportSize({ width: 560, height: 720 });

    await expect(page.getByRole("tab", { name: /切换到 Daily/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /关闭标签页：Daily/ })).toBeVisible();
    await expect(page.locator("#mode-read")).toHaveText("预览");
    await expect(page.locator("#mode-edit")).toHaveText("可视编辑");
    await expect(page.locator("#mode-source")).toHaveText("Markdown");

    const metrics = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabHeight: document.querySelector("#tab-bar")?.getBoundingClientRect().height || 0,
      headHeight: document.querySelector(".workspace-head")?.getBoundingClientRect().height || 0,
    }));
    expect(metrics.bodyOverflow).toBeLessThanOrEqual(1);
    expect(metrics.tabHeight).toBeGreaterThan(0);
    expect(metrics.headHeight).toBeLessThan(160);
    await capturePhase4Screenshot(page, "phase4-navigation-narrow");
  });
});
