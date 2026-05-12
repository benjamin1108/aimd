export function waitForDocumentShell(): Promise<void> {
  if (document.head && document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const tryResolve = () => {
      if (!document.head || !document.body) return false;
      document.removeEventListener("DOMContentLoaded", tryResolve);
      resolve();
      return true;
    };
    if (tryResolve()) return;
    document.addEventListener("DOMContentLoaded", tryResolve);
    const timer = window.setInterval(() => {
      if (tryResolve()) window.clearInterval(timer);
    }, 20);
  });
}
