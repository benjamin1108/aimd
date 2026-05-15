import { test, expect, Page } from "@playwright/test";

const originalMarkdown = [
  "---",
  "title: 原始标题",
  "summary: 原摘要",
  "keyPoints:",
  "  - 原观点",
  "language: zh-CN",
  "---",
  "",
  "# 原始标题",
  "",
  "正文包含 [链接](https://example.com/a) 和图片。",
  "",
  "![图](asset://img-001)",
  "",
  "```bash",
  "npm run build",
  "```",
].join("\n");

const formattedMarkdown = [
  "---",
  "title: 格式化标题",
  "summary: 格式化摘要",
  "keyPoints:",
  "  - 观点一",
  "keywords:",
  "  - AIMD",
  "language: zh-CN",
  "formattedBy:",
  "  provider: dashscope",
  "  model: qwen3.6-plus",
  "  at: 2026-05-14T00:00:00Z",
  "---",
  "",
  "# 格式化标题",
  "",
  "## 清晰分段",
  "",
  "正文包含 [链接](https://example.com/a) 和图片。",
  "",
  "![图](asset://img-001)",
  "",
  "```bash",
  "npm run build",
  "```",
].join("\n");

async function installMock(page: Page) {
  await page.addInitScript(({ original, formatted }) => {
    type Args = Record<string, unknown> | undefined;
    const renderMarkdownForTest = (markdown: string) => {
      const lines = String(markdown).split(/\r?\n/);
      let body = String(markdown);
      let card = "";
      if (lines[0] === "---") {
        const end = lines.indexOf("---", 1);
        if (end > 0) {
          card = `<section class="aimd-frontmatter"><dl><dt>summary</dt><dd>${lines.slice(1, end).join(" ")}</dd></dl></section>`;
          body = lines.slice(end + 1).join("\n").trim();
        }
      }
      const html = body
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<p><img src="$2" alt="$1"></p>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\n\n([^<#\n][^\n]*)/g, "<p>$1</p>");
      return html.replace("</h1>", `</h1>${card}`);
    };
    const calls: Array<{ cmd: string; args?: Args }> = [];
    let formatResult: unknown = { needed: true, reason: "需要清理", markdown: formatted };
    let settings: any = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "sk-dash", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "sk-gemini", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    const doc = {
      path: "/mock/source.aimd",
      title: "原始标题",
      markdown: original,
      html: renderMarkdownForTest(original),
      assets: [{ id: "img-001", path: "assets/img.png", mime: "image/png", size: 123, sha256: "x", role: "image", url: "asset://img-001" }],
      dirty: false,
      format: "aimd",
    };
    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      initial_draft_path: () => null,
      choose_doc_file: () => doc.path,
      choose_aimd_file: () => doc.path,
      open_aimd: () => doc,
      render_markdown: (a) => ({ html: renderMarkdownForTest(String((a as any)?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: renderMarkdownForTest(String((a as any)?.markdown ?? "")) }),
      load_settings: () => settings,
      save_settings: (a) => { settings = (a as any)?.settings ?? settings; (window as any).__lastSettings = settings; return null; },
      format_markdown: (a) => { (window as any).__formatArgs = a; return formatResult; },
      choose_save_markdown_file: () => "/mock/export.md",
      choose_save_aimd_file: () => "/mock/export.aimd",
      save_markdown_as: (a) => { (window as any).__saveMarkdownAsArgs = a; return { path: (a as any).savePath, markdown: formatted, assetsDir: "/mock/export_assets", exportedAssets: [] }; },
      save_aimd_as: (a) => { (window as any).__saveAimdAsArgs = a; return { ...doc, path: (a as any).savePath, markdown: String((a as any).markdown), dirty: false }; },
      save_aimd: (a) => ({ ...doc, markdown: String((a as any).markdown), dirty: false }),
      list_aimd_assets: () => [],
      cleanup_old_drafts: () => undefined,
      update_window_path: () => undefined,
      register_window_path: () => undefined,
      focus_doc_window: () => null,
    };
    (window as any).__setFormatResult = (value: unknown) => { formatResult = value; };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        calls.push({ cmd, args: a });
        const fn = handlers[cmd];
        if (!fn) return null;
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc: (path: string) => `asset://localhost${path}`,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__aimdCalls = calls;
  }, { original: originalMarkdown, formatted: formattedMarkdown });
}

test.describe("one-click format, YAML meta, and save format choice", () => {
  test("settings page persists independent format settings", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='format']").click();
    await expect(page.locator("#format-provider")).toHaveValue("dashscope");
    await page.locator("#format-provider").selectOption("gemini");
    await page.locator("#format-model-select").selectOption("__custom__");
    await page.locator("#format-model").fill("gemini-custom-format");
    await page.locator("#format-output-language").selectOption("en");
    await expect(page.locator("#format-model-timeout")).toHaveValue("300");
    await expect(page.locator("#format-model-retry")).toHaveValue("2");
    await page.locator("#format-model-timeout").fill("90");
    await page.locator("#format-model-retry").fill("2");
    await page.locator("#save-settings").click();
    await expect.poll(() => page.evaluate(() => (window as any).__lastSettings?.format?.model)).toBe("gemini-custom-format");
    await expect.poll(() => page.evaluate(() => (window as any).__lastSettings?.format?.outputLanguage)).toBe("en");
    expect(await page.evaluate(() => (window as any).__lastSettings?.format?.modelTimeoutSeconds)).toBe(90);
    expect(await page.evaluate(() => (window as any).__lastSettings?.format?.modelRetryCount)).toBe(2);
    expect(await page.evaluate(() => (window as any).__lastSettings?.webClip?.outputLanguage)).toBe("zh-CN");
  });

  test("settings page persists independent web clip model settings", async ({ page }) => {
    await installMock(page);
    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='webclip']").click();
    await expect(page.locator("#webclip-model-select")).toBeVisible();
    await expect(page.locator("#webclip-model-select")).toHaveValue("qwen3.6-plus");

    await page.locator("#webclip-provider").selectOption("gemini");
    await expect(page.locator("#webclip-model-select")).toHaveValue("gemini-3.1-flash-lite-preview");
    await expect(page.locator("#webclip-model-select option[value='gemini-3-pro-preview']")).toHaveCount(1);
    await page.locator("#webclip-model-select").selectOption("__custom__");
    await page.locator("#webclip-model").fill("gemini-webclip-custom");
    await page.locator("#webclip-output-language").selectOption("en");
    await expect(page.locator("#webclip-model-timeout")).toHaveValue("300");
    await expect(page.locator("#webclip-model-retry")).toHaveValue("2");
    await page.locator("#webclip-model-timeout").fill("75");
    await page.locator("#webclip-model-retry").fill("3");
    await page.locator("#save-settings").click();

    await expect.poll(() => page.evaluate(() => (window as any).__lastSettings?.webClip?.model)).toBe("gemini-webclip-custom");
    expect(await page.evaluate(() => (window as any).__lastSettings?.webClip?.provider)).toBe("gemini");
    expect(await page.evaluate(() => (window as any).__lastSettings?.webClip?.outputLanguage)).toBe("en");
    expect(await page.evaluate(() => (window as any).__lastSettings?.webClip?.modelTimeoutSeconds)).toBe(75);
    expect(await page.evaluate(() => (window as any).__lastSettings?.webClip?.modelRetryCount)).toBe(3);
    expect(await page.evaluate(() => (window as any).__lastSettings?.ai?.providers?.gemini?.model)).toBe("gemini-3.1-flash-lite-preview");
  });

  test("old web clip settings without model default to provider global model", async ({ page }) => {
    await page.addInitScript(() => {
      type Args = Record<string, unknown> | undefined;
      let settings: any = {
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen-global-custom", apiKey: "sk-dash", apiBase: "" },
            gemini: { model: "gemini-3-pro-preview", apiKey: "sk-gemini", apiBase: "" },
          },
        },
        webClip: { llmEnabled: false, provider: "dashscope", outputLanguage: "zh-CN" },
        format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
        ui: { showAssetPanel: false, debugMode: false },
      };
      const handlers: Record<string, (a?: Args) => unknown> = {
        load_settings: () => settings,
        save_settings: (a) => { settings = (a as any)?.settings ?? settings; (window as any).__lastSettings = settings; return null; },
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, a?: Args) => handlers[cmd]?.(a) ?? null,
        transformCallback: (cb: Function) => cb,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    });

    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='webclip']").click();
    await expect(page.locator("#webclip-model-select")).toHaveValue("__custom__");
    await expect(page.locator("#webclip-model")).toHaveValue("qwen-global-custom");
  });

  test("format command previews first, cancel preserves, apply replaces markdown", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#format-document")).toHaveText(/一键格式化/);
    await page.locator("#format-document").click();
    await expect(page.locator("#format-preview-panel")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__formatArgs?.outputLanguage)).toBe("zh-CN");
    expect(await page.evaluate(() => (window as any).__formatArgs?.modelTimeoutSeconds)).toBe(300);
    expect(await page.evaluate(() => (window as any).__formatArgs?.modelRetryCount)).toBe(2);
    await page.locator("#format-cancel").click();
    await expect(page.locator("#format-preview-panel")).toBeHidden();
    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/原摘要/);

    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await page.locator("#format-apply").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/formattedBy:/);
    await expect(page.locator("#markdown")).toHaveValue(/## 清晰分段/);
    await expect(page.locator("#save")).toBeEnabled();
  });

  test("invalid format output keeps original markdown", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__setFormatResult({
      needed: true,
      reason: "需要清理",
      markdown: "---\ntitle: Bad\n---\n\n# Bad\n\nNo image or link.",
    }));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#status")).toHaveText("格式化结果不完整，已保留原文");
    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/asset:\/\/img-001/);
    await expect(page.locator("#markdown")).toHaveValue(/https:\/\/example.com\/a/);
  });

  test("format skipped result does not open preview or dirty the document", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__setFormatResult({
      needed: false,
      reason: "文档已经比较工整",
    }));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();

    await expect(page.locator("#status")).toHaveText("当前文档已经比较工整，无需格式化");
    await expect(page.locator("#format-preview-panel")).toBeHidden();
    await expect(page.locator("#save")).toBeDisabled();
    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/原摘要/);
    await expect(page.locator("#markdown")).not.toHaveValue(/formattedBy:/);
  });

  test("format output without H1 can still be previewed", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__setFormatResult({
      needed: true,
      reason: "清理简单清单",
      markdown: [
        "---",
        "title: 简单清单",
        "---",
        "",
        "- 保留 [链接](https://example.com/a)",
        "- 保留图片 ![图](asset://img-001)",
        "",
        "```bash",
        "npm run build",
        "```",
      ].join("\n"),
    }));

    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#format-preview-panel")).toBeVisible();
    await expect(page.locator("#format-preview-text")).toContainText("- 保留");
  });

  test("format output that drops asset or link is rejected", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => (window as any).__setFormatResult({
      needed: true,
      reason: "需要清理",
      markdown: "---\ntitle: Bad\n---\n\n正文只有链接 [链接](https://example.com/a)。",
    }));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#status")).toHaveText("格式化结果不完整，已保留原文");
    await expect(page.locator("#format-preview-panel")).toBeHidden();

    await page.evaluate(() => (window as any).__setFormatResult({
      needed: true,
      reason: "需要清理",
      markdown: "---\ntitle: Bad\n---\n\n正文只有图片 ![图](asset://img-001)。",
    }));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#status")).toHaveText("格式化结果不完整，已保留原文");
    await expect(page.locator("#format-preview-panel")).toBeHidden();
  });

  test("format output that rewrites fenced code is rejected", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.evaluate(() => (window as any).__setFormatResult({
      needed: true,
      reason: "需要清理",
      markdown: [
        "---",
        "title: Bad",
        "---",
        "",
        "正文包含 [链接](https://example.com/a) 和图片。",
        "",
        "![图](asset://img-001)",
        "",
        "```bash",
        "npm run test",
        "```",
      ].join("\n"),
    }));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#status")).toHaveText("格式化结果不完整，已保留原文");
    await expect(page.locator("#format-preview-panel")).toBeHidden();
  });

  test("frontmatter is visible in read mode, hidden from source chrome, and preserved on flush", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#reader .aimd-frontmatter")).toBeVisible();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor .aimd-frontmatter")).toHaveCount(0);
    await page.locator("#inline-editor p").first().evaluate((el) => {
      el.textContent = `${el.textContent} 已编辑`;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " 已编辑" }));
    });
    await page.locator("#mode-source").click();
    await expect(page.locator("#source-banner")).toBeHidden();
    await expect(page.locator("#markdown")).toHaveValue(/summary: 原摘要/);
    await expect(page.locator("#markdown")).toHaveValue(/已编辑/);
  });

  test("save-as explicitly chooses Markdown or AIMD", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await page.locator("#save-as").click();
    await expect(page.locator("#save-format-panel")).toBeVisible();
    await page.locator("#save-format-markdown").click();
    await expect.poll(() => page.evaluate(() => (window as any).__saveMarkdownAsArgs?.savePath)).toBe("/mock/export.md");
    expect(await page.evaluate(() => (window as any).__saveMarkdownAsArgs?.sourcePath)).toBe("/mock/source.aimd");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#save-as").click();
    await page.locator("#save-format-aimd").click();
    await expect.poll(() => page.evaluate(() => (window as any).__saveAimdAsArgs?.savePath)).toBe("/mock/export.aimd");
  });
});
