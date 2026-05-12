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
import type { AimdDocument } from "../core/types";
import { setStatus } from "../ui/chrome";
import { deleteDraftFile } from "./drafts";

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
};

const DEFAULT_REFINE_TIMEOUT_MS = 45_000;
let activeTask: WebClipTask | null = null;
let panelBound = false;
let statusRevealBound = false;
let listenersReady: Promise<void> | null = null;
let lastFailedUrl = "";

function countMarkdownImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+#*$/, "");
}

function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    || `webclip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function refineTimeoutMs(): number {
  const override = Number((globalThis as { __aimdWebClipRefineTimeoutMs?: unknown }).__aimdWebClipRefineTimeoutMs);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_REFINE_TIMEOUT_MS;
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
    pill.dataset.action = "web-clip-worker";
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

async function revealActiveExtractorWindow() {
  const task = activeTask;
  if (!task || !isTauri()) return;
  try {
    await invoke("show_extractor_window", { requestId: task.requestId });
  } catch (err) {
    console.warn("[web-clip] failed to show extractor window:", err);
    setStatus("显示网页导入窗口失败", "warn");
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

function stripCodeFences(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

function markdownHeadings(markdown: string): Array<{ level: number; text: string; line: number }> {
  const lines = stripCodeFences(markdown);
  const headings: Array<{ level: number; text: string; line: number }> = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    headings.push({ level: match[1].length, text: normalizeHeadingText(match[2]), line: index });
  });
  return headings;
}

function normalizeMarkdownTitle(markdown: string, title: string): string {
  const cleanTitle = normalizeHeadingText(title) || "网页草稿";
  const lines = markdown.replace(/\r\n/g, "\n").trim().split("\n");
  let inFence = false;
  let seenH1 = false;
  let hasHeading = false;
  const nextLines = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return line;
    hasHeading = true;
    const text = normalizeHeadingText(match[2]);
    if (match[1].length !== 1) return line;
    if (!seenH1) {
      seenH1 = true;
      return `# ${text || cleanTitle}`;
    }
    return `## ${text || cleanTitle}`;
  });

  const normalized = nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (hasHeading && seenH1) return normalized;
  return `# ${cleanTitle}\n\n${normalized}`.trim();
}

