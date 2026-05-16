import { inlineEditorEl, previewEl, readerEl } from "../core/dom";
import type { RenderedSurfaceProfile } from "./types";

export function readerSurfaceProfile(): RenderedSurfaceProfile {
  return {
    kind: "reader",
    root: readerEl(),
    contentEditable: false,
    stripFrontmatter: false,
    sourceAnnotations: false,
    hydrateMarkdownImages: true,
    taskToggle: true,
    codeCopy: true,
    linkOpen: "modifier",
    imageLightbox: true,
    syncOutlineIds: true,
    paintVersionKey: "read",
  };
}

export function previewSurfaceProfile(): RenderedSurfaceProfile {
  return {
    kind: "preview",
    root: previewEl(),
    contentEditable: false,
    stripFrontmatter: false,
    sourceAnnotations: false,
    hydrateMarkdownImages: true,
    taskToggle: true,
    codeCopy: true,
    linkOpen: "modifier",
    imageLightbox: true,
    syncOutlineIds: true,
    paintVersionKey: "source",
  };
}

export function visualEditorSurfaceProfile(): RenderedSurfaceProfile {
  return {
    kind: "visual-editor",
    root: inlineEditorEl(),
    contentEditable: true,
    stripFrontmatter: true,
    sourceAnnotations: true,
    hydrateMarkdownImages: true,
    taskToggle: true,
    codeCopy: false,
    linkOpen: "modifier",
    imageLightbox: true,
    syncOutlineIds: true,
    paintVersionKey: "edit",
  };
}
