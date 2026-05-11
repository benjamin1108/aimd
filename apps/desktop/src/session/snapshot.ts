import { invoke } from "@tauri-apps/api/core";
import {
  state, STORAGE_LAST, STORAGE_SESSION,
} from "../core/state";
import type { AimdDocument, Mode, RenderResult, SessionSnapshot } from "../core/types";
import { setStatus, updateChrome } from "../ui/chrome";
import { rememberOpenedPath } from "../ui/recents";
import { applyDocument } from "../document/apply";

export function loadLastSessionPath(): string | null {
  return window.localStorage.getItem(STORAGE_LAST);
}

export function loadSessionSnapshot(): SessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    return {
      path: typeof parsed.path === "string" ? parsed.path : "",
      title: typeof parsed.title === "string" ? parsed.title : "",
      markdown: typeof parsed.markdown === "string" ? parsed.markdown : "",
      html: typeof parsed.html === "string" ? parsed.html : "",
      assets,
      dirty: Boolean(parsed.dirty),
      isDraft: Boolean(parsed.isDraft),
      draftSourcePath: typeof parsed.draftSourcePath === "string" ? parsed.draftSourcePath : undefined,
      needsAimdSave: Boolean(parsed.needsAimdSave),
      format: parsed.format === "markdown" ? "markdown" : "aimd",
      mode: parsed.mode === "edit" || parsed.mode === "source" ? parsed.mode : "read",
    };
  } catch {
    return null;
  }
}

export function clearLastSessionPath() {
  window.localStorage.removeItem(STORAGE_LAST);
}

export function clearSessionSnapshot() {
  window.localStorage.removeItem(STORAGE_SESSION);
}

export function persistSessionSnapshot() {
  if (!state.doc) {
    clearSessionSnapshot();
    return;
  }
  const snapshot: SessionSnapshot = {
    path: state.doc.path,
    title: state.doc.title,
    markdown: state.doc.markdown,
    html: state.doc.html,
    assets: state.doc.assets,
    dirty: state.doc.dirty,
    isDraft: Boolean(state.doc.isDraft),
    draftSourcePath: state.doc.draftSourcePath,
    needsAimdSave: Boolean(state.doc.needsAimdSave),
    format: state.doc.format,
    mode: state.mode,
  };
  window.localStorage.setItem(STORAGE_SESSION, JSON.stringify(snapshot));
  if (state.doc.path) {
    window.localStorage.setItem(STORAGE_LAST, state.doc.path);
  } else {
    clearLastSessionPath();
  }
}

export async function restoreSession() {
  const snapshot = loadSessionSnapshot();
  if (snapshot) {
    const restored = await restoreSnapshot(snapshot);
    if (restored) {
      applyDocument(restored.doc, restored.mode);
      if (restored.doc.path) {
        rememberOpenedPath(restored.doc.path);
        await registerRestoredPath(restored.doc.path);
      }
      setStatus(restored.message, "info");
      return;
    }
    clearSessionSnapshot();
  }

  const path = loadLastSessionPath();
  if (!path) return;
  try {
    const doc = await invoke<AimdDocument>("open_aimd", { path });
    applyDocument({ ...doc, isDraft: false, format: "aimd", dirty: false }, "read");
    rememberOpenedPath(doc.path);
    await registerRestoredPath(doc.path);
    setStatus("已恢复上次文档", "info");
  } catch {
    clearLastSessionPath();
    updateChrome();
  }
}

async function registerRestoredPath(path: string) {
  // 会话恢复路径时，Rust 端的 OpenedWindows 表里没这条记录；不补登记的话，
  // 多窗口同文件去重失效，且 routeOpenedPath 在另一窗口点同一路径时无法聚焦回来。
  try {
    await invoke("register_window_path", { path });
  } catch { /* 命令不可用（旧版本 / e2e mock 未注册）时静默忽略 */ }
}

export async function restoreSnapshot(snapshot: SessionSnapshot): Promise<{ doc: AimdDocument; mode: Mode; message: string } | null> {
  if (snapshot.draftSourcePath) {
    try {
      const draftDoc = await invoke<AimdDocument>("open_aimd", { path: snapshot.draftSourcePath });
      const html = await renderSnapshotHTML({
        ...snapshot,
        assets: draftDoc.assets,
      });
      return {
        doc: {
          ...draftDoc,
          path: snapshot.path,
          title: snapshot.title || draftDoc.title,
          markdown: snapshot.markdown,
          html,
          assets: draftDoc.assets,
          dirty: snapshot.dirty,
          isDraft: snapshot.isDraft,
          draftSourcePath: snapshot.draftSourcePath,
          needsAimdSave: snapshot.needsAimdSave,
          format: snapshot.format,
        },
        mode: snapshot.mode,
        message: snapshot.dirty || snapshot.isDraft ? "已恢复未保存草稿" : "已恢复上次会话",
      };
    } catch {
      // Fall back to the persisted snapshot below; this may still recover text.
    }
  }

  if (snapshot.path && !snapshot.isDraft && snapshot.format !== "markdown") {
    try {
      const diskDoc = await invoke<AimdDocument>("open_aimd", { path: snapshot.path });
      if (!snapshot.dirty && snapshot.markdown === diskDoc.markdown) {
        return {
          doc: { ...diskDoc, isDraft: false, format: "aimd", dirty: false },
          mode: snapshot.mode,
          message: "已恢复上次文档",
        };
      }
      const html = await renderSnapshotHTML({
        ...snapshot,
        path: diskDoc.path,
        assets: diskDoc.assets,
        title: snapshot.title || diskDoc.title,
      });
      return {
        doc: {
          ...diskDoc,
          title: snapshot.title || diskDoc.title,
          markdown: snapshot.markdown,
          html,
          assets: diskDoc.assets,
          dirty: true,
          isDraft: false,
          draftSourcePath: snapshot.draftSourcePath,
          needsAimdSave: snapshot.needsAimdSave,
          format: "aimd",
        },
        mode: snapshot.mode,
        message: "已恢复未保存修改",
      };
    } catch {
      // Fall back to the persisted snapshot below.
    }
  }

  const html = await renderSnapshotHTML(snapshot);
  return {
    doc: {
      path: snapshot.path,
      title: snapshot.title,
      markdown: snapshot.markdown,
      html,
      assets: snapshot.assets,
      dirty: snapshot.dirty,
      isDraft: snapshot.isDraft,
      draftSourcePath: snapshot.draftSourcePath,
      needsAimdSave: snapshot.needsAimdSave,
      format: snapshot.format,
    },
    mode: snapshot.mode,
    message: snapshot.dirty || snapshot.isDraft ? "已恢复未保存草稿" : "已恢复上次会话",
  };
}

export async function renderSnapshotHTML(snapshot: SessionSnapshot): Promise<string> {
  try {
    const renderPath = snapshot.draftSourcePath
      || (snapshot.path && !snapshot.isDraft && snapshot.format !== "markdown" ? snapshot.path : "");
    if (renderPath) {
      const out = await invoke<RenderResult>("render_markdown", {
        path: renderPath,
        markdown: snapshot.markdown,
      });
      return out.html;
    }
  } catch {
    // Fall through to standalone rendering.
  }

  try {
    const out = await invoke<RenderResult>("render_markdown_standalone", {
      markdown: snapshot.markdown,
    });
    return out.html;
  } catch {
    return snapshot.html || "";
  }
}
