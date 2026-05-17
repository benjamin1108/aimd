import { test, expect, Page, Locator } from "@playwright/test";

type Args = Record<string, any> | undefined;

const STRESS_MARKDOWN = [
  "---",
  "title: Source Preserve Stress",
  "summary: Keeps frontmatter and source style stable",
  "---",
  "",
  "# Source Preserve Stress",
  "",
  "### 1. Heading With Dot",
  "",
  "Paragraph **bold** and *em* with [OpenAI](https://openai.com \"OpenAI title\") plus `code` and escaped 1\\. literal.",
  "",
  "Paragraph before image.![Chart](asset://chart-001)",
  "",
  "> Quote body with **bold** marker.",
  "",
  "- **Bullet item** keeps marker.",
  "- [ ] Task item keeps marker.",
  "1. Ordered item keeps number.",
  "2. Ordered second keeps number.",
  "",
  "| Name | Score | Note |",
  "| --- | ---: | --- |",
  "| Alice | 90 | stable |",
  "| Bob | 91 | steady |",
  "",
  "* * *",
  "",
  "```ts",
  "const untouched = \"code\";",
  "```",
  "",
  "___",
  "",
  "Final paragraph after rules.",
  "",
].join("\n");

async function installStressMock(page: Page, initialMarkdown = STRESS_MARKDOWN) {
  await page.addInitScript((seed: string) => {
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const escapeHtml = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const renderInline = (value: string) => escapeHtml(value)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^ "]+) "([^"]+)"\)/g, '<a href="$2" title="$3">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    const isRule = (line: string) => /^(?:\*\s*){3,}$/.test(line.trim())
      || /^(?:-\s*){3,}$/.test(line.trim())
      || /^(?:_\s*){3,}$/.test(line.trim());
    const render = (md: string) => {
      const lines = md.split(/\n/);
      const html: string[] = [];
      let i = 0;
      if (lines[0] === "---") {
        let end = 1;
        while (end < lines.length && lines[end] !== "---") end += 1;
        if (end < lines.length) {
          html.push('<section class="aimd-frontmatter"><dl><dt>title</dt><dd>Source Preserve Stress</dd></dl></section>');
          i = end + 1;
        }
      }
      for (; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        if (/^```/.test(line)) {
          const code: string[] = [];
          i += 1;
          while (i < lines.length && !/^```/.test(lines[i])) {
            code.push(lines[i]);
            i += 1;
          }
          html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        } else if (line.startsWith("# ")) {
          html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
        } else if (line.startsWith("### ")) {
          html.push(`<h3>${renderInline(line.slice(4))}</h3>`);
        } else if (line.startsWith("> ")) {
          html.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
        } else if (line.startsWith("- ")) {
          const task = /^- \[([ xX])\] (.*)$/.exec(line);
          const body = task ? `<input type="checkbox"${task[1].toLowerCase() === "x" ? " checked" : ""}> ${renderInline(task[2])}` : renderInline(line.slice(2));
          html.push(`<ul><li>${body}</li></ul>`);
        } else if (/^\d+[.)]\s+/.test(line)) {
          html.push(`<ol><li>${renderInline(line.replace(/^\d+[.)]\s+/, ""))}</li></ol>`);
        } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) {
          const header = line.split("|").slice(1, -1).map((cell) => `<th>${renderInline(cell.trim())}</th>`).join("");
          const rows: string[] = [];
          i += 2;
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
            rows.push(`<tr>${lines[i].split("|").slice(1, -1).map((cell) => `<td>${renderInline(cell.trim())}</td>`).join("")}</tr>`);
            i += 1;
          }
          i -= 1;
          html.push(`<table><thead><tr>${header}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
        } else if (isRule(line)) {
          html.push("<hr>");
        } else {
          html.push(`<p>${renderInline(line)}</p>`);
        }
      }
      return { html: html.join("") };
    };
    let doc = {
      path: "/mock/source-preserve-stress.aimd",
      title: "Source Preserve Stress",
      markdown: seed,
      html: render(seed).html,
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      save_aimd: (a) => {
        doc = { ...doc, markdown: String(a?.markdown ?? ""), html: render(String(a?.markdown ?? "")).html, dirty: false };
        return doc;
      },
      render_markdown: (a) => render(String(a?.markdown ?? "")),
      render_markdown_standalone: (a) => render(String(a?.markdown ?? "")),
      list_aimd_assets: () => [],
      cleanup_old_drafts: () => undefined,
    };
    (window as any).__aimd_calls = calls;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Args) => {
        calls.push({ cmd, args });
        const handler = handlers[cmd];
        if (!handler) throw new Error(`mock invoke: unknown command ${cmd}`);
        return handler(args);
      },
      transformCallback: (callback: Function) => callback,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  }, initialMarkdown);
}

async function openVisualEditor(page: Page) {
  await page.goto("/");
  await page.locator("#empty-open").click();
  await page.locator("#mode-edit").click();
}

async function appendText(target: Locator, marker: string, contains?: string) {
  await target.evaluate((root: HTMLElement, { value, needle }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text;
      if (!needle || (candidate.textContent || "").includes(needle)) {
        text = candidate;
        break;
      }
    }
    if (!text) throw new Error(`text node not found: ${needle || "<first>"}`);
    text.textContent = `${text.textContent}${value}`;
    const range = document.createRange();
    range.setStart(text, text.textContent.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }, { value: marker, needle: contains });
}

async function savedMarkdown(page: Page) {
  await page.keyboard.press("Meta+s");
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
    return calls.filter((call) => call.cmd === "save_aimd").length;
  })).toBe(1);
  return page.evaluate(() => {
    const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
    return calls.find((call) => call.cmd === "save_aimd")?.args?.markdown as string;
  });
}

function expectNoSerializerChurn(markdown: string) {
  expect(markdown).toContain('[OpenAI](https://openai.com "OpenAI title")');
  expect(markdown).toContain("### 1. Heading With Dot");
  expect(markdown).toContain("* * *");
  expect(markdown).toContain("___");
  expect(markdown).toContain("- **Bullet item** keeps marker");
  expect(markdown).not.toContain("### 1\\.");
  expect(markdown).not.toContain("-   **Bullet");
  expect(markdown).not.toContain("1\\. Ordered");
}

test.describe("source-preserving visual editor stress suite", () => {
  const cases: Array<{
    name: string;
    selector: string;
    marker: string;
    needle?: string;
    replace: [string, string];
  }> = [
    {
      name: "heading with ordered-number text",
      selector: "#inline-editor h3",
      marker: " X",
      replace: ["### 1. Heading With Dot", "### 1. Heading With Dot X"],
    },
    {
      name: "paragraph with link title, inline code, emphasis, and escaped dot",
      selector: "#inline-editor p",
      marker: " X",
      needle: "escaped",
      replace: [
        "Paragraph **bold** and *em* with [OpenAI](https://openai.com \"OpenAI title\") plus `code` and escaped 1\\. literal.",
        "Paragraph **bold** and *em* with [OpenAI](https://openai.com \"OpenAI title\") plus `code` and escaped 1\\. literal. X",
      ],
    },
    {
      name: "paragraph text immediately before an inline asset image",
      selector: "#inline-editor p",
      marker: " X",
      needle: "Paragraph before image.",
      replace: [
        "Paragraph before image.![Chart](asset://chart-001)",
        "Paragraph before image. X![Chart](asset://chart-001)",
      ],
    },
    {
      name: "blockquote with inline strong text",
      selector: "#inline-editor blockquote",
      marker: " X",
      needle: "marker.",
      replace: ["> Quote body with **bold** marker.", "> Quote body with **bold** marker. X"],
    },
    {
      name: "unordered list item with strong span",
      selector: "#inline-editor li",
      marker: " X",
      needle: "keeps marker.",
      replace: ["- **Bullet item** keeps marker.", "- **Bullet item** keeps marker. X"],
    },
    {
      name: "task list item",
      selector: "#inline-editor li",
      marker: " X",
      needle: "Task item",
      replace: ["- [ ] Task item keeps marker.", "- [ ] Task item keeps marker. X"],
    },
    {
      name: "ordered list item",
      selector: "#inline-editor ol li",
      marker: " X",
      replace: ["1. Ordered item keeps number.", "1. Ordered item keeps number. X"],
    },
    {
      name: "paragraph after existing thematic breaks and code block",
      selector: "#inline-editor p",
      marker: " X",
      needle: "Final paragraph",
      replace: ["Final paragraph after rules.", "Final paragraph after rules. X"],
    },
  ];

  for (const item of cases) {
    test(`ordinary edit preserves source shape: ${item.name}`, async ({ page }) => {
      await installStressMock(page);
      await openVisualEditor(page);
      await appendText(page.locator(item.selector).filter({ hasText: item.needle ?? undefined }).first(), item.marker, item.needle);
      const saved = await savedMarkdown(page);
      expect(saved).toBe(STRESS_MARKDOWN.replace(item.replace[0], item.replace[1]));
      expectNoSerializerChurn(saved);
    });
  }

  test("multiple dirty refs flush together without rewriting untouched Markdown", async ({ page }) => {
    await installStressMock(page);
    await openVisualEditor(page);
    await appendText(page.locator("#inline-editor h3").first(), " H");
    await appendText(page.locator("#inline-editor p").filter({ hasText: "Paragraph before image." }).first(), " P", "Paragraph before image.");
    await appendText(page.locator("#inline-editor li").filter({ hasText: "Task item" }).first(), " T", "Task item");
    await page.locator("#inline-editor tbody tr").nth(1).locator("td").nth(2).evaluate((el: HTMLElement) => {
      el.textContent = "steady CELL";
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " CELL" }));
    });

    const expected = STRESS_MARKDOWN
      .replace("### 1. Heading With Dot", "### 1. Heading With Dot H")
      .replace("Paragraph before image.![Chart](asset://chart-001)", "Paragraph before image. P![Chart](asset://chart-001)")
      .replace("- [ ] Task item keeps marker.", "- [ ] Task item keeps marker. T")
      .replace("| Bob | 91 | steady |", "| Bob | 91 | steady CELL |");
    const saved = await savedMarkdown(page);
    expect(saved).toBe(expected);
    expectNoSerializerChurn(saved);
  });

  test("safe appended structure is serialized only as a new tail region", async ({ page }) => {
    await installStressMock(page);
    await openVisualEditor(page);
    await page.locator("#inline-editor").evaluate((root: HTMLElement) => {
      const p = document.createElement("p");
      p.textContent = "Appended structural paragraph.";
      root.appendChild(p);
      const range = document.createRange();
      range.setStartAfter(p);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertParagraph" }));
    });

    const saved = await savedMarkdown(page);
    expect(saved).toBe(`${STRESS_MARKDOWN.trimEnd()}\n\nAppended structural paragraph.\n`);
    expectNoSerializerChurn(saved);
  });

  test("mid-document unsupported structure blocks save and never falls back to whole-document serialization", async ({ page }) => {
    await installStressMock(page);
    await openVisualEditor(page);
    await page.locator("#inline-editor h3").evaluate((el: HTMLElement) => {
      const hr = document.createElement("hr");
      el.before(hr);
      const range = document.createRange();
      range.setStartAfter(hr);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertHTML" }));
    });
    await page.keyboard.press("Meta+s");

    await expect(page.locator("#status")).toContainText("不能安全保持 Markdown 原文");
    const saveCalls = await page.evaluate(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.filter((call) => call.cmd === "save_aimd").length;
    });
    expect(saveCalls).toBe(0);
  });

  test("fenced code block edits patch only the code body", async ({ page }) => {
    await installStressMock(page);
    await openVisualEditor(page);
    await appendText(page.locator("#inline-editor pre code").first(), " X");
    const saved = await savedMarkdown(page);
    expect(saved).toBe(STRESS_MARKDOWN.replace(
      'const untouched = "code";',
      'const untouched = "code"; X',
    ));
    expectNoSerializerChurn(saved);
  });
});
