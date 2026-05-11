import { test, expect, Page } from "@playwright/test";

async function installWebClipMock(page: Page) {
  await page.addInitScript(() => {
    type Args = Record<string, any> | undefined;
    type Listener = (event: { event: string; payload: any; id: number }) => unknown;

    const listeners = new Map<string, Listener[]>();
    let nextEventId = 1;
    let startCount = 0;
    let saveCount = 0;
    let lastPreview: any = null;
    const deletedDrafts: string[] = [];

    const convertFileSrc = (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`;

    const dispatch = async (event: string, payload: any) => {
      if (event === "web_clip_preview_ready") lastPreview = payload;
      const eventListeners = [...(listeners.get(event) || [])];
      for (const handler of eventListeners) {
        await handler({ event, payload, id: nextEventId++ });
      }
    };

    const renderFromMarkdown = (markdown: string) => ({
      html: [
        markdown.match(/^#\s+(.+)$/m)?.[1]
          ? `<h1>${markdown.match(/^#\s+(.+)$/m)?.[1]}</h1>`
          : "",
        markdown.includes("| A | B |")
          ? "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
          : "",
        markdown.includes("```js")
          ? '<pre><code class="language-js">console.log("clip")</code></pre>'
          : "",
      ].join(""),
    });

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      cleanup_old_drafts: () => null,
      load_settings: () => ({
        ai: {
          activeProvider: "dashscope",
          providers: {
            dashscope: { model: "qwen", apiKey: "", apiBase: "" },
            gemini: { model: "gemini", apiKey: "", apiBase: "" },
          },
        },
        webClip: { llmEnabled: false, provider: "dashscope" },
      }),
      start_url_extraction: () => {
        startCount += 1;
        setTimeout(() => {
          void dispatch("web_clip_raw_extracted", {
            success: false,
            error: "网络失败",
            diagnostics: [{ level: "error", message: "fetch failed" }],
          });
        }, 0);
        return null;
      },
      save_web_clip: (a) => {
        saveCount += 1;
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
        deletedDrafts.push(String(a?.path ?? ""));
        return null;
      },
    };

    (window as any).__aimdWebClipMock = {
      emit: dispatch,
      stats: () => ({ startCount, saveCount, lastPreview, deletedDrafts }),
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

test.describe("Web Clip resilience", () => {
  test("failure can retry without creating stale draft", async ({ page }) => {
    await installWebClipMock(page);
    await page.goto("/");

    await page.locator("#empty-import-web").click();
    await expect(page.locator("#status")).toContainText("提取失败");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#recent-section")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCount)).toBe(0);

    await page.evaluate(() => (window as any).__aimdWebClipMock.emit("web_clip_raw_extracted", {
      success: true,
      title: "Web Clip",
      content: [
        "<h1>Web Clip</h1>",
        "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
        '<pre><code class="language-js">console.log("clip")</code></pre>',
      ].join(""),
      images: [],
      diagnostics: [{ level: "info", message: "retry ok" }],
    }));

    await expect.poll(async () => page.evaluate(() => (window as any).__aimdWebClipMock.stats().saveCount)).toBe(1);
    const preview = await page.evaluate(() => (window as any).__aimdWebClipMock.stats().lastPreview);
    expect(preview.path).toBe("");
    expect(preview.isDraft).toBe(true);
    expect(preview.markdown).toContain("| A | B |");
    expect(preview.markdown).toContain("```js");

    await page.evaluate(() => {
      const previewDoc = (window as any).__aimdWebClipMock.stats().lastPreview;
      return (window as any).__aimdWebClipMock.emit("web_clip_accept", previewDoc);
    });

    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#reader")).toContainText("Web Clip");
    await expect(page.locator("#save")).not.toBeDisabled();
  });
});
