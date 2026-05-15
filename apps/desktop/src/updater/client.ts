import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { state } from "../core/state";
import { debugLog } from "../debug/console";
import { setStatus } from "../ui/chrome";
import { escapeHTML } from "../util/escape";
import { AIMD_RELEASE } from "./release";
import { syncDirtyDocumentState } from "./dirty-state";

type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "blocked"
  | "installed"
  | "error";

type DirtyDocumentWindow = {
  label: string;
  title: string;
  path: string;
};

type UpdateView = {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  detail?: string;
  errorTitle?: string;
  progress?: string;
  manual: boolean;
};

type MockUpdate = {
  version: string;
  date?: string;
  body?: string;
  contentLength?: number;
  failInstall?: string;
};

type UpdaterMock = {
  check: (manual: boolean) => Promise<MockUpdate | null> | MockUpdate | null;
  install?: (update: MockUpdate) => Promise<void> | void;
};

declare global {
  interface Window {
    __aimd_updater_mock?: UpdaterMock;
    __aimd_checkForUpdates?: (opts?: { manual?: boolean }) => Promise<void>;
  }
}

let panelEl: HTMLElement;
let titleEl: HTMLElement;
let messageEl: HTMLElement;
let notesEl: HTMLElement;
let progressEl: HTMLElement;
let installBtn: HTMLButtonElement;
let laterBtn: HTMLButtonElement;
let retryBtn: HTMLButtonElement;

let pendingUpdate: Update | MockUpdate | null = null;
let checking = false;
const dismissedVersions = new Set<string>();

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

function logUpdater(level: "debug" | "info" | "warn" | "error", event: string, data: Record<string, unknown>) {
  const payload = {
    event,
    endpoint: AIMD_RELEASE.updaterManifestUrl,
    channel: AIMD_RELEASE.channel,
    ...data,
  };
  debugLog(level, `[updater] ${JSON.stringify(payload)}`);
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
  console[method]("[updater]", payload);
}

function render(view: UpdateView) {
  panelEl.dataset.phase = view.phase;
  panelEl.hidden = view.phase === "idle";
  titleEl.textContent = view.phase === "available"
    ? `AIMD ${view.latestVersion} 可更新`
    : view.phase === "upToDate"
      ? "AIMD 已是最新版本"
      : view.phase === "blocked"
        ? "安装更新前需要保存文档"
        : view.phase === "error"
          ? view.errorTitle || "更新失败"
          : view.phase === "installed"
            ? "更新已安装"
            : "AIMD 更新";

  const versions = view.latestVersion
    ? `${view.currentVersion} -> ${view.latestVersion}`
    : `当前版本 ${view.currentVersion}`;
  messageEl.textContent = view.detail || versions;
  notesEl.hidden = !view.notes;
  notesEl.innerHTML = view.notes ? escapeHTML(view.notes).replace(/\n/g, "<br>") : "";
  progressEl.hidden = !view.progress;
  progressEl.textContent = view.progress || "";
  installBtn.hidden = view.phase !== "available";
  installBtn.disabled = view.phase !== "available";
  retryBtn.hidden = !(view.phase === "blocked" || view.phase === "error" || view.phase === "upToDate");
  retryBtn.textContent = view.phase === "blocked" ? "保存后重试" : "重新检查";
  laterBtn.textContent = view.phase === "installed" ? "关闭" : "稍后";
}

async function checkWithMock(manual: boolean): Promise<MockUpdate | null> {
  const mock = window.__aimd_updater_mock;
  if (!mock) return null;
  return await mock.check(manual);
}

async function checkForUpdateObject(manual: boolean): Promise<Update | MockUpdate | null> {
  if (window.__aimd_updater_mock) return await checkWithMock(manual);
  if (!isTauri()) return null;
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
  const names = dirty.map((doc) => doc.title || doc.path || doc.label).slice(0, 3);
  const suffix = dirty.length > names.length ? ` 等 ${dirty.length} 个窗口` : "";
  return `请先保存未保存的文档：${names.join("、")}${suffix}`;
}

