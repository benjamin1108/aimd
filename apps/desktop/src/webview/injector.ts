import { Readability } from "@mozilla/readability";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { absoluteHTTPURL, extractImagePayloadsFromHTML, prefetchProxyImages, rewriteAssetURLs, setupImageProxyForPage } from "./injector-images";
import { waitForDocumentShell } from "./injector-dom";
import { fallbackExtractArticle } from "./injector-fallback";
import { WEB_CLIP_STYLE } from "./injector-style";
import type { AimdDocument, DiagnosticLevel, ExtractDiagnostic } from "./injector-types";

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

  void setupImageProxyForPage({
    startupRequestId: startupParams.requestId,
    getRequestId,
    setRequestId,
    isRemotePage,
    record,
    invokeFn: invoke,
  });

  const style = document.createElement("style");
  style.textContent = WEB_CLIP_STYLE;
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

  mount();

  await listen<AimdDocument | { requestId?: string; doc?: AimdDocument }>("web_clip_preview_ready", (event) => {
    const payload = event.payload as AimdDocument | { requestId?: string; doc?: AimdDocument };
    currentDoc = ("doc" in payload && payload.doc) ? payload.doc : payload as AimdDocument;
    workPanel.hidden = true;
    previewPanel.hidden = false;
    safeSetHTML(previewInner, rewriteAssetURLs(currentDoc.html, currentDoc.assets || [], safeSetHTML, convertFileSrc));
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
        article = fallbackExtractArticle(pageTitle, extractPageTitle);
      }
      record("info", "readability finished", { success: Boolean(article), title: article?.title || "", pageTitle, contentChars: article?.content?.length || 0 });
      if (!article) {
        await invoke("web_clip_raw_extracted", { payload: { ...getPayloadBase(), success: false, title: document.title, diagnostics } });
        return;
      }

      const articleContent = article.content || "";
      const images = extractImagePayloadsFromHTML(articleContent, safeSetHTML);
      await prefetchProxyImages(images, {
        startupRequestId: startupParams.requestId,
        getRequestId,
        record,
        invokeFn: invoke,
      });
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
