const STORAGE_KEY = "aimd.desktop.width";
type WidthName = "normal" | "wide" | "ultra";

function appFrameEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".app-frame")!;
}

export function setWidth(name: WidthName) {
  appFrameEl().dataset.width = name;
  window.localStorage.setItem(STORAGE_KEY, name);
  document.querySelectorAll<HTMLButtonElement>(".width-switch .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.width === name);
    btn.setAttribute("aria-selected", String(btn.dataset.width === name));
  });
  const select = document.querySelector<HTMLSelectElement>("#width-select");
  if (select) select.value = name;
}

export function bindWidthSwitch() {
  const saved = window.localStorage.getItem(STORAGE_KEY) as WidthName | null;
  setWidth(saved === "wide" || saved === "ultra" ? saved : "normal");

  document.querySelector("#width-normal")?.addEventListener("click", () => setWidth("normal"));
  document.querySelector("#width-wide")?.addEventListener("click", () => setWidth("wide"));
  document.querySelector("#width-ultra")?.addEventListener("click", () => setWidth("ultra"));
  document.querySelector<HTMLSelectElement>("#width-select")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    setWidth(value === "wide" || value === "ultra" ? value : "normal");
  });
}
