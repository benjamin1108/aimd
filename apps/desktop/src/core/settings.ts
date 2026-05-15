// 应用级设置统一入口。设置窗口和主窗口都通过这里读写后端持久化的 JSON。

import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  WebClipSettings,
  UiSettings,
  ModelProvider,
  ProviderCredential,
  WebClipOutputLanguage,
  FormatSettings,
  FormatOutputLanguage,
} from "./types";

export type AppSettings = {
  ai: AiSettings;
  webClip: WebClipSettings;
  format: FormatSettings;
  ui: UiSettings;
};

export const MODEL_TIMEOUT_SECONDS_MIN = 5;
export const MODEL_TIMEOUT_SECONDS_MAX = 600;
export const MODEL_RETRY_COUNT_MIN = 0;
export const MODEL_RETRY_COUNT_MAX = 5;

export function defaultModelForProvider(provider: ModelProvider) {
  return provider === "gemini" ? "gemini-3.1-flash-lite-preview" : "qwen3.6-plus";
}

function emptyCredFor(provider: ModelProvider): ProviderCredential {
  return { model: defaultModelForProvider(provider), apiKey: "", apiBase: "" };
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProvider: "dashscope",
  providers: {
    dashscope: emptyCredFor("dashscope"),
    gemini: emptyCredFor("gemini"),
  },
};

export const DEFAULT_WEB_CLIP_SETTINGS: WebClipSettings = {
  llmEnabled: false,
  provider: "dashscope",
  model: defaultModelForProvider("dashscope"),
  outputLanguage: "zh-CN",
  modelTimeoutSeconds: 300,
  modelRetryCount: 2,
};

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  provider: "dashscope",
  model: defaultModelForProvider("dashscope"),
  outputLanguage: "zh-CN",
  modelTimeoutSeconds: 300,
  modelRetryCount: 2,
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  showAssetPanel: false,
  debugMode: false,
};

function normalizeProvider(value: unknown): ModelProvider {
  return value === "gemini" ? "gemini" : "dashscope";
}

function normalizeWebClipOutputLanguage(value: unknown): WebClipOutputLanguage {
  return value === "en" ? "en" : "zh-CN";
}

function normalizeFormatOutputLanguage(value: unknown): FormatOutputLanguage {
  return value === "en" ? "en" : "zh-CN";
}

function coerceBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === "string" && !value.trim()) return fallback;
  const raw = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

export function coerceModelTimeoutSeconds(value: unknown, fallback: number): number {
  return coerceBoundedInteger(
    value,
    fallback,
    MODEL_TIMEOUT_SECONDS_MIN,
    MODEL_TIMEOUT_SECONDS_MAX,
  );
}

export function coerceModelRetryCount(value: unknown, fallback: number): number {
  return coerceBoundedInteger(
    value,
    fallback,
    MODEL_RETRY_COUNT_MIN,
    MODEL_RETRY_COUNT_MAX,
  );
}

function coerceProviderCred(raw: unknown, provider: ModelProvider): ProviderCredential {
  const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const model = typeof obj.model === "string" && obj.model.trim()
    ? obj.model.trim()
    : defaultModelForProvider(provider);
  const apiKey = typeof obj.apiKey === "string" ? obj.apiKey.trim() : "";
  const apiBase = typeof obj.apiBase === "string" ? obj.apiBase.trim() : "";
  return { model, apiKey, apiBase };
}

export function defaultWebClipModelForProvider(ai: AiSettings | null | undefined, provider: ModelProvider) {
  const configured = ai?.providers?.[provider]?.model?.trim();
  return configured || defaultModelForProvider(provider);
}

export function coerceSettings(raw: unknown): AiSettings {
  if (!raw || typeof raw !== "object") {
    return cloneSettings(DEFAULT_AI_SETTINGS);
  }
  const obj = raw as Record<string, unknown>;

  const activeProvider = normalizeProvider(obj.activeProvider);
  const providersRaw = (obj.providers && typeof obj.providers === "object")
    ? obj.providers as Record<string, unknown>
    : {};
  return {
    activeProvider,
    providers: {
      dashscope: coerceProviderCred(providersRaw.dashscope, "dashscope"),
      gemini: coerceProviderCred(providersRaw.gemini, "gemini"),
    },
  };
}

