import { test, expect, Page } from "@playwright/test";

type SurfaceSelector = "#reader" | "#preview";

async function installSelectionMock(page: Page) {
  const seed = {
    doc: {
      path: "/mock/selection.aimd",
      title: "Selection",
      markdown: "# Selection\n\nAlpha paragraph",
      html: "<h1>Selection</h1><p>Alpha paragraph</p>",
      assets: [] as Array<unknown>,
      dirty: false,
      format: "aimd" as const,
    },
  };

  await page.addInitScript((s: typeof seed) => {
    type Args = Record<string, unknown> | undefined;
    const escapeHTML = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const flushTable = (html: string[], tableLines: string[]) => {
      if (!tableLines.length) return;
      if (tableLines.length < 2) {
        html.push(...tableLines.map((line) => `<p>${escapeHTML(line)}</p>`));
        tableLines.length = 0;
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
      tableLines.length = 0;
    };
    const markdownToHTML = (markdown: string) => {
      const html: string[] = [];
      let paragraph: string[] = [];
      let codeLines: string[] | null = null;
      const tableLines: string[] = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${paragraph.map(escapeHTML).join(" ")}</p>`);
        paragraph = [];
      };
      const flushCode = () => {
        if (!codeLines) return;
        html.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      };
      for (const line of markdown.split("\n")) {
        if (codeLines) {
          if (/^\s*(```|~~~)/.test(line)) flushCode();
          else codeLines.push(line);
          continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          flushParagraph();
          flushTable(html, tableLines);
          html.push(`<h${heading[1].length}>${escapeHTML(heading[2])}</h${heading[1].length}>`);
          continue;
        }
        if (/^\s*(```|~~~)/.test(line)) {
          flushParagraph();
          flushTable(html, tableLines);
          codeLines = [];
          continue;
        }
        if (!line.trim()) {
          flushParagraph();
          flushTable(html, tableLines);
          continue;
        }
        if (line.includes("|")) {
          flushParagraph();
          tableLines.push(line);
          continue;
        }
        flushTable(html, tableLines);
        paragraph.push(line);
      }
      flushParagraph();
      flushCode();
      flushTable(html, tableLines);
      return html.join("\n\n");
    };
    const render = (markdown: string) => ({ html: markdownToHTML(markdown) });
    const handlers: Record<string, (a: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => s.doc.path,
      open_aimd: () => s.doc,
      render_markdown: (a) => render(String((a as any)?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String((a as any)?.markdown ?? "")),
      list_aimd_assets: () => [],
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, a?: Args) => {
        const fn = handlers[cmd];
        if (!fn) throw new Error(`mock invoke: unknown command ${cmd}`);
        return fn(a);
      },
      transformCallback: (cb: Function) => cb,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, seed);
}

async function openDoc(page: Page) {
  await installSelectionMock(page);
  await page.goto("/");
  await page.locator("#empty-open").click();
}

async function showSurface(page: Page, surface: SurfaceSelector) {
  if (surface === "#preview") await page.locator("#mode-edit").click();
  else await page.locator("#mode-read").click();
  await expect(page.locator(surface)).toBeVisible();
}

async function paintFixtureHTML(page: Page, surface: SurfaceSelector, html: string) {
  await showSurface(page, surface);
  await page.evaluate(async (fixtureHTML) => {
    const mod = await import("/src/ui/outline.ts");
    mod.applyHTML(fixtureHTML);
  }, html);
}

async function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function pointerForText(page: Page, selector: string, text: string, bias = 0.5) {
  return page.locator(selector).filter({ hasText: text }).first().evaluate((root, args) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      const index = node.data.indexOf(args.text);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + args.text.length);
      const rects = Array.from(range.getClientRects());
      const rect = rects.find((item) => item.width > 0 && item.height > 0);
      if (!rect) break;
      return {
        x: rect.left + rect.width * args.bias,
        y: rect.top + rect.height / 2,
      };
    }
    throw new Error(`missing text: ${args.text}`);
  }, { text, bias });
}

async function doubleClickText(page: Page, selector: string, text: string) {
  const point = await pointerForText(page, selector, text, 0.5);
  await page.mouse.dblclick(point.x, point.y);
}

async function dragTextRange(page: Page, selector: string, startText: string, endText: string) {
  const start = await pointerForText(page, selector, startText, 0.05);
  const end = await pointerForText(page, selector, endText, 0.95);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x + 6, end.y, { steps: 8 });
  await page.mouse.up();
}

async function dragTextRangeReverse(page: Page, selector: string, firstText: string, lastText: string) {
  const start = await pointerForText(page, selector, lastText, 0.95);
  const end = await pointerForText(page, selector, firstText, 0.05);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x - 6, end.y, { steps: 8 });
  await page.mouse.up();
}

async function dragTextStartToGapBefore(page: Page, selector: string, startText: string, beforeSelector: string) {
  await dragTextStartToGapBeforeRelease(page, selector, startText, beforeSelector, true);
}

async function dragTextStartToGapBeforeRelease(
  page: Page,
  selector: string,
  startText: string,
  beforeSelector: string,
  release: boolean,
) {
  const start = await pointerForText(page, selector, startText, 0.05);
  const gap = await page.locator(beforeSelector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.2, y: rect.top - 4 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(gap.x, gap.y, { steps: 10 });
  if (release) await page.mouse.up();
}

async function dragTextStartToInlineGap(page: Page, selector: string, startText: string) {
  const start = await pointerForText(page, selector, startText, 0.05);
  const gap = await page.locator(selector).evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastRect: DOMRect | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text) || !node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      lastRect = rects.at(-1) || lastRect;
    }
    if (!lastRect) throw new Error("missing text rect");
    const elementRect = element.getBoundingClientRect();
    return {
      x: Math.min(elementRect.right - 8, lastRect.right + 180),
      y: lastRect.top + lastRect.height / 2,
    };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(gap.x, gap.y, { steps: 10 });
}

async function expectSelectionRectsInside(page: Page, selector: string) {
  const result = await page.locator(selector).evaluate((element) => {
    const rootRect = element.getBoundingClientRect();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return { count: 0, outside: [] as Array<object> };
    const rects = Array.from(selection.getRangeAt(0).getClientRects());
    return {
      count: rects.length,
      outside: rects
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .filter((rect) => (
          rect.left < rootRect.left - 1
          || rect.right > rootRect.right + 1
          || rect.top < rootRect.top - 1
          || rect.bottom > rootRect.bottom + 1
        ))
        .map((rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          rootLeft: rootRect.left,
          rootRight: rootRect.right,
          rootTop: rootRect.top,
          rootBottom: rootRect.bottom,
        })),
    };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.outside).toEqual([]);
}

async function expectSelectionRectsOverlapText(page: Page, rootSelector: string) {
  const result = await page.locator(rootSelector).evaluate((root) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return { rects: 0, floating: [] as Array<object> };
    const selectedRange = selection.getRangeAt(0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textRects: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text) || !node.data.trim() || !selectedRange.intersectsNode(node)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textRects.push(...Array.from(range.getClientRects()));
    }
    const textBands = textRects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ top: rect.top - 1, bottom: rect.bottom + 1 }));
    const selectedRects = Array.from(selectedRange.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      rects: selectedRects.length,
      floating: selectedRects
        .filter((rect) => !textBands.some((band) => rect.bottom >= band.top && rect.top <= band.bottom))
        .map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
    };
  });
  expect(result.rects).toBeGreaterThan(0);
  expect(result.floating).toEqual([]);
}

async function expectSelectionRectsTightToText(page: Page, rootSelector: string) {
  const result = await page.locator(rootSelector).evaluate((root) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return { rects: 0, overflow: [] as Array<object> };
    const selectedRange = selection.getRangeAt(0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textRects: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text) || !node.data.trim() || !selectedRange.intersectsNode(node)) continue;
      const range = document.createRange();
      const start = node === selectedRange.startContainer ? selectedRange.startOffset : 0;
      const end = node === selectedRange.endContainer ? selectedRange.endOffset : node.data.length;
      if (end <= start || !node.data.slice(start, end).trim()) continue;
      range.setStart(node, start);
      range.setEnd(node, end);
      textRects.push(...Array.from(range.getClientRects()));
    }
    const selectedRects = Array.from(selectedRange.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
      rects: selectedRects.length,
      overflow: selectedRects
        .map((rect) => {
          const lineRects = textRects.filter((textRect) => (
            textRect.width > 0
            && textRect.height > 0
            && rect.bottom >= textRect.top - 1
            && rect.top <= textRect.bottom + 1
          ));
          if (!lineRects.length) return { reason: "no-text", left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          const left = Math.min(...lineRects.map((textRect) => textRect.left));
          const right = Math.max(...lineRects.map((textRect) => textRect.right));
          const overflowLeft = left - rect.left;
          const overflowRight = rect.right - right;
          return overflowLeft > 10 || overflowRight > 10
            ? { left: rect.left, right: rect.right, textLeft: left, textRight: right, overflowLeft, overflowRight }
            : null;
        })
        .filter(Boolean),
    };
  });
  expect(result.rects).toBeGreaterThan(0);
  expect(result.overflow).toEqual([]);
}

async function expectNoRootWhitespaceText(page: Page, surface: SurfaceSelector) {
  const count = await page.locator(surface).evaluate((root) => (
    Array.from(root.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()).length
  ));
  expect(count).toBe(0);
}

for (const surface of ["#reader", "#preview"] as const) {
  test.describe(`${surface} rendered selection boundary`, () => {
    test("double-click selection stays inside the rendered text block", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<h1>Fast Workflows</h1>",
        "<p>Summarize:</p>",
        "<pre><code>aimd info report.aimd --json\naimd read report.aimd</code></pre>",
      ].join("\n\n"));

      await doubleClickText(page, `${surface} p`, "Summarize");
      await expect.poll(() => selectedText(page)).toMatch(/^Summarize:?$/);
      await expectSelectionRectsInside(page, `${surface} p`);
      await expectSelectionRectsOverlapText(page, `${surface} p`);
    });

    test("double-click ignores whitespace gaps before code and tables", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<p>Lead paragraph ends cleanly.</p>",
        "<pre><code>const value = 1;</code></pre>",
        "<table><thead><tr><th>产品</th><th>看点</th></tr></thead><tbody><tr><td>Gemma 4</td><td>加速</td></tr></tbody></table>",
      ].join("\n\n"));

      await expectNoRootWhitespaceText(page, surface);
      await doubleClickText(page, `${surface} p`, "cleanly");
      await expect.poll(() => selectedText(page)).toBe("cleanly");
      await expectSelectionRectsInside(page, `${surface} p`);
      await expectSelectionRectsOverlapText(page, `${surface} p`);
    });

    test("real Markdown render does not cross blank gaps into code or tables", async ({ page }) => {
      await openDoc(page);
      await showSurface(page, surface);
      const markdown = [
        "# Fast Workflows",
        "",
        "Summarize:",
        "",
        "```",
        "aimd info report.aimd --json",
        "aimd read report.aimd",
        "```",
        "",
        "| 产品 | 看点 |",
        "| --- | --- |",
        "| Gemma 4 | 加速 |",
      ].join("\n");
      await page.locator("#mode-edit").click();
      await page.locator("#markdown").fill(markdown);
      if (surface === "#reader") await page.locator("#mode-read").click();
      await expect(page.locator(`${surface} pre code`)).toContainText("aimd info");
      await expect(page.locator(`${surface} table td`).first()).toContainText("Gemma 4");

      const summaryBlock = `${surface} p:has-text("Summarize")`;
      await doubleClickText(page, summaryBlock, "Summarize");
      await expect.poll(() => selectedText(page)).toMatch(/^Summarize:?$/);
      await expectSelectionRectsInside(page, summaryBlock);
      await expectSelectionRectsOverlapText(page, summaryBlock);
    });

    test("drag selection to paragraph end does not include a trailing newline row", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<p>Google released Gemma four prediction drafters</p>",
        "<table><thead><tr><th>产品</th><th>看点</th></tr></thead><tbody><tr><td>Gemma 4</td><td>加速</td></tr></tbody></table>",
      ].join("\n\n"));

      await dragTextRange(page, `${surface} p`, "Google", "drafters");
      await expect.poll(() => selectedText(page)).toBe("Google released Gemma four prediction drafters");
      await expectSelectionRectsInside(page, `${surface} p`);
      await expectSelectionRectsOverlapText(page, `${surface} p`);
    });

    test("reverse drag selection keeps rendered text selectable", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<p>Google released Gemma four prediction drafters</p>",
        "<table><thead><tr><th>产品</th><th>看点</th></tr></thead><tbody><tr><td>Gemma 4</td><td>加速</td></tr></tbody></table>",
      ].join("\n\n"));

      await dragTextRangeReverse(page, `${surface} p`, "Google", "drafters");
      await expect.poll(() => selectedText(page)).toBe("Google released Gemma four prediction drafters");
      await expectSelectionRectsInside(page, `${surface} p`);
      await expectSelectionRectsOverlapText(page, `${surface} p`);
    });

    test("dragging toward a code boundary does not paint a floating highlight row", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<h1>Fast Workflows</h1>",
        "<p>Summarize:</p>",
        "<pre><code>aimd info report.aimd --json\naimd read report.aimd\naimd assets list report.aimd --json</code></pre>",
      ].join("\n\n"));

      await dragTextStartToGapBefore(page, `${surface} p`, "Summarize", `${surface} pre`);
      await expect.poll(() => selectedText(page)).toMatch(/^Summarize:?$/);
      await expectSelectionRectsInside(page, `${surface} p`);
      await expectSelectionRectsOverlapText(page, surface);
    });

    test("dragging toward a block gap is trimmed before pointer release", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<h1>Fast Workflows</h1>",
        "<p>Summarize:</p>",
        "<pre><code>aimd info report.aimd --json\naimd read report.aimd</code></pre>",
      ].join("\n\n"));

      try {
        await dragTextStartToGapBeforeRelease(page, `${surface} p`, "Summarize", `${surface} pre`, false);
        await expect.poll(() => selectedText(page)).toMatch(/^Summarize:?$/);
        await expectSelectionRectsInside(page, `${surface} p`);
        await expectSelectionRectsOverlapText(page, surface);
      } finally {
        await page.mouse.up();
      }
    });

    test("dragging past inline text end does not keep a long right-side highlight", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<p>Summarize:</p>",
        "<pre><code>aimd info report.aimd --json</code></pre>",
      ].join("\n\n"));

      try {
        await dragTextStartToInlineGap(page, `${surface} p`, "Summarize");
        await expect.poll(() => selectedText(page)).toMatch(/^Summarize:?$/);
        await expectSelectionRectsInside(page, `${surface} p`);
        await expectSelectionRectsTightToText(page, `${surface} p`);
      } finally {
        await page.mouse.up();
      }
    });

    test("table-cell drag selection does not paint an empty trailing row", async ({ page }) => {
      await openDoc(page);
      await paintFixtureHTML(page, surface, [
        "<table><thead><tr><th>产品</th><th>类型</th><th>看点</th></tr></thead><tbody>",
        "<tr><td>GPT-Realtime-2</td><td>实时语音模型</td><td>实时翻译</td></tr>",
        "<tr><td>Gemma 4 MTP drafters</td><td>开放模型推理加速</td><td>最高可带来 3 倍加速</td></tr>",
        "<tr><td>Claude 金融服务 agents</td><td>行业 agent 模板</td><td>金融任务模板</td></tr>",
        "</tbody></table>",
      ].join(""));

      const cell = `${surface} tbody tr:nth-child(2) td:nth-child(3)`;
      await dragTextRange(page, cell, "最高", "速");
      await expect.poll(() => selectedText(page)).toBe("最高可带来 3 倍加速");
      await expectSelectionRectsInside(page, cell);
      await expectSelectionRectsOverlapText(page, cell);
    });
  });
}
