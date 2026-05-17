import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";
import {
  statusPillEl,
  webClipCancelEl,
  webClipCloseEl,
  webClipErrorEl,
  webClipFallbackEl,
  webClipMessageEl,
  webClipPanelEl,
  webClipSubmitEl,
  webClipUrlEl,
} from "../core/dom";
import { loadAppSettings } from "../core/settings";
import type { AimdDocument, WebClipSettings } from "../core/types";
import { beginAiActivity } from "../ui/ai-activity";
import { setStatus } from "../ui/chrome";
import { deleteDraftFile } from "./drafts";
import {
  cleanBasicMarkdown,
  countMarkdownImages,
  markUnfinishedSmartSections,
  normalizeMarkdownTitle,
} from "./web-clip-markdown";

interface ImagePayload {
  url: string;
  proxyUrl?: string;
  originalUrl?: string;
  data: number[];
}

interface ExtractDiagnostic {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

interface ExtractPayload {
  requestId?: string;
  success: boolean;
  error?: string;
  title?: string;
  content?: string;
  images?: ImagePayload[];
  diagnostics?: ExtractDiagnostic[];
}

interface WebClipImageLocalization {
  markdown: string;
  images: ImagePayload[];
  localizedCount: number;
}

type WebClipTask = {
  requestId: string;
  url: string;
  startedAt: number;
  pendingDraftPath: string;
  applied: boolean;
  endAiActivity: () => void;
};

const DEFAULT_REFINE_TIMEOUT_MS = 300_000;
const WEB_CLIP_STATUS_ACTION = "web-clip-worker";
let activeTask: WebClipTask | null = null;
let panelBound = false;
let statusRevealBound = false;
let listenersReady: Promise<void> | null = null;
let lastFailedUrl = "";

function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    || `webclip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function refineTimeoutMs(config?: WebClipSettings): number {
  const override = Number((globalThis as { __aimdWebClipRefineTimeoutMs?: unknown }).__aimdWebClipRefineTimeoutMs);
  if (Number.isFinite(override) && override > 0) return override;
  const seconds = Number(config?.modelTimeoutSeconds);
  const perAttemptMs = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_REFINE_TIMEOUT_MS;
  const retryCount = Number(config?.modelRetryCount);
  const attempts = 1 + (Number.isFinite(retryCount) && retryCount > 0 ? Math.floor(retryCount) : 0);
  return (perAttemptMs * attempts) + (Math.max(0, attempts - 1) * 500) + 5000;
}

async function invokeWithTimeout<T>(
  command: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([invoke<T>(command, args), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeURL(value: string, addScheme = true): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw)
    ? raw
    : addScheme
      ? `https://${raw}`
      : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function setPanelError(message: string) {
  webClipErrorEl().hidden = !message;
  webClipErrorEl().textContent = message;
}

function setPanelRunning(message: string, url: string) {
  webClipPanelEl().hidden = false;
  webClipMessageEl().textContent = message;
  webClipUrlEl().value = url;
  webClipUrlEl().disabled = true;
  webClipSubmitEl().disabled = true;
  webClipFallbackEl().hidden = true;
  setPanelError("");
}

function showPanel(options: { message?: string; error?: string; fallbackUrl?: string } = {}) {
  webClipPanelEl().hidden = false;
  webClipMessageEl().textContent = options.message || "从网页创建未保存草稿";
  webClipUrlEl().disabled = false;
  webClipSubmitEl().disabled = false;
  webClipFallbackEl().hidden = !options.fallbackUrl;
  if (options.fallbackUrl) lastFailedUrl = options.fallbackUrl;
  setPanelError(options.error || "");
  window.setTimeout(() => {
    webClipUrlEl().focus();
    webClipUrlEl().select();
  }, 0);
}

function hidePanel() {
  webClipPanelEl().hidden = true;
  setPanelError("");
}

function setStatusRevealEnabled(enabled: boolean) {
  const pill = statusPillEl();
  if (enabled) {
    pill.dataset.action = WEB_CLIP_STATUS_ACTION;
    pill.setAttribute("role", "button");
    pill.setAttribute("tabindex", "0");
    pill.title = "查看正在工作的网页导入窗口";
    return;
  }
  delete pill.dataset.action;
  pill.removeAttribute("role");
  pill.removeAttribute("tabindex");
  pill.removeAttribute("title");
}

function setWebClipStatus(text: string, tone: "idle" | "loading" | "success" | "warn" | "info" = "loading") {
  setStatus(text, tone, activeTask ? WEB_CLIP_STATUS_ACTION : undefined);
}

function finishActiveTask(task: WebClipTask) {
  task.endAiActivity();
  if (activeTask === task) activeTask = null;
  setStatusRevealEnabled(false);
}

async function revealActiveExtractorWindow() {
  const task = activeTask;
  if (!task || !isTauri()) return;
  try {
    await invoke("show_extractor_window", { requestId: task.requestId });
  } catch (err) {
    console.warn("[web-clip] failed to show extractor window:", err);
    setWebClipStatus("显示网页导入窗口失败", "warn");
  }
}

function bindPanel() {
  if (panelBound) return;
  panelBound = true;

  webClipCloseEl().addEventListener("click", hidePanel);
  webClipCancelEl().addEventListener("click", hidePanel);
  webClipSubmitEl().addEventListener("click", () => {
    const url = normalizeURL(webClipUrlEl().value);
    if (!url) {
      setPanelError("请输入 http 或 https 网页地址");
      return;
    }
    void startImport(url, false);
  });
  webClipFallbackEl().addEventListener("click", () => {
    const url = normalizeURL(lastFailedUrl || webClipUrlEl().value);
    if (!url) {
      setPanelError("请输入 http 或 https 网页地址");
      return;
    }
    void startImport(url, true);
  });
  webClipUrlEl().addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      webClipSubmitEl().click();
    }
    if (event.key === "Escape") hidePanel();
  });
  webClipUrlEl().addEventListener("input", () => setPanelError(""));
}

