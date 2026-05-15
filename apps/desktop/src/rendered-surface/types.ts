import type { AimdAsset, MarkdownSourceModel, Mode } from "../core/types";

export type RenderedSurfaceKind =
  | "reader"
  | "preview"
  | "visual-editor"
  | "git-diff";

export type LinkOpenMode = "none" | "plain" | "modifier";

export type RenderedSurfaceProfile = {
  kind: RenderedSurfaceKind;
  root: HTMLElement;
  contentEditable: boolean;
  stripFrontmatter: boolean;
  sourceAnnotations: boolean;
  hydrateMarkdownImages: boolean;
  taskToggle: boolean;
  codeCopy: boolean;
  linkOpen: LinkOpenMode;
  imageLightbox: boolean;
  syncOutlineIds: boolean;
  paintVersionKey?: Mode;
};

export type RenderedSurfaceCallbacks = {
  openExternalUrl: (url: string) => void | Promise<void>;
  openImage: (src: string) => void;
  toggleTask: (index: number) => void;
  showLinkHint: () => void;
  clearLinkHint: () => void;
  setStatus: (text: string, tone?: "idle" | "loading" | "success" | "warn" | "info") => void;
};

export type PaintRenderedSurfaceContext = {
  assets: AimdAsset[];
  callbacks: RenderedSurfaceCallbacks;
  htmlVersion?: number;
  markdownPath?: string;
  sourceModel?: MarkdownSourceModel | null;
  tabId?: string | null;
  onHydrated?: (profile: RenderedSurfaceProfile) => void;
  onPainted?: (profile: RenderedSurfaceProfile) => void;
  isHydrationCurrent?: (profile: RenderedSurfaceProfile) => boolean;
};
