import { panelEl } from "../core/dom";
import { openDocument, openMarkdownDocument } from "../document/lifecycle";

export function onWindowDragOver(event: DragEvent) {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  panelEl().classList.add("dragging-file");
}

export function onWindowDragLeave(event: DragEvent) {
  if (event.relatedTarget) return;
  panelEl().classList.remove("dragging-file");
}

export async function onWindowDrop(event: DragEvent) {
  panelEl().classList.remove("dragging-file");
  const file = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
  if (!file) return;
  event.preventDefault();
  const droppedPath = file.path || "";
  if (!droppedPath) return;
  if (/\.aimd$/i.test(droppedPath)) {
    await openDocument(droppedPath);
    return;
  }
  if (/\.(md|markdown|mdx)$/i.test(droppedPath)) {
    await openMarkdownDocument(droppedPath);
  }
}
