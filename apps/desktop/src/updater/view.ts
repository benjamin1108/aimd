import { clearStatusOverride, setStatusOverride } from "../ui/chrome";
import { AIMD_RELEASE } from "./release";
import { platformLabel } from "./runtime";
import type { UpdaterMeta } from "./schedule";
import { formatPercent, safeProgressValue } from "./telemetry";
import type { UpdateUiState, VersionInfo } from "./types";

export const UPDATER_STATUS_ACTION = "updater";

export type UpdaterViewRefs = {
  panel: HTMLElement;
  title: HTMLElement;
  message: HTMLElement;
  aboutBody: HTMLElement;
  aboutVersion: HTMLElement;
  aboutPlatform: HTMLElement;
  aboutUpdateSummary: HTMLElement;
  aboutCopyStatus: HTMLElement;
  aboutCheck: HTMLButtonElement;
  aboutCopy: HTMLButtonElement;
  aboutRelease: HTMLButtonElement;
  aboutInstall: HTMLButtonElement | null;
  updateBody: HTMLElement;
  notes: HTMLElement;
  progressWrap: HTMLElement;
  progressBar: HTMLElement;
  progressFill: HTMLElement;
  progress: HTMLElement;
  progressDetail: HTMLElement;
  close: HTMLButtonElement;
  release: HTMLButtonElement;
  copyDiagnostics: HTMLButtonElement;
  focusDirty: HTMLButtonElement;
  background: HTMLButtonElement;
  remindLater: HTMLButtonElement;
  retry: HTMLButtonElement;
  install: HTMLButtonElement;
};

export type RenderUpdaterViewOptions = {
  refs: UpdaterViewRefs;
  view: UpdateUiState;
  meta: UpdaterMeta;
  versionInfo: VersionInfo | null;
  platformKey: string;
  installing: boolean;
};

export function bindUpdaterView(): UpdaterViewRefs {
  return {
    panel: document.querySelector("#update-panel")!,
    title: document.querySelector("#update-title")!,
    message: document.querySelector("#update-message")!,
    aboutBody: document.querySelector("#about-body")!,
    aboutVersion: document.querySelector("#about-version")!,
    aboutPlatform: document.querySelector("#about-platform")!,
    aboutUpdateSummary: document.querySelector("#about-update-summary")!,
    aboutCopyStatus: document.querySelector("#about-copy-status")!,
    aboutCheck: document.querySelector("#about-check-updates")!,
    aboutCopy: document.querySelector("#about-copy-version")!,
    aboutRelease: document.querySelector("#about-release")!,
    aboutInstall: document.querySelector("#about-install"),
    updateBody: document.querySelector("#update-body")!,
    notes: document.querySelector("#update-notes")!,
    progressWrap: document.querySelector("#update-progress-wrap")!,
    progressBar: document.querySelector("#update-progress-bar")!,
    progressFill: document.querySelector("#update-progress-fill")!,
    progress: document.querySelector("#update-progress")!,
    progressDetail: document.querySelector("#update-progress-detail")!,
    close: document.querySelector("#update-later")!,
    release: document.querySelector("#update-release")!,
    copyDiagnostics: document.querySelector("#update-copy-diagnostics")!,
    focusDirty: document.querySelector("#update-focus-dirty")!,
    background: document.querySelector("#update-background")!,
    remindLater: document.querySelector("#update-remind-later")!,
    retry: document.querySelector("#update-retry")!,
    install: document.querySelector("#update-install")!,
  };
}

export function updaterStatusSummary(view: UpdateUiState, meta: UpdaterMeta) {
  if (view.phase === "checking") return "正在检查更新";
  if (view.phase === "upToDate") return "已是最新版本";
  if (view.phase === "available") return `发现 ${view.latestVersion}`;
  if (view.phase === "downloading" || view.phase === "downloadingUnknownSize") {
    return [`正在下载 ${view.latestVersion}`, formatPercent(view.percent)].filter(Boolean).join(" · ");
  }
  if (view.phase === "installing") return `正在安装 ${view.latestVersion || ""}`.trim();
  if (view.phase === "blocked") return "更新被未保存文档阻止";
  if (view.phase === "installed") return view.detail?.includes("安装器") ? "已打开系统安装器" : "更新已准备好";
  if (view.phase === "error") return "更新失败";
  if (meta.lastSeenVersion && meta.lastSeenVersion !== view.currentVersion) return `发现 ${meta.lastSeenVersion}`;
  return meta.lastAutoCheckAt || meta.lastManualCheckAt ? "已检查更新" : "未检查";
}

export function canHideToBackground(view: UpdateUiState) {
  return view.phase === "checking"
    || view.phase === "downloading"
    || view.phase === "downloadingUnknownSize"
    || view.phase === "installing";
}

function phaseTitle(view: UpdateUiState) {
  if (view.surface === "about") return "AIMD";
  if (view.phase === "checking") return "AIMD 更新";
  if (view.phase === "upToDate") return "AIMD 已是最新版本";
  if (view.phase === "available") return `AIMD ${view.latestVersion} 可用`;
  if (view.phase === "downloading" || view.phase === "downloadingUnknownSize") return `正在下载 AIMD ${view.latestVersion}`;
  if (view.phase === "installing") return "正在准备安装";
  if (view.phase === "blocked") return "需要先保存文档";
  if (view.phase === "installed") return view.detail?.includes("安装器") ? "已打开系统安装器" : "更新已安装";
  if (view.phase === "error") return view.errorTitle || "更新失败";
  return "AIMD 更新";
}

