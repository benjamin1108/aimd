import { Readability } from "@mozilla/readability";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type DiagnosticLevel = "debug" | "info" | "warn" | "error";
type ExtractDiagnostic = { level: DiagnosticLevel; message: string; data?: unknown };
type ImagePayload = { url: string; data: number[] };
type AimdAsset = { id: string; url?: string; localPath?: string };
type AimdDocument = {
  title: string;
  markdown: string;
  html: string;
  assets: AimdAsset[];
  draftSourcePath?: string;
};

const ASSET_URI_PREFIX = "asset://";

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

  const record = (level: DiagnosticLevel, message: string, data?: unknown) => {
    diagnostics.push({ level, message, data });
    const args = data === undefined ? [`[web-clip:extractor] ${message}`] : [`[web-clip:extractor] ${message}`, data];
    if (level === "debug") console.debug(...args);
    else if (level === "info") console.info(...args);
    else if (level === "warn") console.warn(...args);
    else console.error(...args);
  };

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
  shell.innerHTML = `
    <div class="aimd-clip-bar" hidden>
      <input class="aimd-clip-url" type="url" placeholder="https://example.com/article" />
      <button class="aimd-clip-btn" data-action="load">确定</button>
      <button class="aimd-clip-btn secondary" data-action="cancel">取消</button>
    </div>
    <div class="aimd-clip-start">
      <div class="aimd-clip-card">
        <h1>一键提取网页</h1>
        <p>粘贴文章链接，先打开网页确认内容，再提取成 AIMD 草稿。</p>
        <div class="aimd-clip-home-form">
          <div class="aimd-clip-home-field">
            <label class="aimd-clip-label" for="aimd-clip-home-url">网页 URL</label>
            <input id="aimd-clip-home-url" class="aimd-clip-url" data-role="home-url" type="url" placeholder="https://example.com/article" />
          </div>
          <button class="aimd-clip-btn" data-action="home-load">确定</button>
        </div>
        <div class="aimd-clip-meta">
          <span>先浏览原网页</span>
          <span>再生成预览</span>
          <span>确认后写入主窗口</span>
        </div>
      </div>
    </div>
    <div class="aimd-clip-work" hidden>
      <div class="aimd-clip-work-card">
        <div class="aimd-clip-skeleton">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="aimd-clip-work-text">大模型正在格式化</div>
        <div class="aimd-clip-work-sub">正在清理正文、下载图片并生成预览</div>
      </div>
    </div>
    <div class="aimd-clip-preview" hidden>
      <div class="aimd-clip-preview-inner"></div>
    </div>
  `;

  function mount() {
    if (document.body && !document.body.contains(shell)) {
      document.body.appendChild(shell);
      const target = isExtractEntryPage() ? "" : isRemotePage() ? getTargetURL() || location.href : "";
      if (target) {
        clipBar.hidden = false;
        urlInput.value = target;
        homeUrlInput.value = target;
        startPanel.hidden = true;
        loadBtn.textContent = "智能提取";
        loadBtn.dataset.action = "extract";
      } else if (isExtractEntryPage() || !isRemotePage()) {
        clipBar.hidden = true;
        startPanel.hidden = false;
        loadBtn.textContent = "确定";
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

  const urlInput = shell.querySelector<HTMLInputElement>(".aimd-clip-url")!;
  const homeUrlInput = shell.querySelector<HTMLInputElement>('[data-role="home-url"]')!;
  const clipBar = shell.querySelector<HTMLElement>(".aimd-clip-bar")!;
  const loadBtn = shell.querySelector<HTMLButtonElement>('[data-action="load"]')!;
  const homeLoadBtn = shell.querySelector<HTMLButtonElement>('[data-action="home-load"]')!;
  const cancelBtn = shell.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const startPanel = shell.querySelector<HTMLElement>(".aimd-clip-start")!;
  const workPanel = shell.querySelector<HTMLElement>(".aimd-clip-work")!;
  const previewPanel = shell.querySelector<HTMLElement>(".aimd-clip-preview")!;
  const previewInner = shell.querySelector<HTMLElement>(".aimd-clip-preview-inner")!;
  const loadingWorkPanelHTML = workPanel.innerHTML;
  mount();

  await listen<AimdDocument>("web_clip_preview_ready", (event) => {
    currentDoc = event.payload;
    workPanel.hidden = true;
    previewPanel.hidden = false;
    previewInner.innerHTML = rewriteAssetURLs(currentDoc.html, currentDoc.assets || []);
    loadBtn.textContent = "确定";
    loadBtn.dataset.action = "accept";
    loadBtn.disabled = false;
  });

  await listen<{ error?: string }>("web_clip_preview_failed", (event) => {
    workPanel.hidden = false;
    workPanel.innerHTML = `
      <div class="aimd-clip-work-card">
        <div class="aimd-clip-work-text">提取失败</div>
        <div class="aimd-clip-work-sub">${escapeHTML(event.payload?.error || "未知错误")}</div>
      </div>
    `;
    loadBtn.textContent = "智能提取";
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
      void invoke("web_clip_accept", { doc: currentDoc });
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
    void invoke("close_extractor_window");
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

  function loadURLFromInput(input: HTMLInputElement) {
    const url = normalizeURL(input.value);
    if (!url) {
      input.focus();
      return;
    }
    setTargetURL(url);
    window.location.href = url;
  }

  function getTargetURL(): string {
    try {
      const parsed = JSON.parse(window.name || "{}");
      return typeof parsed.aimdWebClipTarget === "string" ? parsed.aimdWebClipTarget : "";
    } catch {
      return "";
    }
  }

  function setTargetURL(url: string) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(window.name || "{}");
    } catch {}
    parsed.aimdWebClipTarget = url;
    window.name = JSON.stringify(parsed);
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
    workPanel.innerHTML = loadingWorkPanelHTML;
    workPanel.hidden = false;
    document.body.style.overflow = "hidden";

    const startedAt = performance.now();
    try {
      const pageTitle = extractPageTitle();
      record("info", "extraction started", { url: location.href });
      await autoScroll();
      await new Promise((r) => setTimeout(r, 800));

      const documentClone = document.cloneNode(true) as Document;
      stripNoise(documentClone);

      const reader = new Readability(documentClone);
      const article = reader.parse();
      record("info", "readability finished", { success: Boolean(article), title: article?.title || "", pageTitle, contentChars: article?.content?.length || 0 });
      if (!article) {
        await invoke("web_clip_raw_extracted", { payload: { success: false, title: document.title, diagnostics } });
        return;
      }

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = article.content || "";
      stripNoise(tempDiv);
      article.content = tempDiv.innerHTML;

      const uniqueUrls = new Set<string>();
      tempDiv.querySelectorAll("img").forEach((img) => {
        const src = absoluteHTTPURL(img.getAttribute("src"));
        if (src) uniqueUrls.add(src);
      });
      const images: ImagePayload[] = Array.from(uniqueUrls).map((url) => ({ url, data: [] }));
      record("info", "image urls handed to backend", { count: images.length });
      record("info", "extraction completed", { elapsedMs: Math.round(performance.now() - startedAt) });

      await invoke("web_clip_raw_extracted", {
        payload: { success: true, title: pageTitle || article.title, content: article.content, images, diagnostics },
      });
    } catch (err: any) {
      record("error", "extraction error", { elapsedMs: Math.round(performance.now() - startedAt), error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      await invoke("web_clip_raw_extracted", { payload: { success: false, error: err.message || "Unknown error", diagnostics } });
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
    tpl.innerHTML = html;
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

  function escapeHTML(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
})();