function ensureBasicSections(markdown: string): string {
  const headings = markdownHeadings(markdown);
  if (headings.some((heading) => heading.level === 2)) return markdown;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstH1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (firstH1Index < 0) return markdown;
  const body = lines.slice(firstH1Index + 1).join("\n").trim();
  if (!body) return markdown;
  lines.splice(firstH1Index + 1, 0, "", "## 正文");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanBasicMarkdown(markdown: string, title: string): string {
  return ensureBasicSections(normalizeMarkdownTitle(markdown, title))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasAssistiveBlock(markdown: string, label: "摘要" | "核心观点"): boolean {
  const pattern = new RegExp(`^>\\s*\\*\\*${label}\\*\\*`, "m");
  return pattern.test(markdown);
}

function countBodyChars(markdown: string): number {
  return stripCodeFences(markdown)
    .filter((line) => !/^\s*>/.test(line) && !/^#{1,6}\s+/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\s+/g, "")
    .length;
}

function markdownBodyText(markdown: string, options: { skipBlockquotes?: boolean } = {}): string {
  return stripCodeFences(markdown)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !options.skipBlockquotes || !/^\s*>/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]*]\([^)]+\)/g, "")
    .replace(/[>*_`#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyTextBeforeFirstH2(markdown: string, options: { skipBlockquotes?: boolean } = {}): string {
  const lines = stripCodeFences(markdown);
  const headings = markdownHeadings(markdown);
  const firstH1 = headings.find((heading) => heading.level === 1);
  const firstH2 = headings.find((heading) => heading.level === 2);
  const start = firstH1 ? firstH1.line + 1 : 0;
  const end = firstH2 ? firstH2.line : lines.length;
  return markdownBodyText(lines.slice(start, end).join("\n"), options);
}

function compactHeadingKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function headingsEquivalent(left: string, right: string): boolean {
  const a = compactHeadingKey(left);
  const b = compactHeadingKey(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
}

function analyzeHeadingStructure(markdown: string, raw: string): string[] {
  const headings = markdownHeadings(markdown);
  const rawHeadings = markdownHeadings(raw);
  const reasons: string[] = [];
  const h1Count = headings.filter((heading) => heading.level === 1).length;
  const h2Count = headings.filter((heading) => heading.level === 2).length;
  const genericTitles = new Set(["介绍", "背景", "总结", "概述", "正文", "主要内容"]);

  if (h1Count !== 1) reasons.push(`H1 数量应为 1，实际为 ${h1Count}`);
  if (raw.trim().length >= 1200 && h2Count < 1) reasons.push("缺少 H2 分章标题");
  if (raw.trim().length >= 3000 && h2Count < 2) reasons.push("长文需要多个 H2 分章");

  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1];
    const current = headings[i];
    if (current.level > prev.level + 1) {
      reasons.push(`标题层级跳跃: H${prev.level} 到 H${current.level}`);
      break;
    }
  }

  const firstH1 = headings.find((heading) => heading.level === 1);
  const firstH2 = headings.find((heading) => heading.level === 2);
  const rawFirstH2 = rawHeadings.find((heading) => heading.level === 2);
  if (firstH1 && firstH2 && firstH2.line > firstH1.line) {
    const refinedLeadChars = bodyTextBeforeFirstH2(markdown, { skipBlockquotes: true }).replace(/\s+/g, "").length;
    const rawLeadChars = bodyTextBeforeFirstH2(raw).replace(/\s+/g, "").length;
    if (refinedLeadChars > 900 && rawLeadChars < 300) reasons.push("H1 后存在过长正文且没有 H2 分章");
    if (
      rawLeadChars >= 300
      && refinedLeadChars < Math.min(240, Math.round(rawLeadChars * 0.35))
      && rawFirstH2
      && headingsEquivalent(rawFirstH2.text, firstH2.text)
    ) {
      reasons.push("原文第一个分章前的导语正文被删除");
    }
  }

  for (const heading of headings.filter((item) => item.level === 2 || item.level === 3)) {
    if (heading.text.length > 64) {
      reasons.push(`标题过长: ${heading.text.slice(0, 24)}`);
      break;
    }
    if (genericTitles.has(heading.text)) {
      reasons.push(`标题过于空泛: ${heading.text}`);
      break;
    }
  }

  return reasons;
}

function shouldAcceptRefinedMarkdown(raw: string, refined: string): { ok: true } | { ok: false; reason: string } {
  const rawChars = raw.trim().length;
  const refinedChars = refined.trim().length;
  const rawImages = countMarkdownImages(raw);
  const refinedImages = countMarkdownImages(refined);

  if (!refinedChars) {
    return { ok: false, reason: "模型返回空内容" };
  }
  if (rawImages > 0 && refinedImages === 0) {
    return { ok: false, reason: `模型删除了全部图片引用 (${rawImages} -> 0)` };
  }
  if (rawChars >= 3000 && refinedChars < Math.round(rawChars * 0.55)) {
    return { ok: false, reason: `模型输出疑似摘要化 (${rawChars} -> ${refinedChars} chars)` };
  }
  if (!hasAssistiveBlock(refined, "摘要")) {
    return { ok: false, reason: "缺少引用块摘要" };
  }
  if (!hasAssistiveBlock(refined, "核心观点")) {
    return { ok: false, reason: "缺少引用块核心观点" };
  }

  const bodyChars = countBodyChars(refined);
  const minBodyChars = rawChars >= 1200 ? Math.min(600, Math.round(rawChars * 0.25)) : 80;
  if (bodyChars < minBodyChars) {
    return { ok: false, reason: "正文不足，疑似只输出摘要和观点" };
  }

  const headingReasons = analyzeHeadingStructure(refined, raw);
  if (headingReasons.length > 0) {
    return { ok: false, reason: headingReasons[0] };
  }

  return { ok: true };
}

function markUnfinishedSmartSections(markdown: string): string {
  const lines = markdown.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  const marker = [
    "",
    "> **未完成智能分章**",
    "> 智能排版结果未通过结构检查，已保留基础提取正文。",
  ];
  if (h1Index >= 0) {
    lines.splice(h1Index + 1, 0, ...marker);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return [...marker, "", markdown].join("\n").trim();
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
      setStatus(event.payload.status, "loading");
    });
    await listen<{ requestId?: string }>("web_clip_closed", (event) => {
      const task = activeTask;
      if (!task || event.payload?.requestId !== task.requestId) return;
      if (!task.applied && task.pendingDraftPath) void deleteDraftFile(task.pendingDraftPath);
      void invoke("clear_web_clip_image_proxy", { requestId: task.requestId }).catch(() => {});
      activeTask = null;
      setStatusRevealEnabled(false);
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
  };
  activeTask = task;
  setStatusRevealEnabled(true);
  hidePanel();
  setStatus("正在打开网页...", "loading");

  try {
    await invoke("start_url_extraction", {
      requestId: task.requestId,
      url,
      visible: fallbackWindow,
      auto: !fallbackWindow,
    });
    if (fallbackWindow) setStatus("已打开提取窗口", "info");
  } catch (err) {
    activeTask = null;
    setStatusRevealEnabled(false);
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
    activeTask = null;
    setStatusRevealEnabled(false);
    lastFailedUrl = task.url;
    setStatus(`提取失败: ${error}`, "warn");
    showPanel({
      message: "网页导入失败",
      error: `${error}。可重试，或在提取窗口中打开。`,
      fallbackUrl: task.url,
    });
    return;
  }

  setStatus("正在提取正文...", "loading");
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
      setStatus("正在处理图片...", "loading");
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
      setStatus("正在智能排版...", "loading");
      const rawMarkdown = markdown;
      let guardReason = "";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const refined = await invokeWithTimeout<string>(
            "refine_markdown",
            {
              markdown: rawMarkdown,
              provider: webClipConfig.provider,
              guardReason: attempt === 0 ? null : guardReason,
            },
            refineTimeoutMs(),
            "智能排版超时",
          );
          const normalized = normalizeMarkdownTitle(refined, title);
          const guard = shouldAcceptRefinedMarkdown(rawMarkdown, normalized);
          if (guard.ok) {
            markdown = normalized;
            guardReason = "";
            break;
          }
          guardReason = guard.reason;
          console.warn("[web-clip] LLM refinement rejected:", guard.reason);
          if (attempt === 0) setStatus("智能排版结构不合格，正在重试...", "loading");
        } catch (llmError) {
          guardReason = llmError instanceof Error ? llmError.message : String(llmError);
          console.error("[web-clip] LLM refinement failed:", llmError);
          break;
        }
      }
      if (guardReason) {
        markdown = markUnfinishedSmartSections(cleanBasicMarkdown(rawMarkdown, title));
        setStatus("未完成智能分章，使用基础提取", "warn");
      }
    }

    setStatus("正在生成网页草稿...", "loading");
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
    activeTask = null;
    setStatusRevealEnabled(false);
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
    activeTask = null;
    setStatusRevealEnabled(false);
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
