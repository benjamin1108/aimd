# /goal: AIMD diff and source-preserving visual editor stability

## Background

AIMD already has Git textconv support for `.aimd` documents. Native `git diff`
should use `aimd git-diff` so users can review `main.md`, canonical package
metadata, and asset lists instead of binary ZIP noise.

Two production regressions exposed gaps in the current implementation:

1. The desktop Git diff view can bypass AIMD textconv when it calls Git with
   `--no-textconv`. That makes `.aimd` files appear as binary or unreadable
   package diffs inside the app, even when `.gitattributes` and Git config are
   correct.
2. A small visual edit can rewrite large parts of `main.md`. The current visual
   editor treats rendered HTML as the save source and converts the whole document
   back to Markdown with Turndown. HTML does not preserve Markdown source style,
   so unchanged source can be rewritten, for example `### 1.` becomes
   `### 1\.` and `- item` becomes `-   item` with extra blank lines.

This goal tracks the production fix. The implementation must land the durable
source-preserving editor architecture directly. Do not treat Turndown rule
tuning, one-off string cleanup, or a partial "minimal fix" as completion.
Unchanged Markdown source must be preserved byte-for-byte.

## Objective

Make `.aimd` review and editing stable enough for production:

- Desktop and command-line Git diff must show semantic `.aimd` changes through
  the AIMD textconv driver.
- Visual edits must not rewrite Markdown source outside the user-edited range.
- The editor must be deterministic across macOS, Windows, and Linux.
- Regression tests must prove that editing one character in an `.aimd` document
  produces a one-character semantic diff, not whole-document Markdown churn.

## In Scope

### Git diff behavior

- Remove `--no-textconv` from desktop file diff commands for user-facing Git
  diff views.
- Keep `--no-ext-diff` if needed to avoid arbitrary external diff tools, but do
  not disable Git textconv.
- Preserve staged and unstaged diff support.
- Preserve output limits, timeout handling, and truncation flags.
- Ensure `.aimd` files with `*.aimd diff=aimd merge=aimd` use the configured
  `diff.aimd.textconv` command inside the desktop app.
- Add regression coverage for `.aimd` desktop diff using a temporary repo and a
  real `.gitattributes` / Git config setup.

### Source-preserving visual editing

- Treat Markdown source as the authority for persistence.
- Treat visual HTML as an interaction view, not as the canonical save source.
- Parse Markdown into a block model that records stable block ids and source
  byte ranges.
- Render visual editor DOM with source mapping metadata such as `data-block-id`
  and source ranges.
- Track dirty blocks or dirty structural regions during visual editing.
- On save, patch the original Markdown source only for changed blocks or changed
  structure.
- Preserve untouched Markdown source byte-for-byte, including heading escaping,
  list marker spacing, blank lines, link title spelling, table alignment rows,
  frontmatter, and trailing newline style.
- Use a deterministic local serializer only for new or structurally changed
  blocks that have no original source span.
- Keep `asset://...` references stable and never convert them to local file
  paths during editing.
- Preserve the document's dominant newline style where possible. Internally the
  editor may normalize to `\n`, but save output must not cause whole-file CRLF /
  LF churn.

## Out of Scope

- Changing the `.aimd` container format.
- Replacing the AIMD Git merge algorithm.
- Supporting remote Git hosting web UIs that cannot run local textconv.
- Making arbitrary rich-text formatting round-trip perfectly when Markdown has
  no equivalent syntax.
- Silently rewriting existing `.aimd` files to a new canonical Markdown style.
- Using unzip / rezip as an editing path.

## Required Architecture

The production editor must move from whole-document HTML to Markdown conversion
to a source-preserving patch engine.

Required model:

1. Open `.aimd` and read `main.md`.
2. Parse Markdown into an AST or block tree with source positions.
3. Render HTML from that tree and attach stable metadata to editable block DOM.
4. Record edits at block granularity. Simple text edits update only the mapped
   block. Structural edits mark a narrow parent region dirty.
5. On save, apply patches to the original Markdown source. Unchanged spans are
   copied exactly from the original source.
6. Re-render after save from the patched Markdown.

Implementation can live in Rust core, TypeScript, or a split design, but the
save semantics must be shared across platforms and covered by tests. If two
parsers are used, the source range model must be tested against the renderer so
DOM block ids map back to the intended Markdown spans.

The normal visual text-edit path must not call whole-document Turndown. A
fallback serializer is allowed only for newly inserted or explicitly unsupported
structural regions, and fallback use must be narrow, observable in tests, and
unable to rewrite untouched source.

