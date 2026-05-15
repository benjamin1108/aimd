import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { statusPillEl } from "../core/dom";
import { state } from "../core/state";
import { debugLog } from "../debug/console";
import { clearStatusOverride, setStatus, setStatusOverride } from "../ui/chrome";
import { escapeHTML } from "../util/escape";
import { syncDirtyDocumentState } from "./dirty-state";
import { errorDiagnostics, versionDiagnostics } from "./diagnostics";
import { AIMD_RELEASE } from "./release";
import {
  DEFAULT_AUTO_CHECK_INTERVAL_MS,
  DEFAULT_AUTO_CHECK_JITTER_MS,
  nextAutomaticCheckDelayMs,
  shouldRunAutomaticUpdateCheck,
  type UpdaterMeta,
} from "./schedule";
import {
  DownloadTelemetry,
  formatProgressLine,
  formatPercent,
  safeProgressValue,
} from "./telemetry";

type UpdaterSurface = "closed" | "about" | "update";

type UpdatePhase =
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

type DirtyDocumentWindow = {
  label: string;
  title: string;
  path: string;
};

type UpdateUiState = {
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

type MockProgressEvent = {
  chunkLength?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  delayMs?: number;
  timeMs?: number;
};

type MockUpdate = {
  version: string;
  date?: string;
  body?: string;
  contentLength?: number;
  unknownSize?: boolean;
  progressEvents?: MockProgressEvent[];
  failInstall?: string;
};

type ManifestUpdate = {
  version: string;
  date?: string;
  body?: string;
  platform: string;
  url: string;
  signature: string;
  installerKind: "macos-pkg" | "tauri";
};

type MacPkgInstallResult = {
  path: string;
  bytes: number;
};

type MacPkgDownloadEvent = {
  requestId: string;
  version: string;
  downloadedBytes?: number;
  totalBytes?: number;
};

type PendingUpdate = Update | MockUpdate | ManifestUpdate;

type MockInstallControls = {
  onProgress: (event: MockProgressEvent) => void;
  onPhase: (phase: "installing" | "installed") => void;
};

type UpdaterMock = {
  check: (manual: boolean) => Promise<MockUpdate | null> | MockUpdate | null;
  install?: (update: MockUpdate, controls: MockInstallControls) => Promise<void> | void;
};

type VersionInfo = {
  version: string;
  channel: string;
  platformKey: string;
  platformLabel: string;
  releaseUrl: string;
  updaterManifestUrl: string;
};

type CheckOptions = {
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
    __aimdUpdaterAutoCheckIntervalMs?: number;
    __aimdUpdaterAutoCheckJitterMs?: number;
  }
}

const UPDATER_META_KEY = "aimd.desktop.updater.meta";
const UPDATER_STATUS_ACTION = "updater";

let panelEl: HTMLElement;
let titleEl: HTMLElement;
let messageEl: HTMLElement;
let aboutBodyEl: HTMLElement;
let aboutVersionEl: HTMLElement;
let aboutPlatformEl: HTMLElement;
let aboutUpdateSummaryEl: HTMLElement;
let aboutCopyStatusEl: HTMLElement;
let aboutCheckBtn: HTMLButtonElement;
let aboutCopyBtn: HTMLButtonElement;
let aboutReleaseBtn: HTMLButtonElement;
let aboutInstallBtn: HTMLButtonElement | null = null;
let updateBodyEl: HTMLElement;
let notesEl: HTMLElement;
let progressWrapEl: HTMLElement;
let progressBarEl: HTMLElement;
let progressFillEl: HTMLElement;
let progressEl: HTMLElement;
let progressDetailEl: HTMLElement;
let closeBtn: HTMLButtonElement;
let releaseBtn: HTMLButtonElement;
let copyDiagnosticsBtn: HTMLButtonElement;
let focusDirtyBtn: HTMLButtonElement;
let backgroundBtn: HTMLButtonElement;
let remindLaterBtn: HTMLButtonElement;
let retryBtn: HTMLButtonElement;
let installBtn: HTMLButtonElement;

let pendingUpdate: PendingUpdate | null = null;
let checking = false;
let installingUpdate = false;
let activeTelemetry: DownloadTelemetry | null = null;
let cachedPlatformKey = "unknown";
let lastVersionInfo: VersionInfo | null = null;
let lastFailureMessage = "";
let autoCheckTimer: number | null = null;

