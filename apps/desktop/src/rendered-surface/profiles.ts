import { previewEl, readerEl } from "../core/dom";
import type { RenderedSurfaceProfile } from "./types";

export function readerSurfaceProfile(): RenderedSurfaceProfile {
  return {
    kind: "reader",
    root: readerEl(),
    stripFrontmatter: false,
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
    kind: "edit-preview",
    root: previewEl(),
    stripFrontmatter: false,
    hydrateMarkdownImages: true,
    taskToggle: true,
    codeCopy: true,
    linkOpen: "modifier",
    imageLightbox: true,
    syncOutlineIds: true,
    paintVersionKey: "edit",
  };
}
