import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "../styles.css";

import {
  cloneSettings,
  DEFAULT_AI_SETTINGS,
  DEFAULT_UI_SETTINGS,
  DEFAULT_WEB_CLIP_SETTINGS,
  DEFAULT_FORMAT_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  defaultModelForProvider,
  defaultWebClipModelForProvider,
  type AppSettings,
} from "../core/settings";
import type {
  AiSettings,
  ModelProvider,
  ProviderCredential,
  WebClipOutputLanguage,
  UiSettings,
  FormatSettings,
  FormatOutputLanguage,
} from "../core/types";
import { MODEL_OPTIONS } from "./model-options";

const CUSTOM_MODEL_VALUE = "__custom__";
type ModelConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
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
          <h1>AIMD 设置</h1>
          <p class="settings-head-sub">管理界面、模型和网页导入偏好</p>
        </div>
      </header>

      <div class="settings-body">
        <aside class="settings-nav" role="tablist" aria-label="设置分类">
          <button type="button" class="settings-nav-item is-active" data-section="general" role="tab" aria-selected="true">常规</button>
          <button type="button" class="settings-nav-item" data-section="model" role="tab" aria-selected="false">AI / 模型</button>
          <button type="button" class="settings-nav-item" data-section="webclip" role="tab" aria-selected="false">网页导入</button>
          <button type="button" class="settings-nav-item" data-section="format" role="tab" aria-selected="false">格式化</button>
        </aside>

        <div class="settings-content">
          <section class="settings-section is-active" data-section="general" role="tabpanel" aria-labelledby="settings-tab-general">
            <header class="settings-section-head">
              <h2>常规</h2>
              <p>调整主窗口的显示偏好。</p>
            </header>

            <label class="toggle-field">
              <input type="checkbox" id="ui-show-asset-panel" />
              <span class="toggle-field-text">
                <span class="field-label">显示资源面板</span>
                <span class="field-hint">在左侧栏显示当前文档内嵌资源列表。关闭后不影响图片保存、资源检查和导出。</span>
              </span>
            </label>

            <label class="toggle-field">
              <input type="checkbox" id="ui-debug-mode" />
              <span class="toggle-field-text">
                <span class="field-label">启用调试模式</span>
                <span class="field-hint">显示调试控制台入口和运行时诊断。关闭后，后台日志仍会保留，但不会主动打扰。</span>
              </span>
            </label>
          </section>

          <section class="settings-section" data-section="model" role="tabpanel" aria-labelledby="settings-tab-model" hidden>
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
              <span class="field-label">Provider</span>
              <select id="webclip-provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
              <span class="field-hint">API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。</span>
            </label>

            <label class="field">
              <span class="field-label">网页导入模型</span>
              <select id="webclip-model-select"></select>
              <input id="webclip-model" type="text" autocomplete="off" spellcheck="false" hidden />
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

          <section class="settings-section" data-section="format" role="tabpanel" aria-labelledby="settings-tab-format" hidden>
            <header class="settings-section-head">
              <h2>一键格式化</h2>
              <p>配置当前文档一键整理时使用的模型和输出语言。</p>
            </header>

            <label class="field">
              <span class="field-label">Provider</span>
              <select id="format-provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
              <span class="field-hint">API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。</span>
            </label>

            <label class="field">
              <span class="field-label">格式化模型</span>
              <select id="format-model-select"></select>
              <input id="format-model" type="text" autocomplete="off" spellcheck="false" hidden />
            </label>

            <label class="field">
              <span class="field-label">输出语言</span>
              <select id="format-output-language">
                <option value="zh-CN">中文</option>
                <option value="en">英文</option>
              </select>
            </label>
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
const uiShowAssetPanelEl = $<HTMLInputElement>("#ui-show-asset-panel");
const uiDebugModeEl = $<HTMLInputElement>("#ui-debug-mode");
const webClipLlmEnabledEl = $<HTMLInputElement>("#webclip-llm-enabled");
const webClipProviderEl = $<HTMLSelectElement>("#webclip-provider");
const webClipModelSelectEl = $<HTMLSelectElement>("#webclip-model-select");
const webClipModelEl = $<HTMLInputElement>("#webclip-model");
const webClipOutputLanguageEl = $<HTMLSelectElement>("#webclip-output-language");
const formatProviderEl = $<HTMLSelectElement>("#format-provider");
const formatModelSelectEl = $<HTMLSelectElement>("#format-model-select");
const formatModelEl = $<HTMLInputElement>("#format-model");
const formatOutputLanguageEl = $<HTMLSelectElement>("#format-output-language");
const saveStateEl = $<HTMLElement>("#save-state");
const saveButtonEl = $<HTMLButtonElement>("#save-settings");
const cancelButtonEl = $<HTMLButtonElement>("#cancel");
const resetModelBtn = $<HTMLButtonElement>("#reset-model");
const testConnectionBtn = $<HTMLButtonElement>("#test-connection");
const connectionTestStateEl = $<HTMLElement>("#connection-test-state");
const navItems = root.querySelectorAll<HTMLButtonElement>(".settings-nav-item");
const sections = root.querySelectorAll<HTMLElement>(".settings-section");
resetModelBtn.hidden = true;

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
let webClipModelDraft: Record<ModelProvider, string> = {
  dashscope: defaultModelForProvider("dashscope"),
  gemini: defaultModelForProvider("gemini"),
};
let formatConfig: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS };
let uiConfig: UiSettings = { ...DEFAULT_UI_SETTINGS };

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
  resetModelBtn.hidden = sectionId !== "model";
  testConnectionBtn.disabled = testingConnection || sectionId !== "model";
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

