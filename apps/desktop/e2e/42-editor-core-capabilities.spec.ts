import { test, expect, Page } from "@playwright/test";

async function installEditorCoreMock(page: Page) {
  const seed = {
    savedHtmlPath: "/mock/export.html",
    doc: {
      path: "/mock/core.aimd",
      title: "核心能力",
      markdown: [
        "# 核心能力",
        "",
        "Alpha paragraph",
        "",
        "[Example](https://example.com/a)",
        "",
        "![old alt](asset://img-001)",
        "",
        "- [ ] todo",
        "",
        "```js",
        "console.log('x')",
        "```",
        "",
      ].join("\n"),
      html: [
        "<h1>核心能力</h1>",
        "<p>Alpha paragraph</p>",
        '<p><a href="https://example.com/a">Example</a></p>',
        '<p><img src="asset://img-001" alt="old alt"></p>',
        '<ul><li><input type="checkbox" disabled> todo</li></ul>',
        "<pre><code class=\"language-js\">console.log('x')\n</code></pre>",
      ].join(""),
      assets: [{
        id: "img-001",
        path: "assets/pic.png",
        mime: "image/png",
        size: 8,
        sha256: "hash",
        role: "content-image",
        url: "/tmp/pic.png",
        localPath: "/tmp/pic.png",
      }],
      dirty: false,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const runtime = {
      exportMarkdownDir: "/mock/export-md" as string | null,
      exportHtmlError: "",
      openPath: s.doc.path,
      openWindowPaths: [] as Array<string | null>,
      openedUrls: [] as string[],
      exportPdfCalls: [] as Array<Record<string, unknown>>,
      healthMode: "remote" as "remote" | "missing" | "unused" | "large" | "clean",
      remotePackageMode: "success" as "success" | "fail",
      remotePackageCalls: [] as Array<Record<string, unknown>>,
      keepOnlineConfirmCalls: [] as Array<Record<string, unknown>>,
      saveCalls: [] as Array<Record<string, unknown>>,
    };
    const convertFileSrc = (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`;
    const renderFromMarkdown = (markdown: string) => ({
      html: markdown
        .replace(/^# (.*)$/m, "<h1>$1</h1>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<p><a href="$2">$1</a></p>')
        .replace(/!\[([^\]]*)\]\(asset:\/\/img-001\)/g, '<p><img src="asset://img-001" alt="$1"></p>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<p><img src="$2" alt="$1"></p>')
        .replace(/- \[ \] todo/g, '<ul><li><input type="checkbox" disabled> todo</li></ul>')
        .replace(/- \[x\] todo/g, '<ul><li><input type="checkbox" disabled checked> todo</li></ul>'),
    });
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_markdown_project_path: () => "/mock/markdown-project",
      choose_doc_file: () => runtime.openPath,
      choose_aimd_file: () => s.doc.path,
      choose_image_file: () => null,
      choose_save_aimd_file: () => "/mock/saved.aimd",
      choose_export_markdown_dir: () => runtime.exportMarkdownDir,
      choose_export_html_file: () => s.savedHtmlPath,
      choose_export_pdf_file: () => "/mock/export.pdf",
      open_aimd: () => s.doc,
      convert_md_to_draft: () => ({
        title: "传统 Markdown",
        markdown: "# 传统 Markdown\n\n![local](./images/local.png)\n",
        html: '<h1>传统 Markdown</h1><p><img src="./images/local.png" alt="local"></p>',
      }),
      import_markdown: (a) => ({
        ...s.doc,
        path: String((a as any)?.savePath ?? "/mock/saved.aimd"),
        title: "导入项目",
        markdown: "# 导入项目\n\n![pic](asset://img-001)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconsole.log('clip')\n```",
        html: [
          "<h1>导入项目</h1>",
          '<p><img src="asset://img-001" alt="pic"></p>',
          "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
          "<pre><code class=\"language-js\">console.log('clip')\n</code></pre>",
        ].join(""),
        dirty: false,
      }),
      package_markdown_as_aimd: (a) => ({
        ...s.doc,
        path: String((a as any)?.savePath ?? "/mock/saved.aimd"),
        title: "导入项目",
        markdown: "# 导入项目\n\n![pic](asset://img-001)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconsole.log('clip')\n```",
        html: [
          "<h1>导入项目</h1>",
          '<p><img src="asset://img-001" alt="pic"></p>',
          "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
          "<pre><code class=\"language-js\">console.log('clip')\n</code></pre>",
        ].join(""),
        dirty: false,
      }),
      save_aimd: (a) => {
        runtime.saveCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return { ...s.doc, markdown: String((a as any)?.markdown ?? s.doc.markdown), dirty: false };
      },
      render_markdown: (a) => renderFromMarkdown(String((a as any)?.markdown ?? "")),
      render_markdown_standalone: (a) => renderFromMarkdown(String((a as any)?.markdown ?? "")),
      read_image_bytes: () => [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
        0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 250, 207, 0, 0,
        2, 7, 1, 2, 154, 28, 49, 113, 0, 0, 0, 0, 73, 69, 78, 68,
        174, 66, 96, 130,
      ],
      list_aimd_assets: () => [],
      check_document_health: () => {
        if (runtime.healthMode === "missing") return {
          status: "missing",
          summary: "资源缺失，需要修复",
          counts: { errors: 1, warnings: 0, infos: 0 },
          issues: [{ kind: "missing_asset", severity: "error", message: "正文引用的资源不存在: missing-001", id: "missing-001" }],
        };
        if (runtime.healthMode === "unused") return {
          status: "risk",
          summary: "存在资源风险",
          counts: { errors: 0, warnings: 0, infos: 1 },
          issues: [{ kind: "unreferenced_asset", severity: "info", message: "资源未被正文引用: unused-001", id: "unused-001" }],
        };
        if (runtime.healthMode === "large") return {
          status: "risk",
          summary: "存在资源风险",
          counts: { errors: 0, warnings: 1, infos: 0 },
          issues: [{ kind: "large_asset", severity: "warning", message: "资源体积较大: img-001", id: "img-001", mime: "image/png" }],
        };
        if (runtime.healthMode === "clean") return {
          status: "ready",
          summary: "资源完整，可离线打开",
          counts: { errors: 0, warnings: 0, infos: 0 },
          issues: [],
        };
        return {
          status: "risk",
          summary: "存在资源风险",
          counts: { errors: 0, warnings: 1, infos: 0 },
          issues: [{ kind: "remote_image", severity: "warning", message: "正文仍依赖远程图片: https://example.com/a.png", url: "https://example.com/a.png" }],
        };
      },
      export_markdown_assets: () => ({
        markdownPath: "/mock/export-md/main.md",
        assetsDir: "/mock/export-md/assets",
        exportedAssets: [{ id: "img-001", filename: "pic.png", path: "assets/pic.png", size: 8 }],
      }),
      export_html: (a) => {
        if (runtime.exportHtmlError) throw new Error(runtime.exportHtmlError);
        return { path: String((a as any)?.outputPath ?? s.savedHtmlPath) };
      },
      export_pdf: (a) => {
        runtime.exportPdfCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return { path: String((a as any)?.outputPath ?? "/mock/export.pdf") };
      },
      package_local_images: (a) => ({ ...s.doc, markdown: String((a as any)?.markdown ?? s.doc.markdown), dirty: false }),
      package_remote_images: (a) => {
        runtime.remotePackageCalls.push({ ...((a || {}) as Record<string, unknown>) });
        if (runtime.remotePackageMode === "fail") {
          throw new Error("1 张远程图片下载失败: https://example.com/a.png: HTTP 403");
        }
        runtime.healthMode = "clean";
        return {
          ...s.doc,
          markdown: String((a as any)?.markdown ?? s.doc.markdown).replace("https://example.com/a.png", "asset://remote-001"),
          assets: [
            ...s.doc.assets,
            {
              id: "remote-001",
              path: "assets/remote.png",
              mime: "image/png",
              size: 16,
              sha256: "remote-hash",
              role: "content-image",
              url: "/tmp/remote.png",
              localPath: "/tmp/remote.png",
            },
          ],
          dirty: false,
        };
      },
      confirm_keep_online_images: (a) => {
        runtime.keepOnlineConfirmCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return true;
      },
      open_in_new_window: (a) => {
        runtime.openWindowPaths.push(((a as any)?.path ?? null) as string | null);
        return null;
      },
      open_external_url: (a) => {
        runtime.openedUrls.push(String((a as any)?.url ?? ""));
        return null;
      },
    };
    (window as any).__aimdEditorCoreMock = {
      cancelMarkdownExport: () => { runtime.exportMarkdownDir = null; },
      failHtmlExport: (message: string) => { runtime.exportHtmlError = message; },
      setHealthMode: (mode: typeof runtime.healthMode) => { runtime.healthMode = mode; },
      openMarkdownNext: () => { runtime.openPath = "/mock/traditional.md"; },
      getOpenWindowPaths: () => runtime.openWindowPaths,
      getOpenedUrls: () => runtime.openedUrls,
      getExportPdfCalls: () => runtime.exportPdfCalls,
      setRemotePackageMode: (mode: typeof runtime.remotePackageMode) => { runtime.remotePackageMode = mode; },
      getRemotePackageCalls: () => runtime.remotePackageCalls,
      getKeepOnlineConfirmCalls: () => runtime.keepOnlineConfirmCalls,
      getSaveCalls: () => runtime.saveCalls,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI__ = {
      core: { convertFileSrc },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}

test.describe("Editor core capabilities", () => {
  test("markdown project import packages local resources into an AIMD document", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");

    await page.locator("#empty-import-md-project").click();
    await expect(page.locator("#doc-title")).toContainText("导入项目");
    await expect(page.locator("#doc-path")).toContainText("saved.aimd");
    await page.locator("#mode-source").click();
    const md = await page.locator("#markdown").inputValue();
    expect(md).toContain("asset://img-001");
    expect(md).toContain("| A | B |");
    expect(md).toContain("```js");
  });

  test("source find/replace keeps document changes", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+H" : "Control+H");
    await page.locator("#find-input").fill("Alpha");
    await page.locator("#replace-input").fill("Omega");
    await page.locator("#replace-all").click();

    await expect(page.locator("#markdown")).toHaveValue(/Omega paragraph/);
    await expect(page.locator("#save")).not.toBeDisabled();
  });

  test("source textarea uses native visible selection", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();

    const style = await page.locator("#markdown").evaluate((textarea) => {
      const computed = getComputedStyle(textarea);
      const shell = textarea.closest(".source-editor-shell")!;
      const shellComputed = getComputedStyle(shell);
      return {
        color: computed.color,
        textFill: computed.getPropertyValue("-webkit-text-fill-color"),
        background: computed.backgroundColor,
        position: computed.position,
        overflowWrap: computed.overflowWrap,
        wordBreak: computed.wordBreak,
        overflowY: computed.overflowY,
        shellDisplay: shellComputed.display,
      };
    });
    expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.textFill).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.position).toBe("static");
    expect(style.overflowWrap).toBe("normal");
    expect(style.wordBreak).toBe("normal");
    expect(["auto", "scroll"]).toContain(style.overflowY);
    expect(style.shellDisplay).toBe("flex");

    const selected = await page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement) => {
      textarea.focus();
      textarea.setSelectionRange(0, 8);
      return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    });
    expect(selected.length).toBe(8);

    const hitTarget = await page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement) => {
      textarea.value = Array.from({ length: 160 }, (_, index) => `Line ${index + 1}: source text`).join("\n");
      textarea.scrollTop = textarea.scrollHeight;
      const rect = textarea.getBoundingClientRect();
      return document.elementFromPoint(rect.left + 24, rect.bottom - 24)?.id ?? "";
    });
    expect(hitTarget).toBe("markdown");
  });

  test("table and fenced code block insertion survive edit to source", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    await page.locator('[data-cmd="table"]').click();
    await page.locator('[data-cmd="codeblock"]').click();
    await page.locator("#mode-source").click();

    const md = await page.locator("#markdown").inputValue();
    expect(md).toMatch(/\|\s*列 1\s*\|\s*列 2\s*\|\s*列 3\s*\|/);
    expect(md).toMatch(/```text/);
    expect(md).toContain("code");
  });

  test("image alt edit and task checkbox click update Markdown", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#reader input[type='checkbox']").click();
    await page.locator("#mode-source").click();
    await expect(page.locator("#markdown")).toHaveValue(/- \[x\] todo/);

    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor img").click();
    await page.keyboard.press("Escape");
    await page.locator('[data-cmd="image-alt"]').click();
    await page.locator("#image-alt-input").fill("new alt");
    await page.locator("#image-alt-confirm").click();
    await page.locator("#mode-source").click();

    await expect(page.locator("#markdown")).toHaveValue(/!\[new alt\]\(asset:\/\/img-001\)/);
  });

  test("health check panel and HTML export surface status", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#more-menu-toggle").click();
    await page.locator("#health-check").click();
    await expect(page.locator("#health-panel")).toBeVisible();
    await expect(page.locator("#health-summary")).toContainText("资源风险");
    await expect(page.locator("#health-list")).toContainText("远程图片");
    await expect(page.locator("#health-package-local")).toContainText("嵌入远程图片");
    await expect(page.locator("#health-package-local")).not.toBeDisabled();
    await page.locator("#health-package-local").click();
    await expect(page.locator("#health-summary")).toContainText("资源完整");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#export-html").click();
    await expect(page.locator("#status")).toContainText("已导出 HTML");
  });

  test("action menu labels and enabled states match document format", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#package-local-images")).toContainText("保存为 AIMD");
    await expect(page.locator("#package-local-images")).toBeDisabled();
    await expect(page.locator("#more-menu #web-import")).toContainText("从网页导入");
    await expect(page.locator("#more-menu #web-import")).not.toBeDisabled();
    await expect(page.locator("#more-menu #health-check")).toContainText("资源检查");
    await expect(page.locator("#more-menu #health-check")).not.toBeDisabled();
    await expect(page.locator("#export-markdown")).toContainText("导出 Markdown");
    await expect(page.locator("#export-markdown")).not.toBeDisabled();
    await expect(page.locator("#export-pdf")).toContainText("导出 PDF");
    await expect(page.locator("#export-pdf")).not.toBeDisabled();
    await expect(page.locator("#format-document")).toContainText("一键格式化");
    await expect(page.locator("#format-document")).not.toBeDisabled();
    await expect(page.locator("#more-menu .action-menu-item")).toHaveCount(10);
    await expect(page.locator("#new-window")).toContainText("新建窗口");
    await page.locator("#new-window").click();
    await expect(page.locator("#status")).toContainText("已打开新窗口");
    await expect.poll(() => page.evaluate(() => (window as any).__aimdEditorCoreMock.getOpenWindowPaths())).toEqual([null]);

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.openMarkdownNext());
    await page.locator("#sidebar-open").click();
    await page.locator("#more-menu-toggle").click();
    await expect(page.locator("#package-local-images")).not.toBeDisabled();
    await expect(page.locator("#export-markdown")).toBeDisabled();
  });

  test("plain Markdown resolves local image paths against the Markdown file directory", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.openMarkdownNext());
    await page.locator("#empty-open").click();

    await expect.poll(async () => page.locator("#reader img[alt='local']").evaluate((img: HTMLImageElement) => ({
      src: img.getAttribute("src") || "",
      localPath: img.dataset.aimdLocalImagePath || "",
      naturalWidth: img.naturalWidth,
    }))).toMatchObject({
      src: expect.stringContaining("blob:"),
      localPath: "/mock/images/local.png",
      naturalWidth: 1,
    });

    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# 传统 Markdown\n\n![local](../shared/pic one.png)\n");
    await expect.poll(async () => page.locator("#reader img[alt='local']").evaluate((img: HTMLImageElement) => ({
      src: img.getAttribute("src") || "",
      localPath: img.dataset.aimdLocalImagePath || "",
      naturalWidth: img.naturalWidth,
    }))).toMatchObject({
      src: expect.stringContaining("blob:"),
      localPath: "/shared/pic one.png",
      naturalWidth: 1,
    });
    await page.locator("#mode-read").click();
    await expect.poll(async () => page.locator("#reader img[alt='local']").evaluate((img: HTMLImageElement) => ({
      src: img.getAttribute("src") || "",
      localPath: img.dataset.aimdLocalImagePath || "",
      naturalWidth: img.naturalWidth,
    }))).toMatchObject({
      src: expect.stringContaining("blob:"),
      localPath: "/shared/pic one.png",
      naturalWidth: 1,
    });
  });

  test("export actions surface cancel and failure status", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.cancelMarkdownExport());
    await page.locator("#more-menu-toggle").click();
    await page.locator("#export-markdown").click();
    await expect(page.locator("#status")).toContainText("导出已取消");

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.failHtmlExport("disk full"));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#export-html").click();
    await expect(page.locator("#status")).toContainText("导出 HTML 失败");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#export-pdf").click();
    await expect(page.locator("#status")).toContainText("已导出 PDF");

    const calls = await page.evaluate(() => (window as any).__aimdEditorCoreMock.getExportPdfCalls());
    expect(Object.keys(calls[calls.length - 1])).not.toContain(`debug${"Webkit"}`);
  });

  test("saving AIMD preserves remote images unless explicitly packaged", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#mode-source").click();
    await page.locator("#markdown").fill("# Save Remote\n\n![remote](https://example.com/a.png)\n");
    await expect(page.locator("#save")).not.toBeDisabled();
    await page.locator("#save").click();

    await expect(page.locator("#status")).toContainText("已保存");
    const calls = await page.evaluate(() => (window as any).__aimdEditorCoreMock.getSaveCalls());
    expect(calls[calls.length - 1].markdown).toContain("https://example.com/a.png");
    expect(await page.evaluate(() => (window as any).__aimdEditorCoreMock.getRemotePackageCalls())).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__aimdEditorCoreMock.getKeepOnlineConfirmCalls())).toHaveLength(0);

    await page.locator("#more-menu-toggle").click();
    await page.locator("#health-check").click();
    await page.locator("#health-package-local").click();

    await expect.poll(() => page.evaluate(() => (window as any).__aimdEditorCoreMock.getRemotePackageCalls().length)).toBe(1);
    const packageCalls = await page.evaluate(() => (window as any).__aimdEditorCoreMock.getRemotePackageCalls());
    expect(packageCalls[0].markdown).toContain("https://example.com/a.png");
  });

  test("health panel surfaces missing, unused cleanup, and large asset risks", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.setHealthMode("missing"));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#health-check").click();
    await expect(page.locator("#health-summary")).toContainText("资源缺失");
    await expect(page.locator("#health-list")).toContainText("missing-001");

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.setHealthMode("unused"));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#health-check").click();
    await expect(page.locator("#health-clean-unused")).not.toBeDisabled();
    await page.evaluate(() => (window as any).__aimdEditorCoreMock.setHealthMode("clean"));
    await page.locator("#health-clean-unused").click();
    await expect(page.locator("#health-summary")).toContainText("资源完整");

    await page.evaluate(() => (window as any).__aimdEditorCoreMock.setHealthMode("large"));
    await page.locator("#more-menu-toggle").click();
    await page.locator("#health-check").click();
    await expect(page.locator("#health-list")).toContainText("资源体积较大");
  });

  test("document links open through the system browser command", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();

    await page.locator("#reader a", { hasText: "Example" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__aimdEditorCoreMock.getOpenedUrls()))
      .toEqual(["https://example.com/a"]);

    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor a", { hasText: "Example" }).click({ modifiers: ["Meta"] });
    await expect.poll(() => page.evaluate(() => (window as any).__aimdEditorCoreMock.getOpenedUrls()))
      .toEqual(["https://example.com/a", "https://example.com/a"]);
  });

  test("source editor handles a long Markdown fixture without obvious input lag", async ({ page }) => {
    await installEditorCoreMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-source").click();

    const longMarkdown = Array.from({ length: 600 }, (_, i) =>
      `## Section ${i + 1}\n\nParagraph ${i + 1} with **bold**, \`code\`, and ![img](asset://img-001).`,
    ).join("\n\n");
    const initialElapsed = await page.evaluate(async (value) => {
      const textarea = document.querySelector<HTMLTextAreaElement>("#markdown")!;
      const start = performance.now();
      textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
        data: value.slice(0, 40),
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    }, longMarkdown);
    expect(initialElapsed).toBeLessThan(2000);

    const elapsed = await page.evaluate(async () => {
      const textarea = document.querySelector<HTMLTextAreaElement>("#markdown")!;
      const start = performance.now();
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.value += "\n\nTail paragraph";
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "Tail paragraph",
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    });

    expect(elapsed).toBeLessThan(1000);
    await expect(page.locator("#save")).not.toBeDisabled();
  });
});
