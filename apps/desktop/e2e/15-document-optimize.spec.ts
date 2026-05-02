import { test, expect, Page } from "@playwright/test";

/**
 * Document asset optimization — verifies that `optimizeDocumentAssets` correctly
 * compresses large PNG assets already stored inside an .aimd, skips small ones,
 * and leaves non-compressible types (GIF/WebP/SVG) untouched.
 *
 * Strategy:
 *   - All Rust invoke calls are mocked.
 *   - Case A/B/C call production code via window.__aimd_testOptimizeAssets
 *     (exposed by main.ts), NOT via an inline reimplementation.
 *   - Case D verifies the auto-trigger path (triggerOptimizeOnOpen) with a
 *     markdown that uses the real asset://ID format; after optimization the
 *     markdown must be UNCHANGED because we no longer rename zip entries.
 *   - The critical "asset integrity" assertion (replace always uses the same
 *     oldName and newName so markdown references remain valid) is enforced in
 *     every case that calls replace_aimd_asset.
 */

async function makeLargePngBuffer(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const W = 3000;
    const H = 3000;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(W, H);
    const d = imageData.data;
    const rng = () => (Math.random() * 256) | 0;
    for (let i = 0; i < d.length; i++) d[i] = rng();
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });
    const buf = await blob.arrayBuffer();
    (window as any).__largePngBuf = buf;
    return buf.byteLength;
  });
}

async function makeSmallPngBuffer(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#336699";
    ctx.fillRect(0, 0, 10, 10);
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });
    const buf = await blob.arrayBuffer();
    (window as any).__smallPngBuf = buf;
    return buf.byteLength;
  });
}

async function installTauriMock(
  page: Page,
  options: {
    assets: Array<{ name: string; size: number; mime: string; bufKey: string }>;
    disableAutoOptimize?: boolean;
    markdownOverride?: string;
  },
) {
  const seed = {
    doc: {
      path: "/mock/optimize-test.aimd",
      title: "优化测试",
      markdown: options.markdownOverride ?? "# 优化测试\n\n![img](asset://aimd-paste-123-image-001)\n",
      html: "<h1>优化测试</h1>",
      assets: [] as Array<unknown>,
      dirty: false,
    },
    assetMeta: options.assets,
    disableAutoOptimize: options.disableAutoOptimize !== false,
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;

    const replaceLog: Array<{ oldName: string; newName: string; byteCount: number }> = [];
    (window as any).__replaceLog = replaceLog;
    (window as any).__savedMarkdown = "";

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_aimd_file: () => s.doc.path,
      choose_doc_file: () => s.doc.path,
      choose_image_file: () => null,
      choose_save_aimd_file: () => s.doc.path,
      open_aimd: () => s.doc,
      create_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown }),
      save_aimd: (a) => {
        (window as any).__savedMarkdown = (a as any)?.markdown ?? s.doc.markdown;
        return { ...s.doc, markdown: (window as any).__savedMarkdown, dirty: false };
      },
      save_aimd_as: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown }),
      render_markdown: () => ({ html: s.doc.html }),
      render_markdown_standalone: () => ({ html: s.doc.html }),
      add_image: () => null,
      add_image_bytes: () => ({
        asset: { id: "x.jpg", path: "assets/x.jpg", mime: "image/jpeg", size: 1000, sha256: "aa", role: "content-image", url: "" },
        uri: "asset://x.jpg",
        markdown: "![x.jpg](asset://x.jpg)",
      }),
      read_image_bytes: () => [],
      list_aimd_assets: () => s.assetMeta,
      read_aimd_asset: async (a) => {
        const name = (a as any)?.assetName as string;
        const meta = s.assetMeta.find((m) => m.name === name);
        if (!meta) return [];
        const buf: ArrayBuffer = (window as any)[meta.bufKey];
        if (!buf) return new Array(meta.size).fill(0x80);
        return Array.from(new Uint8Array(buf));
      },
      replace_aimd_asset: (a) => {
        const oldName = (a as any)?.oldName as string;
        const newName = (a as any)?.newName as string;
        const bytes = (a as any)?.bytes as number[];
        replaceLog.push({ oldName, newName, byteCount: bytes?.length ?? 0 });
        return { name: newName, size: bytes?.length ?? 0, mime: "image/jpeg" };
      },
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
      core: { ...((window as any).__TAURI__?.core ?? {}), convertFileSrc },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

    if (s.disableAutoOptimize) {
      (window as any).__aimd_e2e_disable_auto_optimize = true;
    }
  }, seed);
}

