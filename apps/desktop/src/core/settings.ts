// 应用级设置统一入口。设置窗口和主窗口都通过这里读写后端持久化的 JSON。

import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  ModelProvider,
  ProviderCredential,
} from "./types";

export type AppSettings = {
  ai: AiSettings;
};

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

function normalizeProvider(value: unknown): ModelProvider {
  return value === "gemini" ? "gemini" : "dashscope";
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
    const raw = await invoke<{ ai?: unknown } | null>("load_settings");
    return { ai: coerceSettings(raw?.ai ?? null) };
  } catch {
    return { ai: cloneSettings(DEFAULT_AI_SETTINGS) };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const normalized: AppSettings = { ai: coerceSettings(settings.ai) };
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
