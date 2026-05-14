# AIMD Git Integration

AIMD keeps `.aimd` as a single ZIP package containing `main.md`, `manifest.json`, and `assets/`.
The `aimd` CLI exposes Git drivers so local Git can diff and merge those internal files.

## Enable

Add this to the repository:

```gitattributes
*.aimd diff=aimd merge=aimd
```

Then enable driver commands explicitly, either in the desktop settings page or with:

```bash
aimd git-install --global
aimd git-install --repo
```

The driver config uses stable commands:

```bash
git config --global diff.aimd.textconv "aimd git-diff"
git config --global diff.aimd.cachetextconv false
git config --global merge.aimd.name "AIMD merge driver"
git config --global merge.aimd.driver "aimd git-merge %O %A %B %P"
```

The PKG installer does not write Git config. Users must opt in from settings or CLI.

## Commands

```bash
aimd git-diff file.aimd
aimd git-merge base.aimd ours.aimd theirs.aimd path/in/worktree.aimd
aimd canonicalize file.aimd
aimd git-doctor --repo
aimd git-uninstall --global
```

`git-diff` prints `main.md`, canonical manifest JSON, and a stable asset table. It never prints binary asset bytes.

`git-merge` delegates `main.md` three-way merging to `git merge-file`. Text conflicts are repacked into `main.md` with conflict markers so AIMD can open the document and show a warning. Binary assets are merged as a content-addressed set; same asset id with different SHA-256 is a hard failure.
