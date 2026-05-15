import type { Update } from "@tauri-apps/plugin-updater";

export type UpdaterSurface = "closed" | "about" | "update";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "downloadingUnknownSize"
  | "installing"
  | "blocked"
  | "installed"
  | "error";

export type DirtyDocumentWindow = {
  label: string;
  title: string;
  path: string;
};

export type UpdateUiState = {
  surface: UpdaterSurface;
  phase: UpdatePhase;
  requestId?: string;
  currentVersion: string;
  latestVersion?: string;
  releaseNotesSummary?: string;
  detail?: string;
  progressText?: string;
  progressDetail?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  elapsedMs?: number;
  percent?: number;
  dirtyDocumentCount?: number;
  errorTitle?: string;
  errorMessage?: string;
  manual: boolean;
};

export type MockProgressEvent = {
  chunkLength?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  delayMs?: number;
  timeMs?: number;
};

export type MockUpdate = {
  version: string;
  date?: string;
  body?: string;
  contentLength?: number;
  unknownSize?: boolean;
  progressEvents?: MockProgressEvent[];
  failInstall?: string;
};

export type ManifestUpdate = {
  version: string;
  date?: string;
  body?: string;
  platform: string;
  url: string;
  signature: string;
  installerKind: "macos-pkg" | "tauri";
};

export type MacPkgInstallResult = {
  path: string;
  bytes: number;
};

export type MacPkgDownloadEvent = {
  requestId: string;
  version: string;
  downloadedBytes?: number;
  totalBytes?: number;
};

export type PendingUpdate = Update | MockUpdate | ManifestUpdate;

export type MockInstallControls = {
  onProgress: (event: MockProgressEvent) => void;
  onPhase: (phase: "installing" | "installed") => void;
};

export type UpdaterMock = {
  check: (manual: boolean) => Promise<MockUpdate | null> | MockUpdate | null;
  install?: (update: MockUpdate, controls: MockInstallControls) => Promise<void> | void;
};

export type VersionInfo = {
  version: string;
  channel: string;
  platformKey: string;
  platformLabel: string;
  releaseUrl: string;
  updaterManifestUrl: string;
};

export type CheckOptions = {
  manual?: boolean;
  automatic?: boolean;
  force?: boolean;
};

declare global {
  interface Window {
    __aimd_updater_mock?: UpdaterMock;
    __aimd_checkForUpdates?: (opts?: CheckOptions) => Promise<void>;
    __aimd_showAboutAimd?: () => Promise<void>;
    __aimd_runScheduledUpdateCheck?: (opts?: { force?: boolean }) => Promise<void>;
    __aimdUpdaterAutoCheckDelayMs?: number;
  }
}
