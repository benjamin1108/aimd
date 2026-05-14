# AIMD Safety Checklist

Before writing:

- Run `aimd doctor FILE` if the document may be damaged.
- Run `aimd read FILE > /tmp/file.md` and edit that Markdown copy.
- Preserve existing `asset://id` references unless the user explicitly changes images.
- Do not edit the ZIP internals directly.

When adding assets:

- Use `aimd assets add`.
- Insert the printed `asset://id` into Markdown.
- Use `aimd doctor` after the final write.

When removing assets:

- Remove the Markdown reference first if the asset is still referenced.
- Use `aimd gc FILE` to delete orphan resources.
- Use `aimd assets remove FILE ASSET_ID` only for explicit deletion.

Stop and report instead of writing when:

- `manifest.json` is missing or invalid.
- `format` is not `aimd`.
- `main.md` is missing or not UTF-8.
- A resource path is missing.
- A resource `sha256` or `size` does not match.
- Markdown references an asset id not present in the manifest.
