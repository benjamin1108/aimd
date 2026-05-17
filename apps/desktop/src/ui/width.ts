const STORAGE_KEY = "aimd.desktop.width";
type WidthName = "normal" | "wide" | "ultra";
const WIDTH_NAMES: WidthName[] = ["normal", "wide", "ultra"];

function appFrameEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".app-frame")!;
}

function isWidthName(value: string | null | undefined): value is WidthName {
  return value === "normal" || value === "wide" || value === "ultra";
}

function widthButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-width-option]"));
}

function widthToggleEl(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("#viewport-width-toggle")!;
}

function widthPopoverEl(): HTMLElement {
  return document.querySelector<HTMLElement>("#viewport-width-popover")!;
}

function syncWidthButtons(name: WidthName) {
  for (const button of widthButtons()) {
    const active = button.dataset.widthOption === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  }
}

function openWidthPopover() {
  widthToggleEl().classList.add("is-active");
  widthToggleEl().setAttribute("aria-expanded", "true");
  widthPopoverEl().hidden = false;
}

export function closeWidthPopover() {
  widthToggleEl().classList.remove("is-active");
  widthToggleEl().setAttribute("aria-expanded", "false");
  widthPopoverEl().hidden = true;
}

export function setWidth(name: WidthName) {
  appFrameEl().dataset.width = name;
  window.localStorage.setItem(STORAGE_KEY, name);
  syncWidthButtons(name);
}

export function bindWidthSwitch() {
  const saved = window.localStorage.getItem(STORAGE_KEY) as WidthName | null;
  widthToggleEl().addEventListener("click", () => {
    widthPopoverEl().hidden ? openWidthPopover() : closeWidthPopover();
  });
  for (const button of widthButtons()) {
    button.addEventListener("click", () => {
      const next = button.dataset.widthOption;
      if (!isWidthName(next)) return;
      setWidth(next);
      closeWidthPopover();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (widthPopoverEl().hidden) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (widthPopoverEl().contains(target) || widthToggleEl().contains(target)) return;
    closeWidthPopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !widthPopoverEl().hidden) closeWidthPopover();
  });
  setWidth(isWidthName(saved) && WIDTH_NAMES.includes(saved) ? saved : "normal");
}
