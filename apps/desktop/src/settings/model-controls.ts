import type { ModelProvider } from "../core/types";
import { MODEL_OPTIONS } from "./model-options";

export const CUSTOM_MODEL_VALUE = "__custom__";

export type ModelConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

export function customModelValue() { return CUSTOM_MODEL_VALUE; }

export function renderModelOptionsFor(
  selectEl: HTMLSelectElement,
  inputEl: HTMLInputElement,
  provider: ModelProvider,
  selectedModel: string,
) {
  const customValue = customModelValue();
  const known = MODEL_OPTIONS[provider].some((option) => option.value === selectedModel);
  selectEl.innerHTML = [
    ...MODEL_OPTIONS[provider].map((option) =>
      `<option value="${option.value}">${option.label}</option>`
    ),
    `<option value="${customValue}">自定义模型...</option>`,
  ].join("");
  selectEl.value = known ? selectedModel : customValue;
  inputEl.hidden = known;
  inputEl.value = selectedModel;
}
