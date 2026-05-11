import { invoke } from "@tauri-apps/api/core";
import { state } from "../core/state";
import type { AimdDocument } from "../core/types";
import { displayDocTitle } from "../ui/chrome";

export async function ensureDraftPackage(): Promise<string | null> {
  if (!state.doc) return null;
  if (state.doc.path && state.doc.format === "aimd") return state.doc.path;
  if (state.doc.draftSourcePath) return state.doc.draftSourcePath;

  const doc = await invoke<AimdDocument>("create_aimd_draft", {
    markdown: state.doc.markdown,
    title: displayDocTitle(state.doc),
  });
  const draftSourcePath = doc.draftSourcePath || doc.path;
  if (!draftSourcePath) return null;
  state.doc.draftSourcePath = draftSourcePath;
  state.doc.assets = doc.assets || [];
  return draftSourcePath;
}

export async function deleteDraftFile(path?: string) {
  if (!path) return;
  try {
    await invoke("delete_draft_file", { path });
  } catch (err) {
    console.warn("delete_draft_file failed", err);
  }
}

export async function deleteDocumentDraft(doc?: Pick<AimdDocument, "draftSourcePath" | "path"> | null) {
  const draftPath = doc?.draftSourcePath;
  if (!draftPath || draftPath === doc?.path) return;
  await deleteDraftFile(draftPath);
}

export async function cleanupOldDrafts(activePaths: string[] = []) {
  try {
    await invoke("cleanup_old_drafts", { activePaths });
  } catch {
    // Older mocks / dev shells may not expose this command.
  }
}
