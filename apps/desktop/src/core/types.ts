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
  dirty: boolean;
  isDraft?: boolean;
  draftSourcePath?: string;
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

export type ModelProvider = "dashscope" | "gemini";

// 单 provider 的凭证集合：模型 / API Key / 可选的 API Base。每个 provider 独立持有，
// 切 provider 时不串台。
export type ProviderCredential = {
  model: string;
  apiKey: string;
  apiBase: string;
};

// 持久化的设置
export type AiSettings = {
  activeProvider: ModelProvider;
  providers: Record<ModelProvider, ProviderCredential>;
};

export type WebClipSettings = {
  llmEnabled: boolean;
  provider: ModelProvider;
};
