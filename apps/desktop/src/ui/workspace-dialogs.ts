import { escapeAttr, escapeHTML } from "../util/escape";

export async function promptWorkspaceText(title: string, initialValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "link-popover";
    overlay.innerHTML = `
      <label class="link-popover-label" for="workspace-prompt-input">${escapeHTML(title)}</label>
      <input id="workspace-prompt-input" class="link-popover-input" type="text" value="${escapeAttr(initialValue)}" />
      <div class="link-popover-actions">
        <button class="secondary-btn sm" type="button" data-action="cancel">取消</button>
        <button class="primary-btn sm" type="button" data-action="confirm">确定</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector<HTMLInputElement>("#workspace-prompt-input")!;
    const cleanup = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector<HTMLButtonElement>("[data-action='cancel']")!.addEventListener("click", () => cleanup(null));
    overlay.querySelector<HTMLButtonElement>("[data-action='confirm']")!.addEventListener("click", () => {
      cleanup(input.value.trim() || null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cleanup(null);
      if (event.key === "Enter") cleanup(input.value.trim() || null);
    });
    input.focus();
    input.select();
  });
}

export async function confirmWorkspaceAction(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "link-popover";
    overlay.innerHTML = `
      <div class="link-popover-label">${escapeHTML(title)}</div>
      <div class="link-popover-actions">
        <button class="secondary-btn sm" type="button" data-action="cancel">取消</button>
        <button class="primary-btn sm danger-btn" type="button" data-action="confirm">删除</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cleanup(false);
    };
    const cleanup = (value: boolean) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector<HTMLButtonElement>("[data-action='cancel']")!.addEventListener("click", () => cleanup(false));
    overlay.querySelector<HTMLButtonElement>("[data-action='confirm']")!.addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", onKey);
  });
}
