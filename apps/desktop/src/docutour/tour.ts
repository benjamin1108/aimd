import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import {
  docuTourCountEl,
  docuTourGenerateEl,
  docuTourGenerateLabelEl,
  docuTourPanelEl,
  docuTourSectionEl,
  markdownEl,
  panelEl,
  readerEl,
} from "../core/dom";
import type { AimdDocument, DocuTourScript } from "../core/types";
import { setMode } from "../ui/mode";
import { renderPreview } from "../ui/outline";
import { setStatus, updateChrome } from "../ui/chrome";
import { collectDocuTourAnchors } from "./anchors";
import { loadDocuTourConfig } from "../core/settings";
import { extractDocuTour, removeDocuTour } from "./frontmatter";

let active = false;
let stepIndex = 0;
let overlay: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let activeRegion: HTMLElement | null = null;
let generating = false;
let controlsBound = false;
let keyboardBound = false;
let previousPanelColumns: string | null = null;

export function currentDocuTour(): DocuTourScript | null {
  if (!state.doc) return null;
  return state.doc.docuTour || extractDocuTour(state.doc.markdown);
}

export function hasDocuTour() {
  return Boolean(currentDocuTour()?.steps.length);
}

function ensureStage() {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "docutour-overlay";
    document.body.appendChild(overlay);
  }
  docuTourSectionEl().hidden = false;
  if (previousPanelColumns === null) {
    previousPanelColumns = panelEl().style.gridTemplateColumns;
  }
  const tourWidth = Math.min(Math.max(440, Math.round(window.innerWidth * 0.34)), 560);
  panelEl().style.gridTemplateColumns = `${tourWidth}px minmax(0, 1fr)`;
  if (!controlsBound) {
    docuTourPanelEl().querySelector<HTMLElement>("[data-tour-exit]")?.addEventListener("click", stopDocuTour);
    docuTourPanelEl().querySelector<HTMLElement>("[data-tour-prev]")?.addEventListener("click", previousDocuTourStep);
    docuTourPanelEl().querySelector<HTMLElement>("[data-tour-next]")?.addEventListener("click", nextDocuTourStep);
    controlsBound = true;
  }
  if (!keyboardBound) {
    document.addEventListener("keydown", handleDocuTourKeydown);
    keyboardBound = true;
  }
}

function shouldIgnoreKeyEvent(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function handleDocuTourKeydown(event: KeyboardEvent) {
  if (!active || shouldIgnoreKeyEvent(event)) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    previousDocuTourStep();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nextDocuTourStep();
  } else if (event.key === "Escape") {
    event.preventDefault();
    stopDocuTour();
  }
}

function setActiveTarget(target: HTMLElement | null) {
  activeTarget?.classList.remove("docutour-highlight");
  activeRegion?.classList.remove("docutour-highlight-region");
  activeTarget = target;
  activeRegion = target ? readableRegionFor(target) : null;
  if (activeRegion && activeRegion !== activeTarget) {
    activeRegion.classList.add("docutour-highlight-region");
  } else {
    activeTarget?.classList.add("docutour-highlight");
  }
}

function findTarget(id: string) {
  return readerEl().querySelector<HTMLElement>(`#${CSS.escape(id)}`);
}

function readableRegionFor(target: HTMLElement) {
  const tag = target.tagName.toLowerCase();
  if (!/^h[1-4]$/.test(tag)) return target;

  const level = Number(tag.slice(1));
  const siblings: HTMLElement[] = [target];
  let node = target.nextElementSibling as HTMLElement | null;
  while (node && siblings.length < 8) {
    if (/^h[1-4]$/i.test(node.tagName)) {
      const nextLevel = Number(node.tagName.slice(1));
      if (nextLevel <= level) break;
    }
    if (!node.closest(".aimd-frontmatter")) {
      siblings.push(node);
    }
    const textLength = siblings.map((el) => el.textContent || "").join(" ").trim().length;
    if (textLength > 1200) break;
    node = node.nextElementSibling as HTMLElement | null;
  }

  if (siblings.length <= 1) return target;
  const region = document.createElement("div");
  region.className = "docutour-highlight-region";
  target.before(region);
  for (const el of siblings) region.appendChild(el);
  return region;
}

