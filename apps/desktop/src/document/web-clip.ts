import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";
import { setStatus } from "../ui/chrome";
import { loadAppSettings } from "../core/settings";
import type { AimdDocument } from "../core/types";
import { applyDocument } from "./apply";

// Type definitions matching Rust backend
interface ImagePayload {
  url: string;
  data: number[];
}

interface ExtractDiagnostic {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

interface ExtractPayload {
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

function countMarkdownImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
}

function escapeHeadingText(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");
}

function ensureMarkdownTitle(markdown: string, title: string): string {
  const cleanTitle = escapeHeadingText(title);
  if (!cleanTitle) return markdown;

  const trimmedStart = markdown.trimStart();
  const firstLine = trimmedStart.split(/\r?\n/, 1)[0] || "";
  if (/^#\s+\S/.test(firstLine)) return markdown;

  return `# ${cleanTitle}\n\n${markdown.trimStart()}`;
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
  return { ok: true };
}

export async function importWebClip() {
  if (!isTauri()) {
    setStatus("仅支持在桌面客户端内使用网页提取功能", "idle");
    return;
  }

  setStatus("请在提取窗口中输入网址", "idle");
  const startedAt = performance.now();
  console.info("[web-clip] extraction dialog requested");

  const unlistenRaw = await listen<ExtractPayload>("web_clip_raw_extracted", async (event) => {
    const payload = event.payload;
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
      console.error("Extraction failed:", payload.error);
      setStatus("提取失败: " + (payload.error || "未知错误"), "idle");
      await emit("web_clip_preview_failed", { error: payload.error || "未知错误" });
      return;
    }

    setStatus("大模型正在格式化", "loading");
    console.info("[web-clip] extractor finished", {
      elapsedMs: Math.round(performance.now() - startedAt),
      contentChars: payload.content.length,
      imageCount: payload.images?.length ?? 0,
    });

    try {
      // Convert HTML to Markdown
      const turndownService = new TurndownService({
        headingStyle: "atx",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
      });
      turndownService.use(gfm);
      
      let markdown = turndownService.turndown(payload.content);
      const title = payload.title || "Untitled Web Clip";
      markdown = ensureMarkdownTitle(markdown, title);
      let images = payload.images || [];
      console.debug("[web-clip] turndown finished", {
        markdownChars: markdown.length,
        imageRefs: countMarkdownImages(markdown),
      });

      if (images.length > 0) {
        setStatus("正在本地化图片...", "loading");
        const imageStartedAt = performance.now();
        const localized = await invoke<WebClipImageLocalization>("localize_web_clip_images", {
          markdown,
          images,
        });
        markdown = localized.markdown;
        images = localized.images;
        console.info("[web-clip] image localization finished", {
          elapsedMs: Math.round(performance.now() - imageStartedAt),
          localizedCount: localized.localizedCount,
          imageCount: images.length,
          imageRefs: countMarkdownImages(markdown),
        });
      }

      // Check if LLM refinement is enabled
      const settings = await loadAppSettings();
      const webClipConfig = settings.webClip;

      if (webClipConfig && webClipConfig.llmEnabled) {
        setStatus("正在使用大模型智能排版...", "loading");
        try {
          const llmStartedAt = performance.now();
          const cred = settings.ai.providers[webClipConfig.provider];
          console.info("[web-clip] LLM refinement started", {
            provider: webClipConfig.provider,
            model: cred?.model || "",
            markdownChars: markdown.length,
            imageRefs: countMarkdownImages(markdown),
          });
          const rawMarkdown = markdown;
          const refined = await invoke<string>("refine_markdown", { 
            markdown, 
            provider: webClipConfig.provider 
          });
          const guard = shouldAcceptRefinedMarkdown(rawMarkdown, refined);
          if (!guard.ok) {
            console.warn("[web-clip] LLM refinement rejected, using raw markdown:", guard.reason);
            setStatus("智能排版结果异常，使用原始提取...", "warn");
          } else {
            markdown = ensureMarkdownTitle(refined, title);
          }
          console.info("[web-clip] LLM refinement finished", {
            elapsedMs: Math.round(performance.now() - llmStartedAt),
            markdownChars: markdown.length,
            imageRefs: countMarkdownImages(markdown),
            accepted: guard.ok,
          });
        } catch (llmError: any) {
          console.error("LLM refinement failed, falling back to raw markdown:", llmError);
          setStatus("智能排版失败，使用原始提取...", "warn");
        }
      }
      
      // Create an unsaved draft. The backend keeps a temporary resource package
      // only so asset:// images can render before the user chooses a save path.
      const saveStartedAt = performance.now();
      const doc = await invoke<AimdDocument>("save_web_clip", {
        title: title,
        markdown: markdown,
        images,
      });
      console.info("[web-clip] save_web_clip finished", {
        elapsedMs: Math.round(performance.now() - saveStartedAt),
        markdownChars: markdown.length,
        imageCount: images.length,
      });

      setStatus("就绪", "idle");
      console.info("[web-clip] opened web clip draft", {
        elapsedMs: Math.round(performance.now() - startedAt),
        title: doc.title,
        hasDraftSource: Boolean(doc.draftSourcePath),
      });
      await emit("web_clip_preview_ready", {
        ...doc,
        path: "",
        isDraft: true,
        dirty: true,
        format: "aimd",
      });
      setStatus("等待用户确认提取结果", "info");

    } catch (e: any) {
      console.error("Packing failed:", e);
      setStatus("打包失败", "idle");
      await emit("web_clip_preview_failed", { error: e?.message || String(e) });
    }
  });

  const unlistenAccept = await listen<AimdDocument>("web_clip_accept", (event) => {
    unlistenRaw();
    unlistenAccept();
    const doc = event.payload;
    applyDocument({ ...doc, path: "", isDraft: true, dirty: true, format: "aimd" }, "read");
    setStatus("已创建未保存草稿，点击保存后选择位置", "info");
  });

  try {
    await invoke("start_url_extraction");
  } catch (e: any) {
    unlistenRaw();
    unlistenAccept();
    console.error("Failed to start extraction:", e);
    setStatus("启动提取器失败", "idle");
  }
}
