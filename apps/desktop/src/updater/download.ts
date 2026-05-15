import { listen } from "@tauri-apps/api/event";
import { DownloadTelemetry, formatProgressLine } from "./telemetry";
import type {
  MacPkgDownloadEvent,
  MockProgressEvent,
  MockUpdate,
  UpdatePhase,
  UpdateUiState,
} from "./types";

type ProgressHandlers = {
  start: (totalBytes?: number) => void;
  progress: (patch: Partial<UpdateUiState>) => void;
  phase: (progressText: string) => void;
};

export function progressPatchFromTelemetry(
  telemetry: DownloadTelemetry,
  current: string,
  latest: string,
) {
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

export function updateTelemetryProgress(
  telemetry: DownloadTelemetry,
  current: string,
  latest: string,
  event: MockProgressEvent,
  nowMs?: number,
) {
  if (event.totalBytes !== undefined) telemetry.setTotalBytes(event.totalBytes);
  if (event.downloadedBytes !== undefined) {
    telemetry.setDownloadedBytes(event.downloadedBytes, nowMs);
  } else if (event.chunkLength !== undefined) {
    telemetry.addChunk(event.chunkLength, nowMs);
  }
  return progressPatchFromTelemetry(telemetry, current, latest);
}

export function initialDownloadPatch(
  id: string,
  current: string,
  latest: string,
  totalBytes?: number,
) {
  return {
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
  } satisfies Partial<UpdateUiState>;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function simulateMockDownload(
  update: MockUpdate,
  current: string,
  latest: string,
  telemetry: DownloadTelemetry,
  handlers: Pick<ProgressHandlers, "start" | "progress">,
) {
  const events = update.progressEvents && update.progressEvents.length > 0
    ? update.progressEvents
    : update.unknownSize
      ? [{ chunkLength: 512 * 1024, timeMs: 1000 }]
      : [
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.35, timeMs: 1000 },
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.35, timeMs: 2000 },
          { chunkLength: (update.contentLength || 8 * 1024 * 1024) * 0.3, timeMs: 3000 },
        ];
  const total = update.unknownSize
    ? undefined
    : update.contentLength || events.find((event) => event.totalBytes)?.totalBytes;
  telemetry.setTotalBytes(total);
  handlers.start(total);
  let mockNow = performance.now();
  for (const event of events) {
    if (event.delayMs) await sleep(event.delayMs);
    mockNow += event.timeMs || event.delayMs || 1000;
    handlers.progress(updateTelemetryProgress(telemetry, current, latest, event, mockNow));
  }
}

export async function listenToMacPkgProgress(
  id: string,
  current: string,
  latest: string,
  telemetry: DownloadTelemetry,
  handlers: ProgressHandlers,
) {
  const unlisteners: Array<() => void> = [];
  const matches = (payload: MacPkgDownloadEvent) => payload?.requestId === id;
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-download-started", (event) => {
    if (!matches(event.payload)) return;
    telemetry.setTotalBytes(event.payload.totalBytes);
    handlers.start(event.payload.totalBytes);
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-download-progress", (event) => {
    if (!matches(event.payload)) return;
    handlers.progress(updateTelemetryProgress(telemetry, current, latest, {
      downloadedBytes: event.payload.downloadedBytes,
      totalBytes: event.payload.totalBytes,
    }));
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-verifying", (event) => {
    if (matches(event.payload)) handlers.phase("正在验证签名");
  }));
  unlisteners.push(await listen<MacPkgDownloadEvent>("aimd-updater-installing", (event) => {
    if (matches(event.payload)) handlers.phase("正在打开安装器");
  }));
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
