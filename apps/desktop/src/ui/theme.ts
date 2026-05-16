import type { UiTheme } from "../core/types";

export type ResolvedTheme = "light" | "dark" | "high-contrast";

const MEDIA_DARK = "(prefers-color-scheme: dark)";

export function normalizeTheme(value: unknown): UiTheme {
  return value === "light" || value === "dark" || value === "high-contrast"
    ? value
    : "system";
}

export function resolveTheme(theme: UiTheme, target: Document = document): ResolvedTheme {
  if (theme === "high-contrast") return "high-contrast";
  if (theme === "light" || theme === "dark") return theme;
  return target.defaultView?.matchMedia?.(MEDIA_DARK).matches ? "dark" : "light";
}

export function applyThemePreference(theme: UiTheme, target: Document = document) {
  const root = target.documentElement;
  const resolved = resolveTheme(theme, target);
  root.dataset.themePreference = theme;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved === "dark"
    ? "dark"
    : resolved === "high-contrast"
      ? "light dark"
      : "light";
}

export function bindSystemThemePreference(getTheme: () => UiTheme, target: Document = document) {
  const query = target.defaultView?.matchMedia?.(MEDIA_DARK);
  if (!query) return () => {};
  const sync = () => {
    if (getTheme() === "system") applyThemePreference("system", target);
  };
  query.addEventListener?.("change", sync);
  return () => query.removeEventListener?.("change", sync);
}
