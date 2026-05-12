import type { AimdAsset, ImagePayload, ProxyPrefetchItem } from "./injector-types";

const ASSET_URI_PREFIX = "asset://";
const IMAGE_PROXY_SCHEME = "aimd-image-proxy";
const IMAGE_PROXY_HOST = "localhost";
const IMAGE_PROXY_PREFETCH_CONCURRENCY = 4;
const LAZY_IMAGE_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-url"];

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type RecordFn = (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;

export function setupImageProxyForPage(options: {
  startupRequestId: string;
  getRequestId: () => string;
  setRequestId: (requestId: string) => void;
  isRemotePage: () => boolean;
  record: RecordFn;
  invokeFn: InvokeFn;
}) {
  if (!options.isRemotePage()) return;
  const requestId = options.startupRequestId || options.getRequestId();
  if (!requestId) return;
  options.setRequestId(requestId);
  void configureImageProxyContext(requestId, options.record, options.invokeFn);

  const rewrite = () => rewriteDocumentImages(requestId, options.record);
  rewrite();
  window.addEventListener("DOMContentLoaded", rewrite, { once: true });
  window.addEventListener("load", rewrite);
  const root = document.documentElement || document;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) rewriteImageTree(node, requestId, options.record);
        });
      } else if (mutation.type === "attributes" && mutation.target instanceof Element) {
        rewriteImageTree(mutation.target, requestId, options.record);
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

export async function prefetchProxyImages(
  images: ImagePayload[],
  options: {
    startupRequestId: string;
    getRequestId: () => string;
    record: RecordFn;
    invokeFn: InvokeFn;
  },
) {
  const requestId = options.startupRequestId || options.getRequestId();
  if (!requestId || !images.length) return;
  await configureImageProxyContext(requestId, options.record, options.invokeFn);

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
    const results = await Promise.allSettled(
      chunk.map((url) => options.invokeFn<ProxyPrefetchItem>("prefetch_web_clip_image_proxy", { requestId, url })),
    );
    results.forEach((result, resultIndex) => {
      const fallbackURL = chunk[resultIndex] || "";
      if (result.status === "fulfilled") {
        recordPrefetchItem(result.value, fallbackURL, options.record, (count) => {
          if (count === "ok") fetchedCount += 1;
          else failedCount += 1;
        });
      } else {
        failedCount += 1;
        options.record("warn", "proxy image fetch failed", {
          url: fallbackURL,
          error: result.reason instanceof Error ? `${result.reason.name}: ${result.reason.message}` : String(result.reason),
        });
      }
    });
  }
  options.record("info", "proxy image prefetch finished", {
    total: urls.length,
    fetchedCount,
    failedCount,
  });
}

export function rewriteAssetURLs(
  html: string,
  assets: AimdAsset[],
  safeSetHTML: (target: Element | HTMLTemplateElement, html: string) => void,
  convertFileSrc: (filePath: string) => string,
): string {
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

export function extractImagePayloadsFromHTML(
  html: string,
  safeSetHTML: (target: Element | HTMLTemplateElement, html: string) => void,
): ImagePayload[] {
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

export function absoluteHTTPURL(value: string | null): string {
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

export function originalImageURL(value: string | null): string {
  return originalURLFromProxyURL(value) || absoluteHTTPURL(value);
}

export function parseSrcset(srcset: string): Array<{ raw: string; url: string; descriptor: string }> {
  return srcset
    .split(",")
    .map((raw) => {
      const trimmed = raw.trim();
      const [url = "", ...rest] = trimmed.split(/\s+/);
      return { raw: trimmed, url, descriptor: rest.join(" ") };
    })
    .filter((part) => part.url);
}

function configureImageProxyContext(requestId: string, record: RecordFn, invokeFn: InvokeFn) {
  const context = {
    requestId,
    pageUrl: location.href,
    userAgent: navigator.userAgent || "",
    referer: document.referrer || location.href,
    cookie: safeDocumentCookie(),
    acceptLanguage: navigator.languages?.join(",") || navigator.language || "",
  };
  return invokeFn("configure_web_clip_image_proxy", { context }).catch((err) => {
    record("warn", "image proxy context setup failed", {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  });
}

function rewriteDocumentImages(requestId: string, record: RecordFn) {
  rewriteImageTree(document.documentElement, requestId, record);
}

function rewriteImageTree(root: ParentNode | Element | null, requestId: string, record: RecordFn) {
  if (!root) return;
  const elements: Element[] = [];
  if (root instanceof Element && (root.matches("img") || root.matches("source"))) {
    elements.push(root);
  }
  root.querySelectorAll?.("img,source").forEach((el) => elements.push(el));
  for (const el of elements) {
    if (el.closest(".aimd-clip-shell")) continue;
    if (el instanceof HTMLImageElement) rewriteImageElement(el, requestId, record);
    else rewriteSourceElement(el, requestId);
  }
}

function rewriteImageElement(img: HTMLImageElement, requestId: string, record: RecordFn) {
  bindProxyImageDiagnostics(img, record);
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

function bindProxyImageDiagnostics(img: HTMLImageElement, record: RecordFn) {
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

function assetIDFromURL(value: string): string {
  if (!value.startsWith(ASSET_URI_PREFIX)) return "";
  const rest = value.slice(ASSET_URI_PREFIX.length);
  const end = rest.search(/[?#]/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function recordPrefetchItem(
  item: ProxyPrefetchItem,
  fallbackURL: string,
  record: RecordFn,
  count: (kind: "ok" | "failed") => void,
) {
  if (item.ok) {
    count("ok");
    record("debug", "proxy image fetch ok", {
      url: item.url || fallbackURL,
      bytes: item.bytes || 0,
      mime: item.mime || "",
    });
  } else {
    count("failed");
    record("warn", "proxy image fetch failed", {
      url: item.url || fallbackURL,
      error: item.error || "unknown error",
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
