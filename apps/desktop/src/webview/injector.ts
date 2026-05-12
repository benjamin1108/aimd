import { Readability } from "@mozilla/readability";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type DiagnosticLevel = "debug" | "info" | "warn" | "error";
type ExtractDiagnostic = { level: DiagnosticLevel; message: string; data?: unknown };
type ImagePayload = { url: string; data: number[]; proxyUrl?: string; originalUrl?: string };
type ProxyPrefetchItem = { url: string; ok: boolean; bytes?: number; mime?: string | null; error?: string | null };
type AimdAsset = { id: string; url?: string; localPath?: string };
type AimdDocument = {
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  draftSourcePath?: string;
};

const ASSET_URI_PREFIX = "asset://";
const IMAGE_PROXY_SCHEME = "aimd-image-proxy";
const IMAGE_PROXY_HOST = "localhost";
const IMAGE_PROXY_PREFETCH_CONCURRENCY = 4;
const LAZY_IMAGE_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-url"];

(async () => {
  const installState = window as any;
  if (installState.__aimdWebClipInstalled || installState.__aimdWebClipInstalling) return;
  installState.__aimdWebClipInstalling = true;

  try {
    await waitForDocumentShell();
  } catch (err) {
    installState.__aimdWebClipInstalling = false;
    throw err;
  }
  installState.__aimdWebClipInstalled = true;
  installState.__aimdWebClipInstalling = false;

  const diagnostics: ExtractDiagnostic[] = [];
  let currentDoc: AimdDocument | null = null;
  let extracting = false;
  const startupParams = readStartupParams();

  const record = (level: DiagnosticLevel, message: string, data?: unknown) => {
    diagnostics.push({ level, message, data });
    const args = data === undefined ? [`[web-clip:extractor] ${message}`] : [`[web-clip:extractor] ${message}`, data];
    if (level === "debug") console.debug(...args);
    else if (level === "info") console.info(...args);
    else if (level === "warn") console.warn(...args);
    else console.error(...args);
  };

  void setupImageProxyForPage();

  const style = document.createElement("style");
  style.textContent = `
    .aimd-clip-shell, .aimd-clip-shell * { box-sizing: border-box; }
    .aimd-clip-shell [hidden] { display: none !important; }
    .aimd-clip-shell { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #15171c; letter-spacing: 0; }
    .aimd-clip-bar { position: fixed; z-index: 3; top: 18px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 40px)); min-height: 48px; display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px; border: 1px solid rgba(255,255,255,.72); border-radius: 14px; background: linear-gradient(135deg, rgba(255,255,255,.9), rgba(245,247,250,.78)); box-shadow: 0 22px 62px rgba(19, 24, 36, .2), inset 0 1px 0 rgba(255,255,255,.86); backdrop-filter: blur(22px) saturate(1.18); pointer-events: auto; }
    .aimd-clip-bar::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 15px; background: linear-gradient(120deg, rgba(22,163,255,.42), rgba(142,68,255,.34), rgba(255,68,165,.32), rgba(255,183,77,.28), rgba(22,163,255,.42)); background-size: 240% 240%; opacity: .72; filter: blur(10px); animation: aimdAura 6s ease-in-out infinite; pointer-events: none; }
    .aimd-clip-url { width: 100%; min-width: 0; border: 1px solid rgba(24, 27, 32, .14); border-radius: 9px; padding: 0 12px; color: #17191f !important; background: rgba(255,255,255,.94) !important; font: 520 13px/36px inherit; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-url:focus { border-color: #2f343d; box-shadow: 0 0 0 3px rgba(24, 27, 32, .08); }
    .aimd-clip-btn { position: relative; isolation: isolate; overflow: hidden; height: 36px; border: 0 !important; border-radius: 9px; padding: 0 15px; background: #151822 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 1px rgba(0,0,0,.24); font: 740 13px/36px inherit; cursor: pointer; white-space: nowrap; box-shadow: 0 10px 24px rgba(38, 47, 71, .28), inset 0 1px 0 rgba(255,255,255,.18); transition: transform .16s ease, filter .16s ease, opacity .16s ease; }
    .aimd-clip-btn:not(.secondary)::before { content: ""; position: absolute; inset: -2px; z-index: -2; border-radius: inherit; background: linear-gradient(110deg, #23d5ff 0%, #7b61ff 26%, #ff4fab 52%, #ffb457 76%, #23d5ff 100%); background-size: 260% 260%; animation: aimdAura 4.8s ease-in-out infinite; }
    .aimd-clip-btn:not(.secondary)::after { content: ""; position: absolute; inset: 1px; z-index: -1; border-radius: 8px; background: linear-gradient(180deg, rgba(27,31,43,.92), rgba(15,17,24,.94)); box-shadow: inset 0 1px 0 rgba(255,255,255,.18); }
    .aimd-clip-btn:hover { filter: brightness(1.06) saturate(1.08); }
    .aimd-clip-btn:active { transform: translateY(1px); }
    .aimd-clip-btn.secondary { background: #e9ecef !important; color: #30343b !important; -webkit-text-fill-color: #30343b !important; text-shadow: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-btn.secondary:hover { background: #dde1e5; }
    .aimd-clip-btn:disabled { opacity: .55; cursor: default; transform: none; }
    .aimd-clip-start, .aimd-clip-work, .aimd-clip-preview { position: fixed; z-index: 1; inset: 0; pointer-events: auto; }
    .aimd-clip-start { display: grid; align-items: center; padding: 56px clamp(24px, 7vw, 112px); background: radial-gradient(circle at 14% 18%, rgba(35,213,255,.18), transparent 34%), radial-gradient(circle at 78% 28%, rgba(255,79,171,.14), transparent 30%), radial-gradient(circle at 72% 82%, rgba(255,180,87,.14), transparent 34%), linear-gradient(180deg, #fafaf8 0%, #eff1ee 100%); }
    .aimd-clip-start::before { content: ""; position: absolute; inset: 0; opacity: .34; background-image: linear-gradient(rgba(23,25,31,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(23,25,31,.05) 1px, transparent 1px); background-size: 34px 34px; pointer-events: none; }
    .aimd-clip-card { position: relative; width: min(760px, 100%); padding: 34px; border: 1px solid rgba(255,255,255,.74); border-radius: 16px; background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(250,251,253,.84)); box-shadow: 0 30px 96px rgba(20, 23, 28, .15), inset 0 1px 0 rgba(255,255,255,.92); pointer-events: auto; backdrop-filter: blur(16px) saturate(1.12); }
    .aimd-clip-card::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 17px; background: linear-gradient(130deg, rgba(35,213,255,.46), rgba(123,97,255,.25), rgba(255,79,171,.32), rgba(255,180,87,.28)); filter: blur(12px); opacity: .55; pointer-events: none; }
    .aimd-clip-card h1 { margin: 0 0 10px; font: 760 30px/1.15 inherit; color: #15171c; letter-spacing: 0; }
    .aimd-clip-card p { max-width: 560px; margin: 0 0 24px; color: #646a73; font: 450 14px/1.7 inherit; }
    .aimd-clip-home-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    .aimd-clip-home-field { min-width: 0; }
    .aimd-clip-label { display: block; margin: 0 0 8px; color: #444a53; font: 680 12px/1.2 inherit; }
    .aimd-clip-home-form .aimd-clip-url { height: 46px; font-size: 15px; line-height: 46px; }
    .aimd-clip-home-form .aimd-clip-btn { height: 46px; min-width: 104px; line-height: 46px; }
    .aimd-clip-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; color: #6d737c; font: 520 12px/1.2 inherit; }
    .aimd-clip-meta span { border: 1px solid rgba(24, 27, 32, .1); border-radius: 999px; padding: 7px 10px; background: rgba(248,248,246,.8); }
    .aimd-clip-work { display: grid; place-items: center; padding: 32px; background: rgba(246,247,244,.96); backdrop-filter: blur(8px); }
    .aimd-clip-work-card { width: min(520px, 100%); border: 1px solid rgba(24,27,32,.12); border-radius: 14px; padding: 28px; background: #fff; box-shadow: 0 24px 80px rgba(20,23,28,.16); }
    .aimd-clip-skeleton { display: grid; gap: 10px; margin-bottom: 22px; }
    .aimd-clip-skeleton span { height: 12px; border-radius: 999px; background: linear-gradient(90deg, #ecefeb 0%, #f8f8f6 45%, #ecefeb 100%); background-size: 220% 100%; animation: aimdShimmer 1.4s ease-in-out infinite; }
    .aimd-clip-skeleton span:nth-child(1) { width: 72%; height: 16px; }
    .aimd-clip-skeleton span:nth-child(2) { width: 94%; }
    .aimd-clip-skeleton span:nth-child(3) { width: 82%; }
    .aimd-clip-work-text { color: #15171c; font: 720 16px/1.4 inherit; }
    .aimd-clip-work-sub { margin-top: 6px; color: #747a83; font: 13px/1.5 inherit; }
    .aimd-clip-preview { overflow: auto; padding: 88px 24px 32px; background: #f4f5f1; }
    .aimd-clip-preview-inner { width: min(920px, 100%); margin: 0 auto; padding: 34px 38px 52px; border: 1px solid rgba(24, 27, 32, .1); border-radius: 12px; background: #fff; color: #20242b; box-shadow: 0 24px 70px rgba(20,23,28,.12); }
    .aimd-clip-preview-inner h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; }
    .aimd-clip-preview-inner h2 { font-size: 21px; margin: 28px 0 12px; }
    .aimd-clip-preview-inner h3 { font-size: 17px; margin: 22px 0 10px; }
    .aimd-clip-preview-inner p, .aimd-clip-preview-inner li { font-size: 15px; line-height: 1.75; }
    .aimd-clip-preview-inner img { max-width: 100%; height: auto; border-radius: 8px; }
    @media (max-width: 720px) {
      .aimd-clip-bar { top: 10px; width: calc(100vw - 20px); grid-template-columns: 1fr auto; }
      .aimd-clip-bar .aimd-clip-btn.secondary { display: none; }
      .aimd-clip-start { padding: 24px; }
      .aimd-clip-card { padding: 24px; }
      .aimd-clip-card h1 { font-size: 24px; }
      .aimd-clip-home-form { grid-template-columns: 1fr; }
      .aimd-clip-home-form .aimd-clip-btn { width: 100%; }
      .aimd-clip-preview-inner { padding: 26px 22px 40px; }
    }
    @keyframes aimdShimmer { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }
    @keyframes aimdAura { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  `;
  document.head.appendChild(style);

  const shell = document.createElement("div");
  shell.className = "aimd-clip-shell";

  const clipBar = document.createElement("div");
  clipBar.className = "aimd-clip-bar";
  clipBar.hidden = true;
  const urlInput = document.createElement("input");
  urlInput.className = "aimd-clip-url";
  urlInput.type = "url";
  urlInput.placeholder = "https://example.com/article";
  const loadBtn = createButton("打开", "aimd-clip-btn", "load");
  const cancelBtn = createButton("取消", "aimd-clip-btn secondary", "cancel");
  clipBar.append(urlInput, loadBtn, cancelBtn);

  const startPanel = document.createElement("div");
  startPanel.className = "aimd-clip-start";
  const startCard = document.createElement("div");
  startCard.className = "aimd-clip-card";
  const startTitle = document.createElement("h1");
  startTitle.textContent = "从网页导入";
  const startText = document.createElement("p");
  startText.textContent = "粘贴文章链接，打开网页后提取成 AIMD 草稿。";
  const homeForm = document.createElement("div");
  homeForm.className = "aimd-clip-home-form";
  const homeField = document.createElement("div");
  homeField.className = "aimd-clip-home-field";
  const homeLabel = document.createElement("label");
  homeLabel.className = "aimd-clip-label";
  homeLabel.htmlFor = "aimd-clip-home-url";
  homeLabel.textContent = "网页 URL";
  const homeUrlInput = document.createElement("input");
  homeUrlInput.id = "aimd-clip-home-url";
  homeUrlInput.className = "aimd-clip-url";
  homeUrlInput.dataset.role = "home-url";
  homeUrlInput.type = "url";
  homeUrlInput.placeholder = "https://example.com/article";
  homeField.append(homeLabel, homeUrlInput);
  const homeLoadBtn = createButton("打开网页", "aimd-clip-btn", "home-load");
  homeForm.append(homeField, homeLoadBtn);
  const meta = document.createElement("div");
  meta.className = "aimd-clip-meta";
  for (const label of ["打开网页", "提取正文", "生成草稿"]) {
    const item = document.createElement("span");
    item.textContent = label;
    meta.appendChild(item);
  }
  startCard.append(startTitle, startText, homeForm, meta);
  startPanel.appendChild(startCard);

  const workPanel = document.createElement("div");
  workPanel.className = "aimd-clip-work";
  workPanel.hidden = true;
  resetWorkPanel();

  const previewPanel = document.createElement("div");
  previewPanel.className = "aimd-clip-preview";
  previewPanel.hidden = true;
  const previewInner = document.createElement("div");
  previewInner.className = "aimd-clip-preview-inner";
  previewPanel.appendChild(previewInner);
  shell.append(clipBar, startPanel, workPanel, previewPanel);

  function createButton(text: string, className: string, action: string) {
    const button = document.createElement("button");
    button.className = className;
    button.dataset.action = action;
    button.textContent = text;
    return button;
  }

  function resetWorkPanel(message = "正在提取正文", detail = "正在清理正文、读取页面图片并生成草稿") {
    const card = document.createElement("div");
    card.className = "aimd-clip-work-card";
    const skeleton = document.createElement("div");
    skeleton.className = "aimd-clip-skeleton";
    skeleton.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    const text = document.createElement("div");
    text.className = "aimd-clip-work-text";
    text.textContent = message;
    const sub = document.createElement("div");
    sub.className = "aimd-clip-work-sub";
    sub.textContent = detail;
    card.append(skeleton, text, sub);
    workPanel.replaceChildren(card);
  }

  function mount() {
    if (document.body && !document.body.contains(shell)) {
      document.body.appendChild(shell);
      if (startupParams.requestId) setRequestId(startupParams.requestId);
      if (startupParams.url) setTargetURL(startupParams.url);
      if (startupParams.requestId) setAutoMode(startupParams.auto);
      if (startupParams.url && isExtractEntryPage()) {
        setTargetURL(startupParams.url);
        setAutoMode(startupParams.auto);
        shell.hidden = true;
        void reportProgress("正在打开网页...");
        window.location.href = startupParams.url;
        return;
      }
      const target = isExtractEntryPage() ? "" : isRemotePage() ? getTargetURL() || startupParams.url || location.href : "";
      if (target) {
        const autoMode = getAutoMode();
        if (autoMode) {
          shell.hidden = true;
          startPanel.hidden = true;
          clipBar.hidden = true;
          window.setTimeout(() => { void runExtraction(); }, 300);
          return;
        }
        clipBar.hidden = false;
        urlInput.value = target;
        homeUrlInput.value = target;
        startPanel.hidden = true;
        loadBtn.textContent = "提取";
        loadBtn.dataset.action = "extract";
      } else if (isExtractEntryPage() || !isRemotePage()) {
        clipBar.hidden = true;
        startPanel.hidden = false;
        loadBtn.textContent = "打开";
        loadBtn.dataset.action = "load";
        window.setTimeout(() => homeUrlInput.focus(), 50);
      }
    } else if (!document.body) {
      setTimeout(mount, 50);
    }
  }

  function waitForDocumentShell(): Promise<void> {
    if (document.head && document.body) return Promise.resolve();
    return new Promise((resolve) => {
      const tryResolve = () => {
        if (!document.head || !document.body) return false;
        document.removeEventListener("DOMContentLoaded", tryResolve);
        resolve();
        return true;
      };
      if (tryResolve()) return;
      document.addEventListener("DOMContentLoaded", tryResolve);
      const timer = window.setInterval(() => {
        if (tryResolve()) window.clearInterval(timer);
      }, 20);
    });
  }

  mount();

  await listen<AimdDocument | { requestId?: string; doc?: AimdDocument }>("web_clip_preview_ready", (event) => {
    const payload = event.payload as AimdDocument | { requestId?: string; doc?: AimdDocument };
    currentDoc = ("doc" in payload && payload.doc) ? payload.doc : payload as AimdDocument;
    workPanel.hidden = true;
    previewPanel.hidden = false;
    safeSetHTML(previewInner, rewriteAssetURLs(currentDoc.html, currentDoc.assets || []));
    loadBtn.textContent = "使用草稿";
    loadBtn.dataset.action = "accept";
    loadBtn.disabled = false;
  });

  await listen<{ error?: string }>("web_clip_preview_failed", (event) => {
    workPanel.hidden = false;
    resetWorkPanel("提取失败", event.payload?.error || "未知错误");
    loadBtn.textContent = "提取";
    loadBtn.dataset.action = "extract";
    loadBtn.disabled = false;
  });

  loadBtn.addEventListener("click", () => {
    const action = loadBtn.dataset.action;
    if (action === "load") {
      loadURLFromInput(urlInput);
      return;
    }
    if (action === "extract") {
      void runExtraction();
      return;
    }
    if (action === "accept" && currentDoc) {
      void invoke("web_clip_accept", { requestId: getRequestId() || null, doc: currentDoc });
    }
  });

  homeLoadBtn.addEventListener("click", () => {
    loadURLFromInput(homeUrlInput);
  });

  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadBtn.click();
    }
  });

  urlInput.addEventListener("input", () => {
    homeUrlInput.value = urlInput.value;
  });

  homeUrlInput.addEventListener("input", () => {
    urlInput.value = homeUrlInput.value;
  });

  homeUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      homeLoadBtn.click();
    }
  });

  cancelBtn.addEventListener("click", () => {
    void invoke("close_extractor_window", { requestId: getRequestId() || null });
  });

  function normalizeURL(value: string): string | null {
    const raw = value.trim();
    if (!raw) return null;
    const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function isRemotePage(): boolean {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  function isExtractEntryPage(): boolean {
    return location.pathname.endsWith("/extractor.html") || location.pathname === "/extractor.html";
  }

  function readStartupParams(): { requestId: string; url: string; auto: boolean } {
    const params = new URLSearchParams(location.search);
    const injected = (window as any).__AIMD_WEB_CLIP_STARTUP__;
    const injectedTask = injected && typeof injected === "object" ? injected as Record<string, unknown> : {};
    const requestId = typeof injectedTask.requestId === "string"
      ? injectedTask.requestId
      : params.get("requestId") || "";
    const rawURL = typeof injectedTask.url === "string" ? injectedTask.url : params.get("url") || "";
    const url = normalizeURL(rawURL) || "";
    const auto = typeof injectedTask.auto === "boolean" ? injectedTask.auto : params.get("auto") !== "0";
    return { requestId, url, auto };
  }

  function loadURLFromInput(input: HTMLInputElement) {
    const url = normalizeURL(input.value);
    if (!url) {
      input.focus();
      return;
    }
    setTargetURL(url);
    setAutoMode(false);
    window.location.href = url;
  }

  function getWindowState(): Record<string, unknown> {
    try {
      return JSON.parse(window.name || "{}");
    } catch {
      return {};
    }
  }

  function setWindowState(patch: Record<string, unknown>) {
    window.name = JSON.stringify({ ...getWindowState(), ...patch });
  }

  function getTargetURL(): string {
    const parsed = getWindowState();
    return typeof parsed.aimdWebClipTarget === "string" ? parsed.aimdWebClipTarget : "";
  }

  function getRequestId(): string {
    const parsed = getWindowState();
    return typeof parsed.aimdWebClipRequestId === "string" ? parsed.aimdWebClipRequestId : "";
  }

  function setRequestId(requestId: string) {
    setWindowState({ aimdWebClipRequestId: requestId });
  }

  function getAutoMode(): boolean {
    const parsed = getWindowState();
    return parsed.aimdWebClipAuto === true;
  }

  function setAutoMode(auto: boolean) {
    setWindowState({ aimdWebClipAuto: auto });
  }

  async function reportProgress(status: string) {
    const requestId = getRequestId();
    if (!requestId) return;
    try {
      await invoke("web_clip_progress", { payload: { requestId, status } });
    } catch {
      // Progress is best-effort; the extraction result event is authoritative.
    }
  }

  function getPayloadBase() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  }

  function setTargetURL(url: string) {
    setWindowState({ aimdWebClipTarget: url });
  }

  function normalizeText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function textContent(selector: string): string {
    const node = Array.from(document.querySelectorAll(selector))
      .find((el) => !el.closest(".aimd-clip-shell"));
    return normalizeText(node?.textContent || "");
  }

  function metaContent(selector: string): string {
    return normalizeText(document.querySelector<HTMLMetaElement>(selector)?.content || "");
  }

  function extractPageTitle(): string {
    const h1 = textContent("main h1") || textContent("article h1") || textContent("h1");
    if (h1) return h1;
    const metaTitle = metaContent('meta[property="og:title"]') || metaContent('meta[name="twitter:title"]');
    if (metaTitle) return metaTitle;
    return document.title.replace(/\s+\|.*$/, "").replace(/\s+-\s+.*$/, "").trim() || document.title;
  }

  function absoluteHTTPURL(value: string | null): string {
    const raw = (value || "").trim();
    if (
      !raw ||
      raw.startsWith("data:") ||
      raw.startsWith("blob:") ||
      /["'{}<>\s]/.test(raw) ||
      raw.includes(":\"")
    ) return "";
    try {
      const url = new URL(raw, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function setupImageProxyForPage() {
    if (!isRemotePage()) return;
    const requestId = startupParams.requestId || getRequestId();
    if (!requestId) return;
    setRequestId(requestId);
    void configureImageProxyContext(requestId);

    const rewrite = () => rewriteDocumentImages(requestId);
    rewrite();
    window.addEventListener("DOMContentLoaded", rewrite, { once: true });
    window.addEventListener("load", rewrite);
    const root = document.documentElement || document;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) rewriteImageTree(node, requestId);
          });
        } else if (mutation.type === "attributes" && mutation.target instanceof Element) {
          rewriteImageTree(mutation.target, requestId);
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", ...LAZY_IMAGE_ATTRS],
    });
  }

  async function configureImageProxyContext(requestId: string) {
    const context = {
      requestId,
      pageUrl: location.href,
      userAgent: navigator.userAgent || "",
      referer: document.referrer || location.href,
      cookie: safeDocumentCookie(),
      acceptLanguage: navigator.languages?.join(",") || navigator.language || "",
    };
    try {
      await invoke("configure_web_clip_image_proxy", { context });
    } catch (err) {
      record("warn", "image proxy context setup failed", {
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }

  function safeDocumentCookie(): string {
    try {
      return document.cookie || "";
    } catch {
      return "";
    }
  }

  function rewriteDocumentImages(requestId: string) {
    rewriteImageTree(document.documentElement, requestId);
  }

  function rewriteImageTree(root: ParentNode | Element | null, requestId: string) {
    if (!root) return;
    const elements: Element[] = [];
    if (root instanceof Element && (root.matches("img") || root.matches("source"))) {
      elements.push(root);
    }
    root.querySelectorAll?.("img,source").forEach((el) => elements.push(el));
    for (const el of elements) {
      if (el.closest(".aimd-clip-shell")) continue;
      if (el instanceof HTMLImageElement) rewriteImageElement(el, requestId);
      else rewriteSourceElement(el, requestId);
    }
  }

  function rewriteImageElement(img: HTMLImageElement, requestId: string) {
    bindProxyImageDiagnostics(img);
    const srcProxy = rewriteImageURLAttribute(img, "src", requestId);
    const lazyProxy = LAZY_IMAGE_ATTRS.map((attr) => rewriteImageURLAttribute(img, attr, requestId)).find(Boolean) || "";
    rewriteSrcsetAttribute(img, "srcset", requestId);
    const selectedProxy = srcProxy || lazyProxy;
    const currentSrc = img.getAttribute("src") || "";
    if (selectedProxy && (!currentSrc || currentSrc.startsWith("data:") || currentSrc.startsWith("blob:"))) {
      img.setAttribute("src", selectedProxy);
      img.dataset.aimdProxySrc = selectedProxy;
    }
  }

  function rewriteSourceElement(source: Element, requestId: string) {
    rewriteSrcsetAttribute(source, "srcset", requestId);
    for (const attr of LAZY_IMAGE_ATTRS) rewriteImageURLAttribute(source, attr, requestId);
  }

  function rewriteImageURLAttribute(el: Element, attr: string, requestId: string): string {
    const raw = el.getAttribute(attr);
    const original = originalImageURL(raw);
    if (!original) return "";
    const proxy = imageProxyURL(requestId, original);
    if (raw === proxy) return proxy;
    if (!el.getAttribute("data-aimd-original-src")) el.setAttribute("data-aimd-original-src", original);
    el.setAttribute("data-aimd-proxy-src", proxy);
    el.setAttribute(attr, proxy);
    return proxy;
  }

  function rewriteSrcsetAttribute(el: Element, attr: string, requestId: string): string {
    const raw = el.getAttribute(attr) || "";
    if (!raw.trim()) return "";
    const parts = parseSrcset(raw);
    let changed = false;
    let firstProxy = "";
    const next = parts.map((part) => {
      const original = originalImageURL(part.url);
      if (!original) return part.raw;
      const proxy = imageProxyURL(requestId, original);
      if (!firstProxy) firstProxy = proxy;
      changed = changed || proxy !== part.url;
      return [proxy, part.descriptor].filter(Boolean).join(" ");
    }).join(", ");
    if (!changed) return firstProxy;
    if (!el.getAttribute("data-aimd-original-srcset")) el.setAttribute("data-aimd-original-srcset", raw);
    if (firstProxy && !el.getAttribute("data-aimd-original-src")) {
      const firstOriginal = originalImageURL(parts[0]?.url || "");
      if (firstOriginal) el.setAttribute("data-aimd-original-src", firstOriginal);
    }
    el.setAttribute(attr, next);
    return firstProxy;
  }

  function bindProxyImageDiagnostics(img: HTMLImageElement) {
    if (img.dataset.aimdProxyObserved === "1") return;
    img.dataset.aimdProxyObserved = "1";
    img.addEventListener("load", () => {
      const proxyUrl = img.getAttribute("data-aimd-proxy-src") || "";
      if (!proxyUrl || img.currentSrc !== proxyUrl && img.getAttribute("src") !== proxyUrl) return;
      record("debug", "proxy image fetch ok", {
        url: img.getAttribute("data-aimd-original-src") || originalURLFromProxyURL(proxyUrl) || proxyUrl,
      });
    });
    img.addEventListener("error", () => {
      const proxyUrl = img.getAttribute("data-aimd-proxy-src") || "";
      if (!proxyUrl) return;
      // Some WebViews refuse custom-scheme image elements on remote pages. Backend
      // prefetch is authoritative for saved images, so avoid noisy extraction warnings.
    });
  }

  async function prefetchProxyImages(images: ImagePayload[]) {
    const requestId = startupParams.requestId || getRequestId();
    if (!requestId || !images.length) return;
    await configureImageProxyContext(requestId);

    const urls = Array.from(new Set(images
      .map((img) => {
        const original = img.originalUrl
          || originalURLFromProxyURL(img.proxyUrl || "")
          || originalURLFromProxyURL(img.url)
          || img.url;
        return absoluteHTTPURL(original);
      })
      .filter(Boolean)));
    if (!urls.length) return;

    let fetchedCount = 0;
    let failedCount = 0;
    for (let index = 0; index < urls.length; index += IMAGE_PROXY_PREFETCH_CONCURRENCY) {
      const chunk = urls.slice(index, index + IMAGE_PROXY_PREFETCH_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map((url) => invoke<ProxyPrefetchItem>("prefetch_web_clip_image_proxy", { requestId, url })));
      results.forEach((result, resultIndex) => {
        const fallbackURL = chunk[resultIndex] || "";
        if (result.status === "fulfilled") {
          const item = result.value;
          if (item.ok) {
            fetchedCount += 1;
            record("debug", "proxy image fetch ok", {
              url: item.url || fallbackURL,
              bytes: item.bytes || 0,
              mime: item.mime || "",
            });
          } else {
            failedCount += 1;
            record("warn", "proxy image fetch failed", {
              url: item.url || fallbackURL,
              error: item.error || "unknown error",
            });
          }
        } else {
          failedCount += 1;
          record("warn", "proxy image fetch failed", {
            url: fallbackURL,
            error: result.reason instanceof Error ? `${result.reason.name}: ${result.reason.message}` : String(result.reason),
          });
        }
      });
    }
    record("info", "proxy image prefetch finished", {
      total: urls.length,
      fetchedCount,
      failedCount,
    });
  }

  function imageProxyURL(requestId: string, originalURL: string): string {
    return `${IMAGE_PROXY_SCHEME}://${IMAGE_PROXY_HOST}/${encodeURIComponent(requestId)}/image?u=${encodeURIComponent(originalURL)}`;
  }

  function originalURLFromProxyURL(value: string | null): string {
    const raw = (value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const isProxyScheme = url.protocol === `${IMAGE_PROXY_SCHEME}:`;
      const isWindowsAlias = url.protocol === "http:" && url.hostname === `${IMAGE_PROXY_SCHEME}.localhost`;
      if (!isProxyScheme && !isWindowsAlias) return "";
      return absoluteHTTPURL(url.searchParams.get("u"));
    } catch {
      return "";
    }
  }

  function originalImageURL(value: string | null): string {
    return originalURLFromProxyURL(value) || absoluteHTTPURL(value);
  }

  function parseSrcset(srcset: string): Array<{ raw: string; url: string; descriptor: string }> {
    return srcset
      .split(",")
      .map((raw) => {
        const trimmed = raw.trim();
        const [url = "", ...rest] = trimmed.split(/\s+/);
        return { raw: trimmed, url, descriptor: rest.join(" ") };
      })
      .filter((part) => part.url);
  }

  function stripNoise(root: ParentNode) {
    root.querySelectorAll(".aimd-clip-shell, script, style, link[rel~='stylesheet'], noscript, template, nav, header, footer, aside, form, dialog, iframe, button, input, textarea, select, [role='navigation'], [role='banner'], [role='contentinfo'], [role='search'], [hidden], [aria-hidden='true']").forEach((node) => {
      node.remove();
    });
    root.querySelectorAll<HTMLElement>("*").forEach((el) => {
      el.removeAttribute("style");
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
      }
    });
  }

  async function autoScroll() {
    const scrollStartedAt = performance.now();
    return new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      let done = false;
      const finish = (reason: "finished" | "timeout") => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(safetyTimer);
        record("info", `autoScroll ${reason}`, { elapsedMs: Math.round(performance.now() - scrollStartedAt), totalHeight, scrollHeight: document.body.scrollHeight });
        resolve();
      };
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) finish("finished");
      }, 100);
      const safetyTimer = setTimeout(() => finish("timeout"), 5000);
    });
  }

  async function runExtraction() {
    if (extracting) return;
    extracting = true;
    loadBtn.disabled = true;
    loadBtn.textContent = "提取中";
    startPanel.hidden = true;
    previewPanel.hidden = true;
    resetWorkPanel();
    workPanel.hidden = false;
    document.body.style.overflow = "hidden";

    const startedAt = performance.now();
    try {
      await reportProgress("正在提取正文...");
      const pageTitle = extractPageTitle();
      record("info", "extraction started", { url: location.href });
      await autoScroll();
      await new Promise((r) => setTimeout(r, 800));

      const documentClone = document.cloneNode(true) as Document;
      stripNoise(documentClone);

      let article: { title?: string; content?: string } | null = null;
      try {
        const reader = new Readability(documentClone);
        const parsed = reader.parse();
        article = parsed ? { title: parsed.title || "", content: parsed.content || "" } : null;
      } catch (err) {
        record("warn", "readability failed, using fallback extractor", {
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        article = fallbackExtractArticle(pageTitle);
      }
      record("info", "readability finished", { success: Boolean(article), title: article?.title || "", pageTitle, contentChars: article?.content?.length || 0 });
      if (!article) {
        await invoke("web_clip_raw_extracted", { payload: { ...getPayloadBase(), success: false, title: document.title, diagnostics } });
        return;
      }

      const articleContent = article.content || "";
      const images = extractImagePayloadsFromHTML(articleContent);
      await prefetchProxyImages(images);
      article.content = articleContent;
      record("info", "image payloads handed to backend", {
        count: images.length,
        proxyRefs: images.filter((img) => img.proxyUrl).length,
      });
      record("info", "extraction completed", { elapsedMs: Math.round(performance.now() - startedAt) });

      await invoke("web_clip_raw_extracted", {
        payload: { ...getPayloadBase(), success: true, title: pageTitle || article.title, content: article.content, images, diagnostics },
      });
    } catch (err: any) {
      record("error", "extraction error", { elapsedMs: Math.round(performance.now() - startedAt), error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      await invoke("web_clip_raw_extracted", { payload: { ...getPayloadBase(), success: false, error: err.message || "Unknown error", diagnostics } });
    } finally {
      extracting = false;
    }
  }

  function assetIDFromURL(value: string): string {
    if (!value.startsWith(ASSET_URI_PREFIX)) return "";
    const rest = value.slice(ASSET_URI_PREFIX.length);
    const end = rest.search(/[?#]/);
    return end >= 0 ? rest.slice(0, end) : rest;
  }

  function rewriteAssetURLs(html: string, assets: AimdAsset[]): string {
    if (!assets.length || !html.includes(ASSET_URI_PREFIX)) return html;
    const tpl = document.createElement("template");
    safeSetHTML(tpl, html);
    const byID = new Map(assets.map((asset) => [asset.id, asset]));
    tpl.content.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const source = img.getAttribute("src") || "";
      const id = img.getAttribute("data-asset-id") || assetIDFromURL(source);
      const asset = id ? byID.get(id) : null;
      const localPath = asset?.localPath || asset?.url || "";
      if (!localPath) return;
      img.src = convertFileSrc(localPath);
    });
    return tpl.innerHTML;
  }

  function safeSetHTML(target: Element | HTMLTemplateElement, html: string) {
    try {
      target.innerHTML = html;
    } catch (err) {
      record("warn", "HTML assignment blocked by page policy", {
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      if (target instanceof HTMLTemplateElement) return;
      target.textContent = html;
    }
  }

  function extractImagePayloadsFromHTML(html: string): ImagePayload[] {
    const tpl = document.createElement("template");
    safeSetHTML(tpl, html);
    const byOriginal = new Map<string, ImagePayload>();
    const addURL = (value: string | null, fallbackOriginal?: string | null) => {
      const proxyOriginal = originalURLFromProxyURL(value);
      const original = proxyOriginal || originalImageURL(value) || originalImageURL(fallbackOriginal || "");
      if (!original) return;
      const existing = byOriginal.get(original) || { url: original, originalUrl: original, data: [] };
      if (proxyOriginal && value) existing.proxyUrl = value.trim();
      byOriginal.set(original, existing);
    };

    tpl.content.querySelectorAll("img,source").forEach((el) => {
      addURL(el.getAttribute("src"), el.getAttribute("data-aimd-original-src"));
      for (const attr of LAZY_IMAGE_ATTRS) addURL(el.getAttribute(attr), el.getAttribute("data-aimd-original-src"));
      for (const part of parseSrcset(el.getAttribute("srcset") || "")) addURL(part.url, el.getAttribute("data-aimd-original-src"));
      for (const part of parseSrcset(el.getAttribute("data-aimd-original-srcset") || "")) addURL(part.url);
    });

    return Array.from(byOriginal.values());
  }

  function fallbackExtractArticle(pageTitle: string): { title: string; content: string } | null {
    const root = document.querySelector("article")
      || document.querySelector("main")
      || document.querySelector('[role="main"]')
      || document.body;
    if (!root) return null;

    const blocks: string[] = [];
    const seen = new Set<string>();
    const selector = "h1,h2,h3,h4,p,li,blockquote,pre,img";
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (isNoiseElement(el)) return;
      if (el.tagName === "IMG") {
        const src = originalImageURL(el.getAttribute("src"))
          || originalImageURL(el.getAttribute("data-src"))
          || originalImageURL(el.getAttribute("data-aimd-original-src"));
        if (!src || seen.has(`img:${src}`)) return;
        seen.add(`img:${src}`);
        const alt = normalizeText(el.getAttribute("alt") || "");
        blocks.push(`<p><img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}"></p>`);
        return;
      }

      const text = normalizeText(el.textContent || "");
      if (text.length < 2) return;
      if (seen.has(text)) return;
      seen.add(text);
      if (looksLikeNoiseText(text)) return;

      const tag = el.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) {
        const level = tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3";
        blocks.push(`<${level}>${escapeHTML(text)}</${level}>`);
      } else if (tag === "li") {
        blocks.push(`<ul><li>${escapeHTML(text)}</li></ul>`);
      } else if (tag === "blockquote") {
        blocks.push(`<blockquote><p>${escapeHTML(text)}</p></blockquote>`);
      } else if (tag === "pre") {
        blocks.push(`<pre><code>${escapeHTML(el.textContent || "")}</code></pre>`);
      } else {
        blocks.push(`<p>${escapeHTML(text)}</p>`);
      }
    });

    const title = pageTitle || extractPageTitle() || document.title || "网页草稿";
    const content = [`<h1>${escapeHTML(title)}</h1>`, ...blocks].join("\n");
    return normalizeText(blocks.join("")).length > 80 ? { title, content } : null;
  }

  function isNoiseElement(el: Element): boolean {
    return Boolean(el.closest(
      ".aimd-clip-shell,nav,header,footer,aside,form,dialog,script,style,noscript,template,iframe,button,input,textarea,select,[role='navigation'],[role='banner'],[role='contentinfo'],[role='search'],[hidden],[aria-hidden='true']",
    ));
  }

  function looksLikeNoiseText(text: string): boolean {
    return /^(share|subscribe|sign in|sign up|read more|learn more|cookie|privacy|terms|all rights reserved)$/i.test(text)
      || /^\d+\s*(min|minutes?)\s+read$/i.test(text)
      || /^\d{1,2}:\d{2}$/.test(text);
  }

  function escapeHTML(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})().catch((err) => {
  const injected = (window as any).__AIMD_WEB_CLIP_STARTUP__;
  const requestId = injected && typeof injected.requestId === "string"
    ? injected.requestId
    : new URLSearchParams(location.search).get("requestId") || undefined;
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error("[web-clip:extractor] installation failed", err);
  void invoke("web_clip_raw_extracted", {
    payload: {
      requestId,
      success: false,
      title: document.title,
      error: `提取脚本初始化失败: ${message}`,
      diagnostics: [{ level: "error", message: "extractor installation failed", data: { error: message } }],
    },
  }).catch(() => {});
});
