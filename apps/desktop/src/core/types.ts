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
  needsAimdSave?: boolean;
  hasExternalImageReferences?: boolean;
  requiresAimdSave?: boolean;
  hasGitConflicts?: boolean;
  format: "aimd" | "markdown";
};

export type RenderResult = {
  html: string;
};

export type MarkdownSourceCell = {
  id: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
};

export type MarkdownSourceBlock = {
  id: string;
  kind: "heading" | "paragraph" | "list_item" | "blockquote" | "table" | "code" | "other";
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  cells?: MarkdownSourceCell[];
};

export type MarkdownSourceModel = {
  markdown: string;
  blocks: MarkdownSourceBlock[];
};

export type SessionSnapshot = {
  path: string;
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  dirty: boolean;
  isDraft: boolean;
  draftSourcePath?: string;
  needsAimdSave?: boolean;
  hasExternalImageReferences?: boolean;
  requiresAimdSave?: boolean;
  hasGitConflicts?: boolean;
  format: "aimd" | "markdown";
  mode: Mode;
};

export type OpenDocumentId = string;

export type OpenDocumentTab = {
  id: OpenDocumentId;
  pathKey: string | null;
  title: string;
  doc: AimdDocument;
  sourceModel: MarkdownSourceModel | null;
  sourceDirtyRefs: Set<string>;
  sourceStructuralDirty: boolean;
  inlineDirty: boolean;
  htmlVersion: number;
  paintedVersion: Record<Mode, number>;
  operationVersion: number;
  mode: Mode;
  scroll: {
    read: number;
    edit: number;
    source: number;
  };
  sourceSelection: {
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  };
  baseFileFingerprint?: {
    mtimeMs: number;
    size: number;
  } | null;
  recoveryState?: "disk-changed" | null;
  healthReport: DocumentHealthReport | null;
};

export type OpenDocumentsState = {
  tabs: OpenDocumentTab[];
  activeTabId: OpenDocumentId | null;
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
export type MainView = "document" | "git-diff";

export type MarkdownDraft = { markdown: string; title: string; html: string };

export type AssetEntry = { name: string; size: number; mime: string };

export type ExportMarkdownResult = {
  markdownPath: string;
  assetsDir: string;
  exportedAssets: Array<{
    id: string;
    filename: string;
    path: string;
    size: number;
  }>;
};

export type WorkspaceNodeKind = "folder" | "document";
export type WorkspaceDocumentFormat = "aimd" | "markdown";

export type WorkspaceTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: WorkspaceNodeKind;
  format?: WorkspaceDocumentFormat;
  children?: WorkspaceTreeNode[];
  modifiedAt?: string;
  error?: string;
};

export type WorkspaceRoot = {
  root: string;
  tree: WorkspaceTreeNode;
};

export type HealthStatus = "offline_ready" | "risk" | "missing";
export type HealthSeverity = "info" | "warning" | "error";

export type HealthIssue = {
  kind: string;
  severity: HealthSeverity;
  message: string;
  id?: string;
  url?: string;
  path?: string;
  size?: number;
  mime?: string;
};

export type DocumentHealthReport = {
  status: HealthStatus;
  summary: string;
  counts: {
    errors: number;
    warnings: number;
    infos: number;
  };
  issues: HealthIssue[];
};

export type ModelProvider = "dashscope" | "gemini";
export type WebClipOutputLanguage = "zh-CN" | "en";
export type FormatOutputLanguage = "zh-CN" | "en";

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
  model: string;
  outputLanguage: WebClipOutputLanguage;
};

export type FormatSettings = {
  provider: ModelProvider;
  model: string;
  outputLanguage: FormatOutputLanguage;
};

export type UiSettings = {
  showAssetPanel: boolean;
  debugMode: boolean;
};

export type SidebarDocTab = "outline" | "assets" | "git" | "health";

export type GitFileState =
  | "none"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export type GitFileKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export type GitChangedFile = {
  path: string;
  originalPath?: string;
  staged: GitFileState;
  unstaged: GitFileState;
  kind: GitFileKind;
};

export type GitRepoStatus = {
  isRepo: boolean;
  root: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  clean: boolean;
  conflicted: boolean;
  files: GitChangedFile[];
  error?: string;
};

export type GitFileDiff = {
  path: string;
  stagedDiff: string;
  unstagedDiff: string;
  isBinary: boolean;
  truncated?: boolean;
  renderedMarkdown?: string;
  renderedHtml?: string;
};

export type GitDiffTab = {
  id: OpenDocumentId;
  repoRoot: string;
  path: string;
  title: string;
  directory: string;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string;
  scroll: number;
};