function bindStatusReveal() {
  if (statusRevealBound) return;
  statusRevealBound = true;

  statusPillEl().addEventListener("click", () => {
    void revealActiveExtractorWindow();
  });
  statusPillEl().addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!activeTask) return;
    event.preventDefault();
    void revealActiveExtractorWindow();
  });
}

async function ensureEventListeners() {
  if (listenersReady) return listenersReady;
  listenersReady = (async () => {
    await listen<ExtractPayload>("web_clip_raw_extracted", (event) => {
      void handleExtracted(event.payload);
    });
    await listen<{ requestId?: string; status?: string }>("web_clip_progress", (event) => {
      const task = activeTask;
      if (!task || event.payload?.requestId !== task.requestId || !event.payload.status) return;
      setWebClipStatus(event.payload.status, "loading");
    });
    await listen<{ requestId?: string }>("web_clip_closed", (event) => {
      const task = activeTask;
      if (!task || event.payload?.requestId !== task.requestId) return;
      if (!task.applied && task.pendingDraftPath) void deleteDraftFile(task.pendingDraftPath);
      void invoke("clear_web_clip_image_proxy", { requestId: task.requestId }).catch(() => {});
      finishActiveTask(task);
      setStatus("网页导入已取消", "info");
    });
  })();
  return listenersReady;
}

async function closeExtractorForTask(task: WebClipTask) {
  try {
    await invoke("close_extractor_window", { requestId: task.requestId });
  } catch {
    // Closing the hidden worker is best-effort after completion/failure.
  }
  try {
    await invoke("clear_web_clip_image_proxy", { requestId: task.requestId });
  } catch {
    // Cache cleanup also runs when the extractor window is destroyed.
  }
}

async function startImport(url: string, fallbackWindow: boolean) {
  if (!isTauri()) {
    setStatus("仅支持在桌面客户端内使用网页导入", "idle");
    return;
  }
  if (activeTask) {
    setPanelRunning("网页导入正在后台运行", activeTask.url);
    return;
  }

  await ensureEventListeners();
  const task: WebClipTask = {
    requestId: makeRequestId(),
    url,
    startedAt: performance.now(),
    pendingDraftPath: "",
    applied: false,
    endAiActivity: beginAiActivity("web-clip"),
  };
  activeTask = task;
  setStatusRevealEnabled(true);
  hidePanel();
  setWebClipStatus("正在打开网页...", "loading");

  try {
    await invoke("start_url_extraction", {
      requestId: task.requestId,
      url,
      visible: fallbackWindow,
      auto: !fallbackWindow,
    });
    if (fallbackWindow) setWebClipStatus("已打开提取窗口", "info");
  } catch (err) {
    finishActiveTask(task);
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start web import:", err);
    setStatus("启动网页导入失败", "warn");
    showPanel({ error: message || "启动网页导入失败", fallbackUrl: url });
  }
}

