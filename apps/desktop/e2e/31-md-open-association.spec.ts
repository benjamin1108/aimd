/**
 * 31-md-open-association.spec.ts
 *
 * 验证 .md 按需升级方案：打开 .md 即正式文档（非草稿），
 * 纯文本保存写回原 .md；插入图片不弹升级确认，保存时另存为 .aimd。
 */

import { test, expect, Page } from "@playwright/test";

const mdContent = {
  markdown: "# 月度报告\n\n内容。\n",
  title: "月度报告",
  html: "<h1>月度报告</h1><p>内容。</p>",
};

const aimdDoc = {
  path: "/mock/note.aimd",
  title: "笔记文档",
  markdown: "# 笔记文档\n\n",
  html: "<h1>笔记文档</h1>",
  assets: [],
  dirty: false,
};

const upgradedAimdDoc = {
  path: "/mock/report.aimd",
  title: "月度报告",
  markdown: "# 月度报告\n\n内容。\n![img](asset://img)",
  html: "<h1>月度报告</h1><p>内容。</p>",
  assets: [{ id: "img", path: "assets/img.png", mime: "image/png", size: 1024, sha256: "abc", role: "image", url: "asset://img.png" }],
  dirty: false,
};

const addedAsset = {
  asset: { id: "img", path: "assets/img.png", mime: "image/png", size: 1024, sha256: "abc", role: "image", url: "asset://img.png" },
  uri: "asset://img",
  markdown: "![img](asset://img)",
};

const draftDoc = {
  path: "",
  title: "月度报告",
  markdown: "# 月度报告\n\n内容。\n",
  html: "<h1>月度报告</h1><p>内容。</p>",
  assets: [],
  dirty: true,
  isDraft: true,
  draftSourcePath: "/mock/report-draft.aimd",
  format: "aimd",
};

function installMock(
  page: Page,
  opts: {
    initialPath: string | null;
    chooseSaveAimdPath?: string | null;
  },
) {
  return page.addInitScript(
    ({
      initialPath,
      md,
      aimd,
      upgradedAimd,
      added,
      draft,
      chooseSaveAimdPath,
    }: {
      initialPath: string | null;
      md: typeof mdContent;
      aimd: typeof aimdDoc;
      upgradedAimd: typeof upgradedAimdDoc;
      added: typeof addedAsset;
      draft: typeof draftDoc;
      chooseSaveAimdPath: string | null;
    }) => {
      type Args = Record<string, unknown> | undefined;
      const callLog: Array<{ cmd: string; args?: Args }> = [];
      (window as any).__aimd_call_log = callLog;

      const handlers: Record<string, (a?: Args) => unknown> = {
        initial_open_path: () => initialPath,
        convert_md_to_draft: () => md,
        open_aimd: () => aimd,
        create_aimd: () => upgradedAimd,
        create_aimd_draft: () => draft,
        delete_draft_file: () => undefined,
        cleanup_old_drafts: () => undefined,
        save_markdown: () => undefined,
        save_aimd: () => aimd,
        save_aimd_as: () => upgradedAimd,
        render_markdown_standalone: () => ({ html: md.html }),
        confirm_discard_changes: () => "discard",
        choose_save_aimd_file: () => chooseSaveAimdPath,
        add_image_bytes: () => added,
        list_aimd_assets: () => [],
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, a?: Args) => {
          callLog.push({ cmd, args: a });
          const fn = handlers[cmd];
          if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
          return fn(a);
        },
        transformCallback: (cb: Function) => cb,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      (window as any).__aimd_e2e_disable_auto_optimize = true;
    },
    {
      initialPath: opts.initialPath,
      md: mdContent,
      aimd: aimdDoc,
      upgradedAimd: upgradedAimdDoc,
      added: addedAsset,
      draft: draftDoc,
      chooseSaveAimdPath: Object.prototype.hasOwnProperty.call(opts, "chooseSaveAimdPath")
        ? opts.chooseSaveAimdPath!
        : "/mock/report.aimd",
    },
  );
}

