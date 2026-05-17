import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { DocumentHealthReport, ExportMarkdownResult } from "../core/types";
import { setStatus, displayDocTitle } from "../ui/chrome";
import { fileStem } from "../util/path";
import { showHealthReport } from "./health";

function currentMarkdown(): string | null {
  return state.doc?.markdown ?? "";
}

function suggestedBaseName(): string {
  const doc = state.doc;
  if (!doc) return "document";
  return fileStem(doc.path) || displayDocTitle(doc).replace(/[\\/:*?"<>|]+/g, "-") || "document";
}

async function checkBeforeExport(markdown: string): Promise<boolean> {
  if (!state.doc) return false;
  try {
    const report = await invoke<DocumentHealthReport>("check_document_health", {
      path: state.doc.path || null,
      markdown,
    });
    if (report.status === "missing") {
      showHealthReport(report);
      setStatus("导出前发现缺失资源，请先修复", "warn");
      return false;
    }
    if (report.status === "risk") {
      showHealthReport(report);
      setStatus("导出前发现资源风险，已继续导出", "info");
    }
  } catch {
    // 不让健康检查失败阻断用户导出；具体导出命令仍会给出错误。
  }
  return true;
}

export async function exportMarkdownAssets() {
  if (!state.doc) return;
  if (state.doc.format === "markdown") {
    setStatus("当前已经是 Markdown 文档", "info");
    return;
  }
  const markdown = currentMarkdown();
  if (markdown === null) return;
  if (!await checkBeforeExport(markdown)) return;
  const outputDir = await invoke<string | null>("choose_export_markdown_dir");
  if (!outputDir) {
    setStatus("导出已取消", "info");
    return;
  }
  setStatus("正在导出 Markdown", "loading");
  try {
    const result = await invoke<ExportMarkdownResult>("export_markdown_assets", {
      path: state.doc.path || "",
      markdown,
      outputDir,
    });
    setStatus(`已导出 Markdown: ${result.markdownPath}`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`导出 Markdown 失败: ${String(err)}`, "warn");
  }
}

export async function exportHTML() {
  if (!state.doc) return;
  const markdown = currentMarkdown();
  if (markdown === null) return;
  if (!await checkBeforeExport(markdown)) return;
  const outputPath = await invoke<string | null>("choose_export_html_file", {
    suggestedName: `${suggestedBaseName()}.html`,
  });
  if (!outputPath) {
    setStatus("导出已取消", "info");
    return;
  }
  setStatus("正在导出 HTML", "loading");
  try {
    await invoke("export_html", {
      path: state.doc.path || "",
      markdown,
      outputPath,
    });
    setStatus(`已导出 HTML: ${outputPath}`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`导出 HTML 失败: ${String(err)}`, "warn");
  }
}

export async function exportPDF() {
  if (!state.doc) return;
  const markdown = currentMarkdown();
  if (markdown === null) return;
  if (!await checkBeforeExport(markdown)) return;
  const outputPath = await invoke<string | null>("choose_export_pdf_file", {
    suggestedName: `${suggestedBaseName()}.pdf`,
  });
  if (!outputPath) {
    setStatus("导出已取消", "info");
    return;
  }
  setStatus("正在导出 PDF", "loading");
  try {
    await invoke("export_pdf", {
      path: state.doc.path || "",
      markdown,
      outputPath,
    });
    setStatus(`已导出 PDF: ${outputPath}`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`导出 PDF 失败: ${String(err)}`, "warn");
  }
}
