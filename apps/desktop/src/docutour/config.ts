// Docu-Tour 模型选项元数据。配置的读写在 core/settings.ts 里走后端持久化，
// 这里只保留下拉列表 / 默认值这类纯静态信息。

import type { ModelProvider } from "../core/types";

const CUSTOM_MODEL_VALUE = "__custom__";

export type ModelOption = {
  value: string;
  label: string;
};

const DEFAULT_MODELS: Record<ModelProvider, string> = {
  dashscope: "qwen3.6-plus",
  gemini: "gemini-3.1-flash-lite-preview",
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

export function defaultModelForProvider(provider: ModelProvider) {
  return DEFAULT_MODELS[provider];
}

export function modelOptionsForProvider(provider: ModelProvider) {
  return MODEL_OPTIONS[provider];
}

export function isKnownModel(provider: ModelProvider, model: string) {
  return MODEL_OPTIONS[provider].some((option) => option.value === model);
}

export function customModelValue() {
  return CUSTOM_MODEL_VALUE;
}