function renderModelOptionsFor(selectEl: HTMLSelectElement, inputEl: HTMLInputElement, provider: ModelProvider, selectedModel: string) {
  const customValue = customModelValue();
  const known = isKnownModel(provider, selectedModel);
  selectEl.innerHTML = [
    ...modelOptionsForProvider(provider).map((option) =>
      `<option value="${option.value}">${option.label}</option>`
    ),
    `<option value="${customValue}">自定义模型...</option>`,
  ].join("");
  selectEl.value = known ? selectedModel : customValue;
  inputEl.hidden = known;
  inputEl.value = selectedModel;
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
  uiConfig.showAssetPanel = uiShowAssetPanelEl.checked;
  uiConfig.debugMode = uiDebugModeEl.checked;
  const webClipProvider = webClipProviderEl.value as ModelProvider;
  const webClipModel = webClipModelSelectEl.value === customModelValue()
    ? (webClipModelEl.value.trim() || defaultWebClipModelForProvider({ activeProvider, providers: draft }, webClipProvider))
    : webClipModelSelectEl.value;
  webClipModelDraft[webClipProvider] = webClipModel;
  webClipConfig.llmEnabled = webClipLlmEnabledEl.checked;
  webClipConfig.provider = webClipProvider;
  webClipConfig.model = webClipModel;
  webClipConfig.outputLanguage = webClipOutputLanguageEl.value as WebClipOutputLanguage;
  const formatProvider = formatProviderEl.value as ModelProvider;
  formatConfig = {
    provider: formatProvider,
    model: formatModelSelectEl.value === customModelValue()
      ? (formatModelEl.value.trim() || defaultModelForProvider(formatProvider))
      : formatModelSelectEl.value,
    outputLanguage: formatOutputLanguageEl.value as FormatOutputLanguage,
  };
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
    model: settings.webClip?.model ?? defaultWebClipModelForProvider(settings.ai, settings.webClip?.provider ?? "dashscope"),
    outputLanguage: settings.webClip?.outputLanguage ?? "zh-CN",
  };
  webClipModelDraft = {
    dashscope: webClipConfig.provider === "dashscope"
      ? webClipConfig.model
      : defaultWebClipModelForProvider(settings.ai, "dashscope"),
    gemini: webClipConfig.provider === "gemini"
      ? webClipConfig.model
      : defaultWebClipModelForProvider(settings.ai, "gemini"),
  };
  formatConfig = {
    provider: settings.format?.provider ?? "dashscope",
    model: settings.format?.model ?? defaultModelForProvider(settings.format?.provider ?? "dashscope"),
    outputLanguage: settings.format?.outputLanguage ?? "zh-CN",
  };
  uiConfig = {
    showAssetPanel: settings.ui?.showAssetPanel ?? false,
    debugMode: settings.ui?.debugMode ?? false,
  };
  uiShowAssetPanelEl.checked = uiConfig.showAssetPanel;
  uiDebugModeEl.checked = uiConfig.debugMode;
  webClipLlmEnabledEl.checked = webClipConfig.llmEnabled;
  webClipProviderEl.value = webClipConfig.provider;
  renderModelOptionsFor(webClipModelSelectEl, webClipModelEl, webClipConfig.provider, webClipConfig.model);
  webClipOutputLanguageEl.value = webClipConfig.outputLanguage;
  formatProviderEl.value = formatConfig.provider;
  formatOutputLanguageEl.value = formatConfig.outputLanguage;
  renderModelOptionsFor(formatModelSelectEl, formatModelEl, formatConfig.provider, formatConfig.model);

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
      model: webClipConfig.model,
      outputLanguage: webClipConfig.outputLanguage,
    },
    format: {
      provider: formatConfig.provider,
      model: formatConfig.model,
      outputLanguage: formatConfig.outputLanguage,
    },
    ui: {
      showAssetPanel: uiConfig.showAssetPanel,
      debugMode: uiConfig.debugMode,
    },
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

