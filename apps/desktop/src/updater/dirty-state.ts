import { invoke, isTauri } from "@tauri-apps/api/core";
import { state } from "../core/state";

let lastKey = "";

export async function syncDirtyDocumentState(force = false) {
  const doc = state.doc;
  const dirty = Boolean(doc?.dirty);
  const title = doc?.title || "";
  const path = doc?.path || "";
  const key = `${dirty ? "1" : "0"}\n${title}\n${path}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  if (!isTauri()) return;
  try {
    await invoke("updater_set_dirty_state", { dirty, title, path });
  } catch {
    // Older dev/e2e shells may not have the command; updater falls back to local state.
  }
}
