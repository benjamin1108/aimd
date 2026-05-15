import { invoke } from "@tauri-apps/api/core";
import { findTab } from "./open-document-state";

export type FileFingerprint = {
  mtimeMs: number;
  size: number;
};

export async function readFileFingerprint(path: string): Promise<FileFingerprint | null> {
  if (!path) return null;
  try {
    return await invoke<FileFingerprint>("document_file_fingerprint", { path });
  } catch {
    return null;
  }
}

export async function refreshTabFingerprint(tabId: string, path: string) {
  const fingerprint = await readFileFingerprint(path);
  const tab = findTab(tabId);
  if (tab && tab.doc.path === path) tab.baseFileFingerprint = fingerprint;
}
