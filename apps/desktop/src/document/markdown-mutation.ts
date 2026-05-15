import { state } from "../core/state";
import { markdownEl } from "../core/dom";
import type { OpenDocumentTab } from "../core/types";
import { createSourceModel } from "../editor/source-preserve";
import { updateChrome } from "../ui/chrome";
import { scheduleRender } from "../ui/outline";
import { hasAimdImageReferences, hasExternalImageReferences } from "./assets";
import {
  activeTab,
  bindFacadeFromTab,
  displayTabTitle,
  findTab,
  hasGitConflictMarkers,
} from "./open-document-state";

export type MarkdownMutationOrigin =
  | "source-input"
  | "visual-flush"
  | "task-toggle"
  | "image-alt"
  | "format-toolbar"
  | "paste-image"
  | "insert-image"
  | "format-apply"
  | "save-canonical"
  | "workspace-rename"
  | "test";

export type CommitMarkdownChangeOptions = {
  tabId?: string;
  markdown: string;
  origin: MarkdownMutationOrigin;
  dirty?: boolean;
  updateSourceTextarea?: boolean;
  rebuildSourceModel?: boolean;
  clearSourceDirty?: boolean;
  scheduleRender?: boolean;
  renderImmediately?: boolean;
};

export function commitMarkdownChange(options: CommitMarkdownChangeOptions): OpenDocumentTab | null {
  const tab = findTab(options.tabId) ?? activeTab();
  if (!tab) return null;
  const next = options.markdown;
  const changed = next !== tab.doc.markdown;
  if (!changed && options.dirty === undefined) return tab;

  tab.doc.markdown = next;
  tab.doc.dirty = options.dirty ?? true;
  tab.doc.hasGitConflicts = hasGitConflictMarkers(next);
  tab.doc.hasExternalImageReferences = hasExternalImageReferences(next);
  if (tab.doc.format === "markdown") {
    tab.doc.requiresAimdSave = hasAimdImageReferences(next) || tab.doc.assets.length > 0;
    tab.doc.needsAimdSave = tab.doc.requiresAimdSave;
  }
  tab.title = displayTabTitle(tab.doc);

  if (changed) {
    tab.markdownVersion += 1;
    tab.pendingRenderVersion = null;
    tab.renderErrorVersion = null;
  }
  if (options.rebuildSourceModel !== false) {
    tab.sourceModel = createSourceModel(next);
  }
  if (options.clearSourceDirty !== false) {
    tab.sourceDirtyRefs.clear();
    tab.sourceStructuralDirty = false;
  }

  const isActive = state.openDocuments.activeTabId === tab.id;
  if (isActive) {
    bindFacadeFromTab(tab);
    if (options.updateSourceTextarea !== false) {
      markdownEl().value = next;
    }
  }

  if (changed && options.scheduleRender !== false) {
    scheduleRender(tab.id, { immediate: Boolean(options.renderImmediately) });
  }
  updateChrome();
  return tab;
}
