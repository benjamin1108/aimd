import { appFrameEl } from "../core/dom";

type AiActivityKind = "format" | "web-clip";

const activeActivities = new Map<string, AiActivityKind>();

function syncAiActivity() {
  const frame = appFrameEl();
  if (activeActivities.size === 0) {
    delete frame.dataset.aiActivity;
    return;
  }
  frame.dataset.aiActivity = Array.from(new Set(activeActivities.values())).join(" ");
}

function activityId(kind: AiActivityKind): string {
  return `${kind}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

export function beginAiActivity(kind: AiActivityKind): () => void {
  const id = activityId(kind);
  activeActivities.set(id, kind);
  syncAiActivity();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeActivities.delete(id);
    syncAiActivity();
  };
}
