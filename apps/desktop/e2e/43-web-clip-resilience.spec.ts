import { test, expect, Page } from "@playwright/test";

type RawPayload = {
  success: boolean;
  title?: string;
  content?: string;
  images?: Array<{ url: string; data: number[]; proxyUrl?: string; originalUrl?: string }>;
  error?: string;
  diagnostics?: Array<{ level: "debug" | "info" | "warn" | "error"; message: string; data?: unknown }>;
};

async function installWebClipMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, any> | undefined;
    type Listener = (event: { event: string; payload: any; id: number }) => unknown;

    const listeners = new Map<string, Listener[]>();
    let nextEventId = 1;
    const runtime = {
      autoDispatch: true,
      nextExtraction: {
        success: true,
        title: "Web Clip",
        content: [
          "<h1>Web Clip</h1>",
          "<p>Alpha paragraph with enough text for a clean article draft.</p>",
          "<p>Beta paragraph with more article body.</p>",
        ].join(""),
        images: [],
        diagnostics: [{ level: "info", message: "ok" }],
      } as RawPayload,
      settings: {
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen", apiKey: "", apiBase: "" },
            gemini: { model: "gemini", apiKey: "", apiBase: "" },
          },
        },
        webClip: { llmEnabled: false, provider: "dashscope" },
      },
      refineResponses: [] as string[],
      refineHangs: false,
      startCalls: [] as Array<Record<string, unknown>>,
      closeCalls: [] as Array<Record<string, unknown>>,
      showCalls: [] as Array<Record<string, unknown>>,
      openDraftCalls: [] as Array<Record<string, unknown>>,
      progressCalls: [] as Array<Record<string, unknown>>,
      saveCalls: [] as Array<Record<string, unknown>>,
      localizeCalls: [] as Array<Record<string, unknown>>,
      refineCalls: [] as Array<Record<string, unknown>>,
      prefetchCalls: [] as Array<Record<string, unknown>>,
      deleteDrafts: [] as string[],
      proxyCache: {} as Record<string, number[]>,
      previewEvents: 0,
      clipboardReadCount: 0,
    };

    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => {
            runtime.clipboardReadCount += 1;
            return "https://clipboard.example/article";
          },
        },
      });
    } catch {}

    const convertFileSrc = (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`;

    const dispatch = async (event: string, payload: any) => {
      if (event === "web_clip_preview_ready") runtime.previewEvents += 1;
      const eventListeners = [...(listeners.get(event) || [])];
      for (const handler of eventListeners) {
        await handler({ event, payload, id: nextEventId++ });
      }
    };

    const renderFromMarkdown = (markdown: string) => {
      const html = markdown
        .split(/\n+/)
        .map((line) => {
          if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
          if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
          if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
          if (line.startsWith("> ")) return `<blockquote>${line.slice(2)}</blockquote>`;
          if (line.trim()) return `<p>${line}</p>`;
          return "";
        })
        .join("");
      return { html };
    };

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      load_settings: () => runtime.settings,
      start_url_extraction: (a) => {
        const call = { ...((a || {}) as Record<string, unknown>) };
        runtime.startCalls.push(call);
        if (runtime.autoDispatch) {
          setTimeout(() => {
            void dispatch("web_clip_raw_extracted", {
              requestId: call.requestId,
              ...runtime.nextExtraction,
            });
          }, 0);
        }
        return null;
      },
      web_clip_progress: (a) => {
        runtime.progressCalls.push({ ...((a?.payload || {}) as Record<string, unknown>) });
        return null;
      },
      close_extractor_window: (a) => {
        runtime.closeCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return null;
      },
      show_extractor_window: (a) => {
        runtime.showCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return null;
      },
      configure_web_clip_image_proxy: () => null,
      prefetch_web_clip_image_proxy: (a) => {
        const call = { ...((a || {}) as Record<string, unknown>) };
        runtime.prefetchCalls.push(call);
        const url = String(call.url || "");
        const cached = runtime.proxyCache[url];
        if (cached?.length) return { url, ok: true, bytes: cached.length, mime: "image/png", error: null };
        return { url, ok: false, bytes: 0, mime: null, error: "mock cache miss" };
      },
      clear_web_clip_image_proxy: () => null,
      open_draft_in_new_window: (a) => {
        runtime.openDraftCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return null;
      },
      localize_web_clip_images: (a) => {
        runtime.localizeCalls.push({ ...((a || {}) as Record<string, unknown>) });
        let markdown = String(a?.markdown ?? "");
        let localizedCount = 0;
        const images = ((a?.images ?? []) as Array<{ url: string; data: number[]; proxyUrl?: string; originalUrl?: string }>).map((img, index) => {
          const cached = runtime.proxyCache[img.originalUrl || img.url] || (img.proxyUrl ? runtime.proxyCache[img.proxyUrl] : undefined);
          if (!cached?.length) {
            if (img.proxyUrl) markdown = markdown.split(img.proxyUrl).join(img.originalUrl || img.url);
            return img;
          }
          const asset = `asset://proxy-${index + 1}`;
          for (const value of [img.url, img.originalUrl, img.proxyUrl]) {
            if (value) markdown = markdown.split(value).join(asset);
          }
          localizedCount += 1;
          return { ...img, data: cached };
        });
        return { markdown, images, localizedCount };
      },
      refine_markdown: (a) => {
        runtime.refineCalls.push({ ...((a || {}) as Record<string, unknown>) });
        if (runtime.refineHangs) return new Promise(() => {});
        return runtime.refineResponses.shift() || String(a?.markdown ?? "");
      },
      save_web_clip: (a) => {
        runtime.saveCalls.push({ ...((a || {}) as Record<string, unknown>) });
        const markdown = String(a?.markdown ?? "");
        return {
          path: "/tmp/webclip-draft.aimd",
          draftSourcePath: "/tmp/webclip-draft.aimd",
          title: String(a?.title ?? "Web Clip"),
          markdown,
          html: renderFromMarkdown(markdown).html,
          assets: [],
          dirty: true,
          isDraft: true,
          format: "aimd",
        };
      },
      render_markdown: (a) => renderFromMarkdown(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => renderFromMarkdown(String(a?.markdown ?? "")),
      delete_draft_file: (a) => {
        runtime.deleteDrafts.push(String(a?.path ?? ""));
        return null;
      },
    };

    (window as any).__aimdWebClipMock = {
      emit: dispatch,
      setNextExtraction: (payload: RawPayload) => { runtime.nextExtraction = payload; },
      setAutoDispatch: (value: boolean) => { runtime.autoDispatch = value; },
      setProxyCache: (cache: Record<string, number[]>) => { runtime.proxyCache = cache; },
      enableLlm: (responses: string[]) => {
        runtime.settings.webClip.llmEnabled = true;
        runtime.refineResponses = [...responses];
        runtime.refineHangs = false;
      },
      disableLlm: () => { runtime.settings.webClip.llmEnabled = false; },
      hangRefine: () => {
        runtime.settings.webClip.llmEnabled = true;
        runtime.refineHangs = true;
      },
      stats: () => runtime,
    };
    (window as any).isTauri = true;

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        if (cmd === "plugin:event|listen") {
          const event = String(a?.event);
          const handler = a?.handler as Listener;
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(handler);
          return handler;
        }
        if (cmd === "plugin:event|emit") {
          await dispatch(String(a?.event), a?.payload);
          return null;
        }
        if (cmd === "plugin:event|unlisten") {
          const event = String(a?.event);
          const handler = a?.eventId as Listener;
          const eventListeners = listeners.get(event) || [];
          const index = eventListeners.indexOf(handler);
          if (index >= 0) eventListeners.splice(index, 1);
          return null;
        }
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI__ = {
      core: { convertFileSrc },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  });
}

