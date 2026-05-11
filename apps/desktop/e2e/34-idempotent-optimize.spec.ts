import { test, expect, Page } from "@playwright/test";

/**
 * BUG-026 回归：自动图片压缩幂等性
 *
 * 确保每次打开文档时不会对已优化的 JPEG 反复有损重编码。
 *
 * Case A：PNG 首次压缩为 JPEG → 第二次打开时 replace_aimd_asset 调用次数为 0。
 * Case B：连续打开同一文档 5 次，每次 assets/ 文件字节哈希一致（无二次写入）。
 * Case C：.aimd 内已存一张大 JPEG → 打开时不触发压缩（JPEG 跳过逻辑）。
 * Case D：大 PNG 第一次打开确实压缩并 toast；第二次打开不再写回。
 */

async function makeLargeNoisePng(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const W = 3000;
    const H = 3000;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 256) | 0;
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });
    const buf = await blob.arrayBuffer();
    (window as any).__noisePngBuf = buf;
    return buf.byteLength;
  });
}

async function makeLargeNoiseJpeg(page: Page): Promise<{ buf: ArrayBuffer; size: number }> {
  return page.evaluate(async () => {
    const W = 3000;
    const H = 3000;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 256) | 0;
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
    });
    const buf = await blob.arrayBuffer();
    (window as any).__noiseJpegBuf = buf;
    return { buf, size: buf.byteLength };
  });
}

