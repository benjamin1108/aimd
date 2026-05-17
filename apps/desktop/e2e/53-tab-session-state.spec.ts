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

type Fingerprint = { mtimeMs: number; size: number };

const SESSION_KEY = "aimd.desktop.session";
const LAST_KEY = "aimd.desktop.last";
const ROOT = "/mock/session";
const DOC_A_PATH = `${ROOT}/Alpha.aimd`;
const DOC_B_PATH = `${ROOT}/Beta.aimd`;
const MISSING_PATH = `${ROOT}/Missing.aimd`;

function markdownFor(title: string, label: string) {
  return [`# ${title}`, "", ...Array.from({ length: 80 }, (_, i) => `${label} line ${i + 1}`)].join("\n\n");
}

function renderMarkdown(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled";
  const body = markdown
    .split(/\n\n+/)
    .slice(1)
    .map((line) => `<p>${line}</p>`)
    .join("");
  return `<h1>${title}</h1>${body}`;
}

const DOC_A: Doc = {
  path: DOC_A_PATH,
  title: "Alpha",
  markdown: markdownFor("Alpha", "A"),
  html: renderMarkdown(markdownFor("Alpha", "A")),
  assets: [],
  dirty: false,
  format: "aimd",
};

const DOC_B: Doc = {
  path: DOC_B_PATH,
  title: "Beta",
  markdown: markdownFor("Beta", "B"),
  html: renderMarkdown(markdownFor("Beta", "B")),
  assets: [],
  dirty: false,
  format: "aimd",
};

const BASE_FINGERPRINTS: Record<string, Fingerprint> = {
  [DOC_A_PATH]: { mtimeMs: 100, size: 1000 },
  [DOC_B_PATH]: { mtimeMs: 200, size: 2000 },
};

async function installSessionMock(
  page: Page,
  options: {
    docs?: Doc[];
    session?: unknown;
    initialPath?: string | null;
    missingPaths?: string[];
    fingerprints?: Record<string, Fingerprint>;
    saveAsPath?: string | null;
  } = {},
) {
  await page.addInitScript((seed) => {
    type Args = Record<string, any> | undefined;
    const docs = new Map<string, Doc>(seed.docs.map((doc: Doc) => [doc.path, doc]));
    const missing = new Set<string>(seed.missingPaths);
    const fingerprints = new Map<string, Fingerprint>(Object.entries(seed.fingerprints));
    const render = (markdown: string) => {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled";
      const body = markdown
        .split(/\n\n+/)
        .slice(1)
        .map((line) => `<p>${line}</p>`)
        .join("");
      return `<h1>${title}</h1>${body}`;
    };
    const runtime = {
      calls: [] as Array<{ cmd: string; args?: Args }>,
      registered: [] as string[],
      fingerprintCalls: [] as string[],
      initialPathServed: false,
    };

    if (seed.session === undefined) {
      localStorage.removeItem(seed.sessionKey);
    } else {
      localStorage.setItem(seed.sessionKey, JSON.stringify(seed.session));
    }
    localStorage.removeItem(seed.lastKey);

    const workspace = () => ({
      root: seed.root,
      tree: { id: seed.root, name: "session", path: seed.root, kind: "folder", children: [] },
    });
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => {
        if (runtime.initialPathServed) return null;
        runtime.initialPathServed = true;
        return seed.initialPath || null;
      },
      initial_draft_path: () => null,
      cleanup_old_drafts: () => null,
      open_workspace_dir: () => workspace(),
      read_workspace_tree: () => workspace(),
      get_git_repo_status: () => ({ isRepo: false, root: seed.root, clean: true, conflicted: false, files: [] }),
      focus_doc_window: () => null,
      open_aimd: (a) => {
        const path = String(a?.path ?? "");
        if (missing.has(path)) throw new Error(`missing doc ${path}`);
        const doc = docs.get(path);
        if (!doc) throw new Error(`unknown doc ${path}`);
        return { ...doc };
      },
      convert_md_to_draft: (a) => {
        const path = String(a?.markdownPath ?? "");
        if (missing.has(path)) throw new Error(`missing markdown ${path}`);
        const doc = docs.get(path);
        if (!doc) throw new Error(`unknown markdown ${path}`);
        return { title: doc.title, markdown: doc.markdown, html: doc.html };
      },
      render_markdown: (a) => ({ html: render(String(a?.markdown ?? "")) }),
      render_markdown_standalone: (a) => ({ html: render(String(a?.markdown ?? "")) }),
      document_file_fingerprint: (a) => {
        const path = String(a?.path ?? "");
        runtime.fingerprintCalls.push(path);
        const fingerprint = fingerprints.get(path);
        if (!fingerprint) throw new Error(`no fingerprint ${path}`);
        return fingerprint;
      },
      register_window_path: (a) => {
        runtime.registered.push(String(a?.path ?? ""));
        return null;
      },
      unregister_window_path: () => null,
      update_window_path: () => null,
      confirm_discard_changes: () => "discard",
      save_aimd: (a) => {
        const path = String(a?.path ?? "");
        const markdown = String(a?.markdown ?? "");
        const current = docs.get(path);
        if (!current) throw new Error(`unknown save ${path}`);
        const next = { ...current, markdown, html: render(markdown), dirty: false };
        docs.set(path, next);
        return next;
      },
      choose_save_aimd_file: () => seed.saveAsPath || null,
      choose_save_markdown_file: () => seed.saveAsPath || null,
      save_aimd_as: (a) => {
        const sourcePath = String(a?.path ?? "");
        const savePath = String(a?.savePath ?? "");
        const markdown = String(a?.markdown ?? "");
        const source = docs.get(sourcePath) || docs.values().next().value;
        if (!source) throw new Error(`unknown save-as source ${sourcePath}`);
        const next = {
          ...source,
          path: savePath,
          title: savePath.split("/").at(-1)?.replace(/\.aimd$/i, "") || source.title,
          markdown,
          html: render(markdown),
          dirty: false,
          format: "aimd" as const,
        };
        docs.set(savePath, next);
        return next;
      },
      save_markdown: () => null,
    };

    (window as any).__aimdSessionMock = {
      calls: () => runtime.calls,
      registered: () => runtime.registered,
      fingerprintCalls: () => runtime.fingerprintCalls,
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
  }, {
    root: ROOT,
    docs: options.docs || [DOC_A, DOC_B],
    session: options.session,
    initialPath: options.initialPath || null,
    missingPaths: options.missingPaths || [],
    fingerprints: options.fingerprints || BASE_FINGERPRINTS,
    saveAsPath: options.saveAsPath || null,
    sessionKey: SESSION_KEY,
    lastKey: LAST_KEY,
  });
}