async function installPendingUpdate() {
  const update = pendingUpdate;
  if (!update) return;
  const id = requestId();
  const current = await currentVersion();
  const latest = update.version;
  const dirty = await dirtyDocuments();
  if (dirty.length > 0) {
    render({
      phase: "blocked",
      currentVersion: current,
      latestVersion: latest,
      detail: formatDirtyDocuments(dirty),
      manual: true,
    });
    setStatus("安装更新前需要保存文档", "warn");
    logUpdater("warn", "install_blocked_dirty_documents", { requestId: id, currentVersion: current, latestVersion: latest, dirtyWindows: dirty.length });
    try {
      await invoke("updater_focus_dirty_window");
    } catch {}
    return;
  }

  try {
    let downloaded = 0;
    let contentLength = 0;
    render({ phase: "downloading", currentVersion: current, latestVersion: latest, progress: "准备下载", manual: true });
    setStatus("正在下载更新", "loading");
    logUpdater("info", "download_started", { requestId: id, currentVersion: current, latestVersion: latest });
    if (window.__aimd_updater_mock) {
      const mockUpdate = update as MockUpdate;
      if (mockUpdate.failInstall) throw new Error(mockUpdate.failInstall);
      await window.__aimd_updater_mock.install?.(mockUpdate);
    } else {
      const tauriUpdate = update as Update;
      await tauriUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
          render({
            phase: "downloading",
            currentVersion: current,
            latestVersion: latest,
            progress: contentLength ? `0 / ${Math.round(contentLength / 1024 / 1024)} MB` : "开始下载",
            manual: true,
          });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength
            ? `${Math.min(100, Math.round(downloaded / contentLength * 100))}%`
            : `${Math.round(downloaded / 1024)} KB`;
          render({ phase: "downloading", currentVersion: current, latestVersion: latest, progress, manual: true });
        } else if (event.event === "Finished") {
          render({ phase: "installing", currentVersion: current, latestVersion: latest, progress: "正在安装", manual: true });
        }
      });
    }
    render({ phase: "installed", currentVersion: current, latestVersion: latest, detail: "正在重启 AIMD", manual: true });
    logUpdater("info", "install_finished", { requestId: id, currentVersion: current, latestVersion: latest, downloadSize: contentLength || null });
    setStatus("更新已安装，正在重启", "success");
    if (window.__aimd_updater_mock) return;
    await relaunch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    render({ phase: "error", currentVersion: current, latestVersion: latest, detail: message, errorTitle: "更新安装失败", manual: true });
    setStatus("更新安装失败", "warn");
    logUpdater("error", "install_failed", { requestId: id, currentVersion: current, latestVersion: latest, failure: message });
  }
}

export async function checkForUpdates(opts: { manual?: boolean } = {}) {
  const manual = Boolean(opts.manual);
  if (checking) return;
  if (!manual && !isTauri() && !window.__aimd_updater_mock) return;
  checking = true;
  const id = requestId();
  const started = performance.now();
  const current = await currentVersion();
  try {
    if (manual) {
      render({ phase: "checking", currentVersion: current, detail: "正在检查更新", manual });
      setStatus("正在检查更新", "loading");
    }
    const update = await checkForUpdateObject(manual);
    const elapsedMs = Math.round(performance.now() - started);
    if (!update) {
      logUpdater("info", "check_no_update", { requestId: id, currentVersion: current, elapsedMs });
      if (manual) {
        render({ phase: "upToDate", currentVersion: current, detail: "当前已是最新版本", manual });
        setStatus("已是最新版本", "success");
      }
      return;
    }
    pendingUpdate = update;
    logUpdater("info", "check_update_available", {
      requestId: id,
      currentVersion: current,
      latestVersion: update.version,
      elapsedMs,
    });
    if (!manual && dismissedVersions.has(update.version)) return;
    render({
      phase: "available",
      currentVersion: current,
      latestVersion: update.version,
      notes: "body" in update ? update.body : "",
      detail: `当前版本 ${current}，最新版本 ${update.version}`,
      manual,
    });
    setStatus(`发现新版本 ${update.version}`, "info");
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    logUpdater("warn", "check_failed", { requestId: id, currentVersion: current, elapsedMs, failure: message });
    if (manual) {
      render({ phase: "error", currentVersion: current, detail: message, errorTitle: "更新检查失败", manual });
      setStatus("更新检查失败", "warn");
    }
  } finally {
    checking = false;
  }
}

export function bindUpdater() {
  panelEl = document.querySelector("#update-panel")!;
  titleEl = document.querySelector("#update-title")!;
  messageEl = document.querySelector("#update-message")!;
  notesEl = document.querySelector("#update-notes")!;
  progressEl = document.querySelector("#update-progress")!;
  installBtn = document.querySelector("#update-install")!;
  laterBtn = document.querySelector("#update-later")!;
  retryBtn = document.querySelector("#update-retry")!;
  installBtn.addEventListener("click", () => { void installPendingUpdate(); });
  retryBtn.addEventListener("click", () => { void checkForUpdates({ manual: true }); });
  laterBtn.addEventListener("click", () => {
    if (pendingUpdate?.version) dismissedVersions.add(pendingUpdate.version);
    render({ phase: "idle", currentVersion: currentVersionFallback(), manual: false });
  });
  window.__aimd_checkForUpdates = checkForUpdates;
}

export function scheduleStartupUpdateCheck() {
  window.setTimeout(() => {
    void checkForUpdates({ manual: false });
  }, 2200);
}
