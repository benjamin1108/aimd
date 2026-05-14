import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../../..");

async function installSettingsMock(page: Page, options: { confirmGit?: boolean } = {}) {
  const confirmGit = options.confirmGit ?? true;
  await page.addInitScript((confirmGit) => {
    type Args = Record<string, unknown> | undefined;
    const status = {
      requestId: "git-status-1",
      gitInstalled: true,
      cliInPath: false,
      cliPath: null,
      stableCliExists: true,
      stableCliExecutable: true,
      repoPath: "/repo",
      repoIsGit: true,
      repoPathRequested: true,
      gitattributesPresent: true,
      gitattributesConfigured: false,
      repoDriverConfigured: false,
      globalDriverConfigured: false,
      driverCommandSource: "stable",
      expectedTextconv: "/usr/local/bin/aimd git-diff",
      expectedMergeDriver: "/usr/local/bin/aimd git-merge %O %A %B %P",
      globalTextconv: null,
      globalCacheTextconv: null,
      globalMergeName: null,
      globalMergeDriver: null,
      repoTextconv: null,
      repoCacheTextconv: null,
      repoMergeName: null,
      repoMergeDriver: null,
    };
    let current = { ...status };
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const settings = {
      ai: {
        activeProvider: "dashscope",
        providers: {
          dashscope: { model: "qwen3.6-plus", apiKey: "sk", apiBase: "" },
          gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" },
        },
      },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        calls.push({ cmd, args });
        if (cmd === "load_settings") return settings;
        if (cmd === "save_settings") return null;
        if (cmd === "confirm_git_config_change") return confirmGit;
        if (cmd === "git_integration_status") return current;
        if (cmd === "git_integration_doctor") return {
          requestId: "git-doctor-1",
          ok: false,
          messages: ["aimd 不在 App PATH 中，已使用 /usr/local/bin/aimd 作为稳定入口", "尚未配置 AIMD Git driver"],
          suggestions: ["点击启用全局 Git 集成"],
          status: current,
        };
        if (cmd === "git_integration_enable_global") {
          current = {
            ...current,
            globalDriverConfigured: true,
            globalTextconv: "/usr/local/bin/aimd git-diff",
            globalCacheTextconv: "true",
            globalMergeName: "AIMD merge driver",
            globalMergeDriver: "/usr/local/bin/aimd git-merge %O %A %B %P",
          };
          return { requestId: "git-enable-global-1", ok: true, title: "全局 Git driver 已启用", message: "操作已完成并通过验证", details: ["diff.aimd.textconv = /usr/local/bin/aimd git-diff"], status: current };
        }
        if (cmd === "git_integration_disable_global") {
          current = { ...current, globalDriverConfigured: false, globalTextconv: null, globalCacheTextconv: null, globalMergeName: null, globalMergeDriver: null };
          return { requestId: "git-disable-global-1", ok: true, title: "全局 Git driver 已禁用", message: "操作已完成并通过验证", details: ["diff.aimd.textconv 已删除"], status: current };
        }
        if (cmd === "git_integration_enable_repo") {
          current = { ...current, repoDriverConfigured: true, repoTextconv: "/usr/local/bin/aimd git-diff", repoCacheTextconv: "true", repoMergeName: "AIMD merge driver", repoMergeDriver: "/usr/local/bin/aimd git-merge %O %A %B %P" };
          return { requestId: "git-enable-repo-1", ok: true, title: "当前仓库 Git driver 已启用", message: "操作已完成并通过验证", details: [], status: current };
        }
        if (cmd === "git_integration_disable_repo") {
          current = { ...current, repoDriverConfigured: false, repoTextconv: null, repoCacheTextconv: null, repoMergeName: null, repoMergeDriver: null };
          return { requestId: "git-disable-repo-1", ok: true, title: "当前仓库 Git driver 已禁用", message: "操作已完成并通过验证", details: [], status: current };
        }
        if (cmd === "git_integration_write_gitattributes") {
          current = { ...current, gitattributesConfigured: true };
          return { requestId: "git-attrs-1", ok: true, title: ".gitattributes 已写入", message: "操作已完成并通过验证", details: [".gitattributes 已追加"], status: current };
        }
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__gitCalls = calls;
  }, confirmGit);
}

async function installConflictDocMock(page: Page) {
  await page.addInitScript(() => {
    const markdown = "# Doc\n\n<<<<<<< ours\nA\n=======\nB\n>>>>>>> theirs\n";
    const doc = {
      path: "/mock/conflict.aimd",
      title: "Conflict",
      markdown,
      html: `<h1>Doc</h1><pre>${markdown}</pre>`,
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const settings = {
      ai: { activeProvider: "dashscope", providers: { dashscope: { model: "qwen3.6-plus", apiKey: "sk", apiBase: "" }, gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" } } },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "initial_open_path" || cmd === "initial_draft_path") return null;
        if (cmd === "choose_doc_file" || cmd === "choose_aimd_file") return doc.path;
        if (cmd === "open_aimd") return doc;
        if (cmd === "render_markdown" || cmd === "render_markdown_standalone") return { html: doc.html };
        if (cmd === "load_settings") return settings;
        if (cmd === "cleanup_old_drafts") return undefined;
        return null;
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc: (p: string) => p,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

async function installSettingsFailureMock(page: Page) {
  await page.addInitScript(() => {
    const status = {
      requestId: "git-status-fail",
      gitInstalled: true,
      cliInPath: false,
      stableCliExists: true,
      stableCliExecutable: true,
      repoPath: null,
      repoIsGit: false,
      repoPathRequested: false,
      gitattributesPresent: false,
      gitattributesConfigured: false,
      repoDriverConfigured: false,
      globalDriverConfigured: false,
      driverCommandSource: "stable",
      expectedTextconv: "/usr/local/bin/aimd git-diff",
      expectedMergeDriver: "/usr/local/bin/aimd git-merge %O %A %B %P",
    };
    const settings = {
      ai: { activeProvider: "dashscope", providers: { dashscope: { model: "qwen3.6-plus", apiKey: "sk", apiBase: "" }, gemini: { model: "gemini-3.1-flash-lite-preview", apiKey: "", apiBase: "" } } },
      webClip: { llmEnabled: false, provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      format: { provider: "dashscope", model: "qwen3.6-plus", outputLanguage: "zh-CN" },
      ui: { showAssetPanel: false, debugMode: false },
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "load_settings") return settings;
        if (cmd === "confirm_git_config_change") return true;
        if (cmd === "git_integration_status") return status;
        if (cmd === "git_integration_enable_global") throw new Error("全局 Git driver 启用失败: git config 权限不足（requestId: git-fail-1）");
        return null;
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

test.describe("AIMD Git native integration", () => {
  test("settings page shows Git integration and confirms before enabling", async ({ page }) => {
    await installSettingsMock(page);
    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='git']").click();
    await expect(page.locator("section[data-section='git']")).toContainText("Git 集成");
    await expect(page.locator("#git-integration-status")).toContainText("AIMD CLI");
    await expect(page.locator("#git-integration-status")).toContainText("/usr/local/bin/aimd git-diff");

    await page.locator("#git-repo-path").fill("/repo");
    await page.locator("#git-enable-global").click();
    await expect(page.locator("#git-integration-status")).toContainText("全局 Git driver 已启用");
    await expect(page.locator("#git-integration-status")).toContainText("git-enable-global-1");
    await page.locator("#git-write-attrs").click();
    await expect(page.locator("#git-integration-status")).toContainText(".gitattributes");
    await page.locator("#git-disable-global").click();
    await expect(page.locator("#git-integration-status")).toContainText("全局 Git driver 已禁用");
    await expect.poll(() => page.evaluate(() => (window as any).__gitCalls.map((c: any) => c.cmd))).toContain("git_integration_disable_global");
  });

  test("settings page shows doctor advice and cancelled write feedback", async ({ page }) => {
    await installSettingsMock(page, { confirmGit: false });
    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='git']").click();
    await page.locator("#git-refresh").click();
    await expect(page.locator("#git-integration-status")).toContainText("点击启用全局 Git 集成");

    await page.locator("#git-enable-global").click();
    await expect(page.locator("#git-integration-status")).toContainText("已取消");
    await expect.poll(() => page.evaluate(() => (window as any).__gitCalls.map((c: any) => c.cmd))).not.toContain("git_integration_enable_global");
  });

  test("settings page shows backend failure with request id", async ({ page }) => {
    await installSettingsFailureMock(page);
    await page.goto("/settings.html");
    await page.locator(".settings-nav-item[data-section='git']").click();
    await expect(page.locator("#git-integration-status")).toContainText("当前仓库");
    await expect(page.locator("#git-integration-status")).toContainText("未填写仓库路径");

    await page.locator("#git-enable-global").click();
    await expect(page.locator("#git-integration-status")).toContainText("全局 Git driver 启用失败");
    await expect(page.locator("#git-integration-status")).toContainText("git-fail-1");
  });


  test("conflict marker document warns and blocks one-click format", async ({ page }) => {
    await installConflictDocMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await expect(page.locator("#status")).toContainText("文档包含 Git 冲突");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();
    await expect(page.locator("#status")).toContainText("解决后再格式化");
  });

  test("macOS PKG script stages app and stable CLI without git config writes", async () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/build-macos-pkg.sh"), "utf-8");
    expect(script).toContain("/Applications/AIMD.app");
    expect(script).toContain("/usr/local/bin/aimd");
    expect(script).not.toContain("git config");
  });
});
