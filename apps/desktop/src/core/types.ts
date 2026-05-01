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

export type DocuTourStep = {
  targetId: string;
  narration: string;
};

export type DocuTourScript = {
  version: 1;
  title?: string;
  steps: DocuTourStep[];
};

export type DocuTourAnchor = {
  id: string;
  kind: string;
  text: string;
};

export type ModelProvider = "dashscope" | "gemini";

export type DocuTourModelConfig = {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  apiBase?: string;
  maxSteps: number;
  language: string;
};