[apiBaseEl, modelEl, uiShowAssetPanelEl, uiDebugModeEl, webClipLlmEnabledEl, webClipModelEl, webClipOutputLanguageEl, formatProviderEl, formatModelEl, formatOutputLanguageEl].forEach((el) => {
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
    initial = {
      ai: cloneSettings(DEFAULT_AI_SETTINGS),
      webClip: { ...DEFAULT_WEB_CLIP_SETTINGS },
      format: { ...DEFAULT_FORMAT_SETTINGS },
      ui: { ...DEFAULT_UI_SETTINGS },
    };
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

formatProviderEl.addEventListener("change", () => {
  const provider = formatProviderEl.value as ModelProvider;
  const model = formatConfig.provider === provider ? formatConfig.model : defaultModelForProvider(provider);
  renderModelOptionsFor(formatModelSelectEl, formatModelEl, provider, model);
  syncSaveButton();
});

webClipProviderEl.addEventListener("change", () => {
  const previousProvider = webClipConfig.provider;
  const previousModel = webClipModelSelectEl.value === customModelValue()
    ? (webClipModelEl.value.trim() || defaultWebClipModelForProvider({ activeProvider, providers: draft }, previousProvider))
    : webClipModelSelectEl.value;
  webClipModelDraft[previousProvider] = previousModel;
  draft[activeProvider] = readCredFromForm();
  uiConfig.showAssetPanel = uiShowAssetPanelEl.checked;
  uiConfig.debugMode = uiDebugModeEl.checked;
  const provider = webClipProviderEl.value as ModelProvider;
  const model = webClipModelDraft[provider] || defaultWebClipModelForProvider({ activeProvider, providers: draft }, provider);
  webClipConfig = {
    llmEnabled: webClipLlmEnabledEl.checked,
    provider,
    model,
    outputLanguage: webClipOutputLanguageEl.value as WebClipOutputLanguage,
  };
  renderModelOptionsFor(webClipModelSelectEl, webClipModelEl, provider, model);
  syncSaveButton();
});

webClipModelSelectEl.addEventListener("change", () => {
  const provider = webClipProviderEl.value as ModelProvider;
  const isCustom = webClipModelSelectEl.value === customModelValue();
  webClipModelEl.hidden = !isCustom;
  webClipModelEl.value = isCustom ? "" : webClipModelSelectEl.value;
  if (isCustom) {
    webClipModelEl.placeholder = defaultWebClipModelForProvider({ activeProvider, providers: draft }, provider);
    webClipModelEl.focus();
  }
  syncSaveButton();
});

formatModelSelectEl.addEventListener("change", () => {
  const provider = formatProviderEl.value as ModelProvider;
  const isCustom = formatModelSelectEl.value === customModelValue();
  formatModelEl.hidden = !isCustom;
  formatModelEl.value = isCustom ? "" : formatModelSelectEl.value;
  if (isCustom) {
    formatModelEl.placeholder = defaultModelForProvider(provider);
    formatModelEl.focus();
  }
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