test.describe("31. MD 按需升级方案", () => {
  test("打开 .md 为正式文档：#doc-path 含 .md 路径，不显示「未保存草稿」", async ({ page }) => {
    await installMock(page, { initialPath: "/mock/report.md" });
    await page.goto("/");

    await expect(page.locator("#doc-title")).toHaveText("月度报告");
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#doc-path")).not.toContainText("未保存草稿");
    await expect(page.locator("#save-label")).toHaveText("保存");
  });

  test("保存 .md 文档：调用 save_markdown 且 path 为 .md", async ({ page }) => {
    await installMock(page, { initialPath: "/mock/report.md" });
    await page.goto("/");
    await expect(page.locator("#doc-title")).toHaveText("月度报告");

    // 切换到编辑模式，在编辑器里输入内容使文档变 dirty
    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor").click();
    await page.keyboard.press("End");
    await page.keyboard.type("x");

    // 等待 dirty 状态显示（说明 state.doc.dirty = true 已生效）。
    // dirty 状态由底部 status-pill 承担。
    await page.waitForFunction(() => {
      const pill = document.querySelector("#status-pill");
      return pill && pill.getAttribute("data-tone") === "warn";
    }, { timeout: 3000 });

    // 用快捷键保存
    await page.keyboard.press("Meta+s");

    // 等待 save_markdown 被调用
    await page.waitForFunction(() => {
      const log = (window as any).__aimd_call_log as Array<{ cmd: string; args?: unknown }>;
      return log && log.some((e) => e.cmd === "save_markdown");
    }, { timeout: 3000 });

    const log = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string; args?: unknown }>);
    const saveCalls = log.filter((e) => e.cmd === "save_markdown");
    expect(saveCalls.length).toBeGreaterThan(0);
    const saveArgs = saveCalls[0].args as { path: string };
    expect(saveArgs.path).toBe("/mock/report.md");

    // doc-path 仍是 .md
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
  });

  test("粘贴图片不弹升级确认：仍显示 .md，保存时另存为 .aimd", async ({ page }) => {
    await installMock(page, {
      initialPath: "/mock/report.md",
      chooseSaveAimdPath: "/mock/report.aimd",
    });
    await page.goto("/");
    await expect(page.locator("#doc-title")).toHaveText("月度报告");

    // 切换到编辑模式，触发 pasteImageFiles
    await page.locator("#mode-edit").click();

    // 通过 JS 直接调用 pasteImageFiles（模拟粘贴图片）
    await page.evaluate(async () => {
      // 创建一个假 File 对象
      const file = new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", { type: "image/png" });
      // 调用 pasteImageFiles（通过 inline paste event）
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      const editor = document.querySelector("#inline-editor");
      if (editor) editor.dispatchEvent(event);
    });

    // 等待 add_image_bytes 被调用（内部草稿已创建，但还没有让用户选 .aimd 路径）
    await page.waitForFunction(() => {
      const log = (window as any).__aimd_call_log as Array<{ cmd: string }>;
      return log && log.some((e) => e.cmd === "add_image_bytes");
    }, { timeout: 5000 });

    const log = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string; args?: unknown }>);
    const addCalls = log.filter((e) => e.cmd === "add_image_bytes");
    expect(addCalls.length).toBeGreaterThan(0);
    const addArgs = addCalls[0].args as { path: string };
    expect(addArgs.path).toBe("/mock/report-draft.aimd");
    expect(log.some((e) => e.cmd === "confirm_upgrade_to_aimd")).toBe(false);

    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#doc-path")).toContainText("保存时另存为 .aimd");

    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => {
      const log = (window as any).__aimd_call_log as Array<{ cmd: string }>;
      return log && log.some((e) => e.cmd === "save_aimd_as");
    }, { timeout: 5000 });

    const saveLog = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string; args?: unknown }>);
    const saveAs = saveLog.find((e) => e.cmd === "save_aimd_as")!.args as { path: string; savePath: string };
    expect(saveAs.path).toBe("/mock/report-draft.aimd");
    expect(saveAs.savePath).toBe("/mock/report.aimd");
    await expect(page.locator("#doc-path")).toContainText("/mock/report.aimd");
  });

  test("图片插入后保存取消：仍停留在 .md，图片草稿保留待下次保存", async ({ page }) => {
    await installMock(page, {
      initialPath: "/mock/report.md",
      chooseSaveAimdPath: null,
    });
    await page.goto("/");
    await expect(page.locator("#doc-title")).toHaveText("月度报告");

    await page.locator("#mode-edit").click();

    await page.evaluate(async () => {
      const file = new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      const editor = document.querySelector("#inline-editor");
      if (editor) editor.dispatchEvent(event);
    });

    // 等待图片进入内部草稿。
    await page.waitForFunction(() => {
      const log = (window as any).__aimd_call_log as Array<{ cmd: string }>;
      return log && log.some((e) => e.cmd === "add_image_bytes");
    }, { timeout: 5000 });

    await page.keyboard.press("Meta+s");

    const log = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string }>);
    const addCalls = log.filter((e) => e.cmd === "add_image_bytes");
    expect(addCalls.length).toBe(1);
    expect(log.some((e) => e.cmd === "save_aimd_as")).toBe(false);
    expect(log.some((e) => e.cmd === "confirm_upgrade_to_aimd")).toBe(false);

    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");
    await expect(page.locator("#doc-path")).toContainText("保存时另存为 .aimd");
  });

  test(".aimd 路径仍走 open_aimd，显示文件路径", async ({ page }) => {
    await installMock(page, { initialPath: "/mock/note.aimd" });
    await page.goto("/");

    await expect(page.locator("#doc-title")).toHaveText("笔记文档");
    await expect(page.locator("#doc-path")).toContainText("/mock/note.aimd");
    await expect(page.locator("#doc-path")).not.toContainText("未保存草稿");

    const log = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string }>);
    expect(log.some((e) => e.cmd === "open_aimd")).toBe(true);
    expect(log.some((e) => e.cmd === "convert_md_to_draft")).toBe(false);
  });

  test("最近列表点击 .md 走 Markdown 打开流程", async ({ page }) => {
    await installMock(page, { initialPath: null });
    await page.addInitScript(() => {
      window.localStorage.setItem("aimd.desktop.recents", JSON.stringify(["/mock/report.md"]));
    });
    await page.goto("/");

    const recentItem = page.locator(".recent-item").first();
    await expect(recentItem).toBeVisible();
    await expect(recentItem).toContainText("report");

    await recentItem.click();

    await expect(page.locator("#doc-title")).toHaveText("月度报告");
    await expect(page.locator("#doc-path")).toContainText("/mock/report.md");

    const log = await page.evaluate(() => (window as any).__aimd_call_log as Array<{ cmd: string }>);
    expect(log.some((e) => e.cmd === "convert_md_to_draft")).toBe(true);
    expect(log.some((e) => e.cmd === "open_aimd")).toBe(false);
  });

  test(".txt 不支持：#empty 仍可见，状态条提示「不支持的文件类型」", async ({ page }) => {
    await installMock(page, { initialPath: "/mock/readme.txt" });
    await page.goto("/");

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#status")).toContainText("不支持的文件类型");
  });
});
