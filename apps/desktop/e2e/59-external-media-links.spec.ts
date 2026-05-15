import { test, expect, Page } from "@playwright/test";

const DOC = {
  path: "/mock/external-media.aimd",
  title: "External media links",
  markdown: [
    "# External media links",
    "",
    "[![Build](asset://badge-build)](https://example.com/build)",
    "",
    "[Documentation](https://example.com/docs)",
    "",
  ].join("\n"),
  html: [
    "<h1>External media links</h1>",
    '<p><a href="https://example.com/build"><img src="asset://badge-build" alt="Build"></a></p>',
    '<p><a href="https://example.com/docs">Documentation</a></p>',
  ].join(""),
  assets: [],
  dirty: false,
};

async function installTauriMock(page: Page) {
  await page.addInitScript((d: typeof DOC) => {
    type Args = Record<string, unknown> | undefined;
    const openedUrls: string[] = [];
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => d.path,
      choose_doc_file: () => d.path,
      open_aimd: () => d,
      render_markdown: () => ({ html: d.html }),
      render_markdown_standalone: () => ({ html: d.html }),
      list_aimd_assets: () => [],
      open_external_url: (a) => {
        openedUrls.push(String((a as any)?.url ?? ""));
        return null;
      },
    };
    (window as any).__aimdExternalMediaMock = {
      openedUrls: () => openedUrls,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc: (path: string, protocol = "asset") => `${protocol}://localhost${encodeURI(path)}`,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    (window as any).__TAURI__ = {
      ...(window as any).__TAURI__,
      core: { invoke: (cmd: string, a?: Args) => (window as any).__TAURI_INTERNALS__.invoke(cmd, a) },
    };
    (window as any).__aimd_e2e_disable_auto_optimize = true;
  }, DOC);
}

test("image-only external links do not render text-link arrows", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();

  async function expectSurface(root: "#reader" | "#preview" | "#inline-editor", textArrow: boolean) {
    const mediaLink = page.locator(`${root} a[href="https://example.com/build"]`);
    const textLink = page.locator(`${root} a[href="https://example.com/docs"]`);

    await expect(mediaLink).toHaveAttribute("data-external-media-link", "true");
    await expect(mediaLink).not.toHaveAttribute("data-external-link", "true");
    await expect(textLink).toHaveAttribute("data-external-link", "true");

    const styles = await page.evaluate(({ root, textArrow }) => {
      const media = document.querySelector<HTMLAnchorElement>(`${root} a[href="https://example.com/build"]`)!;
      const text = document.querySelector<HTMLAnchorElement>(`${root} a[href="https://example.com/docs"]`)!;
      return {
        mediaAfter: getComputedStyle(media, "::after").content,
        mediaBorder: getComputedStyle(media).borderBottomWidth,
        textAfter: getComputedStyle(text, "::after").content,
        textArrow,
      };
    }, { root, textArrow });

    expect(styles.mediaAfter === "none" || styles.mediaAfter === "normal").toBeTruthy();
    expect(styles.mediaBorder).toBe("0px");
    if (textArrow) expect(styles.textAfter).toContain("↗");
    else expect(styles.textAfter === "none" || styles.textAfter === "normal").toBeTruthy();
  }

  await expectSurface("#reader", true);

  await page.locator('#reader a[href="https://example.com/docs"]').hover();
  await expect(page.locator("#status")).toContainText("按 Ctrl/⌘ 点击打开链接");
  await page.locator("#mode-read").hover();
  await expect(page.locator("#status")).not.toContainText("按 Ctrl/⌘ 点击打开链接");

  await page.locator('#reader a[href="https://example.com/build"] img').click();
  await expect(page.locator("#aimd-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual([]);

  await page.locator('#reader a[href="https://example.com/build"] img').click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual(["https://example.com/build"]);

  await page.locator('#reader a[href="https://example.com/docs"]').click();
  await expect(page.locator("#status")).toContainText("按 Ctrl/⌘ 点击打开链接");
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual(["https://example.com/build"]);

  await page.locator('#reader a[href="https://example.com/docs"]').click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual(["https://example.com/build", "https://example.com/docs"]);

  await page.locator("#mode-source").click();
  await expectSurface("#preview", true);
  await page.locator('#preview a[href="https://example.com/build"] img').click();
  await expect(page.locator("#aimd-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('#preview a[href="https://example.com/build"] img').click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual(["https://example.com/build", "https://example.com/docs", "https://example.com/build"]);

  await page.locator("#mode-edit").click();
  await expectSurface("#inline-editor", false);
  await page.locator('#inline-editor a[href="https://example.com/build"] img').click();
  await expect(page.locator("#aimd-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('#inline-editor a[href="https://example.com/build"] img').click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(page.locator("#aimd-lightbox")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__aimdExternalMediaMock.openedUrls()))
    .toEqual(["https://example.com/build", "https://example.com/docs", "https://example.com/build", "https://example.com/build"]);
});
