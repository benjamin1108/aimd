import { invoke } from "@tauri-apps/api/core";
import { type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { state } from "../core/state";
import { setStatus } from "../ui/chrome";
import { syncDirtyDocumentState } from "./dirty-state";
import {
  initialDownloadPatch,
  listenToMacPkgProgress,
  simulateMockDownload,
  updateTelemetryProgress as telemetryProgressPatch,
} from "./download";
import { userFacingUpdaterError } from "./diagnostics";
import { AIMD_RELEASE } from "./release";
import { currentVersion } from "./runtime";
import { DownloadTelemetry } from "./telemetry";
import type {
  DirtyDocumentWindow,
  MacPkgInstallResult,
  ManifestUpdate,
  MockProgressEvent,
  MockUpdate,
  PendingUpdate,
  UpdateUiState,
  UpdaterSurface,
} from "./types";

type InstallContext = {
  currentSurface: () => UpdaterSurface;
  currentRequestId: () => string | undefined;
  isInstalling: () => boolean;
  setInstalling: (value: boolean) => void;
  commitState: (patch: Partial<UpdateUiState>) => void;
  logUpdater: (level: "debug" | "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
  requestId: () => string;
  setLastFailureMessage: (message: string) => void;
};

function isManifestUpdate(update: PendingUpdate): update is ManifestUpdate {
  return "installerKind" in update;
}

function isMacPkgUpdate(update: PendingUpdate): update is ManifestUpdate {
  return isManifestUpdate(update) && update.installerKind === "macos-pkg";
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

function startDownloadState(
  telemetry: DownloadTelemetry,
  context: InstallContext,
  id: string,
  current: string,
  latest: string,
  totalBytes?: number,
) {
  telemetry.setTotalBytes(totalBytes);
  context.commitState(initialDownloadPatch(id, current, latest, totalBytes));
}

function updateTelemetryProgress(
  telemetry: DownloadTelemetry,
  context: InstallContext,
  current: string,
  latest: string,
  event: MockProgressEvent,
  nowMs?: number,
) {
  context.commitState(telemetryProgressPatch(telemetry, current, latest, event, nowMs));
}

function commitInstallPhase(
  context: InstallContext,
  current: string,
  latest: string,
  progressText: string,
) {
  context.commitState({
    phase: "installing",
    currentVersion: current,
    latestVersion: latest,
    progressText,
    progressDetail: "",
  });
}

export async function installPendingUpdate(
  update: PendingUpdate | null,
  context: InstallContext,
) {
  if (!update) return;
  if (context.isInstalling()) {
    context.commitState({ surface: "update" });
    return;
  }

  const id = context.requestId();
  const current = await currentVersion();
  const latest = update.version;
  const dirty = await dirtyDocuments();
  if (dirty.length > 0) {
    context.commitState({
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
    context.logUpdater("warn", "install_blocked_dirty_documents", {
      requestId: id,
      currentVersion: current,
      latestVersion: latest,
      dirtyWindows: dirty.length,
    });
    return;
  }

  context.setInstalling(true);
  let telemetry = new DownloadTelemetry();
  context.commitState({
    surface: "update",
    phase: "downloadingUnknownSize",
    requestId: id,
    currentVersion: current,
    latestVersion: latest,
    progressText: "正在准备下载",
    progressDetail: "",
    manual: true,
  });
  context.logUpdater("info", "download_started", { requestId: id, currentVersion: current, latestVersion: latest });

  try {
    let contentLength = 0;
    if (window.__aimd_updater_mock) {
      const mockUpdate = update as MockUpdate;
      if (mockUpdate.failInstall) throw new Error(mockUpdate.failInstall);
      await simulateMockDownload(mockUpdate, current, latest, telemetry, {
        start: (totalBytes) => startDownloadState(telemetry, context, context.currentRequestId() || context.requestId(), current, latest, totalBytes),
        progress: context.commitState,
      });
      await window.__aimd_updater_mock.install?.(mockUpdate, {
        onProgress: (event) => updateTelemetryProgress(telemetry, context, current, latest, event),
        onPhase: (phase) => commitInstallPhase(context, current, latest, phase === "installing" ? "正在安装" : "安装完成"),
      });
    } else if (isMacPkgUpdate(update)) {
      const unlisten = await listenToMacPkgProgress(id, current, latest, telemetry, {
        start: (totalBytes) => startDownloadState(telemetry, context, id, current, latest, totalBytes),
        progress: context.commitState,
        phase: (progressText) => commitInstallPhase(context, current, latest, progressText),
      });
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
      context.commitState({
        surface: "update",
        phase: "installed",
        currentVersion: current,
        latestVersion: latest,
        detail: "完成安装后重新打开 AIMD",
        progressText: undefined,
        progressDetail: undefined,
        manual: true,
      });
      context.logUpdater("info", "install_finished", {
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
          startDownloadState(telemetry, context, id, current, latest, contentLength || undefined);
        } else if (event.event === "Progress") {
          updateTelemetryProgress(telemetry, context, current, latest, {
            chunkLength: event.data.chunkLength,
            totalBytes: contentLength || undefined,
          });
        } else if (event.event === "Finished") {
          commitInstallPhase(context, current, latest, "正在安装");
        }
      });
    }

    context.commitState({
      surface: "update",
      phase: "installed",
      currentVersion: current,
      latestVersion: latest,
      detail: window.__aimd_updater_mock ? "更新已安装" : "正在重启 AIMD",
      progressText: undefined,
      progressDetail: undefined,
      manual: true,
    });
    const snapshot = telemetry.snapshot();
    context.logUpdater("info", "install_finished", {
      requestId: id,
      currentVersion: current,
      latestVersion: latest,
      downloadSize: snapshot.totalBytes || contentLength || null,
      downloadedBytes: snapshot.downloadedBytes || null,
      elapsedMs: Math.round(snapshot.elapsedMs),
    });
    if (window.__aimd_updater_mock) return;
    await relaunch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const userMessage = userFacingUpdaterError(message);
    context.setLastFailureMessage(message);
    context.commitState({
      surface: context.currentSurface() === "closed" ? "closed" : "update",
      phase: "error",
      currentVersion: current,
      latestVersion: latest,
      detail: `${userMessage}，请稍后重试`,
      errorTitle: "更新失败",
      errorMessage: `${userMessage}，请稍后重试`,
      manual: true,
    });
    context.logUpdater("error", "install_failed", {
      requestId: id,
      currentVersion: current,
      latestVersion: latest,
      failure: message,
    });
  } finally {
    context.setInstalling(false);
  }
}
