import { formatToolbarEl } from "../core/dom";

type ToolbarDragState = {
  handle: HTMLElement;
  pointerId: number;
  startScrollLeft: number;
  startX: number;
};

let bound = false;

function hasScrollableOverflow(toolbar: HTMLElement) {
  return toolbar.scrollWidth - toolbar.clientWidth > 1;
}

function releasePointer(handle: HTMLElement, pointerId: number) {
  try {
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be gone after browser-level cancellation.
  }
}

export function bindFormatToolbarDragHandles() {
  if (bound) return;
  bound = true;

  const toolbar = formatToolbarEl();
  let drag: ToolbarDragState | null = null;

  toolbar.addEventListener("pointerdown", (event) => {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>(".ft-sep");
    if (!handle || event.button !== 0 || !hasScrollableOverflow(toolbar)) return;
    event.preventDefault();
    drag = {
      handle,
      pointerId: event.pointerId,
      startScrollLeft: toolbar.scrollLeft,
      startX: event.clientX,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Older browser shells can miss pointer capture; bubbling still keeps drag useful.
    }
    handle.classList.add("is-dragging");
    toolbar.classList.add("is-sep-dragging");
  });

  toolbar.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    toolbar.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
  });

  const finishDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    releasePointer(drag.handle, drag.pointerId);
    drag.handle.classList.remove("is-dragging");
    toolbar.classList.remove("is-sep-dragging");
    drag = null;
  };

  toolbar.addEventListener("pointerup", finishDrag);
  toolbar.addEventListener("pointercancel", finishDrag);
  toolbar.addEventListener("lostpointercapture", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.handle.classList.remove("is-dragging");
    toolbar.classList.remove("is-sep-dragging");
    drag = null;
  });
}
