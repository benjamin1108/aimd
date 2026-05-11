# AIMD UX / Product Audit

## Current Direction

AIMD Desktop is focused on reliable document handling:

- `.aimd` as the durable single-file format for documents with embedded assets.
- Plain Markdown as a compatibility path that stays plain until the user adds image assets.
- Web Clip as a way to create an unsaved `.aimd` draft without making the user choose a file path too early.

## Product Rules

- Do not interrupt image insertion with upgrade prompts.
- Ask for an `.aimd` save path only when saving a Markdown document that now depends on internal assets.
- Keep unsaved asset-bearing drafts in app-managed local data, not in the OS temp directory.
- Keep document UI focused on reading, editing, source editing, assets, and outline.

## Removed Scope

Docu-Tour / AI-guided tour is no longer part of the product surface. Historical notes that described guided-tour generation, playback, status dots, or tour metadata have been retired from active planning.

## Experience Priorities

- Make save outcomes explicit: Markdown save, `.aimd` Save As, cancelled Save As, and draft recovery must each leave a clear status.
- Keep ordinary Markdown workflows quiet and compatible.
- Make asset-bearing workflows reliable across app restart.
- Avoid raw HTML execution in rendered documents.
