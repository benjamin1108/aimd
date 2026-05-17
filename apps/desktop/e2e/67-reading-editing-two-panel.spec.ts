import { test, expect, Page } from "@playwright/test";

async function installTwoPanelMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/two-panel.aimd",
      title: "双面板",
      markdown: "# 双面板\n\nAlpha paragraph\n\n- [ ] task\n",
      html: "<h1>双面板</h1><p>Alpha paragraph</p><ul><li><input type=\"checkbox\" disabled> task</li></ul>",
      assets: [] as Array<unknown>,
      dirty: false,
      format: "aimd" as const,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const runtime = {
      saveCalls: [] as Array<Record<string, unknown>>,
      addedAssets: [] as Array<Record<string, unknown>>,
    };
    const escapeHTML = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const render = (markdown: string) => ({
      html: markdownToHTML(markdown),
    });
    const markdownToHTML = (markdown: string) => {
      const html: string[] = [];
      let paragraph: string[] = [];
      let listItems: string[] = [];
      let codeLines: string[] | null = null;
      let tableLines: string[] = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${paragraph.map(escapeHTML).join("<br>")}</p>`);
        paragraph = [];
      };
      const flushList = () => {
        if (!listItems.length) return;
        html.push(`<ul>${listItems.join("")}</ul>`);
        listItems = [];
      };
      const flushCode = () => {
        if (!codeLines) return;
        html.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      };
      const flushTable = () => {
        if (tableLines.length < 2) {
          tableLines.forEach((line) => paragraph.push(line));
          tableLines = [];
          return;
        }
        const rows = tableLines
          .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
          .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => escapeHTML(cell.trim())));
        const header = rows.shift() || [];
        html.push([
          "<table><thead><tr>",
          header.map((cell) => `<th>${cell}</th>`).join(""),
          "</tr></thead><tbody>",
          rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join(""),
          "</tbody></table>",
        ].join(""));
        tableLines = [];
      };
      for (const line of markdown.split("\n")) {
        if (codeLines) {
          if (/^\s*(```|~~~)/.test(line)) {
            flushCode();
          } else {
            codeLines.push(line);
          }
          continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          flushParagraph();
          flushList();
          flushTable();
          html.push(`<h${heading[1].length}>${escapeHTML(heading[2])}</h${heading[1].length}>`);
          continue;
        }
        if (/^\s*(```|~~~)/.test(line)) {
          flushParagraph();
          flushList();
          flushTable();
          codeLines = [];
          continue;
        }
        const task = line.match(/^\s*-\s+\[( |x|X)]\s+(.+)$/);
        if (task) {
          flushParagraph();
          flushTable();
          listItems.push(`<li><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}> ${escapeHTML(task[2])}</li>`);
          continue;
        }
        const image = line.match(/!\[([^\]]*)]\(asset:\/\/img-001\)/);
        if (image) {
          flushParagraph();
          flushList();
          flushTable();
          html.push(`<p><img src="asset://img-001" alt="${escapeHTML(image[1])}"></p>`);
          continue;
        }
        if (!line.trim()) {
          flushParagraph();
          flushList();
          flushTable();
          continue;
        }
        if (line.includes("|")) {
          flushParagraph();
          flushList();
          tableLines.push(line);
          continue;
        }
        flushTable();
        flushList();
        paragraph.push(line);
      }
      flushParagraph();
      flushList();
      flushCode();
      flushTable();
      return html.join("\n\n");
    };
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => s.doc.path,
      open_aimd: () => s.doc,
      render_markdown: (a) => render(String((a as any)?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String((a as any)?.markdown ?? "")),
      save_aimd: (a) => {
        runtime.saveCalls.push({ ...((a || {}) as Record<string, unknown>) });
        return { ...s.doc, markdown: String((a as any)?.markdown ?? s.doc.markdown), dirty: false };
      },
      add_image_bytes: () => {
        const asset = {
          id: "img-001",
          path: "assets/pasted.png",
          mime: "image/png",
          size: 68,
          sha256: "hash",
          role: "content-image",
          url: "/mock/pasted.png",
          localPath: "/mock/pasted.png",
        };
        runtime.addedAssets.push(asset);
        return { asset, uri: "asset://img-001", markdown: "![](asset://img-001)" };
      },
      list_aimd_assets: () => [],
    };
    (window as any).__aimdTwoPanelMock = {
      saveCalls: () => runtime.saveCalls,
      addedAssets: () => runtime.addedAssets,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, seed);
}

async function openDoc(page: Page) {
  await installTwoPanelMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
}

function longMarkdown() {
  return [
    "# Scroll Sync",
    "",
    ...Array.from({ length: 36 }, (_, index) => {
      const section = index + 1;
      return [
        `## Section ${section}`,
        "",
        `Paragraph ${section} keeps the rendered preview aligned with the source editor.`,
      ].join("\n");
    }),
  ].join("\n\n");
}

