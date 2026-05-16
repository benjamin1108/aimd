import { test, expect, Page } from "@playwright/test";

type Doc = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: unknown[];
  dirty: boolean;
  format: "aimd" | "markdown";
};

const ROOT = "/mock/surface-sync";
const A_PATH = `${ROOT}/Alpha.aimd`;
const B_PATH = `${ROOT}/Beta.aimd`;

const COMPLEX_MARKDOWN = [
  "---",
  "title: Sync Contract",
  "---",
  "",
  "# Sync Contract",
  "",
  "Paragraph D",
  "",
  "- [ ] Task one",
  "",
  "| Name | Score |",
  "| --- | --- |",
  "| Alice | 90 |",
  "",
  "![Chart](asset://asset-chart)",
  "",
  "1. Ordered item",
  "",
].join("\n");

function baseDocs(): Doc[] {
  return [
    doc(A_PATH, "Alpha", "# Alpha\n\nA body\n"),
    doc(B_PATH, "Beta", "# Beta\n\nB body\n"),
  ];
}

function doc(path: string, title: string, markdown: string): Doc {
  return { path, title, markdown, html: renderStatic(markdown), assets: [], dirty: false, format: "aimd" };
}

function renderStatic(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled";
  return `<h1>${title}</h1>`;
}

async function installSurfaceSyncMock(page: Page, docs: Doc[] = baseDocs()) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    type RuntimeDoc = Doc & { html: string };
    const docs = new Map<string, RuntimeDoc>(seed.docs.map((item: Doc) => [item.path, { ...item, html: renderMarkdown(item.markdown) }]));
    let renderSeq = 0;
    const runtime = {
      calls: [] as Array<{ cmd: string; args?: Args }>,
      renders: [] as Array<{ seq: number; markdown: string; done: boolean }>,
      saves: [] as Array<{ path: string; markdown: string }>,
    };

    function escapeHtml(value: string) {
      return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function delayFor(markdown: string) {
      if (markdown.includes("SOURCE_SENTINEL")) return 420;
      if (markdown.includes("A_SOURCE_PENDING_RENDER_SENTINEL")) return 260;
      if (markdown.includes("A_SLOW_RENDER_SENTINEL")) return 480;
      if (markdown.includes("B_FAST_RENDER_SENTINEL")) return 20;
      return 0;
    }

    function renderMarkdown(markdown: string) {
      const lines = markdown.split(/\n/);
      const html: string[] = [];
      let i = 0;
      if (lines[0] === "---") {
        let end = 1;
        while (end < lines.length && lines[end] !== "---") end += 1;
        if (end < lines.length) {
          html.push(`<section class="aimd-frontmatter"><dl><dt>title</dt><dd>Sync Contract</dd></dl></section>`);
          i = end + 1;
        }
      }
      for (; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        if (line.startsWith("# ")) {
          html.push(`<h1>${escapeHtml(line.slice(2).trim())}</h1>`);
        } else if (line.startsWith("## ")) {
          html.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`);
        } else if (/^-\s+\[[ xX]\]\s+/.test(line)) {
          const checked = /\[[xX]\]/.test(line) ? " checked" : "";
          html.push(`<ul><li><input type="checkbox"${checked}> ${escapeHtml(line.replace(/^-\s+\[[ xX]\]\s+/, ""))}</li></ul>`);
        } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) {
          const header = line.split("|").slice(1, -1).map((cell) => `<th>${escapeHtml(cell.trim())}</th>`).join("");
          const row = (lines[i + 2] || "").split("|").slice(1, -1).map((cell) => `<td>${escapeHtml(cell.trim())}</td>`).join("");
          html.push(`<table><thead><tr>${header}</tr></thead><tbody><tr>${row}</tr></tbody></table>`);
          i += 2;
        } else if (/^!\[[^\]]*\]\([^)]+\)/.test(line)) {
          const match = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(line)!;
          html.push(`<p><img alt="${escapeHtml(match[1])}" src="${escapeHtml(match[2])}"></p>`);
        } else if (/^\d+\.\s+/.test(line)) {
          html.push(`<ol><li>${escapeHtml(line.replace(/^\d+\.\s+/, ""))}</li></ol>`);
        } else {
          html.push(`<p>${escapeHtml(line)}</p>`);
        }
      }
      return html.join("");
    }

    async function renderCommand(args: Args) {
      const markdown = String(args?.markdown ?? "");
      const seq = ++renderSeq;
      const record = { seq, markdown, done: false };
      runtime.renders.push(record);
      const delay = delayFor(markdown);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      record.done = true;
      return { html: renderMarkdown(markdown) };
    }

    function workspace() {
      return {
        root: seed.root,
        tree: {
          id: seed.root,
          name: "sync",
          path: seed.root,
          kind: "folder",
          children: [...docs.values()].map((item) => ({
            id: item.path,
            name: item.path.split("/").at(-1),
            path: item.path,
            kind: "document",
            format: "aimd",
          })),
        },
      };
    }

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({ isRepo: false, root: seed.root, clean: true, conflicted: false, files: [] }),
      focus_doc_window: () => null,
      open_aimd: (a) => {
        const opened = docs.get(String(a?.path));
        if (!opened) throw new Error(`missing doc ${String(a?.path)}`);
        return { ...opened };
      },
      render_markdown: renderCommand,
      render_markdown_standalone: renderCommand,
      save_aimd: (a) => {
        const path = String(a?.path ?? "");
        const markdown = String(a?.markdown ?? "");
        runtime.saves.push({ path, markdown });
        const current = docs.get(path)!;
        const next = { ...current, markdown, html: renderMarkdown(markdown), dirty: false };
        docs.set(path, next);
        return { ...next };
      },
      save_markdown: (a) => {
        runtime.saves.push({ path: String(a?.path ?? ""), markdown: String(a?.markdown ?? "") });
        return null;
      },
      choose_save_aimd_file: () => `${seed.root}/Saved.aimd`,
      choose_save_markdown_file: () => `${seed.root}/Saved.md`,
      save_aimd_as: (a) => ({ ...docs.values().next().value, path: String(a?.savePath ?? ""), markdown: String(a?.markdown ?? ""), html: renderMarkdown(String(a?.markdown ?? "")), dirty: false }),
      save_markdown_as: (a) => ({ path: String(a?.savePath ?? ""), markdown: String(a?.markdown ?? "") }),
      choose_export_html_file: () => `${seed.root}/export.html`,
      export_html: () => null,
      check_document_health: () => ({ status: "offline_ready", summary: "OK", counts: { errors: 0, warnings: 0, infos: 0 }, issues: [] }),
      format_markdown: () => ({ needed: false, reason: "clean" }),
      register_window_path: () => null,
      unregister_window_path: () => null,
      update_window_path: () => null,
      confirm_discard_changes: () => "cancel",
    };

    (window as any).__surfaceSyncMock = {
      calls: () => runtime.calls,
      renders: () => runtime.renders,
      saves: () => runtime.saves,
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
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, { root: ROOT, docs });
}

async function openWorkspaceAndDocs(page: Page) {
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();
  await page.locator(".workspace-row", { hasText: "Beta.aimd" }).click();
}

async function activateTab(page: Page, title: string) {
  await page.locator(".open-tab", { hasText: title }).locator(".open-tab-main").click();
}

async function clickSaveMenuItem(page: Page) {
  await page.locator("#more-menu-toggle").click();
  await page.locator("#save").click();
}

async function appendSource(page: Page, text: string) {
  await page.locator("#mode-source").click();
  await page.locator("#markdown").evaluate((el: HTMLTextAreaElement, value: string) => {
    el.value = `${el.value.trimEnd()}\n\n${value}\n`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function waitForRendered(page: Page, text: string) {
  await page.waitForFunction((needle) => {
    return ((window as any).__surfaceSyncMock.renders() as Array<{ markdown: string; done: boolean }>)
      .some((render) => render.done && render.markdown.includes(String(needle)));
  }, text);
}

async function tabVersionState(page: Page, path: string) {
  return page.evaluate(async (targetPath) => {
    const { state } = await import("/src/core/state.ts");
    const tab = state.openDocuments.tabs.find((item) => item.doc.path === targetPath);
    return tab ? {
      markdownVersion: tab.markdownVersion,
      htmlMarkdownVersion: tab.htmlMarkdownVersion,
      pendingRenderVersion: tab.pendingRenderVersion,
      html: tab.doc.html,
    } : null;
  }, path);
}

test("A: source edits render back into their originating tab after an immediate tab switch", async ({ page }) => {
  await installSurfaceSyncMock(page);
  await page.goto("/");
  await openWorkspaceAndDocs(page);

  await activateTab(page, "Alpha");
  await appendSource(page, "A_SOURCE_PENDING_RENDER_SENTINEL");
  await activateTab(page, "Beta");
  await waitForRendered(page, "A_SOURCE_PENDING_RENDER_SENTINEL");

  await expect(page.locator("#reader")).not.toContainText("A_SOURCE_PENDING_RENDER_SENTINEL");
  await activateTab(page, "Alpha");
  await expect(page.locator("#markdown")).toHaveValue(/A_SOURCE_PENDING_RENDER_SENTINEL/);
  await page.locator("#mode-read").click();
  await expect(page.locator("#reader")).toContainText("A_SOURCE_PENDING_RENDER_SENTINEL");
  await page.locator("#mode-source").click();
  await expect(page.locator("#preview")).toContainText("A_SOURCE_PENDING_RENDER_SENTINEL");
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toContainText("A_SOURCE_PENDING_RENDER_SENTINEL");

  const alpha = await tabVersionState(page, A_PATH);
  expect(alpha?.htmlMarkdownVersion).toBe(alpha?.markdownVersion);
  expect(alpha?.html).toContain("A_SOURCE_PENDING_RENDER_SENTINEL");
});

test("B: entering visual edit while render is pending keeps the editor non-editable until current HTML arrives", async ({ page }) => {
  await installSurfaceSyncMock(page, [doc(A_PATH, "Alpha", "# Alpha\n\nA body\n")]);
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();

  await appendSource(page, "SOURCE_SENTINEL");
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => page.locator("#inline-editor").evaluate((el: HTMLElement) => el.isContentEditable)).toBe(false);

  await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
    el.textContent = `${el.textContent} VISUAL_SENTINEL`;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "VISUAL_SENTINEL" }));
  });
  await waitForRendered(page, "SOURCE_SENTINEL");
  await expect(page.locator("#inline-editor")).toContainText("SOURCE_SENTINEL");
  await expect(page.locator("#inline-editor")).not.toContainText("VISUAL_SENTINEL");

  await clickSaveMenuItem(page);
  await expect.poll(() => page.evaluate(() => (window as any).__surfaceSyncMock.saves())).toHaveLength(1);
  const saved = await page.evaluate(() => (window as any).__surfaceSyncMock.saves().at(-1).markdown as string);
  expect(saved).toContain("SOURCE_SENTINEL");
  expect(saved).not.toContain("VISUAL_SENTINEL");
});

test("C: failed visual flush blocks save, save-as, export, health check, and format", async ({ page }) => {
  await installSurfaceSyncMock(page, [doc(A_PATH, "Alpha", "# Alpha\n\nA body\n")]);
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();
  await page.locator("#mode-edit").click();

  await page.locator("#inline-editor").evaluate((el: HTMLElement) => {
    const p = document.createElement("p");
    p.textContent = "UNSAFE_STRUCTURAL_EDIT";
    el.insertBefore(p, el.firstChild);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertParagraph" }));
  });

  await page.evaluate(async () => {
    const persist = await import("/src/document/persist.ts");
    const exports = await import("/src/document/export.ts");
    const health = await import("/src/document/health.ts");
    const format = await import("/src/document/format.ts");
    await persist.saveDocument();
    await persist.saveDocumentAs();
    await exports.exportHTML();
    await health.runHealthCheck();
    await format.formatCurrentDocument();
  });

  const calls = await page.evaluate(() => (window as any).__surfaceSyncMock.calls().map((call: any) => call.cmd));
  expect(calls).not.toContain("save_aimd");
  expect(calls).not.toContain("save_aimd_as");
  expect(calls).not.toContain("save_markdown_as");
  expect(calls).not.toContain("export_html");
  expect(calls).not.toContain("check_document_health");
  expect(calls).not.toContain("format_markdown");
  await expect(page.locator("#save")).not.toBeDisabled();
  await expect(page.locator("#status")).toContainText("不能安全保持 Markdown 原文");
});

test("D: task checkbox markdown mutation stays source-model synchronized before adjacent visual edits", async ({ page }) => {
  await installSurfaceSyncMock(page, [doc(A_PATH, "Alpha", COMPLEX_MARKDOWN)]);
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();

  await page.locator('#reader input[type="checkbox"]').click();
  await page.locator("#mode-edit").click();
  await waitForRendered(page, "- [x] Task one");
  await expect(page.locator("#inline-editor")).toContainText("Paragraph D");
  await page.locator("#inline-editor p", { hasText: "Paragraph D" }).evaluate((el: HTMLElement) => {
    el.textContent = "Paragraph D VISUAL_D";
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " VISUAL_D" }));
  });
  await clickSaveMenuItem(page);
  await expect.poll(() => page.evaluate(() => (window as any).__surfaceSyncMock.saves())).toHaveLength(1);
  const saved = await page.evaluate(() => (window as any).__surfaceSyncMock.saves().at(-1).markdown as string);

  expect(saved).toContain("---\ntitle: Sync Contract\n---");
  expect(saved).toContain("Paragraph D VISUAL_D");
  expect(saved).toContain("- [x] Task one");
  expect(saved).toContain("| Alice | 90 |");
  expect(saved).toContain("![Chart](asset://asset-chart)");
  expect(saved).toContain("1. Ordered item");
});

test("E: slow render from one tab updates that tab only and never repaints the active tab", async ({ page }) => {
  await installSurfaceSyncMock(page);
  await page.goto("/");
  await openWorkspaceAndDocs(page);

  await activateTab(page, "Alpha");
  await appendSource(page, "A_SLOW_RENDER_SENTINEL");
  await activateTab(page, "Beta");
  await appendSource(page, "B_FAST_RENDER_SENTINEL");
  await waitForRendered(page, "B_FAST_RENDER_SENTINEL");
  await expect(page.locator("#preview")).toContainText("B_FAST_RENDER_SENTINEL");
  await waitForRendered(page, "A_SLOW_RENDER_SENTINEL");
  await expect(page.locator("#preview")).toContainText("B_FAST_RENDER_SENTINEL");
  await expect(page.locator("#preview")).not.toContainText("A_SLOW_RENDER_SENTINEL");

  await activateTab(page, "Alpha");
  await page.locator("#mode-read").click();
  await expect(page.locator("#reader")).toContainText("A_SLOW_RENDER_SENTINEL");
  const alpha = await tabVersionState(page, A_PATH);
  const beta = await tabVersionState(page, B_PATH);
  expect(alpha?.htmlMarkdownVersion).toBe(alpha?.markdownVersion);
  expect(beta?.htmlMarkdownVersion).toBe(beta?.markdownVersion);
});

test("F: saving from source, edit, and read leaves markdown, HTML, dirty state, and surfaces aligned", async ({ page }) => {
  await installSurfaceSyncMock(page, [doc(A_PATH, "Alpha", COMPLEX_MARKDOWN)]);
  await page.goto("/");
  await page.locator("#empty-open-workspace").click();
  await page.locator(".workspace-row", { hasText: "Alpha.aimd" }).click();

  await appendSource(page, "SOURCE_SAVE_SENTINEL");
  await waitForRendered(page, "SOURCE_SAVE_SENTINEL");
  await clickSaveMenuItem(page);
  await expect.poll(() => page.evaluate(() => (window as any).__surfaceSyncMock.saves().length)).toBe(1);
  await expectAllSurfacesContain(page, "SOURCE_SAVE_SENTINEL");

  await page.locator("#mode-edit").click();
  await page.locator("#inline-editor p", { hasText: "Paragraph D" }).evaluate((el: HTMLElement) => {
    el.textContent = "Paragraph D EDIT_SAVE_SENTINEL";
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " EDIT_SAVE_SENTINEL" }));
  });
  await clickSaveMenuItem(page);
  await expect.poll(() => page.evaluate(() => (window as any).__surfaceSyncMock.saves().length)).toBe(2);
  await expectAllSurfacesContain(page, "EDIT_SAVE_SENTINEL");

  await page.locator("#mode-read").click();
  await page.locator('#reader input[type="checkbox"]').click();
  await waitForRendered(page, "- [x] Task one");
  await clickSaveMenuItem(page);
  await expect.poll(() => page.evaluate(() => (window as any).__surfaceSyncMock.saves().length)).toBe(3);

  const stateAfterSave = await tabVersionState(page, A_PATH);
  expect(stateAfterSave?.pendingRenderVersion).toBeNull();
  expect(stateAfterSave?.htmlMarkdownVersion).toBe(stateAfterSave?.markdownVersion);
  await expect(page.locator("#save")).toBeDisabled();
  const latest = await page.evaluate(() => (window as any).__surfaceSyncMock.saves().at(-1).markdown as string);
  expect(latest).toContain("SOURCE_SAVE_SENTINEL");
  expect(latest).toContain("EDIT_SAVE_SENTINEL");
  expect(latest).toContain("- [x] Task one");
});

test("G: pending-render placeholder from one tab never masks another tab's painted surface", async ({ page }) => {
  await installSurfaceSyncMock(page);
  await page.goto("/");
  await openWorkspaceAndDocs(page);

  await activateTab(page, "Alpha");
  await appendSource(page, "SOURCE_SENTINEL");

  await activateTab(page, "Beta");
  await page.locator("#mode-source").click();
  await expect(page.locator("#preview h1")).toHaveText("Beta");

  await activateTab(page, "Alpha");
  await expect(page.locator("#preview")).toContainText("正在同步");

  await activateTab(page, "Beta");
  await expect(page.locator("#preview h1")).toHaveText("Beta");
  await expect(page.locator("#preview")).not.toContainText("正在同步");

  await waitForRendered(page, "SOURCE_SENTINEL");
  await expect(page.locator("#preview h1")).toHaveText("Beta");
  await expect(page.locator("#preview")).not.toContainText("SOURCE_SENTINEL");
});

async function expectAllSurfacesContain(page: Page, text: string) {
  await page.locator("#mode-source").click();
  await expect(page.locator("#markdown")).toHaveValue(new RegExp(text));
  await expect(page.locator("#preview")).toContainText(text);
  await page.locator("#mode-read").click();
  await expect(page.locator("#reader")).toContainText(text);
  await page.locator("#mode-edit").click();
  await expect(page.locator("#inline-editor")).toContainText(text);
}
