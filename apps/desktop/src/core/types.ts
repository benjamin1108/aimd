export type AimdAsset = {
  id: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
  role: string;
  url?: string;
  localPath?: string;
};

export type AimdDocument = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  docuTour?: DocuTourScript | null;
  dirty: boolean;
  isDraft?: boolean;
  format: "aimd" | "markdown";
};

export type RenderResult = {
  html: string;
};

export type SessionSnapshot = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  docuTour?: DocuTourScript | null;
  dirty: boolean;
  isDraft: boolean;
  format: "aimd" | "markdown";
  mode: Mode;
};

export type AddedAsset = {
  asset: AimdAsset;
  uri: string;
  markdown: string;
};

export type OutlineNode = {
  id: string;
  text: string;
  level: number;
};

export type Mode = "read" | "edit" | "source";

export type MarkdownDraft = { markdown: string; title: string; html: string };

export type AssetEntry = { name: string; size: number; mime: string };

export type DocuTourStep = {
  targetId: string;
  label?: string;
  why?: string;
  insight?: string;
  next?: string;
  narration?: string;
};

export type DocuTourScript = {
  version: 1 | 2;
  title?: string;
  documentType?: string;
  summary?: string;
  readingStrategy?: string;
  steps: DocuTourStep[];
};

export type DocuTourAnchor = {
  id: string;
  kind: string;
  text: string;
  path?: string[];
  nearbyText?: string;
  position?: number;
  signals?: {
    hasTable?: boolean;
    hasImage?: boolean;
    hasCode?: boolean;
  };
};

export type ModelProvider = "dashscope" | "gemini";

// 单 provider 的凭证集合：模型 / API Key / 可选的 API Base。每个 provider 独立持有，
// 切 provider 时不串台。
export type ProviderCredential = {
  model: string;
  apiKey: string;
  apiBase: string;
};

// 持久化的设置：activeProvider 选用哪个 provider，providers 里两套凭证分开存。
// maxSteps / language 不跟 provider 绑定，是全局偏好。
export type DocuTourSettings = {
  activeProvider: ModelProvider;
  providers: Record<ModelProvider, ProviderCredential>;
  maxSteps: number;
  language: string;
};

// 运行时调用 generate_docu_tour 用的扁平视图（从 active provider 那一格 flatten）。
export type DocuTourModelConfig = {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  apiBase?: string;
  maxSteps: number;
  language: string;
};
