# AIMD CLI Reference

The production AIMD workflow uses `aimd` as the stable entrypoint.

## Read

```bash
aimd read FILE
aimd info FILE [--json]
aimd manifest FILE
aimd assets list FILE [--json]
aimd assets extract FILE ASSET_ID --output PATH|-
```

`read` prints the Markdown entry. `info --json` is the fastest machine-readable summary and includes `title` from the manifest plus `bodyTitle` from the first Markdown H1 when present. `manifest` prints the full manifest. `assets extract --output -` writes asset bytes to stdout.

## Edit

```bash
aimd write FILE --input PATH|--stdin [--title TITLE] [--gc] [--canonicalize]
aimd set-title FILE TITLE [--canonicalize]
aimd assets add FILE LOCAL_PATH [--id ID] [--name NAME] [--role ROLE] [--mime MIME]
aimd assets remove FILE ASSET_ID
aimd gc FILE
aimd canonicalize FILE
aimd doctor FILE [--json]
```

`write` replaces `main.md` and preserves existing package metadata and resources. Add `--title TITLE` when the manifest title should move with the body edit. `set-title` changes only the manifest title and `updatedAt`; it preserves `main.md`, asset ids, asset paths, hashes, roles, MIME values, and extension fields. `--gc` removes resources no longer referenced by `asset://id`. `--canonicalize` rewrites stable ZIP and manifest order after the write.

If `aimd doctor --json` reports a `title_mismatch` warning, decide whether the
manifest title or the body H1 is canonical. Use `aimd set-title` for a metadata
fix, or `aimd write --title` when editing the body at the same time. A title
mismatch is a warning and does not make the package invalid.

## Generate

```bash
aimd new OUT.aimd --input SOURCE.md [--title TITLE] [--embed-local-images]
```

Use `--embed-local-images` when the Markdown contains local image paths that should become internal `asset://id` resources. Remote images are not silently packaged by this command.

Use `new` only for a new package. Do not use it to refresh metadata on an
existing `.aimd`, because a new package can regenerate asset ids and metadata.

## Agent Skill Install

```bash
aimd skill list-agents
aimd skill install --agent AGENT --scope user|project [--project PATH] [--force]
aimd skill uninstall --agent AGENT --scope user|project [--project PATH]
aimd skill doctor [--json]
```

Install refuses to overwrite an existing `aimd` skill unless `--force` is provided.

## Git Integration

```bash
aimd git-diff FILE
aimd git-merge BASE OURS THEIRS PATH
aimd git-install --global|--repo
aimd git-uninstall --global|--repo
aimd git-doctor [--repo]
```

These commands are for Git textconv and merge-driver integration.
