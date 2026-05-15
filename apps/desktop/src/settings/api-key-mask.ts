type ApiKeyMaskController = {
  refresh: () => void;
};

function maskedDisplay(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return "已隐藏";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function bindApiKeyMask(
  inputEl: HTMLInputElement,
  wrapEl: HTMLElement,
  maskEl: HTMLElement,
  revealEl: HTMLButtonElement,
): ApiKeyMaskController {
  let revealApiKey = false;

  const refresh = () => {
    const hasValue = inputEl.value.trim().length > 0;
    inputEl.type = revealApiKey ? "text" : "password";
    const showOverlay = !revealApiKey && hasValue;
    wrapEl.dataset.state = showOverlay ? "masked" : "visible";
    maskEl.textContent = showOverlay ? maskedDisplay(inputEl.value) : "";
  };

  inputEl.addEventListener("focus", refresh);
  inputEl.addEventListener("blur", refresh);
  revealEl.addEventListener("click", () => {
    revealApiKey = !revealApiKey;
    revealEl.setAttribute("aria-pressed", String(revealApiKey));
    refresh();
  });

  return { refresh };
}
