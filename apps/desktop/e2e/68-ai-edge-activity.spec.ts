import { expect, test, Page } from "@playwright/test";

type Args = Record<string, any> | undefined;
type Listener = (event: { event: string; payload: any; id: number }) => unknown;

async function installAiActivityMock(page: Page) {
  await page.addInitScript(() => {
    const doc = {
      path: "/mock/ai-edge.aimd",
      title: "AI Edge",
      markdown: "# AI Edge\n\nAlpha paragraph with enough content for formatting.\n",
      html: "<h1>AI Edge</h1><p>Alpha paragraph with enough content for formatting.</p>",
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const listeners = new Map<string, Listener[]>();
    let nextEventId = 1;
    let resolveFormat: ((value: unknown) => void) | null = null;
    const runtime = {
      startCalls: [] as Array<Record<string, unknown>>,
      formatCalls: [] as Array<Record<string, unknown>>,
      settings: {
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen", apiKey: "", apiBase: "" },
            gemini: { model: "gemini", apiKey: "", apiBase: "" },
          },
        },
        webClip: {
          llmEnabled: false,
          provider: "dashscope",
          model: "qwen-webclip",
          outputLanguage: "zh-CN",
          modelTimeoutSeconds: 300,
          modelRetryCount: 2,
        },
        format: {
          provider: "dashscope",
          model: "qwen-format",
          outputLanguage: "zh-CN",
          modelTimeoutSeconds: 300,
          modelRetryCount: 2,
        },
        ui: { debugMode: false, theme: "system" },
      },
    };

    const dispatch = async (event: string, payload: any) => {
      const eventListeners = [...(listeners.get(event) || [])];
      for (const handler of eventListeners) {
        await handler({ event, payload, id: nextEventId++ });
      }
    };
    const renderFromMarkdown = (markdown: string) => ({
      html: markdown
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\n+/g, "<br>"),
    });
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_draft_path: () => null,
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      load_settings: () => runtime.settings,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      render_markdown: (a) => renderFromMarkdown(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => renderFromMarkdown(String(a?.markdown ?? "")),
      list_aimd_assets: () => [],
      format_markdown: (a) => {
        runtime.formatCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return new Promise((resolve) => {
          resolveFormat = resolve;
        });
      },
      start_url_extraction: (a) => {
        runtime.startCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return null;
      },
      clear_web_clip_image_proxy: () => null,
      close_extractor_window: () => null,
      localize_web_clip_images: (a) => ({ markdown: String(a?.markdown ?? ""), images: a?.images ?? [], localizedCount: 0 }),
      save_web_clip: (a) => ({
        path: "/tmp/ai-edge-webclip.aimd",
        draftSourcePath: "/tmp/ai-edge-webclip.aimd",
        title: String(a?.title ?? "Web Clip"),
        markdown: String(a?.markdown ?? ""),
        html: renderFromMarkdown(String(a?.markdown ?? "")).html,
        assets: [],
        dirty: true,
        isDraft: true,
        format: "aimd",
      }),
      open_draft_in_new_window: () => null,
      delete_draft_file: () => null,
    };

    (window as any).__aimdAiActivityMock = {
      emit: dispatch,
      resolveFormat: (value: unknown) => resolveFormat?.(value),
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
        if (cmd === "plugin:event|unlisten") return null;
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc: (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
}

async function expectActiveAiEdge(page: Page, expectedActivity: string) {
  await expect(page.locator(".app-frame")).toHaveAttribute("data-ai-activity", expectedActivity);
  await expect(page.locator("#ai-edge-flow")).toBeVisible();
  await expect.poll(async () => page.locator("#ai-edge-flow").evaluate((edge) => Number(getComputedStyle(edge).opacity)))
    .toBeGreaterThan(0.9);
  const metrics = await page.locator("#ai-edge-flow").evaluate((edge) => {
    const frame = document.querySelector<HTMLElement>(".app-frame")!;
    const panel = document.querySelector<HTMLElement>("#panel")!;
    const edgeRect = edge.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const edgeStyle = getComputedStyle(edge);
    const beforeStyle = getComputedStyle(edge, "::before");
    return {
      edgeInsetTop: Math.round(edgeRect.top - frameRect.top),
      edgeInsetLeft: Math.round(edgeRect.left - frameRect.left),
      edgeOutsetToPanelTop: Math.round(panelRect.top - edgeRect.top),
      edgeOutsetToPanelLeft: Math.round(panelRect.left - edgeRect.left),
      panelInsetTop: Math.round(panelRect.top - frameRect.top),
      panelInsetLeft: Math.round(panelRect.left - frameRect.left),
      radius: edgeStyle.borderTopLeftRadius,
      opacity: Number(edgeStyle.opacity),
      pointerEvents: edgeStyle.pointerEvents,
      zIndex: edgeStyle.zIndex,
      overflow: edgeStyle.overflow,
      animationName: beforeStyle.animationName,
      animationDuration: beforeStyle.animationDuration,
      filter: beforeStyle.filter,
      innerRingRadius: getComputedStyle(edge, "::after").borderTopLeftRadius,
    };
  });
  expect(metrics.edgeInsetTop).toBe(11);
  expect(metrics.edgeInsetLeft).toBe(11);
  expect(metrics.edgeOutsetToPanelTop).toBe(5);
  expect(metrics.edgeOutsetToPanelLeft).toBe(5);
  expect(metrics.panelInsetTop).toBe(16);
  expect(metrics.panelInsetLeft).toBe(16);
  expect(metrics.radius).toBe("25px");
  expect(metrics.opacity).toBeGreaterThan(0.9);
  expect(metrics.pointerEvents).toBe("none");
  expect(metrics.zIndex).toBe("0");
  expect(metrics.overflow).toBe("hidden");
  expect(metrics.animationName).toContain("ai-edge-flow-orbit");
  expect(metrics.animationDuration).toBe("1.5s");
  expect(metrics.filter).toContain("blur");
}

test.describe("AI edge activity effect", () => {
  test("one-click format drives the outer edge effect while the model request is pending", async ({ page }) => {
    await installAiActivityMock(page);
    await page.goto("/");
    await expect(page.locator("#ai-edge-flow")).toBeHidden();

    await page.locator("#empty-open").click();
    await page.locator("#more-menu-toggle").click();
    await page.locator("#format-document").click();

    await expectActiveAiEdge(page, "format");
    await page.evaluate(() => (window as any).__aimdAiActivityMock.resolveFormat({ needed: false, reason: "clean" }));
    await expect(page.locator(".app-frame")).not.toHaveAttribute("data-ai-activity", /.+/);
    await expect(page.locator("#ai-edge-flow")).toBeHidden();
  });

  test("web extraction keeps the outer edge effect active until the import task finishes", async ({ page }) => {
    await installAiActivityMock(page);
    await page.goto("/");

    await page.locator("#empty-import-web").click();
    await page.locator("#web-clip-url").fill("https://example.com/article");
    await page.locator("#web-clip-submit").click();

    await expectActiveAiEdge(page, "web-clip");
    const requestId = await page.evaluate(() => String((window as any).__aimdAiActivityMock.stats().startCalls[0].requestId));
    await page.evaluate((id) => {
      void (window as any).__aimdAiActivityMock.emit("web_clip_raw_extracted", {
        requestId: id,
        success: true,
        title: "AI Edge Web Clip",
        content: "<h1>AI Edge Web Clip</h1><p>Article body.</p>",
        images: [],
      });
    }, requestId);
    await expect(page.locator("#status")).toContainText("网页草稿已在新窗口打开");
    await expect(page.locator(".app-frame")).not.toHaveAttribute("data-ai-activity", /.+/);
    await expect(page.locator("#ai-edge-flow")).toBeHidden();
  });
});
