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
