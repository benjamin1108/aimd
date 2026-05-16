import { state, ICONS } from "../core/state";
import {
  tabBarEl,
  openTabsEl,
  openTabsNextEl,
  openTabsPrevEl,
} from "../core/dom";
import { escapeAttr, escapeHTML } from "../util/escape";
import { displayTabTitle, syncActiveTabFromFacade } from "../document/open-document-state";

const SCROLL_EDGE_EPSILON = 2;
let openTabsSyncFrame = 0;
let openTabsResizeObserver: ResizeObserver | null = null;
let openTabsControlsBound = false;

function tabFormat(doc: { isDraft?: boolean; format: "aimd" | "markdown" }) {
  if (doc.isDraft) return "草稿";
  return doc.format === "markdown" ? "MD" : "AIMD";
}

function openTabItems(): HTMLElement[] {
  return Array.from(openTabsEl().querySelectorAll<HTMLElement>(".open-tab[data-tab-id]"));
}

function activeOpenTabItem(): HTMLElement | null {
  const activeId = state.openDocuments.activeTabId;
  if (!activeId) return null;
  return openTabItems().find((tab) => tab.dataset.tabId === activeId) ?? null;
}

function tabItemForEventTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>(".open-tab[data-tab-id]") : null;
}

function hasHorizontalOverflow(): boolean {
  const tabs = openTabsEl();
  return tabs.scrollWidth - tabs.clientWidth > SCROLL_EDGE_EPSILON;
}

function activeTabIndex(): number {
  const tabs = openTabItems();
  const active = activeOpenTabItem();
  return active ? tabs.indexOf(active) : -1;
}

function setNavigationControlState() {
  const items = openTabItems();
  const overflow = hasHorizontalOverflow();
  const activeIndex = activeTabIndex();
  const showNavigation = items.length > 1;
  const prev = openTabsPrevEl();
  const next = openTabsNextEl();

  tabBarEl().classList.toggle("has-tab-overflow", overflow);
  tabBarEl().classList.toggle("has-tab-navigation", showNavigation);
  prev.hidden = !showNavigation;
  next.hidden = !showNavigation;
  prev.disabled = !showNavigation || activeIndex <= 0;
  next.disabled = !showNavigation || activeIndex < 0 || activeIndex >= items.length - 1;
}

function scrollTabIntoView(tab: HTMLElement, behavior: ScrollBehavior = "auto") {
  tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
}

function queueOpenTabsLayoutSync(revealActive: boolean) {
  if (openTabsSyncFrame) window.cancelAnimationFrame(openTabsSyncFrame);
  openTabsSyncFrame = window.requestAnimationFrame(() => {
    openTabsSyncFrame = 0;
    if (revealActive) {
      const active = activeOpenTabItem();
      if (active) scrollTabIntoView(active);
    }
    setNavigationControlState();
  });
}

function activateTabItem(tab: HTMLElement) {
  tab.querySelector<HTMLButtonElement>(".open-tab-main")?.click();
}

function activateAdjacentTab(direction: -1 | 1) {
  const tabs = openTabItems();
  if (!tabs.length) return;
  const current = tabItemForEventTarget(document.activeElement) || activeOpenTabItem() || tabs[0];
  const currentIndex = Math.max(0, tabs.indexOf(current));
  const next = tabs[currentIndex + direction];
  if (next) activateTabItem(next);
}

function activateEdgeTab(edge: "first" | "last") {
  const tabs = openTabItems();
  const target = edge === "first" ? tabs[0] : tabs.at(-1);
  if (target) activateTabItem(target);
}

function closeFocusedTab() {
  const tab = tabItemForEventTarget(document.activeElement) || activeOpenTabItem();
  tab?.querySelector<HTMLButtonElement>("[data-tab-close]")?.click();
}

