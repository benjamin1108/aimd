type DebugLevel = "log" | "warn" | "error";

type DebugEntry = {
  ts: string;
  level: DebugLevel;
  message: string;
};

const MAX_ENTRIES = 400;
const entries: DebugEntry[] = [];
let installed = false;
let modal: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let minimized = false;

function formatArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ""}`.trim();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function debugLog(level: DebugLevel, ...args: unknown[]) {
  entries.push({
    ts: new Date().toLocaleTimeString(),
    level,
    message: args.map(formatArg).join(" "),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  renderEntries();
}

function renderEntries() {
  if (!listEl) return;
  if (!entries.length) {
    listEl.innerHTML = `<div class="debug-empty">暂无日志</div>`;
    return;
  }
  listEl.innerHTML = entries.map((entry) => `
    <div class="debug-entry" data-level="${entry.level}">
      <div class="debug-entry-meta">${entry.ts} · ${entry.level.toUpperCase()}</div>
      <pre>${escapeHTML(entry.message)}</pre>
    </div>
  `).join("");
  listEl.scrollTop = listEl.scrollHeight;
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let debugModeActive = false;

export function installDebugConsole() {
  window.addEventListener("error", (event) => {
    if (debugModeActive) debugLog("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (debugModeActive) debugLog("error", event.reason || "Unhandled promise rejection");
  });
}

function activateConsolePatch() {
  if (installed) return;
  installed = true;
  debugModeActive = true;
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]) => {
    debugLog("log", ...args);
    original.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    debugLog("warn", ...args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    debugLog("error", ...args);
    original.error(...args);
  };
}

export function openDebugConsole() {
  activateConsolePatch();
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "debug-modal";
    modal.innerHTML = `
      <section class="debug-panel" role="dialog" aria-label="Debug Console">
        <header class="debug-head" data-debug-drag>
          <div>
            <h2>Debug Console</h2>
            <p>运行时日志、模型调用错误和未捕获异常</p>
          </div>
          <div class="debug-actions">
            <button class="secondary-btn sm" data-debug-clear type="button">清空</button>
            <button class="secondary-btn sm" data-debug-minimize type="button">最小化</button>
            <button class="secondary-btn sm" data-debug-close type="button">关闭</button>
          </div>
        </header>
        <div class="debug-list"></div>
      </section>
    `;
    panelEl = modal.querySelector<HTMLElement>(".debug-panel");
    listEl = modal.querySelector<HTMLElement>(".debug-list");
    modal.querySelector<HTMLElement>("[data-debug-close]")?.addEventListener("click", closeDebugConsole);
    modal.querySelector<HTMLElement>("[data-debug-minimize]")?.addEventListener("click", minimizeDebugConsole);
    modal.querySelector<HTMLElement>("[data-debug-clear]")?.addEventListener("click", () => {
      entries.length = 0;
      renderEntries();
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeDebugConsole();
    });
    bindDrag();
    document.body.appendChild(modal);
  }
  minimized = false;
  modal.hidden = false;
  modal.classList.remove("minimized");
  renderEntries();
}

export function closeDebugConsole() {
  if (modal) modal.hidden = true;
}

function minimizeDebugConsole() {
  if (!modal) return;
  minimized = !minimized;
  modal.classList.toggle("minimized", minimized);
}

function bindDrag() {
  const handle = modal?.querySelector<HTMLElement>("[data-debug-drag]");
  if (!handle || !panelEl) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragging = true;
    const rect = panelEl!.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panelEl!.style.left = `${startLeft}px`;
    panelEl!.style.top = `${startTop}px`;
    panelEl!.style.transform = "none";
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const nextLeft = Math.max(8, Math.min(window.innerWidth - 80, startLeft + event.clientX - startX));
    const nextTop = Math.max(8, Math.min(window.innerHeight - 40, startTop + event.clientY - startY));
    panelEl!.style.left = `${nextLeft}px`;
    panelEl!.style.top = `${nextTop}px`;
  });

  handle.addEventListener("pointerup", (event) => {
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
  });
}
