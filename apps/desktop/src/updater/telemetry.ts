export type DownloadProgressSnapshot = {
  downloadedBytes: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  percent?: number;
  elapsedMs: number;
};

type ProgressSample = {
  timeMs: number;
  downloadedBytes: number;
};

const SAMPLE_WINDOW_MS = 6000;
const MIN_SPEED_WINDOW_MS = 500;
const MIN_ETA_SPEED_BYTES_PER_SECOND = 1024;

export class DownloadTelemetry {
  private startedAtMs: number;
  private downloadedBytes = 0;
  private totalBytes?: number;
  private samples: ProgressSample[] = [];

  constructor(nowMs = performance.now()) {
    this.startedAtMs = nowMs;
    this.samples = [{ timeMs: nowMs, downloadedBytes: 0 }];
  }

  setTotalBytes(totalBytes?: number) {
    this.totalBytes = totalBytes && totalBytes > 0 ? totalBytes : undefined;
  }

  addChunk(chunkLength: number, nowMs = performance.now()) {
    if (!Number.isFinite(chunkLength) || chunkLength <= 0) return;
    this.setDownloadedBytes(this.downloadedBytes + chunkLength, nowMs);
  }

  setDownloadedBytes(downloadedBytes: number, nowMs = performance.now()) {
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0) return;
    this.downloadedBytes = Math.max(this.downloadedBytes, downloadedBytes);
    this.samples.push({ timeMs: nowMs, downloadedBytes: this.downloadedBytes });
    const cutoff = nowMs - SAMPLE_WINDOW_MS;
    this.samples = this.samples.filter((sample, index) => index === this.samples.length - 1 || sample.timeMs >= cutoff);
  }

  snapshot(nowMs = performance.now()): DownloadProgressSnapshot {
    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);
    const bytesPerSecond = this.speed(nowMs);
    const percent = this.totalBytes
      ? Math.max(0, Math.min(100, this.downloadedBytes / this.totalBytes * 100))
      : undefined;
    const etaSeconds = this.totalBytes && bytesPerSecond && bytesPerSecond >= MIN_ETA_SPEED_BYTES_PER_SECOND
      ? Math.max(0, Math.ceil((this.totalBytes - this.downloadedBytes) / bytesPerSecond))
      : undefined;
    return {
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      bytesPerSecond,
      etaSeconds,
      percent,
      elapsedMs,
    };
  }

  private speed(nowMs: number) {
    if (this.samples.length < 2) return undefined;
    const latest = this.samples[this.samples.length - 1];
    const baseline = this.samples.find((sample) => latest.timeMs - sample.timeMs >= MIN_SPEED_WINDOW_MS) || this.samples[0];
    const elapsedSeconds = (latest.timeMs - baseline.timeMs) / 1000;
    if (elapsedSeconds <= 0) return undefined;
    const bytes = latest.downloadedBytes - baseline.downloadedBytes;
    if (bytes <= 0) return undefined;
    return bytes / elapsedSeconds;
  }
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} ${units[unit]}`;
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond?: number) {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `约 ${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `约 ${minutes} 分 ${remainder} 秒` : `约 ${minutes} 分钟`;
}

export function formatPercent(percent?: number) {
  if (percent === undefined || !Number.isFinite(percent)) return "";
  if (percent >= 99.5 && percent < 100) return "99%";
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

export function formatProgressLine(snapshot: DownloadProgressSnapshot) {
  const speed = formatSpeed(snapshot.bytesPerSecond);
  if (snapshot.totalBytes && snapshot.percent !== undefined) {
    const pieces = [
      formatPercent(snapshot.percent),
      `${formatBytes(snapshot.downloadedBytes)} / ${formatBytes(snapshot.totalBytes)}`,
      speed,
      formatDuration(snapshot.etaSeconds),
    ].filter(Boolean);
    return pieces.join(" · ");
  }
  const pieces = [
    `已下载 ${formatBytes(snapshot.downloadedBytes)}`,
    speed,
  ].filter(Boolean);
  return pieces.join(" · ");
}

export function safeProgressValue(percent?: number) {
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
