import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { docuTourGenerateEl, markdownEl, readerEl, tourStatusDotEl } from "../core/dom";
import type { DocuTourScript } from "../core/types";
import { setMode } from "../ui/mode";
import { renderPreview } from "../ui/outline";
import { setStatus, updateChrome } from "../ui/chrome";
import { collectDocuTourAnchors } from "./anchors";
import { loadDocuTourConfig } from "./config";
import { extractDocuTour, upsertDocuTour } from "./frontmatter";

let active = false;
let stepIndex = 0;
let overlay: HTMLElement | null = null;
let controlBar: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let generating = false;

export function currentDocuTour(): DocuTourScript | null {
  return state.doc ? extractDocuTour(state.doc.markdown) : null;
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
  if (!controlBar) {
    controlBar = document.createElement("div");
    controlBar.className = "docutour-control";
    controlBar.innerHTML = `
      <button class="docutour-exit" data-tour-exit type="button" title="退出导览" aria-label="退出导览">×</button>
      <button class="docutour-control-btn" data-tour-prev type="button">上一步</button>
      <div class="docutour-control-main">
        <div class="docutour-counter"></div>
        <div class="docutour-narration"></div>
      </div>
      <button class="docutour-control-btn" data-tour-next type="button">下一步</button>
    `;
    controlBar.querySelector<HTMLElement>("[data-tour-exit]")?.addEventListener("click", stopDocuTour);
    controlBar.querySelector<HTMLElement>("[data-tour-prev]")?.addEventListener("click", previousDocuTourStep);
    controlBar.querySelector<HTMLElement>("[data-tour-next]")?.addEventListener("click", nextDocuTourStep);
    document.body.appendChild(controlBar);
  }
}

function setActiveTarget(target: HTMLElement | null) {
  activeTarget?.classList.remove("docutour-highlight");
  activeTarget = target;
  activeTarget?.classList.add("docutour-highlight");
}

function findTarget(id: string) {
  return readerEl().querySelector<HTMLElement>(`#${CSS.escape(id)}`);
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
  controlBar!.querySelector<HTMLElement>(".docutour-counter")!.textContent =
    `${stepIndex + 1} / ${script.steps.length}`;
  controlBar!.querySelector<HTMLElement>(".docutour-narration")!.textContent = step.narration;
  controlBar!.querySelector<HTMLButtonElement>("[data-tour-prev]")!.disabled = stepIndex === 0;
  controlBar!.querySelector<HTMLButtonElement>("[data-tour-next]")!.textContent =
    stepIndex >= script.steps.length - 1 ? "完成" : "下一步";
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

export function stopDocuTour() {
  active = false;
  setActiveTarget(null);
  overlay?.remove();
  controlBar?.remove();
  overlay = null;
  controlBar = null;
  document.body.classList.remove("docutour-active");
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
  const config = loadDocuTourConfig();
  if (!config.apiKey.trim()) {
    setStatus("请先在设置中填写模型 API Key", "warn");
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
  tourStatusDotEl().dataset.state = "generating";
  docuTourGenerateEl().disabled = true;
  docuTourGenerateEl().querySelector("span:last-child")!.textContent = "生成中";
  try {
    const script = await invoke<DocuTourScript>("generate_docu_tour", {
      markdown: state.doc.markdown,
      anchors,
      config,
    });
    const validTargets = new Set(anchors.map((anchor) => anchor.id));
    const clean: DocuTourScript = {
      version: 1,
      title: script.title || "Docu-Tour",
      steps: script.steps
        .filter((step) => validTargets.has(step.targetId) && step.narration.trim())
        .slice(0, config.maxSteps),
    };
    if (!clean.steps.length) throw new Error("模型没有返回可用导览步骤");
    state.doc.markdown = upsertDocuTour(state.doc.markdown, clean);
    markdownEl().value = state.doc.markdown;
    state.doc.dirty = true;
    await renderPreview();
    updateChrome();
    setStatus("导览脚本已写入 Front-matter", "success");
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "导览生成失败", "warn");
  } finally {
    generating = false;
    // 让 updateChrome 重新决定 dot 状态（ready / none）。
    tourStatusDotEl().dataset.state = "none";
    docuTourGenerateEl().querySelector("span:last-child")!.textContent = "生成导览";
    updateChrome();
  }
}
