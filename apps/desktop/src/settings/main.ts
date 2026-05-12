import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "../styles.css";

import {
  cloneSettings,
  DEFAULT_AI_SETTINGS,
  DEFAULT_WEB_CLIP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  defaultModelForProvider,
  type AppSettings,
} from "../core/settings";
import type {
  AiSettings,
  ModelProvider,
  ProviderCredential,
  WebClipOutputLanguage,
} from "../core/types";

const CUSTOM_MODEL_VALUE = "__custom__";
export type ModelOption = { value: string; label: string; };
type ModelConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

export const MODEL_OPTIONS: Record<ModelProvider, ModelOption[]> = {
  dashscope: [
    { value: "qwen3.6-plus", label: "Qwen3.6 Plus（推荐）" },
    { value: "qwen3.6-flash", label: "Qwen3.6 Flash（更快）" },
    { value: "qwen3.6-max-preview", label: "Qwen3.6 Max Preview（最强推理）" },
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { value: "MiniMax/MiniMax-M2.7", label: "MiniMax M2.7（直供）" },
  ],
  gemini: [
    { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview（低成本）" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview（推荐）" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview（更快）" },
  ],
};

function modelOptionsForProvider(provider: ModelProvider) { return MODEL_OPTIONS[provider]; }
function isKnownModel(provider: ModelProvider, model: string) { return MODEL_OPTIONS[provider].some((o) => o.value === model); }
function customModelValue() { return CUSTOM_MODEL_VALUE; }

const root = document.querySelector<HTMLDivElement>("#settings-app")!;

root.innerHTML = `
  <main class="settings-shell">
    <form id="settings-form" class="settings-panel">
      <header class="settings-head">
        <div>
          <h1>大模型服务设置</h1>
          <p class="settings-head-sub">配置模型连接凭证</p>
        </div>
      </header>

      <div class="settings-body">
        <aside class="settings-nav" role="tablist" aria-label="设置分类">
          <button type="button" class="settings-nav-item is-active" data-section="model" role="tab" aria-selected="true">模型</button>
          <button type="button" class="settings-nav-item" data-section="webclip" role="tab" aria-selected="false">一键提取</button>
        </aside>

        <div class="settings-content">
          <section class="settings-section is-active" data-section="model" role="tabpanel" aria-labelledby="settings-tab-model">
            <header class="settings-section-head">
              <h2>模型连接</h2>
              <p>请选择模型服务商并配置对应的访问凭据。</p>
            </header>

            <label class="field">
              <span class="field-label">Provider</span>
              <select id="provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">模型</span>
              <select id="model-select"></select>
              <input id="model" type="text" autocomplete="off" spellcheck="false" hidden />
            </label>

            <label class="field">
              <span class="field-label">API Key</span>
              <div class="api-key-wrap" data-state="masked">
                <input id="api-key" class="api-key-input" type="password" autocomplete="off" spellcheck="false" />
                <span class="api-key-mask" aria-hidden="true"></span>
                <button id="api-key-reveal" type="button" class="api-key-reveal" aria-pressed="false" aria-label="显示 / 隐藏 API Key" title="显示 / 隐藏">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1.5 8s2.6-4.5 6.5-4.5S14.5 8 14.5 8s-2.6 4.5-6.5 4.5S1.5 8 1.5 8z"/>
                    <circle cx="8" cy="8" r="2"/>
                  </svg>
                </button>
              </div>
              <span id="api-key-error" class="field-error" hidden></span>
            </label>

            <label class="field">
              <span class="field-label">API Base <em class="field-optional">可选</em></span>
              <input id="api-base" type="url" autocomplete="off" spellcheck="false" placeholder="留空使用 Provider 官方接入点" />
            </label>

            <div class="connection-test-row">
              <button id="test-connection" class="secondary-btn" type="button">测试连接</button>
              <span id="connection-test-state" class="connection-test-state" aria-live="polite"></span>
            </div>
          </section>

          <section class="settings-section" data-section="webclip" role="tabpanel" aria-labelledby="settings-tab-webclip" hidden>
            <header class="settings-section-head">
              <h2>从网页导入</h2>
              <p>配置从网页创建草稿时的正文清洗与智能排版。</p>
            </header>

            <label class="field" style="flex-direction: row; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="webclip-llm-enabled" style="margin: 0; width: 16px; height: 16px;" />
              <span class="field-label" style="margin: 0;">开启大模型智能排版与清洗</span>
            </label>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">启用后，会把提取到的网页正文发送给所选模型，并生成摘要、核心观点和层级化分章正文。这可能会增加一些等待时间。</p>

            <label class="field">
              <span class="field-label">使用已配置的模型 (Provider)</span>
              <select id="webclip-provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">输出语言</span>
              <select id="webclip-output-language">
                <option value="zh-CN">中文</option>
                <option value="en">英文</option>
              </select>
            </label>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">如果网页原文不是所选语言，智能排版会在保留链接、图片和术语的前提下翻译正文。</p>
          </section>
        </div>
      </div>

      <footer class="settings-actions">
        <span id="save-state" class="settings-save-state" aria-live="polite"></span>
        <button id="reset-model" class="ghost-btn" type="button">恢复默认模型</button>
        <button id="cancel" class="secondary-btn" type="button">取消</button>
        <button id="save-settings" class="primary-btn" type="submit" disabled>保存</button>
      </footer>
    </form>
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

const formEl = $<HTMLFormElement>("#settings-form");
const providerEl = $<HTMLSelectElement>("#provider");
const modelSelectEl = $<HTMLSelectElement>("#model-select");
const modelEl = $<HTMLInputElement>("#model");
const apiKeyEl = $<HTMLInputElement>("#api-key");
const apiKeyWrapEl = $<HTMLElement>(".api-key-wrap");
const apiKeyMaskEl = $<HTMLElement>(".api-key-mask");
const apiKeyRevealEl = $<HTMLButtonElement>("#api-key-reveal");
const apiKeyErrorEl = $<HTMLElement>("#api-key-error");
const apiBaseEl = $<HTMLInputElement>("#api-base");
const webClipLlmEnabledEl = $<HTMLInputElement>("#webclip-llm-enabled");
const webClipProviderEl = $<HTMLSelectElement>("#webclip-provider");
const webClipOutputLanguageEl = $<HTMLSelectElement>("#webclip-output-language");
const saveStateEl = $<HTMLElement>("#save-state");
const saveButtonEl = $<HTMLButtonElement>("#save-settings");
const cancelButtonEl = $<HTMLButtonElement>("#cancel");
const resetModelBtn = $<HTMLButtonElement>("#reset-model");
const testConnectionBtn = $<HTMLButtonElement>("#test-connection");
const connectionTestStateEl = $<HTMLElement>("#connection-test-state");
const navItems = root.querySelectorAll<HTMLButtonElement>(".settings-nav-item");
const sections = root.querySelectorAll<HTMLElement>(".settings-section");

let saving = false;
let testingConnection = false;
let closing = false;
let revealApiKey = false;
let baseline = "";

let activeProvider: ModelProvider = "dashscope";
let draft: Record<ModelProvider, ProviderCredential> = {
  dashscope: { ...DEFAULT_AI_SETTINGS.providers.dashscope },
  gemini: { ...DEFAULT_AI_SETTINGS.providers.gemini },
};
let webClipConfig = { ...DEFAULT_WEB_CLIP_SETTINGS };

function switchTab(sectionId: string) {
  navItems.forEach((btn) => {
    const active = btn.dataset.section === sectionId;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  sections.forEach((sec) => {
    const active = sec.dataset.section === sectionId;
    sec.classList.toggle("is-active", active);
    sec.hidden = !active;
  });
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.section!);
  });
});

function renderModelOptions(provider: ModelProvider, selectedModel: string) {
  const customValue = customModelValue();
  const known = isKnownModel(provider, selectedModel);
  modelSelectEl.innerHTML = [
    ...modelOptionsForProvider(provider).map((option) =>
      `<option value="${option.value}">${option.label}</option>`
    ),
    `<option value="${customValue}">自定义模型...</option>`,
  ].join("");
  modelSelectEl.value = known ? selectedModel : customValue;
  modelEl.hidden = known;
  modelEl.value = selectedModel;
}

function readCredFromForm(): ProviderCredential {
  const model = modelSelectEl.value === customModelValue()
    ? modelEl.value.trim()
    : modelSelectEl.value;
  return {
    model: model || defaultModelForProvider(activeProvider),
    apiKey: apiKeyEl.value.trim(),
    apiBase: apiBaseEl.value.trim(),
  };
}

function captureFormToDraft() {
  draft[activeProvider] = readCredFromForm();
  webClipConfig.llmEnabled = webClipLlmEnabledEl.checked;
  webClipConfig.provider = webClipProviderEl.value as ModelProvider;
  webClipConfig.outputLanguage = webClipOutputLanguageEl.value as WebClipOutputLanguage;
}

function clearConnectionTestState() {
  connectionTestStateEl.textContent = "";
  connectionTestStateEl.removeAttribute("data-tone");
}

function loadProviderToForm(provider: ModelProvider) {
  activeProvider = provider;
  providerEl.value = provider;
  const cred = draft[provider];
  renderModelOptions(provider, cred.model || defaultModelForProvider(provider));
  apiKeyEl.value = cred.apiKey;
  apiBaseEl.value = cred.apiBase;
  apiKeyErrorEl.hidden = true;
  clearConnectionTestState();
  refreshApiKeyMask();
}

function fill(settings: AppSettings) {
  draft = {
    dashscope: { ...settings.ai.providers.dashscope },
    gemini: { ...settings.ai.providers.gemini },
  };
  activeProvider = settings.ai.activeProvider;
  
  webClipConfig = {
    llmEnabled: settings.webClip?.llmEnabled ?? false,
    provider: settings.webClip?.provider ?? "dashscope",
    outputLanguage: settings.webClip?.outputLanguage ?? "zh-CN",
  };
  webClipLlmEnabledEl.checked = webClipConfig.llmEnabled;
  webClipProviderEl.value = webClipConfig.provider;
  webClipOutputLanguageEl.value = webClipConfig.outputLanguage;

  loadProviderToForm(activeProvider);
  saveStateEl.textContent = "";
  saveButtonEl.disabled = true;
  saveButtonEl.textContent = "保存";
  baseline = serialize();
}

function readSettings(): AppSettings {
  captureFormToDraft();
  return {
    ai: {
      activeProvider,
      providers: {
        dashscope: { ...draft.dashscope },
        gemini: { ...draft.gemini },
      },
    },
    webClip: {
      llmEnabled: webClipConfig.llmEnabled,
      provider: webClipConfig.provider,
      outputLanguage: webClipConfig.outputLanguage,
    }
  };
}

function serialize(): string {
  return JSON.stringify(readSettings());
}

function syncSaveButton() {
  saveButtonEl.disabled = saving || serialize() === baseline;
  testConnectionBtn.disabled = testingConnection;
}

async function closeWindow() {
  if (closing) return;
  closing = true;
  try {
    await getCurrentWindow().close();
    return;
  } catch {}
  try {
    await invoke("close_current_window");
    return;
  } catch {}
  try {
    window.close();
  } catch {}
  closing = false;
}

function maskedDisplay(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(Math.min(8, v.length));
  return `${v.slice(0, 4)}${"•".repeat(Math.min(8, v.length - 8))}${v.slice(-4)}`;
}

function refreshApiKeyMask() {
  const focused = document.activeElement === apiKeyEl;
  const hasValue = apiKeyEl.value.trim().length > 0;
  apiKeyEl.type = revealApiKey ? "text" : "password";
  const showOverlay = !revealApiKey && hasValue && !focused;
  apiKeyWrapEl.dataset.state = showOverlay ? "masked" : "visible";
  apiKeyMaskEl.textContent = showOverlay ? maskedDisplay(apiKeyEl.value) : "";
}

apiKeyEl.addEventListener("focus", refreshApiKeyMask);
apiKeyEl.addEventListener("blur", refreshApiKeyMask);
apiKeyEl.addEventListener("input", () => {
  refreshApiKeyMask();
  clearConnectionTestState();
  syncSaveButton();
});
apiKeyRevealEl.addEventListener("click", () => {
  revealApiKey = !revealApiKey;
  apiKeyRevealEl.setAttribute("aria-pressed", String(revealApiKey));
  refreshApiKeyMask();
});

[apiBaseEl, modelEl, webClipLlmEnabledEl, webClipProviderEl, webClipOutputLanguageEl].forEach((el) => {
  el.addEventListener("input", () => {
    clearConnectionTestState();
    syncSaveButton();
  });
  el.addEventListener("change", () => {
    clearConnectionTestState();
    syncSaveButton();
  });
});

async function bootstrap() {
  let initial: AppSettings;
  try {
    initial = await loadAppSettings();
  } catch (err) {
    console.error("load settings failed", err);
    initial = { ai: cloneSettings(DEFAULT_AI_SETTINGS), webClip: { ...DEFAULT_WEB_CLIP_SETTINGS } };
  }
  fill(initial);

  try {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch {}
}

providerEl.addEventListener("change", () => {
  captureFormToDraft();
  const next = providerEl.value as ModelProvider;
  loadProviderToForm(next);
  syncSaveButton();
});

modelSelectEl.addEventListener("change", () => {
  const isCustom = modelSelectEl.value === customModelValue();
  modelEl.hidden = !isCustom;
  modelEl.value = isCustom ? "" : modelSelectEl.value;
  if (isCustom) {
    modelEl.placeholder = defaultModelForProvider(activeProvider);
    modelEl.focus();
  }
  clearConnectionTestState();
  syncSaveButton();
});

resetModelBtn.addEventListener("click", () => {
  renderModelOptions(activeProvider, defaultModelForProvider(activeProvider));
  clearConnectionTestState();
  syncSaveButton();
});

testConnectionBtn.addEventListener("click", async () => {
  if (testingConnection) return;

  const cred = readCredFromForm();
  apiKeyErrorEl.hidden = Boolean(cred.apiKey);
  if (!cred.apiKey) {
    apiKeyErrorEl.textContent = "请填写 API Key";
    apiKeyErrorEl.hidden = false;
    apiKeyEl.focus();
    return;
  }

  testingConnection = true;
  testConnectionBtn.disabled = true;
  connectionTestStateEl.dataset.tone = "loading";
  connectionTestStateEl.textContent = "测试中...";

  try {
    const result = await invoke<ModelConnectionTestResult>("test_model_connection", {
      config: {
        provider: activeProvider,
        model: cred.model,
        apiKey: cred.apiKey,
        apiBase: cred.apiBase,
      },
    });
    connectionTestStateEl.dataset.tone = result.ok ? "success" : "error";
    connectionTestStateEl.textContent = result.ok
      ? `连接正常，延迟 ${result.latencyMs} ms`
      : `连接失败，延迟 ${result.latencyMs} ms：${result.message}`;
  } catch (err) {
    connectionTestStateEl.dataset.tone = "error";
    connectionTestStateEl.textContent = err instanceof Error ? err.message : "测试连接失败";
  } finally {
    testingConnection = false;
    syncSaveButton();
  }
});

cancelButtonEl.addEventListener("click", () => {
  void closeWindow();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void closeWindow();
  }
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  const next = readSettings();
  apiKeyErrorEl.hidden = true;
  saving = true;
  saveButtonEl.disabled = true;
  saveStateEl.textContent = "保存中…";
  try {
    await saveAppSettings(next);
    saveStateEl.textContent = "已保存";
    saveButtonEl.textContent = "保存";
    baseline = serialize();
  } catch (err) {
    console.error("save settings failed", err);
    saveStateEl.textContent = err instanceof Error ? err.message : "保存失败";
  } finally {
    saving = false;
    syncSaveButton();
  }
});

void bootstrap();
