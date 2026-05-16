import { test, expect, Page } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const DOC = {
  path: "/mock/repo/docs/surface.aimd",
  title: "Surface Contract",
  markdown: [
    "---",
    "summary: Unified surface",
    "---",
    "# Surface Contract",
    "",
    "[Text link](https://example.com/text)",
    "",
    "[![Linked asset](asset://asset-chart)](https://example.com/media)",
    "",
    "![local](./local.png)",
    "",
    "- [ ] Review rendered surface",
    "",
    "```ts",
    "const surface = true;",
    "```",
    "",
    "## Chapter",
  ].join("\n"),
  assets: [{
    id: "asset-chart",
    path: "assets/chart.png",
    mime: "image/png",
    size: 68,
    sha256: "chart",
    role: "content-image",
    url: "/mock/chart.png",
    localPath: "/mock/chart.png",
  }],
  dirty: false,
  format: "aimd" as const,
};

async function installRenderedSurfaceMock(page: Page) {
  await page.addInitScript(({ doc, pngBase64 }) => {
    type Args = Record<string, any> | undefined;
    const root = "/mock/repo";
    const openedUrls: string[] = [];
    const currentDoc = { ...doc, html: renderMarkdown(doc.markdown) };

    function pngBytes() {
      return Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    }

    function hasFrontmatter(markdown: string) {
      return markdown.startsWith("---\n") && markdown.indexOf("\n---", 4) > 0;
    }

    function renderMarkdown(markdown: string) {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Surface Contract";
      const checked = /-\s+\[[xX]\]\s+Review rendered surface/.test(markdown) ? " checked" : "";
      const frontmatter = hasFrontmatter(markdown)
        ? '<section class="aimd-frontmatter"><dl><dt>summary</dt><dd>Unified surface</dd></dl></section>'
        : "";
      return [
        frontmatter,
        `<h1>${title}</h1>`,
        '<p><a href="https://example.com/text">Text link</a></p>',
        '<p><a href="https://example.com/media"><img src="asset://asset-chart" alt="Linked asset"></a></p>',
        '<p><img src="./local.png" alt="local"></p>',
        `<ul><li><input type="checkbox"${checked}> Review rendered surface</li></ul>`,
        "<pre><code>const surface = true;</code></pre>",
        "<h2>Chapter</h2>",
      ].join("");
    }

    function workspace() {
      return {
        root,
        tree: {
          id: root,
          name: "repo",
          path: root,
          kind: "folder",
          children: [{
            id: doc.path,
            name: "surface.aimd",
            path: doc.path,
            kind: "document",
            format: "aimd",
            modifiedAt: "2026-05-16T00:00:00Z",
          }],
          modifiedAt: "2026-05-16T00:00:00Z",
        },
      };
    }

    function gitDiff() {
      const added = doc.markdown.split("\n").map((line) => `+${line}`).join("\n");
      return {
        path: "docs/surface.md",
        stagedDiff: `diff --git a/docs/surface.md b/docs/surface.md\n@@ -0,0 +1,18 @@\n${added}`,
        unstagedDiff: "",
        isBinary: false,
        truncated: false,
      };
    }

    const handlers: Record<string, (a: Args) => unknown> = {
      load_settings: () => ({ ui: { showAssetPanel: false, debugMode: false } }),
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      choose_doc_file: () => doc.path,
      choose_aimd_file: () => doc.path,
      open_aimd: () => currentDoc,
      render_markdown: (a) => ({ html: renderMarkdown(String(a?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: renderMarkdown(String(a?.markdown ?? "")) }),
      list_aimd_assets: () => doc.assets,
      read_image_bytes: () => pngBytes(),
      open_external_url: (a) => {
        openedUrls.push(String(a?.url ?? ""));
        return null;
      },
      get_git_repo_status: () => ({
        isRepo: true,
        root,
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        clean: false,
        conflicted: false,
        files: [{ path: "docs/surface.md", staged: "modified", unstaged: "none", kind: "modified" }],
      }),
      get_git_file_diff: () => gitDiff(),
      git_stage_file: () => null,
      git_unstage_file: () => null,
      git_stage_all: () => null,
      git_unstage_all: () => null,
      git_commit: () => null,
      git_pull: () => null,
      git_push: () => null,
    };

    window.localStorage.clear();
    (window as any).__aimdRenderedSurfaceMock = {
      openedUrls: () => openedUrls,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: unknown) => callback,
      convertFileSrc: (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI__ = {
      core: { invoke: (cmd: string, args?: Args) => (window as any).__TAURI_INTERNALS__.invoke(cmd, args) },
    };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, { doc: DOC, pngBase64: PNG_BASE64 });
}

async function openedUrls(page: Page) {
  return page.evaluate(() => (window as any).__aimdRenderedSurfaceMock.openedUrls() as string[]);
}

async function expectDocumentSurface(
  page: Page,
  root: string,
  options: { frontmatter: boolean; codeCopy: boolean; sourceRefs: boolean; aimdAsset: boolean; localMarkdownImage: boolean },
) {
  await expect(page.locator(`${root} h1`)).toHaveAttribute("id", /aimd-heading-/);
  await expect(page.locator(`${root} a[href="https://example.com/text"]`)).toHaveAttribute("data-external-link", "true");
  await expect(page.locator(`${root} a[href="https://example.com/media"]`)).toHaveAttribute("data-external-media-link", "true");
  await expect(page.locator(`${root} img[alt="Linked asset"]`)).toHaveCount(1);
  if (options.aimdAsset) {
    await expect(page.locator(`${root} img[alt="Linked asset"]`)).toHaveAttribute("data-asset-id", "asset-chart");
  }
  await expect(page.locator(`${root} img[alt="local"]`)).toHaveCount(1);
  if (options.localMarkdownImage) {
    await expect(page.locator(`${root} img[alt="local"]`)).toHaveAttribute("data-aimd-markdown-src", "./local.png");
  }
  await expect(page.locator(`${root} input[type="checkbox"]`)).toBeEnabled();
  await expect(page.locator(`${root} .aimd-frontmatter`)).toHaveCount(options.frontmatter ? 1 : 0);
  await expect(page.locator(`${root} .code-copy`)).toHaveCount(options.codeCopy ? 1 : 0);
  const sourceRefs = await page.locator(`${root} [data-md-source-ref]`).count();
  expect(sourceRefs > 0).toBe(options.sourceRefs);
}

async function exerciseLinkAndImageBehavior(page: Page, root: string) {
  const textLink = page.locator(`${root} a[href="https://example.com/text"]`);
  const linkedImage = page.locator(`${root} a[href="https://example.com/media"] img`);
  const plainImage = page.locator(`${root} img[alt="local"]`);
  const before = await openedUrls(page);

  await textLink.click();
  await expect(page.locator("#status")).toContainText("按 Ctrl/⌘ 点击打开链接");
  await expect.poll(() => openedUrls(page)).toEqual(before);

  await textLink.hover();
  await expect(page.locator("#status")).toContainText("按 Ctrl/⌘ 点击打开链接");
  await page.locator("#status-pill").hover();
  await expect(page.locator("#status")).not.toContainText("按 Ctrl/⌘ 点击打开链接");

  await textLink.click({ modifiers: [MOD] });
  await expect.poll(() => openedUrls(page)).toEqual([...before, "https://example.com/text"]);

  await linkedImage.click();
  await expect(page.locator("#aimd-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => openedUrls(page)).toEqual([...before, "https://example.com/text"]);

  await linkedImage.click({ modifiers: [MOD] });
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => openedUrls(page)).toEqual([...before, "https://example.com/text", "https://example.com/media"]);

  await plainImage.click();
  await expect(page.locator("#aimd-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
}

test("document rendered markdown surfaces share one pipeline and interaction contract", async ({ page }) => {
  await installRenderedSurfaceMock(page);
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "surface.aimd" }).click();

  await expectDocumentSurface(page, "#reader", {
    frontmatter: true,
    codeCopy: true,
    sourceRefs: false,
    aimdAsset: true,
    localMarkdownImage: false,
  });
  await exerciseLinkAndImageBehavior(page, "#reader");

  await page.locator('#reader input[type="checkbox"]').click();
  await expect.poll(() => page.locator("#markdown").inputValue()).toContain("- [x] Review rendered surface");

  await page.locator("#mode-source").click();
  await expect(page.locator("#source-banner")).toBeHidden();
  const editorTag = await page.locator(".editor-pane .pane-tag").boundingBox();
  const previewTag = await page.locator(".preview-pane .pane-tag").boundingBox();
  expect(editorTag && previewTag).toBeTruthy();
  expect(Math.abs(editorTag!.y - previewTag!.y)).toBeLessThanOrEqual(1);
  await expectDocumentSurface(page, "#preview", {
    frontmatter: true,
    codeCopy: true,
    sourceRefs: false,
    aimdAsset: true,
    localMarkdownImage: false,
  });
  await exerciseLinkAndImageBehavior(page, "#preview");

  await page.locator("#mode-edit").click();
  await expectDocumentSurface(page, "#inline-editor", {
    frontmatter: false,
    codeCopy: false,
    sourceRefs: true,
    aimdAsset: true,
    localMarkdownImage: false,
  });
  await exerciseLinkAndImageBehavior(page, "#inline-editor");

  await page.locator("#sidebar-tab-git").click();
  await page.locator(".git-file-row[data-path='docs/surface.md']").locator("[data-git-action='select']").click();
  await expect(page.locator("#git-diff-view")).toBeVisible();
  await expect(page.locator("#git-diff-rendered-surface")).toHaveCount(0);
  await expect(page.locator("#git-diff-view")).not.toContainText("Markdown 渲染预览");
  await expect(page.locator(".git-diff-line.is-add", { hasText: "+[Text link](https://example.com/text)" })).toHaveCount(1);
});
