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

type ChangeListener = (errorCount: number) => void;
const listeners = new Set<ChangeListener>();

function formatArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ""}`.trim();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function errorEntryCount(): number {
  let n = 0;
  for (const entry of entries) {
    if (entry.level === "warn" || entry.level === "error") n += 1;
  }
  return n;
}

/** 状态栏 #debug-indicator 通过它订阅"错误数"变化；只算 warn / error，
 *  普通 log 不触发指示器，避免日常打印噪音让用户误以为有问题。 */
export function onDebugChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  // 立即通知一次当前值，方便订阅者初始化。
  listener(errorEntryCount());
  return () => listeners.delete(listener);
}

function emitChange() {
  const n = errorEntryCount();
  for (const listener of listeners) listener(n);
}

export function debugLog(level: DebugLevel, ...args: unknown[]) {
  entries.push({
    ts: new Date().toLocaleTimeString(),
    level,
    message: args.map(formatArg).join(" "),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  renderEntries();
  if (level !== "log") emitChange();
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

// 应用启动就 patch console + 监听 error/rejection，环形 buffer 始终在收集，
// 打开窗口看到的就是完整历史。
export function installDebugConsole() {
  activateConsolePatch();
  window.addEventListener("error", (event) => {
    debugLog("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    debugLog("error", event.reason || "Unhandled promise rejection");
  });
}

function activateConsolePatch() {
  if (installed) return;
  installed = true;
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
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "debug-modal";
    modal.innerHTML = `
      <section class="debug-panel" role="dialog" aria-label="调试控制台">
        <header class="debug-head" data-debug-drag>
          <div>
            <h2>调试控制台</h2>
            <p>运行时日志、模型调用错误和未捕获异常</p>
          </div>
          <div class="debug-actions">
            <button class="secondary-btn sm" data-debug-clear type="button">清空</button>
            <button class="secondary-btn sm" data-debug-close type="button">关闭</button>
          </div>
        </header>
        <div class="debug-list"></div>
      </section>
    `;
    panelEl = modal.querySelector<HTMLElement>(".debug-panel");
    listEl = modal.querySelector<HTMLElement>(".debug-list");
    modal.querySelector<HTMLElement>("[data-debug-close]")?.addEventListener("click", closeDebugConsole);
    modal.querySelector<HTMLElement>("[data-debug-clear]")?.addEventListener("click", () => {
      entries.length = 0;
      renderEntries();
      emitChange();
    });
    bindDrag();
    document.body.appendChild(modal);
  }
  modal.hidden = false;
  renderEntries();
}

export function closeDebugConsole() {
  if (modal) modal.hidden = true;
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
