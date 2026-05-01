const STORAGE_KEY = "aimd.desktop.width";
type WidthName = "normal" | "wide" | "ultra";

function appFrameEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".app-frame")!;
}

export function setWidth(name: WidthName) {
  appFrameEl().dataset.width = name;
  window.localStorage.setItem(STORAGE_KEY, name);
}

export function bindWidthSwitch() {
  const saved = window.localStorage.getItem(STORAGE_KEY) as WidthName | null;
  setWidth(saved === "wide" || saved === "ultra" ? saved : "normal");
  // 宽度由应用菜单 视图 → 阅读宽度 控制（lib.rs 注册了 width-* 菜单事件，
  // main.ts 里 menuHandlers 会转给 setWidth）；不再在 toolbar 上展示控件。
}
