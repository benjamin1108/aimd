export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type ExtractDiagnostic = { level: DiagnosticLevel; message: string; data?: unknown };
export type ImagePayload = { url: string; data: number[]; proxyUrl?: string; originalUrl?: string };
export type ProxyPrefetchItem = { url: string; ok: boolean; bytes?: number; mime?: string | null; error?: string | null };
export type AimdAsset = { id: string; url?: string; localPath?: string };
export type AimdDocument = {
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  draftSourcePath?: string;
};