async function submitWebImport(page: Page, url = "https://example.com/article") {
  await page.locator("#empty-import-web").click();
  await expect(page.locator("#web-clip-panel")).toBeVisible();
  await page.locator("#web-clip-url").fill(url);
  await page.locator("#web-clip-submit").click();
}

test.describe("Web Clip background import", () => {
  test("opening the URL panel does not read clipboard or trigger paste permission UI", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");

    await page.locator("#empty-import-web").click();

    await expect(page.locator("#web-clip-panel")).toBeVisible();
    await expect(page.locator("#web-clip-url")).toHaveValue("");
    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.clipboardReadCount).toBe(0);
    expect(stats.startCalls).toHaveLength(0);
  });

  test("URL submit creates a draft in the background without preview confirmation", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");

    await submitWebImport(page);

    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#save")).toBeDisabled();
    await expect(page.locator("#status")).toContainText("网页草稿已在新窗口打开");

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.startCalls).toHaveLength(1);
    expect(stats.startCalls[0]).toMatchObject({
      url: "https://example.com/article",
      visible: false,
      auto: true,
    });
    expect(String(stats.startCalls[0].requestId)).toMatch(/^webclip-|[0-9a-f-]{36}/);
    expect(stats.previewEvents).toBe(0);
    expect(stats.openDraftCalls).toEqual([{ path: "/tmp/webclip-draft.aimd" }]);
    expect(stats.saveCalls[0].markdown).not.toContain("> **摘要**");
    expect(stats.saveCalls[0].markdown).toContain("## 正文");
  });

  test("image proxy cache localizes successful images and keeps failed ones remote", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.setAutoDispatch(false));

    await submitWebImport(page, "https://example.com/proxy-images");

    const requestId = await page.evaluate(() => String((window as any).__aimdWebClipMock.stats().startCalls[0].requestId));
    const okUrl = "https://cdn.example.com/ok.png";
    const failedUrl = "https://cdn.example.com/missing.png";
    const okProxy = `aimd-image-proxy://localhost/${requestId}/image?u=${encodeURIComponent(okUrl)}`;
    const failedProxy = `aimd-image-proxy://localhost/${requestId}/image?u=${encodeURIComponent(failedUrl)}`;
    await page.evaluate((cache) => (window as any).__aimdWebClipMock.setProxyCache(cache), {
      [okUrl]: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    });
    await page.evaluate(({ id, okUrl, failedUrl, okProxy, failedProxy }) => {
      void (window as any).__aimdWebClipMock.emit("web_clip_raw_extracted", {
        requestId: id,
        success: true,
        title: "Proxy Images",
        content: [
          "<h1>Proxy Images</h1>",
          "<p>Article body text with enough content for the import flow.</p>",
          `<p><img src="${okProxy}" alt="ok"><img src="${failedProxy}" alt="failed"></p>`,
        ].join(""),
        images: [
          { url: okUrl, originalUrl: okUrl, proxyUrl: okProxy, data: [] },
          { url: failedUrl, originalUrl: failedUrl, proxyUrl: failedProxy, data: [] },
        ],
        diagnostics: [],
      });
    }, { id: requestId, okUrl, failedUrl, okProxy, failedProxy });

    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls.length)).toBe(1);
    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.localizeCalls[0].requestId).toBe(requestId);
    expect(stats.localizeCalls[0].images).toHaveLength(2);
    expect(stats.saveCalls[0].markdown).toContain("asset://proxy-1");
    expect(stats.saveCalls[0].markdown).not.toContain(okProxy);
    expect(stats.saveCalls[0].markdown).not.toContain(okUrl);
    expect(stats.saveCalls[0].markdown).toContain(failedUrl);
    expect(stats.saveCalls[0].markdown).not.toContain(failedProxy);
  });

  test("LLM disabled does not generate summary or smart-layout status text", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");

    await submitWebImport(page, "https://example.com/no-llm");
    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls.length)).toBe(1);

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(0);
    expect(stats.saveCalls[0].markdown).not.toContain("> **摘要**");
    expect(await page.locator("#status").textContent()).not.toContain("智能排版");
  });

  test("LLM enabled keeps summary, core points, full body, and H2/H3 hierarchy", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.enableLlm([
      [
        "# Web Clip",
        "",
        "> **摘要**",
        "> 这是一段来自原文的摘要。",
        "",
        "> **核心观点**",
        "> - 第一条观点来自原文。",
        "> - 第二条观点来自原文。",
        "",
        "## 第一部分",
        "",
        "这是一段完整正文，包含足够多的正文信息用于通过结构检查，并且不是摘要替代正文。",
        "",
        "### 关键细节",
        "",
        "这里继续保留正文细节，说明原文中的关键内容和上下文，避免只剩要点。",
        "",
        "## 第二部分",
        "",
        "另一段正文继续展开原文内容，确保长文收藏时有多个可扫描章节。",
      ].join("\n"),
    ]));

    await submitWebImport(page, "https://example.com/llm");

    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().openDraftCalls.length)).toBe(1);
    const markdown = await page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls[0].markdown);
    expect(markdown).toContain("> **摘要**");
    expect(markdown).toContain("> **核心观点**");
    expect(markdown).toContain("## 第一部分");
    expect(markdown).toContain("### 关键细节");
  });

  test("short LLM output can skip H2 sections without triggering a retry", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.enableLlm([
      [
        "# Short Clip",
        "",
        "> **摘要**",
        "> 这是一篇短新闻，概述了产品融资评估和业务进展。",
        "",
        "> **核心观点**",
        "> - 公司正在评估外部融资方案。",
        "> - 相关业务仍保持原有运营节奏。",
        "",
        "短新闻正文第一段，保留原文中的主要事实、背景、回应和上下文，说明事件的基本情况。",
        "",
        "短新闻正文第二段，继续保留关键细节、公司说法和相关业务进展，不额外强行拆分章节。",
      ].join("\n"),
    ]));

    await submitWebImport(page, "https://example.com/short-no-h2");

    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().openDraftCalls.length)).toBe(1);
    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(1);
    expect(stats.saveCalls[0].markdown).toContain("> **摘要**");
    expect(stats.saveCalls[0].markdown).toContain("短新闻正文第二段");
  });

  test("LLM timeout falls back to the basic extraction instead of blocking the draft", async ({ page }) => {
    await installWebClipMock(page);
    await page.addInitScript(() => {
      (window as any).__aimdWebClipRefineTimeoutMs = 20;
    });
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.hangRefine());

    await submitWebImport(page, "https://example.com/llm-timeout");

    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().openDraftCalls.length)).toBe(1);
    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(1);
    expect(stats.saveCalls[0].markdown).toContain("> **未完成智能分章**");
    expect(stats.saveCalls[0].markdown).toContain("## 正文");
    expect(await page.locator("#status").textContent()).not.toContain("正在智能排版");
  });

  test("invalid LLM heading structure retries once before accepting output", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.enableLlm([
      [
        "# Web Clip",
        "",
        "> **摘要**",
        "> 摘要。",
        "",
        "> **核心观点**",
        "> - 观点。",
        "",
        "### 跳级标题",
        "",
        "这段正文足够长，能够避开正文过短检查，但标题从 H1 直接跳到了 H3，应该触发重试。这里继续补充原文内容、上下文、细节和说明，使正文长度超过最低要求。原文还包含更多说明、更多段落、更多细节、更多证据、更多上下文、更多可读信息、更多收藏价值和更多结构化内容。",
      ].join("\n"),
      [
        "# Web Clip",
        "",
        "> **摘要**",
        "> 摘要。",
        "",
        "> **核心观点**",
        "> - 观点。",
        "",
        "## 合理章节",
        "",
        "重试后保留完整正文，并使用 H2 作为主要章节标题。这里继续补充原文中的上下文、细节、段落信息和收藏价值，避免只剩摘要。",
        "",
        "### 章节细节",
        "",
        "这里是正文细节，继续保持层级结构，并把相关说明放在对应章节下。",
      ].join("\n"),
    ]));

    await submitWebImport(page, "https://example.com/retry");
    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls.length)).toBe(1);

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(2);
    expect(String(stats.refineCalls[1].guardReason)).toContain("标题层级跳跃");
    expect(stats.saveCalls[0].markdown).toContain("## 合理章节");
    expect(stats.saveCalls[0].markdown).toContain("### 章节细节");
  });

  test("LLM retry preserves source lead-in before the first source H2", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    const lead = [
      "Amazon Nova Forge introduces a way for customers to build frontier models using Nova training techniques, proprietary data, and checkpoints while preserving important product context.",
      "The article explains how teams can combine their own domain data with managed training workflows, evaluate checkpoints, and keep the resulting model aligned with their use case.",
      "This lead-in defines the product, the customer problem, and the workflow before the article moves into concrete use cases and applications.",
    ].map((text) => `<p>${text}</p>`).join("");
    const useCases = Array.from({ length: 12 }, (_, index) =>
      `<p>Use case paragraph ${index + 1} describes applications, evaluation details, deployment considerations, and model customization context.</p>`,
    ).join("");
    await page.evaluate(({ lead, useCases }) => (window as any).__aimdWebClipMock.setNextExtraction({
      success: true,
      title: "Nova Forge",
      content: `<h1>Nova Forge</h1>${lead}<h2>Use cases and applications</h2>${useCases}`,
      images: [],
      diagnostics: [],
    }), { lead, useCases });
    await page.evaluate(() => {
      const useCaseBody = Array.from({ length: 12 }, (_, index) =>
        `Use case paragraph ${index + 1} describes applications, evaluation details, deployment considerations, and model customization context.`,
      ).join("\n\n");
      (window as any).__aimdWebClipMock.enableLlm([
        [
          "# Nova Forge",
          "",
          "> **摘要**",
          "> Nova Forge helps customers build frontier models with Nova.",
          "",
          "> **核心观点**",
          "> - Customers can customize models.",
          "",
          "## Use cases and applications",
          "",
          useCaseBody,
        ].join("\n"),
        [
          "# Nova Forge",
          "",
          "> **摘要**",
          "> Nova Forge helps customers build frontier models with Nova while using their own data and checkpoints.",
          "",
          "> **核心观点**",
          "> - Customers can customize models.",
          "",
          "## What Nova Forge provides",
          "",
          "Amazon Nova Forge introduces a way for customers to build frontier models using Nova training techniques, proprietary data, and checkpoints while preserving important product context.",
          "",
          "The article explains how teams can combine their own domain data with managed training workflows, evaluate checkpoints, and keep the resulting model aligned with their use case.",
          "",
          "This lead-in defines the product, the customer problem, and the workflow before the article moves into concrete use cases and applications.",
          "",
          "## Use cases and applications",
          "",
          useCaseBody,
        ].join("\n"),
      ]);
    });

    await submitWebImport(page, "https://example.com/lead-before-h2");
    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls.length)).toBe(1);

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(2);
    expect(String(stats.refineCalls[1].guardReason)).toContain("导语正文被删除");
    expect(stats.saveCalls[0].markdown).toContain("## What Nova Forge provides");
    expect(stats.saveCalls[0].markdown).toContain("This lead-in defines the product");
    expect(stats.saveCalls[0].markdown).toContain("## Use cases and applications");
  });

  test("long LLM output must retry until it contains multiple H2 sections", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    const longBody = Array.from({ length: 80 }, (_, index) => `<p>Long paragraph ${index + 1} with article body, context, evidence, and details.</p>`).join("");
    await page.evaluate((content) => (window as any).__aimdWebClipMock.setNextExtraction({
      success: true,
      title: "Long Web Clip",
      content: `<h1>Long Web Clip</h1>${content}`,
      images: [],
      diagnostics: [],
    }), longBody);
    await page.evaluate(() => {
      const oneH2Body = Array.from({ length: 72 }, (_, index) =>
        `长文正文第 ${index + 1} 段，保留原文内容、上下文、证据、细节、段落信息、关键说明和可读内容。`,
      ).join("\n\n");
      const firstH2Body = Array.from({ length: 72 }, (_, index) =>
        `第一章节正文第 ${index + 1} 段，保留原文内容、上下文、证据和细节。`,
      ).join("\n\n");
      const secondH2Body = Array.from({ length: 72 }, (_, index) =>
        `第二章节正文第 ${index + 1} 段，继续保留完整内容，并形成可扫描的章节。`,
      ).join("\n\n");
      (window as any).__aimdWebClipMock.enableLlm([
      [
        "# Long Web Clip",
        "",
        "> **摘要**",
        "> 摘要。",
        "",
        "> **核心观点**",
        "> - 观点。",
        "",
        "## 唯一章节",
        "",
        oneH2Body,
      ].join("\n"),
      [
        "# Long Web Clip",
        "",
        "> **摘要**",
        "> 摘要。",
        "",
        "> **核心观点**",
        "> - 观点。",
        "",
        "## 第一章节",
        "",
        firstH2Body,
        "",
        "## 第二章节",
        "",
        secondH2Body,
      ].join("\n"),
      ]);
    });

    await submitWebImport(page, "https://example.com/long");
    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCalls.length)).toBe(1);

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.refineCalls).toHaveLength(2);
    expect(String(stats.refineCalls[1].guardReason)).toContain("长文需要多个 H2");
    expect(stats.saveCalls[0].markdown).toContain("## 第一章节");
    expect(stats.saveCalls[0].markdown).toContain("## 第二章节");
  });

  test("failure stays in the panel and fallback opens the extractor window", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.setNextExtraction({
      success: false,
      error: "网络失败",
      diagnostics: [{ level: "error", message: "fetch failed" }],
    }));

    await submitWebImport(page, "https://example.com/fail");

    await expect(page.locator("#status")).toContainText("提取失败");
    await expect(page.locator("#web-clip-panel")).toBeVisible();
    await expect(page.locator("#web-clip-error")).toContainText("网络失败");
    await expect(page.locator("#web-clip-fallback")).toBeVisible();
    await page.evaluate(() => (window as any).__aimdWebClipMock.setNextExtraction({
      success: false,
      error: "需要登录",
      diagnostics: [],
    }));
    await page.locator("#web-clip-fallback").click();

    const stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.startCalls.at(-1)).toMatchObject({
      url: "https://example.com/fail",
      visible: true,
      auto: false,
    });
  });

  test("repeat click reuses the running task and ignores stale events", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.setAutoDispatch(false));

    await submitWebImport(page, "https://example.com/slow");
    await page.locator("#empty-import-web").click();
    await expect(page.locator("#web-clip-panel")).toBeVisible();
    await expect(page.locator("#web-clip-message")).toContainText("后台运行");

    let stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.startCalls).toHaveLength(1);
    await page.evaluate(() => (window as any).__aimdWebClipMock.emit("web_clip_raw_extracted", {
      requestId: "stale-request",
      success: true,
      title: "Stale",
      content: "<h1>Stale</h1><p>ignored</p>",
      images: [],
      diagnostics: [],
    }));
    stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.saveCalls).toHaveLength(0);
    await page.evaluate(() => (window as any).__aimdWebClipMock.emit("web_clip_closed", {
      requestId: "stale-request",
    }));
    await expect(page.locator("#web-clip-message")).toContainText("后台运行");

    const requestId = String(stats.startCalls[0].requestId);
    await page.evaluate((id) => (window as any).__aimdWebClipMock.emit("web_clip_raw_extracted", {
      requestId: id,
      success: true,
      title: "Current",
      content: "<h1>Current</h1><p>accepted body text with enough content.</p>",
      images: [],
      diagnostics: [],
    }), requestId);

    stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.saveCalls).toHaveLength(1);
    expect(stats.openDraftCalls).toEqual([{ path: "/tmp/webclip-draft.aimd" }]);
  });

  test("status pill reveals the active extractor window while background import is running", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");
    await page.evaluate(() => (window as any).__aimdWebClipMock.setAutoDispatch(false));

    await submitWebImport(page, "https://example.com/slow-visible");
    await expect(page.locator("#status-pill")).toHaveAttribute("data-action", "web-clip-worker");
    await page.locator("#status-pill").click();

    let stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    const requestId = String(stats.startCalls[0].requestId);
    expect(stats.showCalls).toEqual([{ requestId }]);

    await page.evaluate((id) => (window as any).__aimdWebClipMock.emit("web_clip_raw_extracted", {
      requestId: id,
      success: true,
      title: "Done",
      content: "<h1>Done</h1><p>accepted body text with enough content.</p>",
      images: [],
      diagnostics: [],
    }), requestId);

    await expect.poll(() => page.evaluate(() => (window as any).__aimdWebClipMock.stats().openDraftCalls.length)).toBe(1);
    await expect(page.locator("#status-pill")).not.toHaveAttribute("data-action", "web-clip-worker");
    await page.locator("#status-pill").click();
    stats = await page.evaluate(() => (window as any).__aimdWebClipMock.stats());
    expect(stats.showCalls).toHaveLength(1);
  });
});