export function bindOpenTabsNavigationControls() {
  if (openTabsControlsBound) return;
  openTabsControlsBound = true;

  openTabsPrevEl().addEventListener("click", () => activateAdjacentTab(-1));
  openTabsNextEl().addEventListener("click", () => activateAdjacentTab(1));
  openTabsEl().addEventListener("scroll", () => setNavigationControlState(), { passive: true });
  openTabsEl().addEventListener("wheel", (event) => {
    if (!hasHorizontalOverflow()) return;
    const tabs = openTabsEl();
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const before = tabs.scrollLeft;
    tabs.scrollLeft += delta;
    if (tabs.scrollLeft !== before) {
      event.preventDefault();
      setNavigationControlState();
    }
  }, { passive: false });
  openTabsEl().addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      activateAdjacentTab(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      activateAdjacentTab(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      activateEdgeTab("first");
    } else if (event.key === "End") {
      event.preventDefault();
      activateEdgeTab("last");
    } else if (event.key === "Delete") {
      event.preventDefault();
      closeFocusedTab();
    }
  });

  if (typeof ResizeObserver !== "undefined") {
    openTabsResizeObserver = new ResizeObserver(() => queueOpenTabsLayoutSync(false));
    openTabsResizeObserver.observe(openTabsEl());
  }
  window.addEventListener("resize", () => queueOpenTabsLayoutSync(false));
  queueOpenTabsLayoutSync(false);
}

export function renderOpenTabs() {
  syncActiveTabFromFacade();
  const tabs = state.openDocuments.tabs;
  const gitDiffTabs = state.git.diffTabs;
  const total = tabs.length + gitDiffTabs.length;
  tabBarEl().hidden = total === 0;
  if (total === 0) {
    openTabsEl().innerHTML = "";
    queueOpenTabsLayoutSync(false);
    return;
  }
  const activeId = state.openDocuments.activeTabId;
  const documentTabs = tabs.map((tab) => {
    const title = displayTabTitle(tab.doc);
    const full = tab.doc.path || title;
    const dirty = tab.doc.dirty ? `<span class="open-tab-dirty" aria-label="未保存">●</span>` : "";
    return `
      <div class="open-tab ${tab.id === activeId ? "is-active" : ""} ${tab.doc.dirty ? "is-dirty" : ""}"
           data-tab-id="${escapeAttr(tab.id)}"
           title="${escapeAttr(full)}">
        <button class="open-tab-main" type="button" role="tab"
                aria-selected="${tab.id === activeId ? "true" : "false"}"
                tabindex="${tab.id === activeId ? "0" : "-1"}"
                data-tab-activate="${escapeAttr(tab.id)}" aria-label="切换到 ${escapeAttr(title)}">
          ${dirty}
          <span class="open-tab-title">${escapeHTML(title)}</span>
          <span class="open-tab-format">${escapeHTML(tabFormat(tab.doc))}</span>
        </button>
        <button class="open-tab-close" type="button" data-tab-close="${escapeAttr(tab.id)}" tabindex="-1" title="关闭标签页：${escapeAttr(title)}" aria-label="关闭标签页：${escapeAttr(title)}">
          ${ICONS.close}
        </button>
      </div>
    `;
  });
  const diffTabs = gitDiffTabs.map((tab) => `
    <div class="open-tab is-git-diff ${tab.id === activeId ? "is-active" : ""}"
         data-tab-id="${escapeAttr(tab.id)}"
         title="${escapeAttr(tab.path)}">
      <button class="open-tab-main" type="button" role="tab"
              aria-selected="${tab.id === activeId ? "true" : "false"}"
              tabindex="${tab.id === activeId ? "0" : "-1"}"
              data-tab-activate="${escapeAttr(tab.id)}" aria-label="切换到 Git Diff ${escapeAttr(tab.title)}">
        <span class="open-tab-title">${escapeHTML(tab.title)}</span>
        <span class="open-tab-format">Git</span>
      </button>
      <button class="open-tab-close" type="button" data-tab-close="${escapeAttr(tab.id)}" tabindex="-1" title="关闭标签页：${escapeAttr(tab.title)}" aria-label="关闭标签页：${escapeAttr(tab.title)}">
        ${ICONS.close}
      </button>
    </div>
  `);
  openTabsEl().innerHTML = [...documentTabs, ...diffTabs].join("");
  queueOpenTabsLayoutSync(true);
}