function renderStep(script: DocuTourScript) {
  if (!active) return;
  const step = script.steps[stepIndex];
  if (!step) {
    stopDocuTour();
    setStatus("导览播放完毕", "success");
    return;
  }
  const target = findTarget(step.targetId);
  if (!target) {
    nextDocuTourStep();
    return;
  }
  setActiveTarget(target);
  const label = step.label?.trim() || `第 ${stepIndex + 1} 步`;
  const insight = step.insight?.trim() || step.narration?.trim() || "";
  const why = step.why?.trim() || "";
  const next = step.next?.trim() || "";
  const panel = docuTourPanelEl();
  panel.style.setProperty("--docutour-progress", `${((stepIndex + 1) / script.steps.length) * 100}%`);
  docuTourCountEl().textContent = String(script.steps.length);
  panel.querySelector<HTMLElement>(".docutour-counter")!.textContent =
    `${stepIndex + 1} / ${script.steps.length}`;
  const metaEl = panel.querySelector<HTMLElement>(".docutour-meta")!;
  const meta = [script.documentType, script.summary].filter(Boolean).join(" · ");
  metaEl.textContent = meta;
  metaEl.hidden = !meta;
  panel.querySelector<HTMLElement>(".docutour-step-title")!.textContent = label;
  const whyEl = panel.querySelector<HTMLElement>(".docutour-why")!;
  whyEl.textContent = why ? `为什么看这里：${why}` : "";
  whyEl.hidden = !why;
  panel.querySelector<HTMLElement>(".docutour-insight")!.textContent = insight;
  const nextEl = panel.querySelector<HTMLElement>(".docutour-next")!;
  nextEl.textContent = next ? `下一步：${next}` : "";
  nextEl.hidden = !next;
  panel.querySelector<HTMLButtonElement>("[data-tour-prev]")!.disabled = stepIndex === 0;
  panel.querySelector<HTMLButtonElement>("[data-tour-next]")!.textContent =
    stepIndex >= script.steps.length - 1 ? "完成" : "下一步";
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

export function stopDocuTour() {
  active = false;
  setActiveTarget(null);
  overlay?.remove();
  overlay = null;
  docuTourSectionEl().hidden = true;
  if (previousPanelColumns !== null) {
    panelEl().style.gridTemplateColumns = previousPanelColumns;
    previousPanelColumns = null;
  }
  document.body.classList.remove("docutour-active");
  updateChrome();
}

export function nextDocuTourStep() {
  const script = currentDocuTour();
  if (!script) return;
  if (stepIndex >= script.steps.length - 1) {
    stopDocuTour();
    setStatus("导览已结束", "success");
    return;
  }
  stepIndex += 1;
  renderStep(script);
}

export function previousDocuTourStep() {
  const script = currentDocuTour();
  if (!script) return;
  stepIndex = Math.max(0, stepIndex - 1);
  renderStep(script);
}

export function startDocuTour() {
  const script = currentDocuTour();
  if (!script?.steps.length) {
    setStatus("当前文档还没有导览脚本", "info");
    return;
  }
  setMode("read");
  stopDocuTour();
  ensureStage();
  document.body.classList.add("docutour-active");
  active = true;
  stepIndex = 0;
  setStatus("导览已打开，可手动切换步骤", "info");
  renderStep(script);
}

export async function generateDocuTour() {
  if (!state.doc) return;
  if (generating) return;
  let config;
  try {
    config = await loadDocuTourConfig();
  } catch (err) {
    console.error(err);
    setStatus("读取设置失败，请打开设置重试", "warn");
    return;
  }
  if (!config.apiKey.trim()) {
    setStatus("请先在设置中填写模型 API Key", "warn");
    return;
  }
  if (!state.doc.path || state.doc.isDraft || state.doc.format === "markdown") {
    setStatus("请先保存为 .aimd，再生成导读", "warn");
    return;
  }
  setMode("read");
  const anchors = collectDocuTourAnchors(readerEl()).slice(0, 80);
  if (anchors.length === 0) {
    setStatus("未找到可导览的锚点", "warn");
    return;
  }
  setStatus("正在生成导览脚本", "loading");
  generating = true;
  docuTourGenerateEl().disabled = true;
  docuTourGenerateEl().classList.add("is-generating");
  docuTourGenerateLabelEl().textContent = "生成中";
  try {
    const script = await invoke<DocuTourScript>("generate_docu_tour", {
      markdown: state.doc.markdown,
      anchors,
      config,
    });
    const validTargets = new Set(anchors.map((anchor) => anchor.id));
    const clean: DocuTourScript = {
      version: script.version || 2,
      title: script.title || "Docu-Tour",
      documentType: script.documentType,
      summary: script.summary,
      readingStrategy: script.readingStrategy,
      steps: script.steps
        .filter((step) =>
          validTargets.has(step.targetId)
          && Boolean((step.insight || step.narration || step.why || step.label || "").trim())
        )
        .slice(0, config.maxSteps),
    };
    if (!clean.steps.length) throw new Error("模型没有返回可用导览步骤");
    const cleanedMarkdown = removeDocuTour(state.doc.markdown);
    const saved = await invoke<AimdDocument>("save_docu_tour", {
      path: state.doc.path,
      markdown: cleanedMarkdown,
      script: clean,
    });
    if (!saved) throw new Error("导读保存失败");
    state.doc = {
      ...state.doc,
      ...saved,
      markdown: cleanedMarkdown,
      docuTour: clean,
      dirty: false,
      isDraft: false,
      format: "aimd",
    };
    markdownEl().value = state.doc.markdown;
    await renderPreview();
    updateChrome();
    setStatus(`导览脚本已生成（${clean.steps.length} 步）`, "success");
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "导览生成失败", "warn");
  } finally {
    generating = false;
    docuTourGenerateEl().classList.remove("is-generating");
    // 让 updateChrome 重新决定按钮文案（"生成导览" / "重新生成"）。
    updateChrome();
  }
}
