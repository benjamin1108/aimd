import { invoke, isTauri } from "@tauri-apps/api/core";
import { state } from "../core/state";
import { dirtyTabs } from "../document/open-document-state";

let lastKey = "";

export async function syncDirtyDocumentState(force = false) {
  const dirty = dirtyTabs();
  const first = dirty[0]?.doc ?? state.doc;
  const title = dirty.length > 1 ? `${dirty.length} 个未保存文档` : first?.title || "";
  const path = dirty.length > 1 ? "" : first?.path || "";
  const hasDirty = dirty.length > 0;
  const key = `${hasDirty ? "1" : "0"}\n${title}\n${path}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  if (!isTauri()) return;
  try {
    await invoke("updater_set_dirty_state", { dirty: hasDirty, title, path });
  } catch {
    // Older dev/e2e shells may not have the command; updater falls back to local state.
  }
}
