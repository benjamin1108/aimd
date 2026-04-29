import {
  inlineEditorEl,
  linkPopoverEl, linkPopoverInputEl, linkPopoverTitleEl,
  linkPopoverConfirmEl, linkPopoverCancelEl, linkPopoverUnlinkEl,
} from "../core/dom";

let _linkPopoverResolve: ((url: string | null) => void) | null = null;

export function showLinkPopover(savedRange: Range | null, existingAnchor?: HTMLAnchorElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    _linkPopoverResolve = resolve;
    const isEdit = !!existingAnchor;

    // 编辑模式：预填现有 href，更新标题和确认按钮文案，显示"删除链接"按钮
    if (isEdit) {
      linkPopoverInputEl().value = existingAnchor!.getAttribute("href") ?? "";
      linkPopoverTitleEl().textContent = "编辑链接";
      linkPopoverConfirmEl().textContent = "更新";
      linkPopoverUnlinkEl().removeAttribute("hidden");
    } else {
      linkPopoverInputEl().value = "https://";
      linkPopoverTitleEl().textContent = "链接地址";
      linkPopoverConfirmEl().textContent = "确定";
      linkPopoverUnlinkEl().setAttribute("hidden", "");
    }

    linkPopoverEl().removeAttribute("hidden");
    linkPopoverInputEl().focus();
    linkPopoverInputEl().select();

    const closePopover = () => {
      linkPopoverEl().setAttribute("hidden", "");
      _linkPopoverResolve = null;
    };

    const applyLink = (url: string) => {
      inlineEditorEl().focus();
      if (isEdit) {
        // 编辑模式：直接更新 href，不走 execCommand（避免选区漂移或嵌套）
        existingAnchor!.setAttribute("href", url);
      } else {
        if (savedRange) {
          const s = document.getSelection();
          if (s) {
            s.removeAllRanges();
            s.addRange(savedRange);
          }
        }
        document.execCommand("createLink", false, url);
      }
      inlineEditorEl().dispatchEvent(new Event("input"));
    };

    const unlinkAnchor = () => {
      if (!existingAnchor) return;
      inlineEditorEl().focus();
      // 把 a 的所有子节点移到 a 前面，再移除 a
      const parent = existingAnchor.parentNode;
      if (parent) {
        while (existingAnchor.firstChild) {
          parent.insertBefore(existingAnchor.firstChild, existingAnchor);
        }
        existingAnchor.remove();
      }
      inlineEditorEl().dispatchEvent(new Event("input"));
    };

    const finish = (action: "confirm" | "cancel" | "unlink") => {
      closePopover();
      if (action === "confirm") {
        const url = linkPopoverInputEl().value.trim();
        if (url) {
          applyLink(url);
        } else if (isEdit) {
          // 编辑模式下清空 URL 确认 = 解链接
          unlinkAnchor();
        }
        resolve(url || null);
      } else if (action === "unlink") {
        unlinkAnchor();
        resolve(null);
      } else {
        resolve(null);
      }
    };

    const onConfirm = () => { finish("confirm"); cleanup(); };
    const onCancel = () => { finish("cancel"); cleanup(); };
    const onUnlink = () => { finish("unlink"); cleanup(); };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    const cleanup = () => {
      linkPopoverConfirmEl().removeEventListener("click", onConfirm);
      linkPopoverCancelEl().removeEventListener("click", onCancel);
      linkPopoverUnlinkEl().removeEventListener("click", onUnlink);
      linkPopoverInputEl().removeEventListener("keydown", onKeydown);
    };

    linkPopoverConfirmEl().addEventListener("click", onConfirm);
    linkPopoverCancelEl().addEventListener("click", onCancel);
    linkPopoverUnlinkEl().addEventListener("click", onUnlink);
    linkPopoverInputEl().addEventListener("keydown", onKeydown);
  });
}
