import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AIMD_RELEASE } from "./release";
import type { VersionInfo } from "./types";

let cachedPlatformKey = "unknown";
let lastVersionInfo: VersionInfo | null = null;

export function currentVersionFallback() {
  return AIMD_RELEASE.version;
}

export async function currentVersion() {
  if (!isTauri() && !window.__aimd_updater_mock) return currentVersionFallback();
  try {
    return await getVersion();
  } catch {
    return currentVersionFallback();
  }
}

export async function updaterPlatformKey() {
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

export function getCachedPlatformKey() {
  return cachedPlatformKey;
}

export function getLastVersionInfo() {
  return lastVersionInfo;
}

export function browserPlatformKey() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "darwin-aarch64";
  if (platform.includes("win")) return "windows-x86_64";
  return "browser";
}

export function platformLabel(platformKey: string) {
  if (platformKey === "darwin-aarch64") return "macOS arm64";
  if (platformKey === "windows-x86_64") return "Windows x64";
  if (platformKey === "unsupported") return "Unsupported platform";
  if (platformKey === "browser") return "Browser preview";
  return platformKey;
}

export async function getVersionInfo(): Promise<VersionInfo> {
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
