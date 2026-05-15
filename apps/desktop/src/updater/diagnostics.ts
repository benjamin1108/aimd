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

export function userFacingUpdaterError(message: string) {
  const trimmed = message.trim();
  if (/error sending request|dns|lookup|timed out|connection|network|tls|certificate/i.test(trimmed)) {
    return "无法连接更新服务，请检查网络或代理";
  }
  if (/下载更新清单失败:\s*HTTP/i.test(trimmed)) {
    return "更新服务暂时不可用";
  }
  const withoutUrls = trimmed.replace(/https?:\/\/\S+/g, "更新地址");
  return withoutUrls.length > 80 ? `${withoutUrls.slice(0, 78)}…` : withoutUrls;
}
