# AIMD Format Reference

An `.aimd` file is a ZIP container with Markdown, a JSON manifest, and optional resources.

```text
report.aimd
├── main.md
├── manifest.json
└── assets/
    └── image-001.png
```

Required manifest fields:

- `format`: must be `aimd`.
- `version`: current format version.
- `entry`: usually `main.md`.
- `createdAt` and `updatedAt`: RFC3339 timestamps.
- `assets`: optional list of resource records.

Asset records use:

- `id`: referenced from Markdown as `asset://id`.
- `path`: ZIP entry, usually under `assets/`.
- `mime`: media type.
- `sha256`: resource digest.
- `size`: byte size.
- `role`: for example `content-image`, `cover`, or `attachment`.

Agents should treat the container as a package managed by the `aimd` CLI. Read `main.md` through `aimd read`; replace it through `aimd write`; add and remove resources through `aimd assets`.
