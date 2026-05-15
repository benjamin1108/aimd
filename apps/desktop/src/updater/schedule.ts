export type UpdaterMeta = {
  lastAutoCheckAt?: number;
  lastManualCheckAt?: number;
  lastSeenVersion?: string;
  lastDismissedVersion?: string;
  lastNotifiedVersion?: string;
};

export const DEFAULT_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_CHECK_JITTER_MS = 2 * 60 * 60 * 1000;

export function shouldRunAutomaticUpdateCheck(
  meta: UpdaterMeta,
  nowMs: number,
  intervalMs = DEFAULT_AUTO_CHECK_INTERVAL_MS,
) {
  return nowMs - (meta.lastAutoCheckAt || 0) >= intervalMs;
}

export function nextAutomaticCheckDelayMs(
  intervalMs = DEFAULT_AUTO_CHECK_INTERVAL_MS,
  jitterMs = DEFAULT_AUTO_CHECK_JITTER_MS,
  random = Math.random,
) {
  return intervalMs + Math.round(random() * Math.max(0, jitterMs));
}

export function dismissedVersionMatches(meta: UpdaterMeta, version?: string) {
  return Boolean(version && meta.lastDismissedVersion === version);
}
