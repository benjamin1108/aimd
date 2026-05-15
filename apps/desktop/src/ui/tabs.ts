import { state, ICONS } from "../core/state";
import { tabBarEl, openTabsEl } from "../core/dom";
import { escapeAttr, escapeHTML } from "../util/escape";
import { displayTabTitle, syncActiveTabFromFacade } from "../document/open-document-state";

function tabFormat(doc: { isDraft?: boolean; format: "aimd" | "markdown" }) {
  if (doc.isDraft) return "草稿";
  return doc.format === "markdown" ? "Markdown" : "AIMD";
}

export function renderOpenTabs() {
  syncActiveTabFromFacade();
  const tabs = state.openDocuments.tabs;
  tabBarEl().hidden = tabs.length === 0;
  if (tabs.length === 0) {
    openTabsEl().innerHTML = "";
    return;
  }
  const activeId = state.openDocuments.activeTabId;
  openTabsEl().innerHTML = tabs.map((tab) => {
    const title = displayTabTitle(tab.doc);
    const full = tab.doc.path || title;
    const dirty = tab.doc.dirty ? `<span class="open-tab-dirty" aria-label="未保存">●</span>` : "";
    return `
      <div class="open-tab ${tab.id === activeId ? "is-active" : ""} ${tab.doc.dirty ? "is-dirty" : ""}"
           role="tab"
           aria-selected="${tab.id === activeId ? "true" : "false"}"
           data-tab-id="${escapeAttr(tab.id)}"
           title="${escapeAttr(full)}">
        <button class="open-tab-main" type="button" data-tab-activate="${escapeAttr(tab.id)}" aria-label="切换到 ${escapeAttr(title)}">
          ${dirty}
          <span class="open-tab-title">${escapeHTML(title)}</span>
          <span class="open-tab-format">${escapeHTML(tabFormat(tab.doc))}</span>
        </button>
        <button class="open-tab-close" type="button" data-tab-close="${escapeAttr(tab.id)}" title="关闭标签页：${escapeAttr(title)}" aria-label="关闭标签页：${escapeAttr(title)}">
          ${ICONS.close}
        </button>
      </div>
    `;
  }).join("");
}