async function handleExtracted(payload: ExtractPayload) {
  const task = activeTask;
  if (!task || payload.requestId !== task.requestId) return;

  for (const item of payload.diagnostics || []) {
    const args = item.data === undefined
      ? [`[web-clip:extractor] ${item.message}`]
      : [`[web-clip:extractor] ${item.message}`, item.data];
    if (item.level === "debug") console.debug(...args);
    else if (item.level === "warn") console.warn(...args);
    else if (item.level === "error") console.error(...args);
    else console.info(...args);
  }

  if (!payload.success || !payload.content) {
    const error = payload.error || "未提取到正文";
    console.error("[web-clip] extraction failed:", error);
    await closeExtractorForTask(task);
    finishActiveTask(task);
    lastFailedUrl = task.url;
    setStatus(`提取失败: ${error}`, "warn");
    showPanel({
      message: "网页导入失败",
      error: `${error}。可重试，或在提取窗口中打开。`,
      fallbackUrl: task.url,
    });
    return;
  }

  setWebClipStatus("正在提取正文...", "loading");
  console.info("[web-clip] extractor finished", {
    requestId: task.requestId,
    elapsedMs: Math.round(performance.now() - task.startedAt),
    contentChars: payload.content.length,
    imageCount: payload.images?.length ?? 0,
  });

  try {
    const turndownService = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    turndownService.use(gfm);

    const title = payload.title || "网页草稿";
    let markdown = cleanBasicMarkdown(turndownService.turndown(payload.content), title);
    let images = payload.images || [];

    console.debug("[web-clip] turndown finished", {
      markdownChars: markdown.length,
      imageRefs: countMarkdownImages(markdown),
    });

    if (images.length > 0) {
      setWebClipStatus("正在处理图片...", "loading");
      const localized = await invoke<WebClipImageLocalization>("localize_web_clip_images", {
        requestId: task.requestId,
        markdown,
        images,
      });
      markdown = localized.markdown;
      images = localized.images;
      console.info("[web-clip] image localization finished", {
        localizedCount: localized.localizedCount,
        imageCount: images.length,
        imageRefs: countMarkdownImages(markdown),
      });
    }

    const settings = await loadAppSettings();
    const webClipConfig = settings.webClip;
    if (webClipConfig?.llmEnabled) {
      setWebClipStatus("正在智能排版...", "loading");
      const rawMarkdown = markdown;
      try {
        const refined = await invokeWithTimeout<string>(
          "refine_markdown",
          {
            markdown: rawMarkdown,
            provider: webClipConfig.provider,
            model: webClipConfig.model,
            guardReason: null,
            outputLanguage: webClipConfig.outputLanguage,
            modelTimeoutSeconds: webClipConfig.modelTimeoutSeconds,
            modelRetryCount: webClipConfig.modelRetryCount,
          },
          refineTimeoutMs(webClipConfig),
          "智能排版超时",
        );
        const normalized = normalizeMarkdownTitle(refined, title);
        if (normalized.trim()) {
          markdown = normalized;
        } else {
          markdown = markUnfinishedSmartSections(cleanBasicMarkdown(rawMarkdown, title));
          setWebClipStatus("未完成智能分章，使用基础提取", "warn");
        }
      } catch (llmError) {
        console.error("[web-clip] LLM refinement failed:", llmError);
        markdown = markUnfinishedSmartSections(cleanBasicMarkdown(rawMarkdown, title));
        setWebClipStatus("未完成智能分章，使用基础提取", "warn");
      }
    }

    setWebClipStatus("正在生成网页草稿...", "loading");
    const doc = await invoke<AimdDocument>("save_web_clip", {
      title,
      markdown,
      images,
    });
    task.pendingDraftPath = doc.draftSourcePath || doc.path || "";
    if (!task.pendingDraftPath) {
      throw new Error("网页草稿创建成功，但缺少草稿路径");
    }
    await invoke("open_draft_in_new_window", { path: task.pendingDraftPath });
    task.applied = true;

    await closeExtractorForTask(task);
    finishActiveTask(task);
    setStatus("网页草稿已在新窗口打开", "idle");
    console.info("[web-clip] opened web clip draft in a new window", {
      requestId: task.requestId,
      elapsedMs: Math.round(performance.now() - task.startedAt),
      title: doc.title,
      hasDraftSource: Boolean(doc.draftSourcePath),
    });
  } catch (err) {
    console.error("[web-clip] import failed:", err);
    await closeExtractorForTask(task);
    if (!task.applied && task.pendingDraftPath) void deleteDraftFile(task.pendingDraftPath);
    finishActiveTask(task);
    const message = err instanceof Error ? err.message : String(err);
    setStatus("网页导入失败", "warn");
    showPanel({
      message: "网页导入失败",
      error: message || "处理网页内容失败",
      fallbackUrl: task.url,
    });
  }
}

export async function importWebClip() {
  bindPanel();
  bindStatusReveal();
  await ensureEventListeners();

  if (!isTauri()) {
    setStatus("仅支持在桌面客户端内使用网页导入", "idle");
    return;
  }

  if (activeTask) {
    setPanelRunning("网页导入正在后台运行", activeTask.url);
    return;
  }

  showPanel();
}
