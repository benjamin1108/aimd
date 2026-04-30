import { state } from "../core/state";
import { readerEl, inlineEditorEl } from "../core/dom";
import type { Mode } from "../core/types";

export function openLightbox(src: string) {
  const existing = document.getElementById("aimd-lightbox");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "aimd-lightbox";
  overlay.className = "aimd-lightbox";
  overlay.setAttribute("data-lightbox", "true");

  const img = document.createElement("img");
  img.className = "aimd-lightbox-img";
  img.src = src;

  const closeBtn = document.createElement("button");
  closeBtn.className = "aimd-lightbox-close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.setAttribute("aria-label", "关闭");

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  overlay.addEventListener("click", (e) => {
    if (e.target !== img) close();
  });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey, { capture: true });
}

export function bindImageLightbox() {
  const open = (e: MouseEvent, mode: Mode) => {
    if (state.mode !== mode) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "IMG") return;
    if (target.closest(".aimd-lightbox")) return;
    const img = target as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    if (!src) return;
    e.preventDefault();
    openLightbox(src);
  };
  readerEl().addEventListener("click", (e) => open(e, "read"));
  // 编辑模式下点图片也放大；preventDefault 顺手挡住 contenteditable
  // 把光标定到图片附近的副作用，按 ESC 回编辑器即可继续编辑。
  inlineEditorEl().addEventListener("click", (e) => open(e, "edit"));
}
