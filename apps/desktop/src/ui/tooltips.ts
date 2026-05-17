import { uiTooltipEl } from "../core/dom";

let activeTarget: HTMLElement | null = null;

function tooltipTargetFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-tooltip]");
}

function tooltipText(target: HTMLElement): string {
  return (target.dataset.tooltip || "").trim();
}

function positionTooltip(target: HTMLElement) {
  const tooltip = uiTooltipEl();
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 8;
  const gap = 7;

  let top = targetRect.top - tooltipRect.height - gap;
  tooltip.dataset.placement = "top";
  if (top < margin) {
    top = targetRect.bottom + gap;
    tooltip.dataset.placement = "bottom";
  }

  const maxLeft = window.innerWidth - tooltipRect.width - margin;
  const centeredLeft = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
  const left = Math.max(margin, Math.min(centeredLeft, maxLeft));

  tooltip.style.setProperty("--ui-tooltip-x", `${Math.round(left)}px`);
  tooltip.style.setProperty("--ui-tooltip-y", `${Math.round(top)}px`);
}

function showTooltip(target: HTMLElement) {
  const text = tooltipText(target);
  if (!text) return;
  activeTarget = target;
  const tooltip = uiTooltipEl();
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionTooltip(target);
}

function hideTooltip(target?: HTMLElement | null) {
  if (target && activeTarget && target !== activeTarget) return;
  activeTarget = null;
  uiTooltipEl().hidden = true;
}

export function refreshActiveTooltip(target?: HTMLElement | null) {
  if (!activeTarget || (target && target !== activeTarget)) return;
  const text = tooltipText(activeTarget);
  if (!text) {
    hideTooltip(activeTarget);
    return;
  }
  const tooltip = uiTooltipEl();
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionTooltip(activeTarget);
}

export function bindTooltips() {
  document.addEventListener("pointerover", (event) => {
    const target = tooltipTargetFromEventTarget(event.target);
    if (!target || target === activeTarget) return;
    showTooltip(target);
  });
  document.addEventListener("pointerout", (event) => {
    const target = tooltipTargetFromEventTarget(event.target);
    if (!target) return;
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (next && target.contains(next)) return;
    hideTooltip(target);
  });
  document.addEventListener("focusin", (event) => {
    const target = tooltipTargetFromEventTarget(event.target);
    if (target) showTooltip(target);
  });
  document.addEventListener("focusout", (event) => {
    const target = tooltipTargetFromEventTarget(event.target);
    if (target) hideTooltip(target);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip();
  });
  window.addEventListener("resize", () => hideTooltip());
  document.addEventListener("scroll", () => hideTooltip(), true);
}
