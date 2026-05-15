import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { setStatus, updateChrome } from "../ui/chrome";
import { flushInline } from "../editor/inline";
import { markdownEl, formatPreviewPanelEl, formatPreviewTextEl, formatApplyEl, formatCancelEl, formatPreviewCancelXEl } from "../core/dom";
import { renderPreview } from "../ui/outline";
import { loadAppSettings } from "../core/settings";
import { hasAimdImageReferences } from "./assets";
import { splitFrontmatter } from "../markdown/frontmatter";
import { hasGitConflictMarkers } from "./apply";
import { beginTabOperation, isActiveOperationCurrent } from "./open-document-state";

let formatting = false;
let pendingMarkdown = "";
let pendingTabId = "";

type FormatMarkdownResult = {
  needed: boolean;
  reason?: string;
  markdown?: string;
};

function collectAssetRefs(markdown: string): string[] {
  return Array.from(markdown.matchAll(/asset:\/\/[^\s)"'>]+/g)).map((match) => match[0]);
}

function collectMarkdownLinkUrls(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^)]+["'])?\)/g))
    .map((match) => match[1])
    .filter((url) => !url.startsWith("asset://"));
}

function collectFencedCodeBlocks(markdown: string): string[] {
  return Array.from(markdown.matchAll(/```[\s\S]*?```/g)).map((match) => match[0]);
}

export function validateFormattedMarkdown(input: string, output: string): string[] {
  const reasons: string[] = [];
  const { body } = splitFrontmatter(output);
  if (!body.trim()) reasons.push("缺少正文");
  if (/^>\s*\*\*(摘要|summary|核心观点|key points?)\*\*/gim.test(body)) {
    reasons.push("摘要或核心观点仍在正文块引用中");
  }
  const outputFenceCount = (output.match(/```/g) || []).length;
  if (outputFenceCount % 2 !== 0) reasons.push("代码块围栏不完整");
  const outputCodeBlocks = new Set(collectFencedCodeBlocks(output));
  for (const block of collectFencedCodeBlocks(input)) {
    if (!outputCodeBlocks.has(block)) reasons.push("丢失或改写代码块");
  }
  const outputAssetRefs = new Set(collectAssetRefs(output));
  for (const ref of collectAssetRefs(input)) {
    if (!outputAssetRefs.has(ref)) reasons.push(`丢失资源引用 ${ref}`);
  }
  const outputLinks = new Set(collectMarkdownLinkUrls(output));
  for (const url of collectMarkdownLinkUrls(input)) {
    if (!outputLinks.has(url)) reasons.push(`丢失链接 ${url}`);
  }
  return reasons;
}

function showPreview(markdown: string, tabId: string) {
  pendingMarkdown = markdown;
  pendingTabId = tabId;
  formatPreviewTextEl().textContent = markdown;
  formatPreviewPanelEl().hidden = false;
  formatApplyEl().focus();
}

function hidePreview() {
  pendingMarkdown = "";
  pendingTabId = "";
  formatPreviewPanelEl().hidden = true;
}

export function bindFormatDocumentPanel() {
  formatCancelEl().addEventListener("click", () => {
    hidePreview();
    setStatus("已取消格式化", "info");
  });
  formatPreviewCancelXEl().addEventListener("click", () => {
    hidePreview();
    setStatus("已取消格式化", "info");
  });
  formatApplyEl().addEventListener("click", async () => {
    if (!state.doc || !pendingMarkdown || pendingTabId !== state.openDocuments.activeTabId) return;
    const markdown = pendingMarkdown;
    hidePreview();
    state.doc.markdown = markdown;
    state.doc.dirty = true;
    state.doc.hasExternalImageReferences = false;
    if (state.doc.format === "markdown") {
      state.doc.requiresAimdSave = hasAimdImageReferences(markdown) || state.doc.assets.length > 0;
      state.doc.needsAimdSave = state.doc.requiresAimdSave;
    }
    markdownEl().value = markdown;
    await renderPreview();
    updateChrome();
    setStatus("格式化结果已应用", "success");
  });
}

export async function formatCurrentDocument() {
  if (!state.doc || formatting) return;
  if (!state.doc.markdown.trim()) {
    setStatus("当前文档为空，无法格式化", "info");
    return;
  }
  if (state.doc.hasGitConflicts || hasGitConflictMarkers(state.doc.markdown)) {
    state.doc.hasGitConflicts = true;
    updateChrome();
    setStatus("文档包含 Git 冲突，请解决后再格式化", "warn");
    return;
  }
  if (state.mode === "edit") flushInline();
  const target = beginTabOperation();
  if (!target) return;
  formatting = true;
  setStatus("正在格式化文档...", "loading");
  try {
    const settings = await loadAppSettings();
    const config = settings.format;
    const result = await invoke<FormatMarkdownResult>("format_markdown", {
      markdown: state.doc.markdown,
      provider: config.provider,
      model: config.model,
      outputLanguage: config.outputLanguage,
    });
    if (!isActiveOperationCurrent(target)) return;
    if (!result.needed) {
      hidePreview();
      console.info("format_markdown skipped", result.reason || "");
      setStatus("当前文档已经比较工整，无需格式化", "info");
      return;
    }
    if (!result.markdown) {
      setStatus("格式化结果不完整，已保留原文", "warn");
      return;
    }
    const reasons = validateFormattedMarkdown(state.doc.markdown, result.markdown);
    if (reasons.length) {
      console.warn("format_markdown validation failed", reasons);
      setStatus("格式化结果不完整，已保留原文", "warn");
      return;
    }
    showPreview(result.markdown, target.tabId);
    setStatus("格式化完成，请确认应用", "info");
  } catch (err) {
    console.error(err);
    setStatus(`格式化失败: ${String(err)}`, "warn");
  } finally {
    formatting = false;
  }
}

export function isFormatting() {
  return formatting;
}
