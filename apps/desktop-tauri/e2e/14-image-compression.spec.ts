import { test, expect, Page } from "@playwright/test";

/**
 * Image compression — verifies that pasting a large PNG triggers the
 * compressImageBytes path and the payload sent to add_image_bytes is
 * significantly smaller than the raw input.
 *
 * Strategy:
 *   1. Generate a 3000×3000 noise PNG in the browser (≈ several MB uncompressed).
 *   2. Drive it through the real compressImageBytes + pasteImageFiles flow via
 *      the __aimd_testInsertImageBytes hook exposed at module init.
 *   3. Intercept the add_image_bytes mock to capture the byte count that the
 *      frontend actually sends.
 *   4. Assert the captured size is well below the raw PNG size (compression
 *      threshold is 300 KB; a 3000×3000 PNG will be several MB so the JPEG
 *      re-encode must fire).
 *   5. Assert the resulting <img> in the editor carries an asset:// src, never
 *      a data: URL.
 */

async function installTauriMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/img-test.aimd",
      title: "压缩测试",
      markdown: "# 压缩测试\n\n",
      html: "<h1>压缩测试</h1>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
    addedAsset: {
      asset: {
        id: "pasted-img.jpg",
        path: "assets/pasted-img.jpg",
        mime: "image/jpeg",
        size: 40000,
        sha256: "aabbccdd",
        role: "content-image",
        url: "asset://localhost/mock/assets/pasted-img.jpg",
      },
      uri: "asset://pasted-img.jpg",
      markdown: "![pasted-img.jpg](asset://pasted-img.jpg)",
    },
  };

  await page.addInitScript((s: typeof seed) => {
    (window as any).__capturedImageByteCount = -1;
    (window as any).__capturedImageName = "";

    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_image_file: () => null,
      choose_save_aimd_file: () => s.doc.path,
      open_aimd: () => s.doc,
      create_aimd: () => ({ ...s.doc, isDraft: false }),
      save_aimd: (a) => ({
        ...s.doc,
        markdown: (a as any)?.markdown ?? s.doc.markdown,
        dirty: false,
      }),
      save_aimd_as: (a) => ({
        ...s.doc,
        markdown: (a as any)?.markdown ?? s.doc.markdown,
        dirty: false,
      }),
      render_markdown: () => ({ html: s.doc.html }),
      add_image: () => s.addedAsset,
      add_image_bytes: (a) => {
        const data = (a as any)?.data ?? [];
        (window as any).__capturedImageByteCount = Array.isArray(data) ? data.length : -1;
        (window as any).__capturedImageName = (a as any)?.filename ?? "";
        s.doc.assets = [...s.doc.assets, s.addedAsset.asset];
        return {
          ...s.addedAsset,
          asset: {
            ...s.addedAsset.asset,
            url: convertFileSrc(s.addedAsset.asset.path),
          },
        };
      },
      read_image_bytes: () => [],
      list_aimd_assets: () => [],
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc,
    };
    (window as any).__TAURI__ = {
      ...(window as any).__TAURI__,
      core: {
        ...((window as any).__TAURI__?.core ?? {}),
        convertFileSrc,
      },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}


test.describe("Image compression on paste", () => {
  test("large PNG paste is compressed before reaching add_image_bytes", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.evaluate(async () => {
      const W = 3000;
      const H = 3000;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(W, H);
      const d = imageData.data;
      for (let i = 0; i < d.length; i++) {
        d[i] = Math.floor(Math.random() * 256);
      }
      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      const buf = await blob.arrayBuffer();
      (window as any).__rawImageSize = buf.byteLength;
      await (window as any).__aimd_testInsertImageBytes(buf, "image/png", "test-noise.png", "edit");
    });

    await page.waitForTimeout(500);

    const capturedSize: number = await page.evaluate(() => (window as any).__capturedImageByteCount);
    const rawImageSize: number = await page.evaluate(() => (window as any).__rawImageSize);

    expect(capturedSize).toBeGreaterThan(0);
    expect(rawImageSize).toBeGreaterThan(300 * 1024);
    expect(capturedSize).toBeLessThan(rawImageSize * 0.5);

    const capturedFilename: string = await page.evaluate(() => (window as any).__capturedImageName);
    expect(capturedFilename).toMatch(/\.jpg$/i);
  });

  test("small image below threshold passes through without re-encoding", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.evaluate(async () => {
      const W = 100;
      const H = 100;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, W, H);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      const buf = await blob.arrayBuffer();
      (window as any).__rawImageSize = buf.byteLength;
      await (window as any).__aimd_testInsertImageBytes(buf, "image/png", "small.png", "edit");
    });

    await page.waitForTimeout(500);

    const capturedSize: number = await page.evaluate(() => (window as any).__capturedImageByteCount);
    const rawImageSize: number = await page.evaluate(() => (window as any).__rawImageSize);

    expect(rawImageSize).toBeLessThan(300 * 1024);
    expect(capturedSize).toBeGreaterThan(0);
    expect(capturedSize).toBeLessThanOrEqual(rawImageSize + 100);
  });

  test("inserted image uses asset:// src, never data: URL", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.evaluate(async () => {
      const W = 3000;
      const H = 3000;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#0000ff";
      for (let i = 0; i < 200; i++) {
        ctx.fillRect(
          Math.floor(Math.random() * W),
          Math.floor(Math.random() * H),
          Math.floor(Math.random() * 20) + 2,
          Math.floor(Math.random() * 20) + 2,
        );
      }
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      const buf = await blob.arrayBuffer();
      await (window as any).__aimd_testInsertImageBytes(buf, "image/png", "large-colored.png", "edit");
    });

    await page.waitForTimeout(500);

    const img = page.locator("#inline-editor img");
    await expect(img).toHaveCount(1);

    const src = await img.getAttribute("src");
    expect(src).not.toBeNull();
    expect(src!).not.toMatch(/^data:/i);
    expect(src!).toMatch(/^asset:\/\//);

    const editorHtml = await page.locator("#inline-editor").innerHTML();
    expect(editorHtml).not.toContain("data:image/");
  });

  test("GIF images above threshold are passed through without compression", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    // Build a GIF buffer that is >= IMG_COMPRESS_THRESHOLD (300 KB) so that the
    // size check alone cannot cause the bypass — only the skipTypes path can.
    const result = await page.evaluate(async () => {
      const THRESHOLD = 300 * 1024; // must match IMG_COMPRESS_THRESHOLD in main.ts
      const gifHeader = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0x02, 0x02, 0x44, 0x01, 0x00,
        0x3b,
      ]);
      // Pad with random bytes to push well above the 300 KB threshold.
      const padding = new Uint8Array(THRESHOLD + 1024 - gifHeader.length);
      for (let i = 0; i < padding.length; i++) padding[i] = Math.floor(Math.random() * 256);
      const combined = new Uint8Array(gifHeader.length + padding.length);
      combined.set(gifHeader, 0);
      combined.set(padding, gifHeader.length);
      const buf = combined.buffer;
      (window as any).__rawGifSize = buf.byteLength;
      await (window as any).__aimd_testInsertImageBytes(buf, "image/gif", "anim.gif", "edit");
      return { rawSize: buf.byteLength };
    });

    await page.waitForTimeout(500);

    // The raw GIF must be above the threshold so the size bypass cannot fire.
    expect(result.rawSize).toBeGreaterThan(300 * 1024);

    const capturedByteCount: number = await page.evaluate(() => (window as any).__capturedImageByteCount);
    const capturedFilename: string = await page.evaluate(() => (window as any).__capturedImageName);

    // Output filename must still be .gif (not converted to .jpg).
    expect(capturedFilename).toMatch(/\.gif$/i);
    // Output byte count must equal the raw input size (no re-encoding happened).
    const rawGifSize: number = await page.evaluate(() => (window as any).__rawGifSize);
    expect(capturedByteCount).toBe(rawGifSize);
  });

  test("large PNG above threshold is compressed to JPEG (type-branch sanity check)", async ({ page }) => {
    // Counterpart to the GIF test: same size > threshold, but PNG should be
    // re-encoded to JPEG.  This proves the type-branch in skipTypes is what
    // drives the GIF bypass, not the size guard.
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#inline-editor")).toBeVisible();

    await page.evaluate(async () => {
      const W = 3000;
      const H = 3000;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(W, H);
      const d = imageData.data;
      for (let i = 0; i < d.length; i++) d[i] = Math.floor(Math.random() * 256);
      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      const buf = await blob.arrayBuffer();
      (window as any).__rawImageSize = buf.byteLength;
      await (window as any).__aimd_testInsertImageBytes(buf, "image/png", "noise.png", "edit");
    });

    await page.waitForTimeout(500);

    const capturedSize: number = await page.evaluate(() => (window as any).__capturedImageByteCount);
    const rawImageSize: number = await page.evaluate(() => (window as any).__rawImageSize);
    const capturedFilename: string = await page.evaluate(() => (window as any).__capturedImageName);

    expect(rawImageSize).toBeGreaterThan(300 * 1024);
    // PNG must be re-encoded to JPEG and shrink significantly.
    expect(capturedFilename).toMatch(/\.jpg$/i);
    expect(capturedSize).toBeLessThan(rawImageSize * 0.5);
  });
});