async function fillLongMarkdown(page: Page) {
  await page.locator("#mode-edit").click();
  await page.locator("#markdown").fill(longMarkdown());
  await expect(page.locator("#preview h2")).toHaveCount(36);
  await expect.poll(() => page.locator("#markdown").evaluate((el: HTMLTextAreaElement) => (
    el.scrollHeight - el.clientHeight
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#preview").evaluate((el: HTMLElement) => (
    el.scrollHeight - el.clientHeight
  ))).toBeGreaterThan(0);
}

async function sourceScrollToHeading(page: Page, heading: string) {
  await page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement, targetHeading) => {
    const lines = textarea.value.split("\n");
    const line = lines.findIndex((item) => item.trim() === `## ${targetHeading}`);
    const style = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.45 || 22;
    textarea.scrollTop = Math.max(0, line) * lineHeight;
    textarea.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, heading);
}

async function previewScrollToHeading(page: Page, heading: string) {
  await page.locator("#preview").evaluate((preview: HTMLElement, targetHeading) => {
    const target = Array.from(preview.querySelectorAll<HTMLElement>("h2"))
      .find((element) => element.textContent?.trim() === targetHeading);
    if (!target) throw new Error(`missing preview heading ${targetHeading}`);
    const rootRect = preview.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    preview.scrollTop = targetRect.top - rootRect.top + preview.scrollTop;
    preview.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, heading);
}

async function expectPreviewHeadingNearTop(page: Page, heading: string) {
  await expect.poll(() => page.locator("#preview").evaluate((preview: HTMLElement, targetHeading) => {
    const target = Array.from(preview.querySelectorAll<HTMLElement>("h2"))
      .find((element) => element.textContent?.trim() === targetHeading);
    if (!target) return Number.POSITIVE_INFINITY;
    return Math.abs(target.getBoundingClientRect().top - preview.getBoundingClientRect().top);
  }, heading)).toBeLessThan(140);
}

async function expectSourceHeadingNearTop(page: Page, heading: string) {
  await expect.poll(() => page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement, targetHeading) => {
    const lines = textarea.value.split("\n");
    const line = lines.findIndex((item) => item.trim() === `## ${targetHeading}`);
    const style = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.45 || 22;
    return Math.abs(textarea.scrollTop - Math.max(0, line) * lineHeight);
  }, heading)).toBeLessThan(140);
}

