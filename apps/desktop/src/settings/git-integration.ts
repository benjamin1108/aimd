import { invoke } from "@tauri-apps/api/core";

type GitIntegrationStatus = {
  requestId?: string;
  gitInstalled: boolean;
  gitError?: string;
  cliInPath: boolean;
  cliPath?: string;
  stableCliPath?: string;
  stableCliExists: boolean;
  stableCliExecutable: boolean;
  stableCliError?: string;
  repoPath?: string;
  repoIsGit: boolean;
  repoError?: string;
  repoPathRequested?: boolean;
  gitattributesPresent: boolean;
  gitattributesConfigured: boolean;
  repoDriverConfigured: boolean;
  globalDriverConfigured: boolean;
  driverCommandSource?: string;
  expectedTextconv: string;
  expectedMergeDriver: string;
  globalTextconv?: string;
  globalCacheTextconv?: string;
  globalMergeName?: string;
  globalMergeDriver?: string;
  repoTextconv?: string;
  repoCacheTextconv?: string;
  repoMergeName?: string;
  repoMergeDriver?: string;
};

type GitDoctorResult = {
  requestId?: string;
  ok: boolean;
  messages: string[];
  suggestions?: string[];
  status: GitIntegrationStatus;
};

type GitIntegrationActionResult = {
  requestId?: string;
  ok: boolean;
  title: string;
  message: string;
  details?: string[];
  status: GitIntegrationStatus;
};

type LineState = "ok" | "missing" | "notConfigured" | "notApplicable" | "error" | "checking";

export function gitIntegrationSectionHTML() {
  return `
    <section id="settings-panel-git" class="settings-section" data-section="git" role="tabpanel" aria-labelledby="settings-tab-git" hidden>
      <header class="settings-section-head">
        <h2>Git 集成</h2>
        <p>安装、检测、修复和卸载 AIMD 的 .aimd diff / merge driver。</p>
      </header>

      <label class="field">
        <span class="field-label">仓库路径 <em class="field-optional">可选</em></span>
        <input id="git-repo-path" type="text" autocomplete="off" spellcheck="false" placeholder="/path/to/git/repo" />
        <span class="field-hint">留空时只检查 Git、CLI 和全局 driver；仓库操作需要填写 Git 仓库路径。</span>
      </label>

      <div id="git-integration-status" class="git-integration-status" aria-live="polite"></div>

      <div class="git-integration-actions">
        <button id="git-refresh" class="secondary-btn sm" type="button">检查/修复</button>
        <button id="git-enable-repo" class="secondary-btn sm" type="button">启用当前仓库 Git 集成</button>
        <button id="git-enable-global" class="secondary-btn sm" type="button">启用全局 Git 集成</button>
        <button id="git-write-attrs" class="secondary-btn sm" type="button">写入 .gitattributes</button>
        <button id="git-disable-repo" class="secondary-btn sm" type="button">禁用当前仓库 Git 集成</button>
        <button id="git-disable-global" class="secondary-btn sm" type="button">禁用全局 Git 集成</button>
      </div>
    </section>
  `;
}

