import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "../styles.css";
import {
  customModelValue,
  defaultModelForProvider,
  isKnownModel,
  modelOptionsForProvider,
} from "../docutour/config";
import {
  cloneSettings,
  DEFAULT_DOCUTOUR_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../core/settings";
import type {
  DocuTourSettings,
  ModelProvider,
  ProviderCredential,
} from "../core/types";

const root = document.querySelector<HTMLDivElement>("#settings-app")!;

// 双栏：左导航 / 右分节表单。所有字段共用一个 form，一个保存按钮，
// 切换分节只是切 [data-section] 的可见性，不影响表单状态。
root.innerHTML = `
  <main class="settings-shell">
    <form id="settings-form" class="settings-panel">
      <header class="settings-head">
        <div>
          <h1>设置</h1>
          <p class="settings-head-sub">配置模型连接和导览偏好</p>
        </div>
      </header>

      <div class="settings-body">
        <aside class="settings-nav" role="tablist" aria-label="设置分类">
          <button type="button" class="settings-nav-item is-active" data-section="model" role="tab" aria-selected="true">模型</button>
          <button type="button" class="settings-nav-item" data-section="tour" role="tab" aria-selected="false">导览</button>
        </aside>

        <div class="settings-content">
          <section class="settings-section is-active" data-section="model" role="tabpanel" aria-labelledby="settings-tab-model">
            <header class="settings-section-head">
              <h2>模型连接</h2>
              <p>每个 Provider 单独保存凭证，切换不会串台。</p>
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
          </section>

          <section class="settings-section" data-section="tour" role="tabpanel" aria-labelledby="settings-tab-tour" hidden>
            <header class="settings-section-head">
              <h2>导览偏好</h2>
              <p>控制导览脚本的体量和语言。修改不会影响已生成的脚本。</p>
            </header>

            <label class="field">
              <span class="field-label">导览步数</span>
              <input id="max-steps" type="number" min="3" max="12" step="1" />
              <span class="field-hint">建议 5–8 步：太少抓不到结构，太多用户读不完。</span>
            </label>

            <label class="field">
              <span class="field-label">输出语言</span>
              <select id="language">
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>

            <label class="field is-disabled">
              <span class="field-label">提示词风格 <em class="field-optional">即将上线</em></span>
              <select disabled>
                <option>默认（编辑视角的导读）</option>
              </select>
              <span class="field-hint">下个版本支持自定义讲解口吻。</span>
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
const maxStepsEl = $<HTMLInputElement>("#max-steps");
const languageEl = $<HTMLSelectElement>("#language");
const saveStateEl = $<HTMLElement>("#save-state");
const saveButtonEl = $<HTMLButtonElement>("#save-settings");
const cancelButtonEl = $<HTMLButtonElement>("#cancel");
const resetModelBtn = $<HTMLButtonElement>("#reset-model");
const navItems = root.querySelectorAll<HTMLButtonElement>(".settings-nav-item");
const sections = root.querySelectorAll<HTMLElement>(".settings-section");

let saving = false;
let closing = false;
let revealApiKey = false;
let baseline = "";

// 当前正在表单里编辑的 provider，以及两个 provider 各自的草稿凭证。
// 切换 provider 时把表单状态先 capture 进 draft，再用 newProvider 的 draft 填回表单。
let activeProvider: ModelProvider = "dashscope";
let draft: Record<ModelProvider, ProviderCredential> = {
  dashscope: { ...DEFAULT_DOCUTOUR_SETTINGS.providers.dashscope },
  gemini: { ...DEFAULT_DOCUTOUR_SETTINGS.providers.gemini },
};

const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
type SupportedLang = typeof SUPPORTED_LANGUAGES[number];

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
}

function loadProviderToForm(provider: ModelProvider) {
  activeProvider = provider;
  providerEl.value = provider;
  const cred = draft[provider];
  renderModelOptions(provider, cred.model || defaultModelForProvider(provider));
  apiKeyEl.value = cred.apiKey;
  apiBaseEl.value = cred.apiBase;
  apiKeyErrorEl.hidden = true;
  refreshApiKeyMask();
}

function fill(settings: DocuTourSettings) {
  draft = {
    dashscope: { ...settings.providers.dashscope },
    gemini: { ...settings.providers.gemini },
  };
  activeProvider = settings.activeProvider;
  loadProviderToForm(activeProvider);
  maxStepsEl.value = String(settings.maxSteps);
  languageEl.value = (SUPPORTED_LANGUAGES as readonly string[]).includes(settings.language)
    ? settings.language
    : "zh-CN";
  saveStateEl.textContent = "";
  saveButtonEl.disabled = true;
  saveButtonEl.textContent = "保存";
  baseline = serialize();
}

function readSettings(): DocuTourSettings {
  // 把当前表单状态先存回 draft，再读全量。
  captureFormToDraft();
  const lang = (SUPPORTED_LANGUAGES as readonly string[]).includes(languageEl.value)
    ? (languageEl.value as SupportedLang)
    : "zh-CN";
  return {
    activeProvider,
    providers: {
      dashscope: { ...draft.dashscope },
      gemini: { ...draft.gemini },
    },
    maxSteps: Number(maxStepsEl.value || 6),
    language: lang,
  };
}

function serialize(): string {
  return JSON.stringify(readSettings());
}

function syncSaveButton() {
  saveButtonEl.disabled = saving || serialize() === baseline;
}

async function closeWindow() {
  if (closing) return;
  closing = true;
  // 三档兜底：(1) Tauri close，(2) 后端命令 close_current_window，(3) DOM window.close。
  // 之前只走 (1)，部分 webview 实测会静默 reject，导致点了取消"没反应"。
  try {
    await getCurrentWindow().close();
    return;
  } catch {
    // 继续兜底
  }
  try {
    await invoke("close_current_window");
    return;
  } catch {
    // 继续兜底
  }
  try {
    window.close();
  } catch {
    // 非 Tauri / e2e：到这里不会真关，但 click handler 已经触达。
  }
  closing = false;
}

// API Key 显隐策略：
//   - 默认 type=password（输入时也只看到 ••• 反馈，永远不会因为点击/聚焦把明文暴露）
//   - 未聚焦且已有值：覆盖一层 prefix4 + ••• + suffix4 浮层，让用户能识别"是哪一个 key"
//   - 聚焦时：浮层消失，input 自身的密码 mask 接管（用户看到正在输入的位数）
//   - 仅当用户主动点 #api-key-reveal（眼睛）时切到 type=text，看到完整明文
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
  syncSaveButton();
});
apiKeyRevealEl.addEventListener("click", () => {
  revealApiKey = !revealApiKey;
  apiKeyRevealEl.setAttribute("aria-pressed", String(revealApiKey));
  refreshApiKeyMask();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.dataset.section!;
    navItems.forEach((other) => {
      const isActive = other === item;
      other.classList.toggle("is-active", isActive);
      other.setAttribute("aria-selected", String(isActive));
    });
    sections.forEach((section) => {
      const isActive = section.dataset.section === target;
      section.classList.toggle("is-active", isActive);
      section.hidden = !isActive;
    });
  });
});

[apiBaseEl, maxStepsEl, languageEl, modelEl].forEach((el) => {
  el.addEventListener("input", syncSaveButton);
  el.addEventListener("change", syncSaveButton);
});

async function bootstrap() {
  let initial: AppSettings;
  try {
    initial = await loadAppSettings();
  } catch (err) {
    console.error("load settings failed", err);
    initial = { docutour: cloneSettings(DEFAULT_DOCUTOUR_SETTINGS) };
  }
  fill(initial.docutour);

  // 渲染好后再让窗口可见，避免 2-3 秒黑屏。
  try {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch {
    // dev / e2e 环境没有 Tauri，忽略。
  }
}

providerEl.addEventListener("change", () => {
  // 切 provider 之前把当前表单值落盘到旧 provider 的草稿。
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
  syncSaveButton();
});

resetModelBtn.addEventListener("click", () => {
  renderModelOptions(activeProvider, defaultModelForProvider(activeProvider));
  syncSaveButton();
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
  const activeCred = next.providers[next.activeProvider];
  apiKeyErrorEl.hidden = Boolean(activeCred.apiKey);
  if (!activeCred.apiKey) {
    apiKeyErrorEl.textContent = "请填写 API Key";
    apiKeyErrorEl.hidden = false;
    // 切回模型分节让用户能看到字段。
    navItems.forEach((other) => {
      const isActive = other.dataset.section === "model";
      other.classList.toggle("is-active", isActive);
      other.setAttribute("aria-selected", String(isActive));
    });
    sections.forEach((section) => {
      const isActive = section.dataset.section === "model";
      section.classList.toggle("is-active", isActive);
      section.hidden = !isActive;
    });
    apiKeyEl.focus();
    return;
  }
  saving = true;
  saveButtonEl.disabled = true;
  saveStateEl.textContent = "保存中…";
  try {
    await saveAppSettings({ docutour: next });
    // 保存后留在窗口，不自动关：用户可能要连着改下一节，
    // 也方便他们对比修改前后的状态。关窗交给 取消 / Esc / 窗口关闭按钮。
    // baseline 同步到当前已落盘的值，按钮重新通过 syncSaveButton 进入 disabled，
    // 直到用户再次编辑才回到"保存"。
    saveStateEl.textContent = "已保存";
    saveButtonEl.textContent = "保存";
    baseline = serialize();
    // 不需要主动通知主窗口：generateDocuTour 每次都会去读后端配置。
  } catch (err) {
    console.error("save settings failed", err);
    saveStateEl.textContent = err instanceof Error ? err.message : "保存失败";
  } finally {
    saving = false;
    syncSaveButton();
  }
});

void bootstrap();
