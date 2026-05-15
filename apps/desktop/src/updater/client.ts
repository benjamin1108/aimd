import { invoke, isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { statusPillEl } from "../core/dom";
import { setStatus } from "../ui/chrome";
import {
  errorDiagnostics,
  userFacingUpdaterError,
  versionDiagnostics,
} from "./diagnostics";
import { installPendingUpdate as runInstallPendingUpdate } from "./install";
import { AIMD_RELEASE } from "./release";
import {
  currentVersion,
  currentVersionFallback,
  getCachedPlatformKey,
  getLastVersionInfo,
  getVersionInfo,
  updaterPlatformKey,
} from "./runtime";
import {
  STARTUP_AUTO_CHECK_DELAY_MS,
  type UpdaterMeta,
} from "./schedule";
import type {
  CheckOptions,
  ManifestUpdate,
  MockUpdate,
  PendingUpdate,
  UpdateUiState,
} from "./types";
import {
  bindUpdaterView,
  UPDATER_STATUS_ACTION,
  updaterStatusSummary,
  renderUpdaterView,
  type UpdaterViewRefs,
} from "./view";

const UPDATER_META_KEY = "aimd.desktop.updater.meta";

let viewRefs: UpdaterViewRefs;
let pendingUpdate: PendingUpdate | null = null;
let checking = false;
let installingUpdate = false;
let lastFailureMessage = "";
let startupAutoCheckTimer: number | null = null;

let uiState: UpdateUiState = {
  surface: "closed",
  phase: "idle",
  currentVersion: currentVersionFallback(),
  manual: false,
};

function requestId() {
  return `upd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function startupAutoCheckDelayMs() {
  const override = Number(window.__aimdUpdaterAutoCheckDelayMs);
  return Number.isFinite(override) && override >= 0 ? override : STARTUP_AUTO_CHECK_DELAY_MS;
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
    platform: getCachedPlatformKey(),
    ...data,
  };
  const method = level === "error"
    ? "error"
    : level === "warn"
      ? "warn"
      : level === "debug"
        ? "debug"
        : "info";
  console[method]("[updater]", payload);
}

function commitState(patch: Partial<UpdateUiState>) {
  uiState = { ...uiState, ...patch };
  if (!viewRefs) return;
  renderUpdaterView({
    refs: viewRefs,
    view: uiState,
    meta: readMeta(),
    versionInfo: getLastVersionInfo(),
    platformKey: getCachedPlatformKey(),
    installing: installingUpdate,
  });
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

async function installPendingUpdate() {
  await runInstallPendingUpdate(pendingUpdate, {
    currentSurface: () => uiState.surface,
    currentRequestId: () => uiState.requestId,
    isInstalling: () => installingUpdate,
    setInstalling: (value) => { installingUpdate = value; },
    commitState,
    logUpdater,
    requestId,
    setLastFailureMessage: (message) => { lastFailureMessage = message; },
  });
}

export async function checkForUpdates(opts: CheckOptions = {}) {
  const manual = Boolean(opts.manual);
  const automatic = Boolean(opts.automatic || !manual);
  if (installingUpdate) {
    logUpdater("info", "check_skipped_installing", { manual, automatic });
    commitState({ surface: "update" });
    return;
  }
  if (checking) {
    logUpdater("info", "check_skipped_already_running", { manual, automatic });
    if (manual) commitState({ surface: "update" });
    return;
  }
  if (!manual && !isTauri() && !window.__aimd_updater_mock) {
    logUpdater("debug", "check_skipped_non_tauri", { manual, automatic });
    return;
  }

  checking = true;
  const id = requestId();
  const started = performance.now();
  const current = await currentVersion();
  try {
    await updaterPlatformKey();
    logUpdater("info", "check_started", { requestId: id, currentVersion: current, manual, automatic });
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
    const userMessage = userFacingUpdaterError(message);
    lastFailureMessage = message;
    logUpdater("warn", "check_failed", { requestId: id, currentVersion: current, elapsedMs, failure: message, automatic });
    if (manual) {
      commitState({
        surface: "update",
        phase: "error",
        requestId: id,
        currentVersion: current,
        detail: `${userMessage}，请稍后重试`,
        errorTitle: "更新失败",
        errorMessage: `${userMessage}，请稍后重试`,
        elapsedMs,
        manual: true,
      });
    }
  } finally {
    checking = false;
  }
}

async function runAutomaticUpdateCheck() {
  writeMeta({ lastAutoCheckAt: Date.now() });
  await checkForUpdates({ manual: false, automatic: true });
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
  viewRefs.aboutCopyStatus.hidden = true;
}

async function copyVersionInfo() {
  const info = getLastVersionInfo() || await getVersionInfo();
  try {
    await navigator.clipboard.writeText(versionDiagnostics({
      version: info.version,
      channel: info.channel,
      platformKey: info.platformKey,
      updaterStatus: updaterStatusSummary(uiState, readMeta()),
      updaterManifestUrl: info.updaterManifestUrl,
      releaseUrl: info.releaseUrl,
    }));
    viewRefs.aboutCopyStatus.textContent = "版本信息已复制";
    viewRefs.aboutCopyStatus.hidden = false;
  } catch {
    viewRefs.aboutCopyStatus.textContent = "复制失败";
    viewRefs.aboutCopyStatus.hidden = false;
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(errorDiagnostics({
      requestId: uiState.requestId,
      currentVersion: uiState.currentVersion,
      latestVersion: uiState.latestVersion,
      platformKey: getCachedPlatformKey(),
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
  viewRefs = bindUpdaterView();
  viewRefs.close.addEventListener("click", hideSurface);
  viewRefs.background.addEventListener("click", hideSurface);
  viewRefs.remindLater.addEventListener("click", hideSurface);
  viewRefs.install.addEventListener("click", () => { void installPendingUpdate(); });
  viewRefs.aboutInstall?.addEventListener("click", () => { void installPendingUpdate(); });
  viewRefs.retry.addEventListener("click", () => {
    if (uiState.phase === "blocked" && pendingUpdate) {
      void installPendingUpdate();
      return;
    }
    void checkForUpdates({ manual: true });
  });
  viewRefs.focusDirty.addEventListener("click", () => { void focusDirtyDocument(); });
  viewRefs.release.addEventListener("click", () => { void openReleasePage(); });
  viewRefs.copyDiagnostics.addEventListener("click", () => { void copyDiagnostics(); });
  viewRefs.aboutCheck.addEventListener("click", () => { void checkForUpdates({ manual: true }); });
  viewRefs.aboutCopy.addEventListener("click", () => { void copyVersionInfo(); });
  viewRefs.aboutRelease.addEventListener("click", () => { void openReleasePage(); });
  statusPillEl().addEventListener("click", () => {
    if (statusPillEl().dataset.action === UPDATER_STATUS_ACTION) reopenUpdatePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && uiState.surface !== "closed") hideSurface();
  });

  window.__aimd_checkForUpdates = checkForUpdates;
  window.__aimd_showAboutAimd = showAboutAimd;
  window.__aimd_runScheduledUpdateCheck = async () => {
    await runAutomaticUpdateCheck();
  };
  void getVersionInfo().then((info) => {
    commitState({ currentVersion: info.version });
  });
}

export function scheduleStartupUpdateCheck() {
  if (startupAutoCheckTimer !== null) window.clearTimeout(startupAutoCheckTimer);
  const delayMs = startupAutoCheckDelayMs();
  logUpdater("info", "startup_auto_check_scheduled", { delayMs });
  startupAutoCheckTimer = window.setTimeout(() => {
    startupAutoCheckTimer = null;
    void runAutomaticUpdateCheck();
  }, delayMs);
}
