import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { setStatus } from "./chrome";
import { saveRecentPaths, renderRecentList } from "./recents";

let activeContextMenu: HTMLElement | null = null;

export function dismissContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

export function showFileContextMenu(x: number, y: number, path: string) {
  dismissContextMenu();

  const menu = document.createElement("div");
  menu.className = "file-ctx-menu";
  menu.setAttribute("data-file-ctx-menu", "true");
  menu.setAttribute("role", "menu");

  const items: Array<{ label: string; action: () => void }> = [
    {
      label: "在 Finder 中显示",
      action: () => {
        dismissContextMenu();
        void invoke("reveal_in_finder", { path }).catch((err) => {
          console.error("reveal_in_finder:", err);
          setStatus(String(err), "warn");
        });
      },
    },
    {
      label: "复制路径",
      action: () => {
        dismissContextMenu();
        void navigator.clipboard.writeText(path).catch(() => {});
      },
    },
    {
      label: "从最近列表移除",
      action: () => {
        dismissContextMenu();
        state.recentPaths = state.recentPaths.filter((p) => p !== path);
        saveRecentPaths();
        renderRecentList();
      },
    },
  ];

  items.forEach(({ label, action }) => {
    const btn = document.createElement("button");
    btn.className = "file-ctx-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
    });
    menu.appendChild(btn);
  });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  const menuW = menu.offsetWidth || 180;
  const menuH = menu.offsetHeight || 120;
  const left = Math.min(x, window.innerWidth - menuW - 4);
  const top = Math.min(y, window.innerHeight - menuH - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDismiss = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Escape") {
        dismissContextMenu();
        document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
        document.removeEventListener("click", onDismiss as EventListener, { capture: true });
      }
      return;
    }
    if (!(e.target as HTMLElement).closest("[data-file-ctx-menu]")) {
      dismissContextMenu();
      document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
      document.removeEventListener("click", onDismiss as EventListener, { capture: true });
    }
  };

  setTimeout(() => {
    document.addEventListener("click", onDismiss as EventListener, { capture: true });
    document.addEventListener("keydown", onDismiss as EventListener, { capture: true });
  }, 0);
}

export function showContextMenu(
  x: number,
  y: number,
  items: Array<{ label: string; action: () => void; danger?: boolean; disabled?: boolean }>,
) {
  dismissContextMenu();

  const menu = document.createElement("div");
  menu.className = "file-ctx-menu";
  menu.setAttribute("data-file-ctx-menu", "true");
  menu.setAttribute("role", "menu");

  items.forEach(({ label, action, danger, disabled }) => {
    const btn = document.createElement("button");
    btn.className = danger ? "file-ctx-item danger" : "file-ctx-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.disabled = Boolean(disabled);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      action();
    });
    menu.appendChild(btn);
  });

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  const menuW = menu.offsetWidth || 190;
  const menuH = menu.offsetHeight || 160;
  menu.style.left = `${Math.min(x, window.innerWidth - menuW - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menuH - 4)}px`;

  const onDismiss = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Escape") {
        dismissContextMenu();
        document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
        document.removeEventListener("click", onDismiss as EventListener, { capture: true });
      }
      return;
    }
    if (!(e.target as HTMLElement).closest("[data-file-ctx-menu]")) {
      dismissContextMenu();
      document.removeEventListener("keydown", onDismiss as EventListener, { capture: true });
      document.removeEventListener("click", onDismiss as EventListener, { capture: true });
    }
  };

  setTimeout(() => {
    document.addEventListener("click", onDismiss as EventListener, { capture: true });
    document.addEventListener("keydown", onDismiss as EventListener, { capture: true });
  }, 0);
}