async function sha256Hex(page: Page, bufKey: string): Promise<string> {
  return page.evaluate(async (key: string) => {
    const buf: ArrayBuffer = (window as any)[key];
    if (!buf) return "";
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, bufKey);
}

type AssetMeta = { name: string; size: number; mime: string; bufKey: string };

interface MockOptions {
  assets: AssetMeta[];
  docPath?: string;
  disableAutoOptimize?: boolean;
}

async function installMock(page: Page, opts: MockOptions) {
  const seed = {
    doc: {
      path: opts.docPath ?? "/mock/idempotent-test.aimd",
      title: "幂等压缩测试",
      markdown: "# 幂等压缩测试\n\n![img](asset://test-asset-001)\n",
      html: "<h1>幂等压缩测试</h1>",
      assets: [] as unknown[],
      dirty: false,
    },
    assetMeta: opts.assets,
    disableAutoOptimize: opts.disableAutoOptimize === true,
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://localhost${encodeURI(path)}`;

    const replaceLog: Array<{ oldName: string; newName: string; byteCount: number; bytes: Uint8Array }> = [];
    (window as any).__replaceLog = replaceLog;

    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => s.doc.path,
      choose_aimd_file: () => s.doc.path,
      choose_save_aimd_file: () => s.doc.path,
      choose_image_file: () => null,
      open_aimd: () => ({ ...s.doc }),
      create_aimd: (a) => ({ ...s.doc, markdown: (a as any)?.markdown ?? s.doc.markdown }),
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
      render_markdown_standalone: () => ({ html: s.doc.html }),
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
        const bytes: number[] = (a as any)?.bytes ?? [];
        const data = new Uint8Array(bytes);
        replaceLog.push({ oldName, newName, byteCount: bytes.length, bytes: data });
        // 模拟写回：把 bufKey 对应的 buffer 替换为压缩后的内容，以便下次 read_aimd_asset 返回新版本
        const meta = s.assetMeta.find((m) => m.name === oldName || m.name.endsWith(`/${oldName}`));
        if (meta) {
          (window as any)[meta.bufKey] = data.buffer;
          meta.size = bytes.length;
          meta.mime = "image/jpeg";
        }
        return { name: newName, size: bytes.length, mime: "image/jpeg" };
      },
      register_window_path: () => null,
      focus_doc_window: () => null,
      confirm_discard_changes: () => "discard",
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

test.describe("BUG-026 自动优化幂等性", () => {
  test("Case A: JPEG 资产在第二次打开时 replace_aimd_asset 调用次数为 0", async ({ page }) => {
    // 第一步：先用一张大 PNG 模拟"首次插入后已被压缩为 JPEG"的状态
    // 即：模拟 .aimd 内已存一张以 JPEG MIME 存储的资产（首次压缩的结果）
    // 直接构造一个 JPEG 大图作为已存入 .aimd 的资产
    await installMock(page, {
      assets: [{ name: "assets/photo.jpg", size: 800 * 1024, mime: "image/jpeg", bufKey: "__noiseJpegBuf" }],
    });

    await page.goto("/");
    const jpegResult = await makeLargeNoiseJpeg(page);
    expect(jpegResult.size).toBeGreaterThan(300 * 1024);

    // "打开"文档（触发 triggerOptimizeOnOpen）
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("幂等压缩测试");

    // 等待 auto-optimize 完成
    await page.waitForTimeout(3000);

    const replaceLog: unknown[] = await page.evaluate(() => (window as any).__replaceLog);
    // JPEG 已在 skipTypes 里，不应有任何写回
    expect(replaceLog).toHaveLength(0);
  });

  test("Case B: 连续打开同一文档 5 次，资产字节哈希始终一致（无重复写入）", async ({ page }) => {
    // 先安装 mock，资产是一张已压缩的 JPEG（模拟文档之前已优化完毕的状态）
    await installMock(page, {
      assets: [{ name: "assets/photo.jpg", size: 800 * 1024, mime: "image/jpeg", bufKey: "__noiseJpegBuf" }],
    });

    await page.goto("/");
    await makeLargeNoiseJpeg(page);

    const hashes: string[] = [];

    for (let i = 0; i < 5; i++) {
      // 每次都通过 empty-open 或 __aimd_testOptimizeAssets 触发 auto-optimize 路径
      if (i === 0) {
        await page.locator("#empty-open").click();
        await expect(page.locator("#doc-title")).toHaveText("幂等压缩测试");
      } else {
        // 模拟重新打开：直接调用 openDocument
        await page.evaluate(async () => {
          await (window as any).__aimd_testOptimizeAssets("/mock/idempotent-test.aimd");
        });
      }
      await page.waitForTimeout(3000);

      // 取当前 buffer 的哈希
      const hash = await sha256Hex(page, "__noiseJpegBuf");
      hashes.push(hash);
    }

    // 所有 5 次哈希必须一致（JPEG 未被重新写入）
    const allSame = hashes.every((h) => h === hashes[0]);
    expect(hashes[0].length).toBeGreaterThan(0);
    expect(allSame).toBe(true);
    // replaceLog 也应为空
    const replaceLog: unknown[] = await page.evaluate(() => (window as any).__replaceLog);
    expect(replaceLog).toHaveLength(0);
  });

  test("Case C: .aimd 内存储的大 JPEG 打开时不触发重编码", async ({ page }) => {
    // 直接构造含 1MB JPEG 的 .aimd（绕过 insertImage 路径）
    await installMock(page, {
      assets: [{ name: "assets/large-photo.jpg", size: 1024 * 1024, mime: "image/jpeg", bufKey: "__noiseJpegBuf" }],
    });

    await page.goto("/");
    const jpegResult = await makeLargeNoiseJpeg(page);
    expect(jpegResult.size).toBeGreaterThan(300 * 1024);

    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("幂等压缩测试");

    // 等待 auto-optimize 路径完成
    await page.waitForTimeout(3000);

    const replaceLog: unknown[] = await page.evaluate(() => (window as any).__replaceLog);
    // JPEG 在 skipTypes 里，不应触发 replace_aimd_asset
    expect(replaceLog).toHaveLength(0);
  });

  test("Case D: 大 PNG 首次打开确实压缩；再次打开不再写回", async ({ page }) => {
    // 安装 mock：资产是一张大 PNG
    await installMock(page, {
      assets: [{ name: "assets/large-image.png", size: 2 * 1024 * 1024, mime: "image/png", bufKey: "__noisePngBuf" }],
    });

    await page.goto("/");
    const pngSize = await makeLargeNoisePng(page);
    expect(pngSize).toBeGreaterThan(300 * 1024);

    // 第一次打开 → 触发 auto-optimize
    await page.locator("#empty-open").click();
    await expect(page.locator("#doc-title")).toHaveText("幂等压缩测试");
    await page.waitForTimeout(4000);

    const replaceLogAfterFirst: Array<{ oldName: string; byteCount: number }> = await page.evaluate(
      () => (window as any).__replaceLog,
    );
    // 第一次打开应当压缩该 PNG（节省 >= 50KB 且 >= 10%）
    expect(replaceLogAfterFirst).toHaveLength(1);
    expect(replaceLogAfterFirst[0].oldName).toBe("large-image.png");
    // 压缩后文件更小
    expect(replaceLogAfterFirst[0].byteCount).toBeLessThan(pngSize);

    // 清空 replaceLog，模拟"第二次打开"：直接调用 optimizeDocumentAssets
    await page.evaluate(() => {
      (window as any).__replaceLog.length = 0;
    });

    // 第二次调用 optimize（mime 已被 mock 中的 replace handler 更新为 image/jpeg）
    await page.evaluate(async () => {
      await (window as any).__aimd_testOptimizeAssets("/mock/idempotent-test.aimd");
    });
    await page.waitForTimeout(2000);

    const replaceLogAfterSecond: unknown[] = await page.evaluate(() => (window as any).__replaceLog);
    // 第二次打开时资产 mime 已变为 image/jpeg，跳过，不应写回
    expect(replaceLogAfterSecond).toHaveLength(0);
  });
});