let uiState: UpdateUiState = {
  surface: "closed",
  phase: "idle",
  currentVersion: currentVersionFallback(),
  manual: false,
};

function requestId() {
  return `upd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentVersionFallback() {
  return AIMD_RELEASE.version;
}

async function currentVersion() {
  if (!isTauri() && !window.__aimd_updater_mock) return currentVersionFallback();
  try {
    return await getVersion();
  } catch {
    return currentVersionFallback();
  }
}

async function updaterPlatformKey() {
  if (!isTauri() && !window.__aimd_updater_mock) return browserPlatformKey();
  try {
    const platform = await invoke<unknown>("updater_platform");
    cachedPlatformKey = typeof platform === "string" && platform ? platform : browserPlatformKey();
    return cachedPlatformKey;
  } catch {
    cachedPlatformKey = browserPlatformKey();
    return cachedPlatformKey;
  }
}

function browserPlatformKey() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "darwin-aarch64";
  if (platform.includes("win")) return "windows-x86_64";
  return "browser";
}

function platformLabel(platformKey: string) {
  if (platformKey === "darwin-aarch64") return "macOS arm64";
  if (platformKey === "windows-x86_64") return "Windows x64";
  if (platformKey === "unsupported") return "Unsupported platform";
  if (platformKey === "browser") return "Browser preview";
  return platformKey;
}

async function getVersionInfo(): Promise<VersionInfo> {
  const [version, platformKey] = await Promise.all([currentVersion(), updaterPlatformKey()]);
  lastVersionInfo = {
    version,
    channel: AIMD_RELEASE.channel,
    platformKey,
    platformLabel: platformLabel(platformKey),
    releaseUrl: AIMD_RELEASE.releaseUrl,
    updaterManifestUrl: AIMD_RELEASE.updaterManifestUrl,
  };
  return lastVersionInfo;
}

function readMeta(): UpdaterMeta {
  try {
    const raw = localStorage.getItem(UPDATER_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UpdaterMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(patch: Partial<UpdaterMeta>) {
  const next = { ...readMeta(), ...patch };
  localStorage.setItem(UPDATER_META_KEY, JSON.stringify(next));
  return next;
}

function autoCheckIntervalMs() {
  const override = Number(window.__aimdUpdaterAutoCheckIntervalMs);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_AUTO_CHECK_INTERVAL_MS;
}

function autoCheckJitterMs() {
  const override = Number(window.__aimdUpdaterAutoCheckJitterMs);
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_AUTO_CHECK_JITTER_MS;
}

function startupAutoCheckDelayMs() {
  const override = Number(window.__aimdUpdaterAutoCheckDelayMs);
  return Number.isFinite(override) && override >= 0
    ? override
    : 30_000 + Math.round(Math.random() * 30_000);
}

function shouldRunAutoCheck(now = Date.now()) {
  return shouldRunAutomaticUpdateCheck(readMeta(), now, autoCheckIntervalMs());
}

function summarizeReleaseNotes(notes?: string) {
  if (!notes) return "";
  const text = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("，");
  return text.length > 88 ? `${text.slice(0, 86)}…` : text;
}

function logUpdater(level: "debug" | "info" | "warn" | "error", event: string, data: Record<string, unknown>) {
  const payload = {
    event,
    endpoint: AIMD_RELEASE.updaterManifestUrl,
    channel: AIMD_RELEASE.channel,
    platform: cachedPlatformKey,
    ...data,
  };
  debugLog(level, `[updater] ${JSON.stringify(payload)}`);
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
  console[method]("[updater]", payload);
}

function phaseTitle(view: UpdateUiState) {
  if (view.surface === "about") return "AIMD";
  if (view.phase === "checking") return "AIMD 更新";
  if (view.phase === "upToDate") return "AIMD 已是最新版本";
  if (view.phase === "available") return `AIMD ${view.latestVersion} 可用`;
  if (view.phase === "downloading" || view.phase === "downloadingUnknownSize") return `正在下载 AIMD ${view.latestVersion}`;
  if (view.phase === "installing") return "正在准备安装";
  if (view.phase === "blocked") return "需要先保存文档";
  if (view.phase === "installed") return view.detail?.includes("安装器") ? "已打开系统安装器" : "更新已安装";
  if (view.phase === "error") return view.errorTitle || "更新失败";
  return "AIMD 更新";
}

function phaseMessage(view: UpdateUiState) {
  if (view.surface === "about") return "";
  if (view.phase === "checking") return "正在检查更新";
  if (view.phase === "upToDate") return `当前版本 ${view.currentVersion}`;
  if (view.phase === "available") return `当前 ${view.currentVersion} → 最新 ${view.latestVersion}`;
  if (view.phase === "blocked") return view.detail || `有 ${view.dirtyDocumentCount || 1} 个未保存文档，保存后再安装`;
  if (view.phase === "installed") return view.detail || "完成后重新打开 AIMD";
  if (view.phase === "error") return view.errorMessage || view.detail || "请稍后重试";
  if (view.phase === "installing") return view.progressText || "正在验证签名";
  return "";
}

function canHideToBackground(view: UpdateUiState) {
  return view.phase === "checking"
    || view.phase === "downloading"
    || view.phase === "downloadingUnknownSize"
    || view.phase === "installing";
}

function hasProgress(view: UpdateUiState) {
  return view.phase === "checking"
    || view.phase === "downloading"
    || view.phase === "downloadingUnknownSize"
    || view.phase === "installing";
}

function statusSummary(view: UpdateUiState) {
  if (view.phase === "checking") return "正在检查更新";
  if (view.phase === "upToDate") return "已是最新版本";
  if (view.phase === "available") return `发现 ${view.latestVersion}`;
  if (view.phase === "downloading" || view.phase === "downloadingUnknownSize") {
    const percent = formatPercent(view.percent);
    return [`正在下载 ${view.latestVersion}`, percent].filter(Boolean).join(" · ");
  }
  if (view.phase === "installing") return `正在安装 ${view.latestVersion || ""}`.trim();
  if (view.phase === "blocked") return "更新被未保存文档阻止";
  if (view.phase === "installed") return view.detail?.includes("安装器") ? "已打开系统安装器" : "更新已准备好";
  if (view.phase === "error") return "更新失败";
  const meta = readMeta();
  if (meta.lastSeenVersion && meta.lastSeenVersion !== view.currentVersion) return `发现 ${meta.lastSeenVersion}`;
  return meta.lastAutoCheckAt || meta.lastManualCheckAt ? "已检查更新" : "未检查";
}

function backgroundStatus(view: UpdateUiState) {
  if (view.phase === "available" && view.latestVersion) return { text: `有新版本 ${view.latestVersion}`, tone: "info" as const };
  if ((view.phase === "downloading" || view.phase === "downloadingUnknownSize") && view.latestVersion) {
    const percent = formatPercent(view.percent);
    return { text: [`正在下载 ${view.latestVersion}`, percent].filter(Boolean).join(" · "), tone: "loading" as const };
  }
  if (view.phase === "installing" && view.latestVersion) return { text: `正在安装 ${view.latestVersion}`, tone: "loading" as const };
  if (view.phase === "installed") return { text: statusSummary(view), tone: "success" as const };
  if (view.phase === "error") return { text: "更新失败", tone: "warn" as const };
  return null;
}

function syncStatusBar(view: UpdateUiState) {
  const status = view.surface === "closed" ? backgroundStatus(view) : null;
  if (status) {
    setStatusOverride(status.text, status.tone, UPDATER_STATUS_ACTION);
  } else {
    clearStatusOverride(UPDATER_STATUS_ACTION);
  }
}

function applyProgressBar(view: UpdateUiState) {
  const value = safeProgressValue(view.percent);
  const determinate = value !== undefined && view.phase === "downloading";
  progressBarEl.classList.toggle("is-indeterminate", !determinate);
  if (determinate) {
    progressBarEl.setAttribute("aria-valuenow", String(value));
    progressFillEl.style.width = `${value}%`;
  } else {
    progressBarEl.removeAttribute("aria-valuenow");
    progressFillEl.style.width = "";
  }
  progressBarEl.setAttribute("aria-valuetext", view.progressText || statusSummary(view));
}

function renderAbout(view: UpdateUiState) {
  const info = lastVersionInfo;
  aboutVersionEl.textContent = `版本 ${info?.version || view.currentVersion} · ${info?.channel || AIMD_RELEASE.channel}`;
  aboutPlatformEl.textContent = info?.platformLabel || platformLabel(cachedPlatformKey);
  aboutUpdateSummaryEl.textContent = `更新状态：${statusSummary(view)}`;
  aboutInstallBtn?.toggleAttribute("hidden", view.phase !== "available");
}

function hideAllActionButtons() {
  for (const button of [
    releaseBtn,
    copyDiagnosticsBtn,
    focusDirtyBtn,
    backgroundBtn,
    remindLaterBtn,
    retryBtn,
    installBtn,
  ]) {
    button.hidden = true;
    button.disabled = false;
  }
}

function renderUpdateActions(view: UpdateUiState) {
  hideAllActionButtons();
  if (view.phase === "available") {
    releaseBtn.hidden = false;
    releaseBtn.textContent = "发布说明";
    remindLaterBtn.hidden = false;
    installBtn.hidden = false;
    installBtn.disabled = installingUpdate;
  } else if (view.phase === "upToDate") {
    releaseBtn.hidden = false;
    releaseBtn.textContent = "发布页面";
  } else if (canHideToBackground(view)) {
    backgroundBtn.hidden = false;
  } else if (view.phase === "blocked") {
    focusDirtyBtn.hidden = false;
    retryBtn.hidden = false;
    retryBtn.textContent = "保存后重试";
  } else if (view.phase === "error") {
    copyDiagnosticsBtn.hidden = false;
    retryBtn.hidden = false;
    retryBtn.textContent = "重新检查";
  }
}

function render(view: UpdateUiState) {
  if (!panelEl) return;
  const visible = view.surface !== "closed";
  panelEl.hidden = !visible;
  panelEl.dataset.surface = view.surface;
  panelEl.dataset.phase = view.phase;
  titleEl.textContent = phaseTitle(view);
  const message = phaseMessage(view);
  messageEl.hidden = !message;
  messageEl.textContent = message;

  const isAbout = view.surface === "about";
  aboutBodyEl.hidden = !isAbout;
  updateBodyEl.hidden = isAbout;
  if (isAbout) {
    renderAbout(view);
  } else {
    notesEl.hidden = !(view.phase === "available" && view.releaseNotesSummary);
    notesEl.textContent = view.releaseNotesSummary || "";
    progressWrapEl.hidden = !hasProgress(view);
    if (hasProgress(view)) {
      progressEl.textContent = view.progressText || (view.phase === "checking" ? "连接发布清单" : statusSummary(view));
      progressDetailEl.textContent = view.progressDetail || "";
      applyProgressBar(view);
    }
    renderUpdateActions(view);
  }

  closeBtn.title = canHideToBackground(view) ? "后台继续" : "关闭";
  closeBtn.setAttribute("aria-label", closeBtn.title);
  syncStatusBar(view);
}

function commitState(patch: Partial<UpdateUiState>) {
  uiState = { ...uiState, ...patch };
  render(uiState);
}

async function checkWithMock(manual: boolean): Promise<MockUpdate | null> {
  const mock = window.__aimd_updater_mock;
  if (!mock) return null;
  return await mock.check(manual);
}

function isManifestUpdate(update: PendingUpdate): update is ManifestUpdate {
  return "installerKind" in update;
}

function isMacPkgUpdate(update: PendingUpdate): update is ManifestUpdate {
  return isManifestUpdate(update) && update.installerKind === "macos-pkg";
}

async function checkForUpdateObject(manual: boolean, current: string): Promise<PendingUpdate | null> {
  if (window.__aimd_updater_mock) return await checkWithMock(manual);
  if (!isTauri()) return null;
  const platform = await updaterPlatformKey();
  if (platform === "darwin-aarch64") {
    return await invoke<ManifestUpdate | null>("updater_check_manifest", {
      manifestUrl: AIMD_RELEASE.updaterManifestUrl,
      currentVersion: current,
    });
  }
  return await check();
}

async function dirtyDocuments(): Promise<DirtyDocumentWindow[]> {
  await syncDirtyDocumentState(true);
  const localDirty = state.doc?.dirty
    ? [{ label: "current", title: state.doc.title || "未命名文档", path: state.doc.path || "" }]
    : [];
  try {
    const remote = await invoke<DirtyDocumentWindow[]>("updater_dirty_documents");
    return remote.length > 0 ? remote : localDirty;
  } catch {
    return localDirty;
  }
}

function formatDirtyDocuments(dirty: DirtyDocumentWindow[]) {
  return `有 ${dirty.length} 个未保存文档，保存后再安装`;
}

function progressPatchFromTelemetry(telemetry: DownloadTelemetry, current: string, latest: string) {
  const snapshot = telemetry.snapshot();
  const phase: UpdatePhase = snapshot.totalBytes ? "downloading" : "downloadingUnknownSize";
  return {
    phase,
    currentVersion: current,
    latestVersion: latest,
    progressText: formatProgressLine(snapshot),
    progressDetail: snapshot.totalBytes ? "" : "总大小未知",
    downloadedBytes: snapshot.downloadedBytes,
    totalBytes: snapshot.totalBytes,
    bytesPerSecond: snapshot.bytesPerSecond,
    etaSeconds: snapshot.etaSeconds,
    elapsedMs: snapshot.elapsedMs,
    percent: snapshot.percent,
  } satisfies Partial<UpdateUiState>;
}

function startDownloadState(id: string, current: string, latest: string, totalBytes?: number) {
  activeTelemetry = new DownloadTelemetry();
  activeTelemetry.setTotalBytes(totalBytes);
  commitState({
    surface: "update",
    phase: totalBytes ? "downloading" : "downloadingUnknownSize",
    requestId: id,
    currentVersion: current,
    latestVersion: latest,
    progressText: totalBytes ? "0% · 0 KB" : "正在准备下载",
    progressDetail: "",
    downloadedBytes: 0,
    totalBytes,
    bytesPerSecond: undefined,
    etaSeconds: undefined,
    elapsedMs: 0,
    percent: totalBytes ? 0 : undefined,
    manual: true,
  });
}

function updateTelemetryProgress(current: string, latest: string, event: MockProgressEvent, nowMs?: number) {
  if (!activeTelemetry) activeTelemetry = new DownloadTelemetry(nowMs);
  if (event.totalBytes !== undefined) activeTelemetry.setTotalBytes(event.totalBytes);
  if (event.downloadedBytes !== undefined) {
    activeTelemetry.setDownloadedBytes(event.downloadedBytes, nowMs);
  } else if (event.chunkLength !== undefined) {
    activeTelemetry.addChunk(event.chunkLength, nowMs);
  }
  commitState(progressPatchFromTelemetry(activeTelemetry, current, latest));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function simulateMockDownload(update: MockUpdate, current: string, latest: string) {
  const events = update.progressEvents && update.progressEvents.length > 0
    ? update.progressEvents
    : update.unknownSize
      ? [{ chunkLength: 512 * 1024, timeMs: 1000 }]
      : [
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.35, timeMs: 1000 },
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.35, timeMs: 2000 },
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.3, timeMs: 3000 },
        ];
  const total = update.unknownSize ? undefined : update.contentLength || events.find((event) => event.totalBytes)?.totalBytes;
  startDownloadState(uiState.requestId || requestId(), current, latest, total);
  let mockNow = performance.now();
  for (const event of events) {
    if (event.delayMs) await sleep(event.delayMs);
    mockNow += event.timeMs || event.delayMs || 1000;
    updateTelemetryProgress(current, latest, event, mockNow);
  }
}

async function listenToMacPkgProgress(id: string, current: string, latest: string) {
  const unlisteners: Array<() => void> = [];
  const matches = (payload: MacPkgDownloadEvent) => payload?.requestId === id;
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-download-started", (event) => {
    if (!matches(event.payload)) return;
    startDownloadState(id, current, latest, event.payload.totalBytes);
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-download-progress", (event) => {
    if (!matches(event.payload)) return;
    updateTelemetryProgress(current, latest, {
      downloadedBytes: event.payload.downloadedBytes,
      totalBytes: event.payload.totalBytes,
    });
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-verifying", (event) => {
    if (!matches(event.payload)) return;
    commitState({
      phase: "installing",
      currentVersion: current,
      latestVersion: latest,
      progressText: "正在验证签名",
      progressDetail: "",
    });
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-installing", (event) => {
    if (!matches(event.payload)) return;
    commitState({
      phase: "installing",
      currentVersion: current,
      latestVersion: latest,
      progressText: "正在打开安装器",
      progressDetail: "",
    });
  }));
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

async function installPendingUpdate() {
  const update = pendingUpdate;
  if (!update) return;
  if (installingUpdate) {
    commitState({ surface: "update" });
    return;
  }

  const id = requestId();
  const current = await currentVersion();
  const latest = update.version;
  const dirty = await dirtyDocuments();
  if (dirty.length > 0) {
    commitState({
      surface: "update",
      phase: "blocked",
      requestId: id,
      currentVersion: current,
      latestVersion: latest,
      detail: formatDirtyDocuments(dirty),
      dirtyDocumentCount: dirty.length,
      manual: true,
    });
    setStatus("安装更新前需要保存文档", "warn");
    logUpdater("warn", "install_blocked_dirty_documents", { requestId: id, currentVersion: current, latestVersion: latest, dirtyWindows: dirty.length });
    return;
  }

  installingUpdate = true;
  activeTelemetry = null;
  commitState({
    surface: "update",
    phase: "downloadingUnknownSize",
    requestId: id,
    currentVersion: current,
    latestVersion: latest,
    progressText: "正在准备下载",
    progressDetail: "",
    manual: true,
  });
  logUpdater("info", "download_started", { requestId: id, currentVersion: current, latestVersion: latest });

  try {
    let contentLength = 0;
    if (window.__aimd_updater_mock) {
      const mockUpdate = update as MockUpdate;
      if (mockUpdate.failInstall) throw new Error(mockUpdate.failInstall);
      await simulateMockDownload(mockUpdate, current, latest);
      await window.__aimd_updater_mock.install?.(mockUpdate, {
        onProgress: (event) => updateTelemetryProgress(current, latest, event),
        onPhase: (phase) => {
          commitState({
            phase,
            currentVersion: current,
            latestVersion: latest,
            progressText: phase === "installing" ? "正在安装" : "安装完成",
            progressDetail: "",
          });
        },
      });
    } else if (isMacPkgUpdate(update)) {
      const unlisten = await listenToMacPkgProgress(id, current, latest);
      try {
        const result = await invoke<MacPkgInstallResult>("updater_install_macos_pkg", {
          requestId: id,
          url: update.url,
          signature: update.signature,
          pubkey: AIMD_RELEASE.updaterPubkey,
          version: update.version,
        });
        contentLength = result.bytes || 0;
      } finally {
        unlisten();
      }
      commitState({
        surface: "update",
        phase: "installed",
        currentVersion: current,
        latestVersion: latest,
        detail: "完成安装后重新打开 AIMD",
        progressText: undefined,
        progressDetail: undefined,
        manual: true,
      });
      logUpdater("info", "install_finished", {
        requestId: id,
        currentVersion: current,
        latestVersion: latest,
        installerKind: update.installerKind,
        downloadSize: contentLength || null,
      });
      return;
    } else {
      const tauriUpdate = update as Update;
      await tauriUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
          startDownloadState(id, current, latest, contentLength || undefined);
        } else if (event.event === "Progress") {
          updateTelemetryProgress(current, latest, { chunkLength: event.data.chunkLength, totalBytes: contentLength || undefined });
        } else if (event.event === "Finished") {
          commitState({
            phase: "installing",
            currentVersion: current,
            latestVersion: latest,
            progressText: "正在安装",
            progressDetail: "",
          });
        }
      });
    }

    commitState({
      surface: "update",
      phase: "installed",
      currentVersion: current,
      latestVersion: latest,
      detail: window.__aimd_updater_mock ? "更新已安装" : "正在重启 AIMD",
      progressText: undefined,
      progressDetail: undefined,
      manual: true,
    });
    const telemetry = activeTelemetry as DownloadTelemetry | null;
    const snapshot = telemetry ? telemetry.snapshot() : undefined;
    logUpdater("info", "install_finished", {
      requestId: id,
      currentVersion: current,
      latestVersion: latest,
      downloadSize: snapshot?.totalBytes || contentLength || null,
      downloadedBytes: snapshot?.downloadedBytes || null,
      elapsedMs: snapshot ? Math.round(snapshot.elapsedMs) : null,
    });
    if (window.__aimd_updater_mock) return;
    await relaunch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastFailureMessage = message;
    commitState({
      surface: uiState.surface === "closed" ? "closed" : "update",
      phase: "error",
      currentVersion: current,
      latestVersion: latest,
      detail: `${message}，请稍后重试`,
      errorTitle: "更新失败",
      errorMessage: `${message}，请稍后重试`,
      manual: true,
    });
    logUpdater("error", "install_failed", { requestId: id, currentVersion: current, latestVersion: latest, failure: message });
  } finally {
    installingUpdate = false;
  }
}

export async function checkForUpdates(opts: CheckOptions = {}) {
  const manual = Boolean(opts.manual);
  const automatic = Boolean(opts.automatic || !manual);
  if (installingUpdate) {
    commitState({ surface: "update" });
    return;
  }
  if (checking) {
    if (manual) commitState({ surface: "update" });
    return;
  }
  if (!manual && !isTauri() && !window.__aimd_updater_mock) return;

  checking = true;
  const id = requestId();
  const started = performance.now();
  const current = await currentVersion();
  try {
    await updaterPlatformKey();
    if (manual) {
      writeMeta({ lastManualCheckAt: Date.now() });
      commitState({
        surface: "update",
        phase: "checking",
        requestId: id,
        currentVersion: current,
        progressText: "连接发布清单",
        progressDetail: "",
        manual: true,
      });
      setStatus("正在检查更新", "loading");
    }
    const update = await checkForUpdateObject(manual, current);
    const elapsedMs = Math.round(performance.now() - started);
    if (!update) {
      logUpdater("info", "check_no_update", { requestId: id, currentVersion: current, elapsedMs, automatic });
      if (manual) {
        commitState({
          surface: "update",
          phase: "upToDate",
          requestId: id,
          currentVersion: current,
          elapsedMs,
          manual: true,
        });
      }
      return;
    }

    pendingUpdate = update;
    const notes = "body" in update ? update.body : "";
    const metaPatch: Partial<UpdaterMeta> = {
      lastSeenVersion: update.version,
      lastNotifiedVersion: automatic ? update.version : readMeta().lastNotifiedVersion,
    };
    writeMeta(metaPatch);
    logUpdater("info", "check_update_available", {
      requestId: id,
      currentVersion: current,
      latestVersion: update.version,
      installerKind: isManifestUpdate(update) ? update.installerKind : "tauri",
      elapsedMs,
      automatic,
    });
    commitState({
      surface: manual ? "update" : "closed",
      phase: "available",
      requestId: id,
      currentVersion: current,
      latestVersion: update.version,
      releaseNotesSummary: summarizeReleaseNotes(notes),
      elapsedMs,
      manual,
    });
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    lastFailureMessage = message;
    logUpdater("warn", "check_failed", { requestId: id, currentVersion: current, elapsedMs, failure: message, automatic });
    if (manual) {
      commitState({
        surface: "update",
        phase: "error",
        requestId: id,
        currentVersion: current,
        detail: `${message}，请稍后重试`,
        errorTitle: "更新失败",
        errorMessage: `${message}，请稍后重试`,
        elapsedMs,
        manual: true,
      });
    }
  } finally {
    checking = false;
  }
}

async function runAutomaticUpdateCheck(force = false) {
  if (!force && !shouldRunAutoCheck()) return;
  writeMeta({ lastAutoCheckAt: Date.now() });
  await checkForUpdates({ manual: false, automatic: true });
}

function scheduleNextAutomaticCheck() {
  if (autoCheckTimer !== null) window.clearTimeout(autoCheckTimer);
  autoCheckTimer = window.setTimeout(() => {
    void runAutomaticUpdateCheck(false);
    scheduleNextAutomaticCheck();
  }, nextAutomaticCheckDelayMs(autoCheckIntervalMs(), autoCheckJitterMs()));
}

function hideSurface() {
  if (uiState.phase === "available" && uiState.latestVersion) {
    writeMeta({ lastDismissedVersion: uiState.latestVersion });
  }
  commitState({ surface: "closed" });
}

function reopenUpdatePanel() {
  if (uiState.phase === "idle") return;
  commitState({ surface: "update" });
}

export async function showAboutAimd() {
  const info = await getVersionInfo();
  commitState({
    surface: "about",
    currentVersion: info.version,
    manual: false,
  });
  aboutCopyStatusEl.hidden = true;
}

async function copyVersionInfo() {
  const info = lastVersionInfo || await getVersionInfo();
  try {
    await navigator.clipboard.writeText(versionDiagnostics({
      version: info.version,
      channel: info.channel,
      platformKey: info.platformKey,
      updaterStatus: statusSummary(uiState),
      updaterManifestUrl: info.updaterManifestUrl,
      releaseUrl: info.releaseUrl,
    }));
    aboutCopyStatusEl.textContent = "版本信息已复制";
    aboutCopyStatusEl.hidden = false;
  } catch {
    aboutCopyStatusEl.textContent = "复制失败";
    aboutCopyStatusEl.hidden = false;
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(errorDiagnostics({
      requestId: uiState.requestId,
      currentVersion: uiState.currentVersion,
      latestVersion: uiState.latestVersion,
      platformKey: cachedPlatformKey,
      endpoint: AIMD_RELEASE.updaterManifestUrl,
      elapsedMs: uiState.elapsedMs,
      errorMessage: lastFailureMessage || uiState.errorMessage,
    }));
    setStatus("诊断已复制", "success");
  } catch {
    setStatus("复制诊断失败", "warn");
  }
}

async function openReleasePage() {
  try {
    await invoke("open_aimd_release_url", { url: AIMD_RELEASE.releaseUrl });
  } catch (err) {
    setStatus(`打开发布页面失败: ${String(err)}`, "warn");
  }
}

async function focusDirtyDocument() {
  try {
    await invoke("updater_focus_dirty_window");
  } catch {
    setStatus("定位未保存文档失败", "warn");
  }
}

export function bindUpdater() {
  panelEl = document.querySelector("#update-panel")!;
  titleEl = document.querySelector("#update-title")!;
  messageEl = document.querySelector("#update-message")!;
  aboutBodyEl = document.querySelector("#about-body")!;
  aboutVersionEl = document.querySelector("#about-version")!;
  aboutPlatformEl = document.querySelector("#about-platform")!;
  aboutUpdateSummaryEl = document.querySelector("#about-update-summary")!;
  aboutCopyStatusEl = document.querySelector("#about-copy-status")!;
  aboutCheckBtn = document.querySelector("#about-check-updates")!;
  aboutCopyBtn = document.querySelector("#about-copy-version")!;
  aboutReleaseBtn = document.querySelector("#about-release")!;
  aboutInstallBtn = document.querySelector("#about-install");
  updateBodyEl = document.querySelector("#update-body")!;
  notesEl = document.querySelector("#update-notes")!;
  progressWrapEl = document.querySelector("#update-progress-wrap")!;
  progressBarEl = document.querySelector("#update-progress-bar")!;
  progressFillEl = document.querySelector("#update-progress-fill")!;
  progressEl = document.querySelector("#update-progress")!;
  progressDetailEl = document.querySelector("#update-progress-detail")!;
  closeBtn = document.querySelector("#update-later")!;
  releaseBtn = document.querySelector("#update-release")!;
  copyDiagnosticsBtn = document.querySelector("#update-copy-diagnostics")!;
  focusDirtyBtn = document.querySelector("#update-focus-dirty")!;
  backgroundBtn = document.querySelector("#update-background")!;
  remindLaterBtn = document.querySelector("#update-remind-later")!;
  retryBtn = document.querySelector("#update-retry")!;
  installBtn = document.querySelector("#update-install")!;

  closeBtn.addEventListener("click", hideSurface);
  backgroundBtn.addEventListener("click", hideSurface);
  remindLaterBtn.addEventListener("click", hideSurface);
  installBtn.addEventListener("click", () => { void installPendingUpdate(); });
  aboutInstallBtn?.addEventListener("click", () => { void installPendingUpdate(); });
  retryBtn.addEventListener("click", () => {
    if (uiState.phase === "blocked" && pendingUpdate) {
      void installPendingUpdate();
      return;
    }
    void checkForUpdates({ manual: true });
  });
  focusDirtyBtn.addEventListener("click", () => { void focusDirtyDocument(); });
  releaseBtn.addEventListener("click", () => { void openReleasePage(); });
  copyDiagnosticsBtn.addEventListener("click", () => { void copyDiagnostics(); });
  aboutCheckBtn.addEventListener("click", () => { void checkForUpdates({ manual: true }); });
  aboutCopyBtn.addEventListener("click", () => { void copyVersionInfo(); });
  aboutReleaseBtn.addEventListener("click", () => { void openReleasePage(); });
  statusPillEl().addEventListener("click", () => {
    if (statusPillEl().dataset.action === UPDATER_STATUS_ACTION) reopenUpdatePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && uiState.surface !== "closed") hideSurface();
  });

  window.__aimd_checkForUpdates = checkForUpdates;
  window.__aimd_showAboutAimd = showAboutAimd;
  window.__aimd_runScheduledUpdateCheck = async (opts = {}) => {
    await runAutomaticUpdateCheck(Boolean(opts.force));
  };
  void getVersionInfo().then((info) => {
    commitState({ currentVersion: info.version });
  });
}

export function scheduleStartupUpdateCheck() {
  window.setTimeout(() => {
    void runAutomaticUpdateCheck(false);
    scheduleNextAutomaticCheck();
  }, startupAutoCheckDelayMs());
  window.addEventListener("online", () => { void runAutomaticUpdateCheck(false); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runAutomaticUpdateCheck(false);
  });
}
