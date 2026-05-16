export type WebClipLifecycle = {
  signal: AbortSignal;
  addDomListener: <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => void;
  addUnlistener: (unlisten: () => void) => void;
  captureFocus: () => void;
  lockBodyScroll: () => void;
  restoreBodyScroll: () => void;
  cleanup: () => void;
};

export function createWebClipLifecycle(installState: any, shell: HTMLElement): WebClipLifecycle {
  const controller = new AbortController();
  const unlisteners: Array<() => void> = [];
  let previousBodyOverflow: string | null = null;
  let focusBeforeMount: HTMLElement | null = null;

  const restoreBodyScroll = () => {
    if (previousBodyOverflow === null) return;
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
  };

  return {
    signal: controller.signal,
    addDomListener(target, type, listener) {
      target.addEventListener(type, listener as EventListener, { signal: controller.signal });
    },
    addUnlistener(unlisten) {
      unlisteners.push(unlisten);
    },
    captureFocus() {
      focusBeforeMount = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    lockBodyScroll() {
      if (previousBodyOverflow === null) previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    },
    restoreBodyScroll,
    cleanup() {
      controller.abort();
      for (const unlisten of unlisteners.splice(0)) unlisten();
      restoreBodyScroll();
      shell.remove();
      installState.__aimdWebClipInstalled = false;
      const focusTarget = focusBeforeMount;
      focusBeforeMount = null;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    },
  };
}