test.describe("reading/editing two-panel contract", () => {
  test("only reading and editing modes are exposed", async ({ page }) => {
    await openDoc(page);
    await expect(page.locator("#mode-read")).toContainText("阅读");
    await expect(page.locator("#mode-edit")).toContainText("编辑");
    await expect(page.locator(`#mode-${"source"}`)).toHaveCount(0);
    await expect(page.locator(`#inline-${"editor"}`)).toHaveCount(0);
  });

  test("editing textarea updates the read-only preview and save uses Markdown source", async ({ page }) => {
    await openDoc(page);
    await page.locator("#mode-edit").click();
    await expect(page.locator("#markdown")).toBeVisible();
    await expect(page.locator("#markdown")).toHaveValue(/Alpha paragraph/);
    await expect(page.locator("#preview")).toBeVisible();

    await page.locator("#markdown").fill("# 双面板\n\nBeta preview\n");
    await expect(page.locator("#preview")).toContainText("Beta preview");

    await page.locator("#more-menu-toggle").click();
    await page.locator("#save").click();
    await expect(page.locator("#status")).toContainText("已保存");
    const calls = await page.evaluate(() => (window as any).__aimdTwoPanelMock.saveCalls());
    expect(calls.at(-1).markdown).toBe("# 双面板\n\nBeta preview\n");
  });

  test("reader task checkbox mutates Markdown through the source model", async ({ page }) => {
    await openDoc(page);
    await page.locator("#reader input[type='checkbox']").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#markdown")).toHaveValue(/- \[x\] task/);
  });

  test("pane swap is UI state and does not dirty the document", async ({ page }) => {
    await openDoc(page);
    await page.locator("#mode-edit").click();
    await expect(page.locator("#editor-wrap")).toHaveAttribute("data-edit-pane-order", "source-first");
    await page.locator("#edit-pane-swap").click();
    await expect(page.locator("#editor-wrap")).toHaveAttribute("data-edit-pane-order", "preview-first");
    await expect(page.locator("#save")).toBeDisabled();
    await page.locator("#mode-read").click();
    await page.locator("#mode-edit").click();
    await expect(page.locator("#editor-wrap")).toHaveAttribute("data-edit-pane-order", "preview-first");
  });

  test("source and preview keep semantic scroll position in sync", async ({ page }) => {
    await openDoc(page);
    await fillLongMarkdown(page);

    await sourceScrollToHeading(page, "Section 24");
    await expectPreviewHeadingNearTop(page, "Section 24");

    await previewScrollToHeading(page, "Section 31");
    await expectSourceHeadingNearTop(page, "Section 31");
  });

  test("scroll sync survives pane swap and stacked edit layout", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 720 });
    await openDoc(page);
    await fillLongMarkdown(page);

    await page.locator("#edit-pane-swap").click();
    await expect(page.locator("#editor-wrap")).toHaveAttribute("data-edit-pane-order", "preview-first");
    await sourceScrollToHeading(page, "Section 18");
    await expectPreviewHeadingNearTop(page, "Section 18");

    await previewScrollToHeading(page, "Section 28");
    await expectSourceHeadingNearTop(page, "Section 28");
  });

  test("format toolbar follows source focus and pane swap keeps the icon row stable", async ({ page }) => {
    await openDoc(page);
    await expect(page.locator("#mode-tool-slot")).toHaveAttribute("data-tool-mode", "read");
    await expect(page.locator("#viewport-width-toggle")).toBeVisible();
    await expect(page.locator("#viewport-width-toggle")).toBeEnabled();
    await expect(page.locator("#edit-pane-swap")).toBeHidden();
    const beforeEdit = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: Math.round(box.left), width: Math.round(box.width) } : { left: 0, width: 0 };
      };
      return {
        swap: rect("#edit-pane-swap"),
        find: rect("#find-toggle"),
        width: rect("#viewport-width-toggle"),
        mode: rect(".toolbar-group--mode"),
        more: rect("#more-menu-toggle"),
      };
    });
    const readOrderIsCorrect = await page.evaluate(() => {
      const width = document.querySelector("#viewport-width-toggle");
      const find = document.querySelector("#find-toggle");
      const mode = document.querySelector(".toolbar-group--mode");
      if (!width || !find || !mode) return false;
      return Boolean(width.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(find.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(readOrderIsCorrect).toBe(true);

    await page.locator("#mode-edit").click();

    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#mode-tool-slot")).toHaveAttribute("data-tool-mode", "edit");
    await expect(page.locator("#edit-pane-swap")).toBeVisible();
    await expect(page.locator("#edit-pane-swap")).toBeEnabled();
    await expect(page.locator("#viewport-width-toggle")).toBeHidden();

    const editOrderIsCorrect = await page.evaluate(() => {
      const find = document.querySelector("#find-toggle");
      const swap = document.querySelector("#edit-pane-swap");
      const mode = document.querySelector(".toolbar-group--mode");
      const insideFormatToolbar = document.querySelector("#format-toolbar #edit-pane-swap");
      if (!find || !swap || !mode || insideFormatToolbar) return false;
      return Boolean(swap.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(find.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(editOrderIsCorrect).toBe(true);

    const afterEdit = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: Math.round(box.left), width: Math.round(box.width) } : { left: 0, width: 0 };
      };
      return {
        swap: rect("#edit-pane-swap"),
        find: rect("#find-toggle"),
        width: rect("#viewport-width-toggle"),
        mode: rect(".toolbar-group--mode"),
        more: rect("#more-menu-toggle"),
      };
    });
    expect(afterEdit.swap.width).toBe(beforeEdit.width.width);
    expect(afterEdit.swap.left).toBe(beforeEdit.width.left);
    expect(afterEdit.find.left).toBe(beforeEdit.find.left);
    expect(afterEdit.mode.left).toBe(beforeEdit.mode.left);
    expect(afterEdit.more.left).toBe(beforeEdit.more.left);
    const gaps = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const swap = rect("#edit-pane-swap");
      const find = rect("#find-toggle");
      const mode = rect(".toolbar-group--mode");
      return {
        swapFind: Math.round(find.left - swap.right),
        findMode: Math.round(mode.left - find.right),
      };
    });
    expect(gaps.swapFind).toBeGreaterThanOrEqual(3);
    expect(gaps.swapFind).toBeLessThanOrEqual(5);
    expect(gaps.findMode).toBe(gaps.swapFind);

    await page.locator("#markdown").focus();
    await expect(page.locator("#format-toolbar")).toBeVisible();

    const separatorBox = await page.locator(".ft-sep").first().boundingBox();
    expect(separatorBox).toBeTruthy();
    await page.mouse.move(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + separatorBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(separatorBox!.x + 18, separatorBox!.y + separatorBox!.height / 2);
    await expect(page.locator("#format-toolbar")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("#format-toolbar")).toBeVisible();

    await page.locator("#preview").click();
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await expect(page.locator("#edit-pane-swap")).toBeVisible();
  });

  test("toolbar controls expose custom tips", async ({ page }) => {
    await openDoc(page);
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").focus();

    await page.locator('[data-cmd="bold"]').hover();
    await expect(page.locator("#ui-tooltip")).toBeVisible();
    await expect(page.locator("#ui-tooltip")).toContainText("粗体");

    await page.locator('[data-cmd="image-alt"]').hover();
    await expect(page.locator("#ui-tooltip")).toContainText("编辑图片描述");

    await page.locator("#edit-pane-swap").hover();
    await expect(page.locator("#ui-tooltip")).toBeHidden();

    await page.locator("#mode-read").hover();
    await expect(page.locator("#ui-tooltip")).toBeHidden();
  });

  test("pasted image inserts Markdown syntax and renders in preview", async ({ page }) => {
    await openDoc(page);
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement) => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
      0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 250, 207, 0, 0,
      2, 7, 1, 2, 154, 28, 49, 113, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ]).buffer;
    await page.evaluate(async (buf) => {
      await (window as any).__aimd_testInsertImageBytes(buf, "image/png", "pasted.png");
    }, png);
    await expect(page.locator("#markdown")).toHaveValue(/!\[\]\(asset:\/\/img-001\)/);
    await expect(page.locator('#preview img[alt=""]')).toHaveCount(1);
  });

  test("image description editor hides generated internal paste names", async ({ page }) => {
    await openDoc(page);
    await page.locator("#mode-edit").click();
    await page.locator("#markdown").fill("# 双面板\n\n![aimd paste 1777432866771939000 image](asset://img-001)\n");
    await page.locator("#markdown").evaluate((textarea: HTMLTextAreaElement) => {
      const marker = "![aimd paste";
      const start = textarea.value.indexOf(marker);
      textarea.focus();
      textarea.setSelectionRange(start + 2, start + 10);
    });
    await page.locator('[data-cmd="image-alt"]').click();
    await expect(page.locator("#image-alt-input")).toHaveValue("");
  });
});
