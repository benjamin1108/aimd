import type { DocuTourModelConfig, ModelProvider } from "../core/types";

// TODO(P1-5): 迁移到系统 Keychain / secure store（如 tauri-plugin-stronghold 或 keyring），
// 目前 API Key 存储在 localStorage，安全级别有限，不适合在公共设备使用。
const STORAGE_KEY = "aimd.docutour.modelConfig";

const DEFAULT_MODELS: Record<ModelProvider, string> = {
  dashscope: "dashscope/qwen-plus",
  gemini: "gemini/gemini-2.5-flash",
};

export const DEFAULT_DOCUTOUR_CONFIG: DocuTourModelConfig = {
  provider: "dashscope",
  model: DEFAULT_MODELS.dashscope,
  apiKey: "",
  apiBase: "",
  maxSteps: 6,
  language: "zh-CN",
};

export function defaultModelForProvider(provider: ModelProvider) {
  return DEFAULT_MODELS[provider];
}

export function loadDocuTourConfig(): DocuTourModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DOCUTOUR_CONFIG };
    const parsed = JSON.parse(raw) as Partial<DocuTourModelConfig>;
    const provider = parsed.provider === "gemini" ? "gemini" : "dashscope";
    return {
      ...DEFAULT_DOCUTOUR_CONFIG,
      ...parsed,
      provider,
      model: parsed.model?.trim() || defaultModelForProvider(provider),
      maxSteps: Math.min(12, Math.max(3, Number(parsed.maxSteps || 6))),
      language: parsed.language?.trim() || "zh-CN",
    };
  } catch {
    return { ...DEFAULT_DOCUTOUR_CONFIG };
  }
}

export function saveDocuTourConfig(config: DocuTourModelConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...config,
    maxSteps: Math.min(12, Math.max(3, Number(config.maxSteps || 6))),
  }));
}