export function coerceWebClipSettings(raw: unknown): WebClipSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_WEB_CLIP_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const provider = normalizeProvider(obj.provider);
  const model = typeof obj.model === "string" && obj.model.trim()
    ? obj.model.trim()
    : defaultModelForProvider(provider);
  return {
    llmEnabled: Boolean(obj.llmEnabled),
    provider,
    model,
    outputLanguage: normalizeWebClipOutputLanguage(obj.outputLanguage),
    modelTimeoutSeconds: coerceModelTimeoutSeconds(
      obj.modelTimeoutSeconds,
      DEFAULT_WEB_CLIP_SETTINGS.modelTimeoutSeconds,
    ),
    modelRetryCount: coerceModelRetryCount(
      obj.modelRetryCount,
      DEFAULT_WEB_CLIP_SETTINGS.modelRetryCount,
    ),
  };
}

export function coerceFormatSettings(raw: unknown): FormatSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_FORMAT_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const provider = normalizeProvider(obj.provider);
  const model = typeof obj.model === "string" && obj.model.trim()
    ? obj.model.trim()
    : defaultModelForProvider(provider);
  return {
    provider,
    model,
    outputLanguage: normalizeFormatOutputLanguage(obj.outputLanguage),
    modelTimeoutSeconds: coerceModelTimeoutSeconds(
      obj.modelTimeoutSeconds,
      DEFAULT_FORMAT_SETTINGS.modelTimeoutSeconds,
    ),
    modelRetryCount: coerceModelRetryCount(
      obj.modelRetryCount,
      DEFAULT_FORMAT_SETTINGS.modelRetryCount,
    ),
  };
}

export function coerceUiSettings(raw: unknown): UiSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_UI_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    showAssetPanel: obj.showAssetPanel === true,
    debugMode: obj.debugMode === true,
  };
}

export function cloneSettings(s: AiSettings): AiSettings {
  return {
    activeProvider: s.activeProvider,
    providers: {
      dashscope: { ...s.providers.dashscope },
      gemini: { ...s.providers.gemini },
    },
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<{ ai?: unknown, webClip?: unknown, format?: unknown, ui?: unknown } | null>("load_settings");
    const ai = coerceSettings(raw?.ai ?? null);
    const webClip = coerceWebClipSettings(raw?.webClip ?? null);
    const rawWebClip = (raw?.webClip && typeof raw.webClip === "object")
      ? raw.webClip as Record<string, unknown>
      : {};
    if (typeof rawWebClip.model !== "string" || !rawWebClip.model.trim()) {
      webClip.model = defaultWebClipModelForProvider(ai, webClip.provider);
    }
    return { 
      ai,
      webClip,
      format: coerceFormatSettings(raw?.format ?? null),
      ui: coerceUiSettings(raw?.ui ?? null),
    };
  } catch (err) {
    console.warn("load_settings failed; using defaults", err);
    return { 
      ai: cloneSettings(DEFAULT_AI_SETTINGS),
      webClip: { ...DEFAULT_WEB_CLIP_SETTINGS },
      format: { ...DEFAULT_FORMAT_SETTINGS },
      ui: { ...DEFAULT_UI_SETTINGS },
    };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const normalized: AppSettings = { 
    ai: coerceSettings(settings.ai),
    webClip: coerceWebClipSettings(settings.webClip),
    format: coerceFormatSettings(settings.format),
    ui: coerceUiSettings(settings.ui),
  };
  await invoke("save_settings", { settings: normalized });
}

export async function loadAiConfig(): Promise<ProviderCredential & { provider: ModelProvider }> {
  const settings = await loadAppSettings();
  const provider = settings.ai.activeProvider;
  const cred = settings.ai.providers[provider];
  return {
    provider,
    model: cred.model,
    apiKey: cred.apiKey,
    apiBase: cred.apiBase,
  };
}
