import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "../styles.css";
import {
  defaultModelForProvider,
  loadDocuTourConfig,
  saveDocuTourConfig,
} from "../docutour/config";
import type { DocuTourModelConfig, ModelProvider } from "../core/types";

interface LiteLLMDepsStatus {
  python3Found: boolean;
  litellmFound: boolean;
  python3Version: string | null;
  installHint: string;
}

const root = document.querySelector<HTMLDivElement>("#settings-app")!;

root.innerHTML = `
  <main class="settings-shell">
    <section class="settings-panel">
      <header class="settings-head">
        <h1>设置</h1>
        <p>Docu-Tour 通过 LiteLLM 调用模型生成导读脚本。</p>
      </header>

      <form id="settings-form" class="settings-form">
        <fieldset class="settings-group">
          <legend class="settings-group-label">Provider 与凭证</legend>

          <label class="field">
            <span class="field-label">Provider</span>
            <select id="provider">
              <option value="dashscope">DashScope（通义千问）</option>
              <option value="gemini">Gemini（Google）</option>
            </select>
            <span class="field-hint">DashScope 走通义千问 API，Gemini 走 Google AI Studio。</span>
          </label>

          <label class="field">
            <span class="field-label">模型</span>
            <input id="model" type="text" autocomplete="off" spellcheck="false" />
            <span class="field-hint">默认按 Provider 给推荐值，可手填覆盖（如 qwen-plus、gemini-2.5-pro）。</span>
          </label>

          <label class="field">
            <span class="field-label">API Key</span>
            <input id="api-key" type="password" autocomplete="off" spellcheck="false" />
            <span class="field-hint">调用模型必须。<strong>当前保存在本地浏览器存储</strong>，请勿在公共设备使用；桌面 Keychain 接入中。</span>
          </label>

          <label class="field">
            <span class="field-label">API Base <em class="field-optional">可选</em></span>
            <input id="api-base" type="url" autocomplete="off" spellcheck="false" placeholder="留空使用 Provider 官方接入点" />
            <span class="field-hint">仅当你用代理或自部署网关时填写，例如 https://api.example.com/v1。</span>
          </label>
        </fieldset>

        <fieldset class="settings-group">
          <legend class="settings-group-label">生成参数</legend>

          <div class="field-row">
            <label class="field">
              <span class="field-label">演示稿步数</span>
              <input id="max-steps" type="number" min="3" max="12" step="1" />
              <span class="field-hint">导览拆成几段播放，3–12 之间，常用 6。</span>
            </label>
            <label class="field">
              <span class="field-label">输出语言</span>
              <input id="language" type="text" autocomplete="off" spellcheck="false" placeholder="zh-CN" />
              <span class="field-hint">导览旁白用什么语言生成，例如 zh-CN、en-US。</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="settings-group">
          <legend class="settings-group-label">运行环境</legend>
          <p class="settings-group-desc">桌面端通过系统 python3 调用 LiteLLM。安装一次即可。</p>
          <div class="deps-row">
            <div id="deps-status" class="deps-status" aria-live="polite">正在检测依赖…</div>
            <button id="deps-recheck" class="ghost-btn" type="button">重新检测</button>
          </div>
        </fieldset>

        <footer class="settings-actions">
          <span id="save-state" class="settings-save-state" aria-live="polite"></span>
          <button id="reset-model" class="ghost-btn" type="button">恢复默认模型</button>
          <button id="cancel" class="secondary-btn" type="button">取消</button>
          <button id="save-settings" class="primary-btn" type="submit">保存</button>
        </footer>
      </form>
    </section>
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

const providerEl = $<HTMLSelectElement>("#provider");
const modelEl = $<HTMLInputElement>("#model");
const apiKeyEl = $<HTMLInputElement>("#api-key");
const apiBaseEl = $<HTMLInputElement>("#api-base");
const maxStepsEl = $<HTMLInputElement>("#max-steps");
const languageEl = $<HTMLInputElement>("#language");
const saveStateEl = $<HTMLElement>("#save-state");
const saveButtonEl = $<HTMLButtonElement>("#save-settings");
const depsStatusEl = $<HTMLElement>("#deps-status");
const depsRecheckEl = $<HTMLButtonElement>("#deps-recheck");

function fill(config: DocuTourModelConfig) {
  providerEl.value = config.provider;
  modelEl.value = config.model;
  apiKeyEl.value = config.apiKey;
  apiBaseEl.value = config.apiBase || "";
  maxStepsEl.value = String(config.maxSteps);
  languageEl.value = config.language;
}

function read(): DocuTourModelConfig {
  const provider = (providerEl.value === "gemini" ? "gemini" : "dashscope") as ModelProvider;
  return {
    provider,
    model: modelEl.value.trim() || defaultModelForProvider(provider),
    apiKey: apiKeyEl.value.trim(),
    apiBase: apiBaseEl.value.trim(),
    maxSteps: Number(maxStepsEl.value || 6),
    language: languageEl.value.trim() || "zh-CN",
  };
}

fill(loadDocuTourConfig());

function refreshDeps() {
  depsStatusEl.className = "deps-status";
  depsStatusEl.textContent = "正在检测依赖…";
  invoke<LiteLLMDepsStatus>("check_litellm_deps").then((status) => {
    if (status.litellmFound) {
      depsStatusEl.className = "deps-status deps-status--ok";
      depsStatusEl.textContent = `LiteLLM 就绪（${status.python3Version ?? "python3"}）`;
    } else if (status.python3Found) {
      depsStatusEl.className = "deps-status deps-status--warn";
      depsStatusEl.textContent = `已检测到 python3，但缺少 LiteLLM。请在终端执行：${status.installHint}`;
    } else {
      depsStatusEl.className = "deps-status deps-status--error";
      depsStatusEl.textContent = `未检测到 python3。请先安装 Python 3，再执行：${status.installHint}`;
    }
  }).catch(() => {
    depsStatusEl.className = "deps-status deps-status--warn";
    depsStatusEl.textContent = "无法检测依赖状态（非 Tauri 环境）";
  });
}

refreshDeps();
depsRecheckEl.addEventListener("click", refreshDeps);

providerEl.addEventListener("change", () => {
  modelEl.value = defaultModelForProvider(providerEl.value as ModelProvider);
});

$("#reset-model").addEventListener("click", () => {
  modelEl.value = defaultModelForProvider(providerEl.value as ModelProvider);
});

$("#cancel").addEventListener("click", () => {
  void getCurrentWindow().close();
});

$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveDocuTourConfig(read());
  saveButtonEl.disabled = true;
  saveButtonEl.textContent = "已保存";
  saveStateEl.textContent = "配置已保存";
  window.setTimeout(() => {
    void getCurrentWindow().close();
  }, 650);
});
