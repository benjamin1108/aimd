// 应用级设置统一入口。设置窗口和主窗口都通过这里读写后端持久化的 JSON。
//
// 存储采用 per-provider 模型：apiKey / apiBase / model 三个字段分别属于 dashscope
// 和 gemini，两个 provider 互不串台。runtime 调用 generate_docu_tour 时由
// loadDocuTourConfig 把 active provider 那一格 flatten 成扁平 DocuTourModelConfig。

import { invoke } from "@tauri-apps/api/core";
import { defaultModelForProvider } from "../docutour/config";
import type {
  DocuTourModelConfig,
  DocuTourSettings,
  ModelProvider,
  ProviderCredential,
} from "./types";

export type AppSettings = {
  docutour: DocuTourSettings;
};

function emptyCredFor(provider: ModelProvider): ProviderCredential {
  return { model: defaultModelForProvider(provider), apiKey: "", apiBase: "" };
}

export const DEFAULT_DOCUTOUR_SETTINGS: DocuTourSettings = {
  activeProvider: "dashscope",
  providers: {
    dashscope: emptyCredFor("dashscope"),
    gemini: emptyCredFor("gemini"),
  },
  maxSteps: 6,
  language: "zh-CN",
};

const SUPPORTED_LANGUAGES = new Set(["zh-CN", "en-US"]);

function clampSteps(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 6;
  return Math.max(3, Math.min(12, Math.round(n)));
}

function normalizeProvider(value: unknown): ModelProvider {
  return value === "gemini" ? "gemini" : "dashscope";
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== "string") return "zh-CN";
  const trimmed = value.trim();
  return SUPPORTED_LANGUAGES.has(trimmed) ? trimmed : "zh-CN";
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

// 老格式：顶层 { provider, model, apiKey, apiBase, maxSteps, language }。
// 把 apiKey/apiBase/model 搬到 providers[provider] 那一格。这是仅向前迁移：
// 把当时配的 key 落到对应 provider，另一个 provider 留空。
function migrateLegacy(raw: Record<string, unknown>): DocuTourSettings | null {
  if ("providers" in raw) return null;
  if (!("provider" in raw) && !("apiKey" in raw) && !("model" in raw)) return null;

  const provider = normalizeProvider(raw.provider);
  const cred: ProviderCredential = {
    model: typeof raw.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : defaultModelForProvider(provider),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    apiBase: typeof raw.apiBase === "string" ? raw.apiBase.trim() : "",
  };
  const providers: Record<ModelProvider, ProviderCredential> = {
    dashscope: emptyCredFor("dashscope"),
    gemini: emptyCredFor("gemini"),
  };
  providers[provider] = cred;
  return {
    activeProvider: provider,
    providers,
    maxSteps: clampSteps(raw.maxSteps),
    language: normalizeLanguage(raw.language),
  };
}

export function coerceSettings(raw: unknown): DocuTourSettings {
  if (!raw || typeof raw !== "object") {
    return cloneSettings(DEFAULT_DOCUTOUR_SETTINGS);
  }
  const obj = raw as Record<string, unknown>;
  const migrated = migrateLegacy(obj);
  if (migrated) return migrated;

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
    maxSteps: clampSteps(obj.maxSteps),
    language: normalizeLanguage(obj.language),
  };
}

export function cloneSettings(s: DocuTourSettings): DocuTourSettings {
  return {
    activeProvider: s.activeProvider,
    providers: {
      dashscope: { ...s.providers.dashscope },
      gemini: { ...s.providers.gemini },
    },
    maxSteps: s.maxSteps,
    language: s.language,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<{ docutour?: unknown } | null>("load_settings");
    return { docutour: coerceSettings(raw?.docutour ?? null) };
  } catch {
    // 非 Tauri 环境（vite dev / e2e）：返回默认配置，e2e 走自己的 mock。
    return { docutour: cloneSettings(DEFAULT_DOCUTOUR_SETTINGS) };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const normalized: AppSettings = { docutour: coerceSettings(settings.docutour) };
  await invoke("save_settings", { settings: normalized });
}

export async function loadDocuTourConfig(): Promise<DocuTourModelConfig> {
  const settings = await loadAppSettings();
  const provider = settings.docutour.activeProvider;
  const cred = settings.docutour.providers[provider];
  return {
    provider,
    model: cred.model,
    apiKey: cred.apiKey,
    apiBase: cred.apiBase,
    maxSteps: settings.docutour.maxSteps,
    language: settings.docutour.language,
  };
}