async function routePath(page: Page, path: string) {
  await page.evaluate(async (targetPath) => {
    const { routeOpenedPath } = await import("/src/document/lifecycle.ts");
    await routeOpenedPath(targetPath);
  }, path);
}

test.describe("Tab session state", () => {
  test("restores multiple tabs, active mode, source selection, scroll, and is idempotent", async ({ page }) => {
    const session = {
      schemaVersion: 2,
      activeTabId: "beta-tab",
      tabs: [
        { kind: "path", id: "alpha-tab", path: DOC_A_PATH, title: "Alpha", format: "aimd", mode: "read", scroll: { read: 160 } },
        {
          kind: "path",
          id: "beta-tab",
          path: DOC_B_PATH,
          title: "Beta",
          format: "aimd",
          mode: "source",
          scroll: { source: 140 },
          sourceSelection: { start: 8, end: 16, direction: "forward" },
        },
      ],
      drafts: [],
    };
    await installSessionMock(page, { session });
    await page.goto("/");

    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Beta");
    await expect(page.locator("#mode-edit")).toHaveClass(/active/);
    await expect.poll(() => page.locator("#markdown").evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
    }))).toEqual({ start: 8, end: 16 });
    await expect.poll(() => page.locator("#preview").evaluate((el: HTMLElement) => el.scrollTop)).toBeGreaterThan(0);
    const callsAfterCleanRestore = await page.evaluate(() => (window as any).__aimdSessionMock.calls());
    expect(callsAfterCleanRestore.filter((call: any) => call.cmd.startsWith("render_markdown"))).toHaveLength(0);

    await page.evaluate(async () => {
      const { restoreSession } = await import("/src/session/snapshot.ts");
      await restoreSession();
    });
    await expect(page.locator(".open-tab")).toHaveCount(2);
    const callsAfterIdempotentRestore = await page.evaluate(() => (window as any).__aimdSessionMock.calls());
    expect(callsAfterIdempotentRestore.filter((call: any) => call.cmd === "open_aimd")).toHaveLength(2);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    await expect(page.locator("#mode-read")).toHaveClass(/active/);
    await expect.poll(() => page.locator("#reader").evaluate((el: HTMLElement) => el.scrollTop)).toBeGreaterThan(0);

    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await expect(page.locator("#mode-edit")).toHaveClass(/active/);
    await expect.poll(() => page.locator("#preview").evaluate((el: HTMLElement) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await page.locator(".open-tab", { hasText: "Beta" }).locator(".open-tab-main").click();
    await expect(page.locator(".open-tab.is-dirty")).toHaveCount(0);
  });

  test("persists a V2 session snapshot with dirty path working copy and view state", async ({ page }) => {
    await installSessionMock(page);
    await page.goto("/");
    await routePath(page, DOC_A_PATH);
    await routePath(page, DOC_B_PATH);

    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    await expect.poll(() => page.evaluate((path) => (
      (window as any).__aimdSessionMock.fingerprintCalls() as string[]
    ).includes(path), DOC_A_PATH)).toBe(true);
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").evaluate((el: HTMLTextAreaElement) => {
      el.value = "# Alpha\n\nUnsaved local copy";
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
        data: "Unsaved local copy",
      }));
    });
    await expect(page.locator("#markdown")).toHaveValue("# Alpha\n\nUnsaved local copy");
    await page.locator("#markdown").evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(10, 17, "forward");
      el.scrollTop = 55;
    });
    await page.evaluate(() => {
      const preview = document.querySelector<HTMLElement>("#preview")!;
      preview.scrollTop = 80;
    });
    await page.evaluate(async () => {
      const { persistSessionSnapshot } = await import("/src/session/snapshot.ts");
      persistSessionSnapshot();
    });

    const snapshot = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SESSION_KEY);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.tabs).toHaveLength(2);
    const alpha = snapshot.tabs.find((tab: any) => tab.path === DOC_A_PATH);
    expect(alpha.mode).toBe("edit");
    expect(alpha.sourceSelection).toMatchObject({ start: 10, end: 17, direction: "forward" });
    expect(alpha.dirtyWorkingCopy).toMatchObject({
      markdown: "# Alpha\n\nUnsaved local copy",
      baseFileMtime: 100,
      baseFileSize: 1000,
    });
  });

  test("restores a dirty path working copy and warns when the disk fingerprint changed", async ({ page }) => {
    const session = {
      schemaVersion: 2,
      activeTabId: "alpha-tab",
      tabs: [{
        kind: "path",
        id: "alpha-tab",
        path: DOC_A_PATH,
        title: "Alpha",
        format: "aimd",
        mode: "read",
        dirtyWorkingCopy: {
          markdown: "# Alpha\n\nUnsaved after disk change",
          baseFileMtime: 100,
          baseFileSize: 1000,
        },
      }],
      drafts: [],
    };
    await installSessionMock(page, {
      session,
      fingerprints: { ...BASE_FINGERPRINTS, [DOC_A_PATH]: { mtimeMs: 999, size: 1000 } },
    });
    await page.goto("/");

    await expect(page.locator(".open-tab.is-dirty", { hasText: "Alpha" })).toBeVisible();
    await expect(page.locator("#status")).toContainText("磁盘文件已变化");
    await page.locator("#mode-edit").click();
    await expect(page.locator("#markdown")).toHaveValue("# Alpha\n\nUnsaved after disk change");
  });

  test("skips unavailable clean path tabs while restoring usable tabs", async ({ page }) => {
    const session = {
      schemaVersion: 2,
      activeTabId: "missing-tab",
      tabs: [
        { kind: "path", id: "alpha-tab", path: DOC_A_PATH, title: "Alpha", format: "aimd", mode: "read" },
        { kind: "path", id: "missing-tab", path: MISSING_PATH, title: "Missing", format: "aimd", mode: "read" },
      ],
      drafts: [],
    };
    await installSessionMock(page, { session, missingPaths: [MISSING_PATH] });
    await page.goto("/");

    await expect(page.locator(".open-tab")).toHaveCount(1);
    await expect(page.locator("#doc-title")).toHaveText("Alpha");
    await expect(page.locator("#status")).toContainText("部分文件不可用");
  });

  test("restores a dirty draft together with a clean path-backed tab", async ({ page }) => {
    const session = {
      schemaVersion: 2,
      activeTabId: "draft-tab",
      tabs: [
        { kind: "path", id: "alpha-tab", path: DOC_A_PATH, title: "Alpha", format: "aimd", mode: "read" },
        { kind: "draft", id: "draft-tab", draftId: "draft-tab", title: "Draft", format: "aimd", mode: "source" },
      ],
      drafts: [{
        id: "draft-tab",
        title: "Draft",
        markdown: "# Draft\n\nUnsaved draft body",
        format: "aimd",
      }],
    };
    await installSessionMock(page, { session });
    await page.goto("/");

    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Draft");
    await expect(page.locator(".open-tab.is-dirty", { hasText: "Draft" })).toBeVisible();
    await page.locator(".open-tab", { hasText: "Alpha" }).locator(".open-tab-main").click();
    await expect(page.locator(".open-tab.is-dirty", { hasText: "Alpha" })).toHaveCount(0);
  });

  test("routes initial open path after session restore without duplicating restored tabs", async ({ page }) => {
    const session = {
      schemaVersion: 2,
      activeTabId: "alpha-tab",
      tabs: [
        { kind: "path", id: "alpha-tab", path: DOC_A_PATH, title: "Alpha", format: "aimd", mode: "read" },
        { kind: "path", id: "beta-tab", path: DOC_B_PATH, title: "Beta", format: "aimd", mode: "read" },
      ],
      drafts: [],
    };
    await installSessionMock(page, { session, initialPath: DOC_B_PATH });
    await page.goto("/");

    await expect(page.locator(".open-tab")).toHaveCount(2);
    await expect(page.locator("#doc-title")).toHaveText("Beta");
    const calls = await page.evaluate(() => (window as any).__aimdSessionMock.calls());
    expect(calls.filter((call: any) => call.cmd === "open_aimd")).toHaveLength(2);
  });

  test("save as after restore updates the persisted path for the active tab", async ({ page }) => {
    const saveAsPath = `${ROOT}/Alpha Copy.aimd`;
    const session = {
      schemaVersion: 2,
      activeTabId: "alpha-tab",
      tabs: [{ kind: "path", id: "alpha-tab", path: DOC_A_PATH, title: "Alpha", format: "aimd", mode: "read" }],
      drafts: [],
    };
    await installSessionMock(page, { session, saveAsPath });
    await page.goto("/");
    await expect(page.locator("#doc-title")).toHaveText("Alpha");

    const saveTask = page.evaluate(async () => {
      const { saveDocumentAs } = await import("/src/document/persist.ts");
      await saveDocumentAs();
    });
    await expect(page.locator("#save-format-aimd")).toBeVisible();
    await page.locator("#save-format-aimd").click();
    await saveTask;
    const saveCalls = await page.evaluate(() => (window as any).__aimdSessionMock.calls());
    expect(saveCalls.map((call: any) => call.cmd)).toContain("save_aimd_as");
    expect(saveCalls.find((call: any) => call.cmd === "save_aimd_as")?.args).toMatchObject({
      path: DOC_A_PATH,
      savePath: saveAsPath,
    });
    await expect(page.locator("#doc-path")).toContainText(saveAsPath);
    await page.evaluate(async () => {
      const { persistSessionSnapshot } = await import("/src/session/snapshot.ts");
      persistSessionSnapshot();
    });
    const snapshot = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SESSION_KEY);
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0].path).toBe(saveAsPath);
  });

  test("restoring ten clean path-backed tabs does not render inactive markdown", async ({ page }) => {
    const docs = Array.from({ length: 10 }, (_, index): Doc => {
      const path = `${ROOT}/Doc-${index + 1}.aimd`;
      const markdown = markdownFor(`Doc ${index + 1}`, `D${index + 1}`);
      return {
        path,
        title: `Doc ${index + 1}`,
        markdown,
        html: renderMarkdown(markdown),
        assets: [],
        dirty: false,
        format: "aimd",
      };
    });
    const session = {
      schemaVersion: 2,
      activeTabId: "doc-1",
      tabs: docs.map((doc, index) => ({
        kind: "path",
        id: `doc-${index + 1}`,
        path: doc.path,
        title: doc.title,
        format: "aimd",
        mode: "read",
      })),
      drafts: [],
    };
    await installSessionMock(page, { docs, session });
    await page.goto("/");

    await expect(page.locator(".open-tab")).toHaveCount(10);
    await expect(page.locator("#doc-title")).toHaveText("Doc 1");
    const calls = await page.evaluate(() => (window as any).__aimdSessionMock.calls());
    expect(calls.filter((call: any) => call.cmd === "open_aimd")).toHaveLength(10);
    expect(calls.filter((call: any) => call.cmd.startsWith("render_markdown"))).toHaveLength(0);
  });
});
