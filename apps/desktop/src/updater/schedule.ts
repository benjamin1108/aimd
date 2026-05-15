export type UpdaterMeta = {
  lastAutoCheckAt?: number;
  lastManualCheckAt?: number;
  lastSeenVersion?: string;
  lastDismissedVersion?: string;
  lastNotifiedVersion?: string;
};

export const STARTUP_AUTO_CHECK_DELAY_MS = 10_000;

export function dismissedVersionMatches(meta: UpdaterMeta, version?: string) {
  return Boolean(version && meta.lastDismissedVersion === version);
}
