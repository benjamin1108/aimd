export type VersionDiagnosticsInput = {
  version: string;
  channel: string;
  platformKey: string;
  updaterStatus: string;
  updaterManifestUrl: string;
  releaseUrl: string;
};

export type ErrorDiagnosticsInput = {
  requestId?: string;
  currentVersion: string;
  latestVersion?: string;
  platformKey: string;
  endpoint: string;
  elapsedMs?: number;
  errorMessage?: string;
};

export function versionDiagnostics(input: VersionDiagnosticsInput) {
  return [
    `AIMD ${input.version}`,
    `Channel: ${input.channel}`,
    `Platform: ${input.platformKey}`,
    `Updater status: ${input.updaterStatus}`,
    `Updater manifest: ${input.updaterManifestUrl}`,
    `Release: ${input.releaseUrl}`,
  ].join("\n");
}

export function errorDiagnostics(input: ErrorDiagnosticsInput) {
  return [
    `Request: ${input.requestId || "-"}`,
    `Current: ${input.currentVersion}`,
    `Latest: ${input.latestVersion || "-"}`,
    `Platform: ${input.platformKey}`,
    `Endpoint: ${input.endpoint}`,
    `Elapsed: ${input.elapsedMs ? Math.round(input.elapsedMs) : "-"} ms`,
    `Error: ${input.errorMessage || "-"}`,
  ].join("\n");
}
