import { invoke } from "@tauri-apps/api/core";
import type { RenderResult, SessionSnapshot } from "../core/types";

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
