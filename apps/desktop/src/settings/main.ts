import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "../styles.css";

import { cloneSettings, DEFAULT_AI_SETTINGS, DEFAULT_UI_SETTINGS, DEFAULT_WEB_CLIP_SETTINGS, DEFAULT_FORMAT_SETTINGS, loadAppSettings, saveAppSettings, defaultModelForProvider, defaultWebClipModelForProvider, type AppSettings } from "../core/settings";
import type {
  ModelProvider,
  ProviderCredential,
  WebClipOutputLanguage,
  UiSettings,
  FormatSettings,
  FormatOutputLanguage,
} from "../core/types";
import { MODEL_OPTIONS } from "./model-options";
import { setupGitIntegration } from "./git-integration";
import { settingsTemplateHTML } from "./template";
import { bindSelectionBoundary } from "../ui/selection";

declare global {
  interface Window {
    __AIMD_SETTINGS_FATAL__?: (reason: unknown) => void;
  }
}

const CUSTOM_MODEL_VALUE = "__custom__";
type ModelConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};
function modelOptionsForProvider(provider: ModelProvider) { return MODEL_OPTIONS[provider]; }
function isKnownModel(provider: ModelProvider, model: string) { return MODEL_OPTIONS[provider].some((o) => o.value === model); }
function customModelValue() { return CUSTOM_MODEL_VALUE; }

const root = document.querySelector<HTMLDivElement>("#settings-app");
if (!root) throw new Error("设置页缺少 #settings-app 挂载点");
root.innerHTML = settingsTemplateHTML();
bindSelectionBoundary("settings");

const $ = <T extends HTMLElement>(selector: string) => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`设置页模板缺少 ${selector}`);
  return el;
};

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
const gitIntegration = setupGitIntegration(root);

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

function normalizeSectionId(sectionId: string | undefined): string {
  if (!sectionId) return "general";
  for (const sec of sections) {
    if (sec.dataset.section === sectionId) return sectionId;
  }
  return "general";
}

function switchTab(sectionId: string | undefined) {
  const targetSectionId = normalizeSectionId(sectionId);
  navItems.forEach((btn) => {
    const active = btn.dataset.section === targetSectionId;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  sections.forEach((sec) => {
    const active = sec.dataset.section === targetSectionId;
    sec.classList.toggle("is-active", active);
    sec.hidden = !active;
  });
  resetModelBtn.hidden = targetSectionId !== "model";
  testConnectionBtn.disabled = testingConnection || targetSectionId !== "model";
  if (targetSectionId === "git") void gitIntegration.refresh();
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.section);
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
  gitIntegration.syncButtons();
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
  if (v.length <= 8) return "已隐藏";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function refreshApiKeyMask() {
  const hasValue = apiKeyEl.value.trim().length > 0;
  apiKeyEl.type = revealApiKey ? "text" : "password";
  const showOverlay = !revealApiKey && hasValue;
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

bootstrap()
  .then(() => {
    root.dataset.booted = "true";
  })
  .catch((err) => {
    console.error("settings bootstrap failed", err);
    window.__AIMD_SETTINGS_FATAL__?.(err);
  });