## Cross-Platform Requirements

- The source-preserving algorithm must be platform independent string / AST
  logic.
- Windows paths must not leak into Markdown source when editing asset-backed
  images.
- CRLF input files must not be rewritten to LF unless the user explicitly
  normalizes the file.
- WebView-specific `innerHTML` differences must not affect saved Markdown for
  simple text edits.
- Git diff behavior must be verified on macOS and Windows. Linux should use the
  same non-platform-specific Git invocation path where available.

## Acceptance Criteria

- In a repo with `.gitattributes` containing `*.aimd diff=aimd merge=aimd`, the
  desktop Git diff view for a changed `.aimd` file includes `--- AIMD main.md ---`
  and does not report the file as a binary diff.
- Desktop staged and unstaged `.aimd` diffs both use textconv.
- `git diff -- examples/ai-daily-2026-04-30.aimd` and the desktop diff view show
  the same semantic Markdown change for the same unstaged file.
- Opening an `.aimd` file, switching modes without editing, and saving does not
  change the file.
- In visual edit mode, adding one character to a heading in
  `examples/ai-daily-2026-04-30.aimd` changes only the expected heading line in
  textconv diff.
- Existing Markdown source outside the edited block is byte-for-byte unchanged
  after save.
- Existing list markers, list indentation, heading punctuation, blank lines,
  table formatting, link titles, frontmatter, and trailing newline style survive
  unrelated visual text edits.
- `asset://` ids remain unchanged after visual edits that do not touch the image.
- Regression tests fail if whole-document Turndown output is used for ordinary
  text edits.
- `npm --prefix apps/desktop run check`, `cargo check --workspace`, and
  `git diff --check` pass for the final implementation.

## Suggested Test Matrix

- `.aimd` Git diff:
  - unstaged text edit in `main.md`
  - staged text edit in `main.md`
  - changed asset table without binary bytes
  - missing or disabled textconv produces a clear actionable error

- Source-preserving visual edit:
  - heading text edit where heading begins with `1.`
  - unordered list item text edit
  - ordered list item text edit
  - task list edit
  - table cell text edit
  - link text edit with title preserved
  - image-adjacent text edit with `asset://` reference preserved
  - frontmatter document edit with frontmatter preserved
  - CRLF input document edit with CRLF preserved

## Delivery Requirements

This is a single production delivery, not a staged minimal implementation. The
work is complete only when all of the following are true:

- Desktop `.aimd` diff uses Git textconv for staged and unstaged changes.
- Markdown open/render/edit/save uses a source-preserving block model with
  source ranges.
- Visual editor DOM is mapped back to Markdown source through stable block ids.
- Dirty tracking records the smallest safe changed block or structural region.
- Save applies patches to the original Markdown source and copies untouched
  spans exactly.
- Whole-document Turndown is removed from the normal visual text-edit save path.
- Unsupported structural edits either use a narrow region serializer or are
  blocked with a clear user-facing limitation; they must not silently rewrite
  the whole document.
- Tests cover the production behavior end to end, including the real
  `examples/ai-daily-2026-04-30.aimd` one-character edit case.
- The implementation passes the full required validation set before the goal is
  considered complete.

## Manual Verification Checklist

1. Install or configure AIMD Git integration.
2. Confirm `.gitattributes` contains `*.aimd diff=aimd merge=aimd`.
3. Open `examples/ai-daily-2026-04-30.aimd` in the desktop app.
4. In visual edit mode, add one character to the first `### 1.` heading.
5. Save the document.
6. Run `git diff -- examples/ai-daily-2026-04-30.aimd`.
7. Confirm diff shows `--- AIMD main.md ---`.
8. Confirm the only semantic Markdown body change is the intended character.
9. Confirm heading punctuation, list indentation, blank lines, tables, links, and
   `asset://` ids outside the edited location did not change.
10. Open the desktop Git panel and confirm the same file diff is readable in the
    main diff view.

## Current Evidence

- Current desktop `get_git_file_diff` uses `git diff --no-ext-diff --no-textconv`
  for staged and unstaged file diffs, which disables AIMD textconv inside the app.
- Local Git config and attributes can still be correct while the app diff fails:
  `diff.aimd.textconv` may point to `aimd git-diff` and
  `git check-attr diff -- file.aimd` may return `diff: aimd`.
- A visual edit can rewrite `main.md` formatting through the current
  `flushInline -> htmlToMarkdown -> turndown` path.