test.describe("Document asset optimization", () => {
  test("Case A: large PNG is compressed via production optimizeDocumentAssets; zip entry name is preserved (no rename)", async ({ page }) => {
    await installTauriMock(page, {
      assets: [{ name: "assets/aimd-paste-123-image.png", size: 2 * 1024 * 1024, mime: "image/png", bufKey: "__largePngBuf" }],
    });
    await page.goto("/");

    const largePngSize = await makeLargePngBuffer(page);
    expect(largePngSize).toBeGreaterThan(300 * 1024);

    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("优化测试");

    // Call the PRODUCTION function via the test hook exposed by main.ts.
    const result = await page.evaluate(async () => {
      return (window as any).__aimd_testOptimizeAssets("/mock/optimize-test.aimd");
    });

    expect(result.optimized).toBe(1);
    expect(result.savedBytes).toBeGreaterThan(0);

    const replaceLog: Array<{ oldName: string; newName: string; byteCount: number }> = await page.evaluate(
      () => (window as any).__replaceLog,
    );
    expect(replaceLog).toHaveLength(1);

    // Critical assertion (BUG-016 guard): the zip entry name MUST NOT change so
    // that asset://ID references in markdown remain valid without any rewrite.
    expect(replaceLog[0].oldName).toBe("aimd-paste-123-image.png");
    expect(replaceLog[0].newName).toBe("aimd-paste-123-image.png");
    expect(replaceLog[0].byteCount).toBeLessThan(largePngSize);
  });

  test("Case B: small PNG below threshold is not optimized", async ({ page }) => {
    await installTauriMock(page, {
      assets: [{ name: "assets/aimd-paste-123-image.png", size: 1024, mime: "image/png", bufKey: "__smallPngBuf" }],
    });
    await page.goto("/");

    const smallPngSize = await makeSmallPngBuffer(page);
    expect(smallPngSize).toBeLessThan(300 * 1024);

    await page.locator("#empty-open").click();

    // Call production code.
    const result = await page.evaluate(async () => {
      return (window as any).__aimd_testOptimizeAssets("/mock/optimize-test.aimd");
    });

    expect(result.optimized).toBe(0);

    const replaceLog: Array<unknown> = await page.evaluate(() => (window as any).__replaceLog);
    expect(replaceLog).toHaveLength(0);
  });

  test("Case C: GIF, WebP, and SVG assets are skipped (not optimized)", async ({ page }) => {
    await installTauriMock(page, {
      assets: [
        { name: "assets/anim.gif", size: 2 * 1024 * 1024, mime: "image/gif", bufKey: "__noBuf" },
        { name: "assets/photo.webp", size: 2 * 1024 * 1024, mime: "image/webp", bufKey: "__noBuf" },
        { name: "assets/icon.svg", size: 512 * 1024, mime: "image/svg+xml", bufKey: "__noBuf" },
      ],
    });
    await page.goto("/");
    await page.locator("#empty-open").click();

    // Call production code.
    const result = await page.evaluate(async () => {
      return (window as any).__aimd_testOptimizeAssets("/mock/optimize-test.aimd");
    });

    expect(result.optimized).toBe(0);

    const replaceLog: Array<unknown> = await page.evaluate(() => (window as any).__replaceLog);
    expect(replaceLog).toHaveLength(0);
  });

  test("auto-optimize fires on document open; markdown with asset://ID references is unchanged after compression", async ({ page }) => {
    // Use the real asset://ID format that Go backend generates.
    // After optimization the markdown MUST remain identical because we only
    // replace bytes in-place (no zip entry rename, no markdown rewrite).
    const realMarkdown = "# 优化测试\n\n![Solar](asset://aimd-paste-1777432866771939000-image-001)\n";

    await installTauriMock(page, {
      assets: [{ name: "assets/aimd-paste-1777432866771939000-image.png", size: 2 * 1024 * 1024, mime: "image/png", bufKey: "__largePngBuf" }],
      disableAutoOptimize: false,
      markdownOverride: realMarkdown,
    });

    await page.goto("/");
    await makeLargePngBuffer(page);
    await page.locator("#empty-open").click();

    // Wait for auto-optimize to complete (compresses + status update).
    await page.waitForTimeout(4000);

    const replaceLog: Array<{ oldName: string; newName: string }> = await page.evaluate(
      () => (window as any).__replaceLog,
    );
    // replace_aimd_asset must have been called once (compression happened).
    expect(replaceLog).toHaveLength(1);

    // CRITICAL: old == new — the zip entry name was NOT changed.
    // This guarantees asset://aimd-paste-...-001 references remain valid.
    expect(replaceLog[0].oldName).toBe("aimd-paste-1777432866771939000-image.png");
    expect(replaceLog[0].newName).toBe("aimd-paste-1777432866771939000-image.png");

    // The markdown must be unchanged — no save_aimd call needed.
    // (triggerOptimizeOnOpen no longer calls save_aimd because markdown is unchanged)
    const savedMarkdown: string = await page.evaluate(() => (window as any).__savedMarkdown);
    expect(savedMarkdown).toBe("");
  });
});