export function setupGitIntegration(root: HTMLElement) {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const repoPathEl = $<HTMLInputElement>("#git-repo-path");
  const statusEl = $<HTMLElement>("#git-integration-status");
  const refreshBtn = $<HTMLButtonElement>("#git-refresh");
  const enableRepoBtn = $<HTMLButtonElement>("#git-enable-repo");
  const enableGlobalBtn = $<HTMLButtonElement>("#git-enable-global");
  const writeAttrsBtn = $<HTMLButtonElement>("#git-write-attrs");
  const disableRepoBtn = $<HTMLButtonElement>("#git-disable-repo");
  const disableGlobalBtn = $<HTMLButtonElement>("#git-disable-global");
  let busy = false;

  function repoPathValue(): string | null {
    const value = repoPathEl.value.trim();
    return value ? value : null;
  }

  function statusLine(label: string, state: LineState, detail = "") {
    const text: Record<LineState, string> = {
      ok: "OK",
      missing: "缺失",
      notConfigured: "未配置",
      notApplicable: "不适用",
      error: "失败",
      checking: "检查中",
    };
    const ok = state === "ok" || state === "notApplicable";
    return `<div class="git-status-line" data-ok="${String(ok)}" data-state="${state}"><strong>${label}</strong><span>${text[state]}${detail ? ` · ${escapeHTML(detail)}` : ""}</span></div>`;
  }

  function valueLine(label: string, value?: string) {
    return `<div class="git-status-line" data-ok="${String(Boolean(value))}" data-state="${value ? "ok" : "notConfigured"}"><strong>${label}</strong><span>${value ? escapeHTML(value) : "未配置"}</span></div>`;
  }

  function renderAction(result: GitIntegrationActionResult) {
    renderStatus(result.status, [], result);
  }

  function renderStatus(status: GitIntegrationStatus, messages: string[] = [], action?: GitIntegrationActionResult, suggestions: string[] = []) {
    const repoRequested = Boolean(status.repoPathRequested ?? status.repoPath);
    const systemCliOk = status.stableCliExists && status.stableCliExecutable;
    const repoState: LineState = repoRequested ? (status.repoIsGit ? "ok" : "error") : "notConfigured";
    const attrsState: LineState = !repoRequested ? "notApplicable" : status.gitattributesConfigured ? "ok" : "notConfigured";
    const repoDriverState: LineState = !repoRequested ? "notApplicable" : status.repoDriverConfigured ? "ok" : "notConfigured";
    const cliDetail = status.cliInPath && status.cliPath
      ? `${status.cliPath}（来自 PATH）`
      : systemCliOk
        ? `${status.stableCliPath || status.expectedTextconv.replace(/\s+git-diff$/, "")}（稳定安装入口，App 会使用它）`
        : status.stableCliError || "需要安装 AIMD PKG，或在开发环境 PATH 中提供 aimd";
    const globalDetail = status.globalDriverConfigured
      ? "已启用，.aimd diff / merge 会调用 AIMD"
      : "未启用；点击“启用全局 Git 集成”";
    const repoDetail = !repoRequested
      ? "未填写仓库路径；只影响当前仓库的操作会先禁用"
      : status.repoIsGit
        ? status.repoPath || "已识别 Git 仓库"
        : status.repoError || "不是 Git 仓库";
    const repoDriverDetail = !repoRequested
      ? "填写仓库路径后可检查/启用"
      : status.repoDriverConfigured
        ? "已启用，仅作用于这个仓库"
        : "未启用；可点击“启用当前仓库 Git 集成”";
    const attrsDetail = !repoRequested
      ? "填写仓库路径后可写入"
      : status.gitattributesConfigured
        ? "已配置 *.aimd"
        : status.gitattributesPresent
          ? "文件存在，但还没有配置 *.aimd"
          : "未写入；可点击“写入 .gitattributes”";
    const lines = [
      action ? `<div class="git-status-line" data-ok="${String(action.ok)}"><strong>${escapeHTML(action.title)}</strong><span>${escapeHTML(action.message)}${action.requestId ? ` · ${escapeHTML(action.requestId)}` : ""}</span></div>` : "",
      statusLine("Git", status.gitInstalled ? "ok" : "error", status.gitError || ""),
      statusLine("AIMD CLI", status.cliInPath || systemCliOk ? "ok" : "missing", cliDetail),
      statusLine("全局 Git 集成", status.globalDriverConfigured ? "ok" : "notConfigured", globalDetail),
      statusLine("当前仓库", repoState, repoDetail),
      statusLine("当前仓库 Git 集成", repoDriverState, repoDriverDetail),
      statusLine(".gitattributes", attrsState, attrsDetail),
      statusLine("Git driver 命令", "ok", `${status.driverCommandSource === "stable" ? "系统 CLI" : "PATH"} · ${status.expectedTextconv}`),
    ];
    if (status.globalTextconv || status.globalMergeDriver || status.repoTextconv || status.repoMergeDriver) {
      lines.push(
        valueLine("全局 diff 命令", status.globalTextconv),
        valueLine("全局 merge 命令", status.globalMergeDriver),
        repoRequested ? valueLine("仓库 diff 命令", status.repoTextconv) : "",
        repoRequested ? valueLine("仓库 merge 命令", status.repoMergeDriver) : "",
      );
    }
    if (action?.details?.length) {
      lines.push(`<div class="git-status-line" data-ok="true"><strong>操作详情</strong><span>${action.details.map(escapeHTML).join("；")}</span></div>`);
    }
    if (messages.length > 0) {
      lines.push(`<div class="git-status-line" data-ok="false"><strong>诊断</strong><span>${messages.map(escapeHTML).join("；")}</span></div>`);
    }
    if (suggestions.length > 0) {
      lines.push(`<div class="git-status-line" data-ok="true"><strong>建议</strong><span>${suggestions.map(escapeHTML).join("；")}</span></div>`);
    }
    statusEl.innerHTML = lines.filter(Boolean).join("");
    enableRepoBtn.disabled = busy || !repoRequested || !status.repoIsGit;
    disableRepoBtn.disabled = busy || !repoRequested || !status.repoIsGit;
    writeAttrsBtn.disabled = busy || !repoRequested || !status.repoIsGit;
  }

  function renderError(err: unknown) {
    statusEl.innerHTML = `<div class="git-status-line" data-ok="false"><strong>Git 集成</strong><span>${escapeHTML(String(err))}</span></div>`;
  }

  function syncButtons() {
    [refreshBtn, enableGlobalBtn, disableGlobalBtn].forEach((btn) => { btn.disabled = busy; });
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    syncButtons();
    statusEl.textContent = "检查中...";
    try {
      const status = await invoke<GitIntegrationStatus>("git_integration_status", { repoPath: repoPathValue() });
      busy = false;
      renderStatus(status);
    } catch (err) {
      renderError(err);
    } finally {
      busy = false;
      syncButtons();
    }
  }

  async function doctor() {
    if (busy) return;
    busy = true;
    syncButtons();
    statusEl.textContent = "检查中...";
    try {
      const result = await invoke<GitDoctorResult>("git_integration_doctor", { repoPath: repoPathValue() });
      busy = false;
      renderStatus(result.status, result.messages, undefined, result.suggestions || []);
    } catch (err) {
      renderError(err);
    } finally {
      busy = false;
      syncButtons();
    }
  }

  async function confirmGitConfigChange(): Promise<boolean> {
    const message = "启用后，Git 在 diff/merge .aimd 文件时会调用 AIMD 命令。\n这会修改 Git 配置，可随时在这里关闭。";
    try {
      return await invoke<boolean>("confirm_git_config_change", { message });
    } catch {
      // 仅用于 vite-only 开发态 / e2e 兜底；Tauri 实跑必须走 Rust 原生对话框。
      return window.confirm(message);
    }
  }

  async function runAction(command: string, args: Record<string, unknown> = {}, confirmWrite = false) {
    if (busy) return;
    if (confirmWrite && !(await confirmGitConfigChange())) {
      statusEl.innerHTML = `<div class="git-status-line" data-ok="true"><strong>已取消</strong><span>未修改 Git 配置</span></div>`;
      return;
    }
    busy = true;
    syncButtons();
    statusEl.textContent = "处理中...";
    try {
      const result = await invoke<GitIntegrationActionResult>(command, args);
      busy = false;
      renderAction(result);
    } catch (err) {
      renderError(err);
    } finally {
      busy = false;
      syncButtons();
    }
  }

  function requireRepoPath(): string | null {
    const repoPath = repoPathValue();
    if (!repoPath) renderError("请先填写仓库路径");
    return repoPath;
  }

  repoPathEl.addEventListener("change", () => { void refresh(); });
  refreshBtn.addEventListener("click", () => { void doctor(); });
  enableGlobalBtn.addEventListener("click", () => { void runAction("git_integration_enable_global", {}, true); });
  disableGlobalBtn.addEventListener("click", () => { void runAction("git_integration_disable_global"); });
  enableRepoBtn.addEventListener("click", () => {
    const repoPath = requireRepoPath();
    if (repoPath) void runAction("git_integration_enable_repo", { repoPath }, true);
  });
  disableRepoBtn.addEventListener("click", () => {
    const repoPath = requireRepoPath();
    if (repoPath) void runAction("git_integration_disable_repo", { repoPath });
  });
  writeAttrsBtn.addEventListener("click", () => {
    const repoPath = requireRepoPath();
    if (repoPath) void runAction("git_integration_write_gitattributes", { repoPath });
  });

  return { refresh, syncButtons };
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