function phaseMessage(view: UpdateUiState) {
  if (view.surface === "about") return "";
  if (view.phase === "checking") return "正在检查更新";
  if (view.phase === "upToDate") return `当前版本 ${view.currentVersion}`;
  if (view.phase === "available") return `当前 ${view.currentVersion} → 最新 ${view.latestVersion}`;
  if (view.phase === "blocked") return view.detail || `有 ${view.dirtyDocumentCount || 1} 个未保存文档，保存后再安装`;
  if (view.phase === "installed") return view.detail || "完成后重新打开 AIMD";
  if (view.phase === "error") return view.errorMessage || view.detail || "请稍后重试";
  if (view.phase === "installing") return view.progressText || "正在验证签名";
  return "";
}

function hasProgress(view: UpdateUiState) {
  return canHideToBackground(view);
}

function backgroundStatus(view: UpdateUiState, meta: UpdaterMeta) {
  if (view.phase === "available" && view.latestVersion) return { text: `有新版本 ${view.latestVersion}`, tone: "info" as const };
  if ((view.phase === "downloading" || view.phase === "downloadingUnknownSize") && view.latestVersion) {
    return { text: [`正在下载 ${view.latestVersion}`, formatPercent(view.percent)].filter(Boolean).join(" · "), tone: "loading" as const };
  }
  if (view.phase === "installing" && view.latestVersion) return { text: `正在安装 ${view.latestVersion}`, tone: "loading" as const };
  if (view.phase === "installed") return { text: updaterStatusSummary(view, meta), tone: "success" as const };
  if (view.phase === "error") return { text: "更新失败", tone: "warn" as const };
  return null;
}

function applyProgressBar(refs: UpdaterViewRefs, view: UpdateUiState, meta: UpdaterMeta) {
  const value = safeProgressValue(view.percent);
  const determinate = value !== undefined && view.phase === "downloading";
  refs.progressBar.classList.toggle("is-indeterminate", !determinate);
  if (determinate) {
    refs.progressBar.setAttribute("aria-valuenow", String(value));
    refs.progressFill.style.setProperty("--update-progress-scale", String(value / 100));
  } else {
    refs.progressBar.removeAttribute("aria-valuenow");
    refs.progressFill.style.removeProperty("--update-progress-scale");
  }
  refs.progressBar.setAttribute("aria-valuetext", view.progressText || updaterStatusSummary(view, meta));
}

function renderAbout(options: RenderUpdaterViewOptions) {
  const { refs, view, versionInfo, platformKey, meta } = options;
  refs.aboutVersion.textContent = `版本 ${versionInfo?.version || view.currentVersion} · ${versionInfo?.channel || AIMD_RELEASE.channel}`;
  refs.aboutPlatform.textContent = versionInfo?.platformLabel || platformLabel(platformKey);
  refs.aboutUpdateSummary.textContent = `更新状态：${updaterStatusSummary(view, meta)}`;
  refs.aboutInstall?.toggleAttribute("hidden", view.phase !== "available");
}

function renderUpdateActions(refs: UpdaterViewRefs, view: UpdateUiState, installing: boolean) {
  for (const button of [refs.release, refs.copyDiagnostics, refs.focusDirty, refs.background, refs.remindLater, refs.retry, refs.install]) {
    button.hidden = true;
    button.disabled = false;
  }
  if (view.phase === "available") {
    refs.release.hidden = false;
    refs.release.textContent = "发布说明";
    refs.remindLater.hidden = false;
    refs.install.hidden = false;
    refs.install.disabled = installing;
  } else if (view.phase === "upToDate") {
    refs.release.hidden = false;
    refs.release.textContent = "发布页面";
  } else if (canHideToBackground(view)) {
    refs.background.hidden = false;
  } else if (view.phase === "blocked") {
    refs.focusDirty.hidden = false;
    refs.retry.hidden = false;
    refs.retry.textContent = "保存后重试";
  } else if (view.phase === "error") {
    refs.copyDiagnostics.hidden = false;
    refs.retry.hidden = false;
    refs.retry.textContent = "重新检查";
  }
}

export function renderUpdaterView(options: RenderUpdaterViewOptions) {
  const { refs, view, meta, installing } = options;
  refs.panel.hidden = view.surface === "closed";
  refs.panel.dataset.surface = view.surface;
  refs.panel.dataset.phase = view.phase;
  refs.title.textContent = phaseTitle(view);
  const message = phaseMessage(view);
  refs.message.hidden = !message;
  refs.message.textContent = message;

  const isAbout = view.surface === "about";
  refs.aboutBody.hidden = !isAbout;
  refs.updateBody.hidden = isAbout;
  if (isAbout) {
    renderAbout(options);
  } else {
    refs.notes.hidden = !(view.phase === "available" && view.releaseNotesSummary);
    refs.notes.textContent = view.releaseNotesSummary || "";
    refs.progressWrap.hidden = !hasProgress(view);
    if (hasProgress(view)) {
      refs.progress.textContent = view.progressText || (view.phase === "checking" ? "连接发布清单" : updaterStatusSummary(view, meta));
      refs.progressDetail.textContent = view.progressDetail || "";
      applyProgressBar(refs, view, meta);
    }
    renderUpdateActions(refs, view, installing);
  }

  refs.close.title = canHideToBackground(view) ? "后台继续" : "关闭";
  refs.close.setAttribute("aria-label", refs.close.title);
  const status = view.surface === "closed" ? backgroundStatus(view, meta) : null;
  if (status) {
    setStatusOverride(status.text, status.tone, UPDATER_STATUS_ACTION);
  } else {
    clearStatusOverride(UPDATER_STATUS_ACTION);
  }
}
