import { test, expect, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const markdown = [
  "# Source Stable",
  "",
  "### 1. OpenAI 推出 Deployment Company",
  "",
  "Paragraph with [OpenAI](https://openai.com \"OpenAI title\") link.",
  "",
  "- **Forward Deployed Engineer**：嵌入客户组织。",
  "",
  "| Name | Score |",
  "| --- | --- |",
  "| Alice | 90 |",
  "",
].join("\n");

async function installSourcePreserveMock(page: Page) {
  await page.addInitScript((initialMarkdown: string) => {
    type Args = Record<string, any> | undefined;
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const render = (md: string) => {
      const blocks: string[] = [];
      const lines = md.split(/\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.startsWith("# ")) blocks.push(`<h1>${line.slice(2)}</h1>`);
        else if (line.startsWith("### ")) blocks.push(`<h3>${line.slice(4)}</h3>`);
        else if (line.startsWith("- ")) blocks.push(`<ul><li>${line.slice(2).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</li></ul>`);
        else if (line.startsWith("Paragraph")) blocks.push(`<p>${line.replace(/\[([^\]]+)\]\(([^ "]+) "([^"]+)"\)/g, '<a href="$2" title="$3">$1</a>')}</p>`);
        else if (line.startsWith("| Name |")) {
          blocks.push("<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>90</td></tr></tbody></table>");
          i += 2;
        }
      }
      return { html: blocks.join("") };
    };
    const doc = {
      path: "/mock/source-stable.aimd",
      title: "Source Stable",
      markdown: initialMarkdown,
      html: render(initialMarkdown).html,
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      save_aimd: (a) => ({ ...doc, markdown: String(a?.markdown ?? ""), dirty: false }),
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
  }, markdown);
}

async function installInlineImageMock(page: Page, initialMarkdown: string) {
  await page.addInitScript((markdownWithImage: string) => {
    type Args = Record<string, any> | undefined;
    const calls: Array<{ cmd: string; args?: Args }> = [];
    const renderInline = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const render = (md: string) => ({
      html: md.split(/\n/).map((line) => {
        if (line.startsWith("# ")) return `<h1>${renderInline(line.slice(2))}</h1>`;
        if (line.startsWith("### ")) return `<h3>${renderInline(line.slice(4))}</h3>`;
        if (line.startsWith("- ")) return `<ul><li>${renderInline(line.slice(2))}</li></ul>`;
        if (line.trim()) return `<p>${renderInline(line)}</p>`;
        return "";
      }).join(""),
    });
    const doc = {
      path: "/mock/inline-image.aimd",
      title: "Inline Image",
      markdown: markdownWithImage,
      html: render(markdownWithImage).html,
      assets: [],
      dirty: false,
      format: "aimd",
    };
    const handlers: Record<string, (a?: Args) => unknown> = {
      initial_open_path: () => null,
      choose_doc_file: () => doc.path,
      open_aimd: () => doc,
      save_aimd: (a) => ({ ...doc, markdown: String(a?.markdown ?? ""), dirty: false }),
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

function readHeadExampleMarkdown() {
  const dir = mkdtempSync(join(tmpdir(), "aimd-example-"));
  const aimdPath = join(dir, "ai-daily-head.aimd");
  const bytes = execFileSync("git", ["show", "HEAD:examples/ai-daily-2026-04-30.aimd"]);
  writeFileSync(aimdPath, bytes);
  return execFileSync("aimd", ["read", aimdPath], { encoding: "utf8" });
}

test.describe("source-preserving visual editor", () => {
  test("visual text edits patch only dirty source ranges", async ({ page }) => {
    await installSourcePreserveMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    await page.locator("#inline-editor h3").evaluate((el: HTMLElement) => {
      el.textContent = `${el.textContent}1`;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "1" }));
    });
    await page.locator("#inline-editor tbody td").nth(1).evaluate((el: HTMLElement) => {
      el.textContent = "91";
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "1" }));
    });

    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.some((call) => call.cmd === "save_aimd");
    });

    const saved = await page.evaluate(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.find((call) => call.cmd === "save_aimd")?.args?.markdown as string;
    });
    const expected = markdown
      .replace("### 1. OpenAI 推出 Deployment Company", "### 1. OpenAI 推出 Deployment Company1")
      .replace("| Alice | 90 |", "| Alice | 91 |");

    expect(saved).toBe(expected);
    expect(saved).toContain("- **Forward Deployed Engineer**：嵌入客户组织。");
    expect(saved).toContain('[OpenAI](https://openai.com "OpenAI title")');
    expect(saved).not.toContain("### 1\\.");
    expect(saved).not.toContain("-   **Forward");
  });

  test("visual text edits next to an inline asset image preserve source style", async ({ page }) => {
    const inlineImageMarkdown = [
      "# AI 日报",
      "",
      "今天 AI 圈的主线是：**前沿模型竞争正在从单点模型发布，转向企业落地。** 模型能力仍在提升。![aimd paste image](asset://ai-daily-image-001)",
      "",
      "### 1. OpenAI 推出 Deployment Company",
      "",
      "- **Forward Deployed Engineer**：嵌入客户组织。",
      "",
    ].join("\n");
    await installInlineImageMock(page, inlineImageMarkdown);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

    await page.locator("#inline-editor p").first().evaluate((el: HTMLElement) => {
      const text = Array.from(el.childNodes).find((node) =>
        node.nodeType === Node.TEXT_NODE && (node.textContent || "").includes("模型能力仍在提升。")
      );
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("paragraph text node missing");
      text.textContent = `${text.textContent}1`;
      const range = document.createRange();
      range.setStart(text, text.textContent.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "1" }));
    });
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.some((call) => call.cmd === "save_aimd");
    });

    const saved = await page.evaluate(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.find((call) => call.cmd === "save_aimd")?.args?.markdown as string;
    });
    const expected = inlineImageMarkdown.replace(
      "模型能力仍在提升。![aimd paste image]",
      "模型能力仍在提升。1![aimd paste image]",
    );
    expect(saved).toBe(expected);
    expect(saved).toContain("### 1. OpenAI 推出 Deployment Company");
    expect(saved).toContain("- **Forward Deployed Engineer**：嵌入客户组织。");
    expect(saved).toContain("![aimd paste image](asset://ai-daily-image-001)");
    expect(saved).not.toContain("### 1\\.");
    expect(saved).not.toContain("-   **Forward");
  });

  test("unsafe structural edits block save instead of full-document serialization", async ({ page }) => {
    await installSourcePreserveMock(page);
    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();

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

  test("real ai-daily AIMD heading edit does not rewrite Markdown style", async ({ page }) => {
    const exampleMarkdown = readHeadExampleMarkdown();
    await page.addInitScript((initialMarkdown: string) => {
      type Args = Record<string, any> | undefined;
      const calls: Array<{ cmd: string; args?: Args }> = [];
      const render = (md: string) => ({
        html: md.split(/\n/).map((line) => {
          if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
          if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
          if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
          if (line.startsWith("- ")) return `<ul><li>${line.slice(2).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</li></ul>`;
          if (/^(?:\*\s*){3,}$/.test(line.trim())) return "<hr>";
          return "";
        }).join(""),
      });
      const doc = {
        path: "/mock/ai-daily-2026-04-30.aimd",
        title: "AI 日报",
        markdown: initialMarkdown,
        html: render(initialMarkdown).html,
        assets: [],
        dirty: false,
        format: "aimd",
      };
      const handlers: Record<string, (a?: Args) => unknown> = {
        initial_open_path: () => null,
        choose_doc_file: () => doc.path,
        open_aimd: () => doc,
        save_aimd: (a) => ({ ...doc, markdown: String(a?.markdown ?? ""), dirty: false }),
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
    }, exampleMarkdown);

    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor h3").first().evaluate((el: HTMLElement) => {
      el.textContent = `${el.textContent}1`;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "1" }));
    });
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.some((call) => call.cmd === "save_aimd");
    });

    const saved = await page.evaluate(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.find((call) => call.cmd === "save_aimd")?.args?.markdown as string;
    });
    const originalHeading = "### 1. OpenAI 推出 Deployment Company，企业 AI 进入“前线工程师”阶段";
    expect(saved).toBe(exampleMarkdown.replace(originalHeading, `${originalHeading}1`));
    expect(saved).toContain("- **Forward Deployed Engineer**：嵌入客户组织、把模型能力连接到真实业务流程和生产系统的工程角色。");
    expect(saved).not.toContain("### 1\\.");
    expect(saved).not.toContain("-   **Forward");
  });

  test("frontmatter, CRLF, ordered lists, and task markers survive unrelated visual edits", async ({ page }) => {
    const crlfMarkdown = [
      "---",
      "title: Stable",
      "---",
      "",
      "# Stable",
      "",
      "## Section 1.0",
      "",
      "1. Ordered item",
      "- [ ] Task item",
      "",
    ].join("\r\n");
    await page.addInitScript((initialMarkdown: string) => {
      type Args = Record<string, any> | undefined;
      const calls: Array<{ cmd: string; args?: Args }> = [];
      const render = (md: string) => ({
        html: md.split(/\n/).map((raw) => {
          const line = raw.replace(/\r$/, "");
          if (line === "---" || line.startsWith("title:")) return "";
          if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
          if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
          if (/^\d+\. /.test(line)) return `<ol><li>${line.replace(/^\d+\. /, "")}</li></ol>`;
          if (line.startsWith("- [ ] ")) return `<ul><li><input type="checkbox" disabled> ${line.slice(6)}</li></ul>`;
          return "";
        }).join(""),
      });
      const doc = {
        path: "/mock/stable-crlf.aimd",
        title: "Stable",
        markdown: initialMarkdown,
        html: render(initialMarkdown).html,
        assets: [],
        dirty: false,
        format: "aimd",
      };
      const handlers: Record<string, (a?: Args) => unknown> = {
        initial_open_path: () => null,
        choose_doc_file: () => doc.path,
        open_aimd: () => doc,
        save_aimd: (a) => ({ ...doc, markdown: String(a?.markdown ?? ""), dirty: false }),
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
    }, crlfMarkdown);

    await page.goto("/");
    await page.locator("#empty-open").click();
    await page.locator("#mode-edit").click();
    await page.locator("#inline-editor h2").evaluate((el: HTMLElement) => {
      el.textContent = `${el.textContent}x`;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.querySelector("#inline-editor")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    });
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.some((call) => call.cmd === "save_aimd");
    });

    const saved = await page.evaluate(() => {
      const calls = (window as any).__aimd_calls as Array<{ cmd: string; args?: any }>;
      return calls.find((call) => call.cmd === "save_aimd")?.args?.markdown as string;
    });
    expect(saved).toBe(crlfMarkdown.replace("## Section 1.0", "## Section 1.0x"));
    expect(saved).toContain("---\r\ntitle: Stable\r\n---");
    expect(saved).toContain("1. Ordered item");
    expect(saved).toContain("- [ ] Task item");
  });
});
