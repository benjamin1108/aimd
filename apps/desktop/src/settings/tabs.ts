export function bindSettingsTabs(
  navItems: NodeListOf<HTMLButtonElement>,
  sections: NodeListOf<HTMLElement>,
  onActiveChange: (sectionId: string) => void,
) {
  const normalizeSectionId = (sectionId: string | undefined): string => {
    if (!sectionId) return "general";
    for (const sec of sections) {
      if (sec.dataset.section === sectionId) return sectionId;
    }
    return "general";
  };
  const switchTab = (sectionId: string | undefined) => {
    const targetSectionId = normalizeSectionId(sectionId);
    navItems.forEach((btn) => {
      const active = btn.dataset.section === targetSectionId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    sections.forEach((sec) => {
      const active = sec.dataset.section === targetSectionId;
      sec.classList.toggle("is-active", active);
      sec.hidden = !active;
    });
    onActiveChange(targetSectionId);
  };
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.section));
    btn.addEventListener("keydown", (event) => {
      const items = Array.from(navItems);
      const current = items.indexOf(btn);
      const focusAt = (index: number) => {
        const next = items.at((index + items.length) % items.length);
        next?.focus();
        switchTab(next?.dataset.section);
      };
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(current + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(items.length - 1);
      }
    });
  });
  return { switchTab };
}
