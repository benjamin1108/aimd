# AIMD — AI Markdown Document

> Turn AI-generated Markdown into a complete, portable, editable document.

AIMD is a single-file document format for the AI generation era. It packages Markdown, images, assets, and metadata into one open `.aimd` file, so reports, tutorials, research notes, technical docs, and agent outputs can be moved, archived, edited, inspected, and shared without broken image paths.

```text
Markdown is the content layer.
AIMD is the document container.
```

![AIMD Desktop: a complete Markdown document package with outline, rendered content, and bundled assets](docs/assets/readme/hero-desktop.png)

## Why AIMD

AI tools are making Markdown the default output format for structured content. ChatGPT, Claude, Gemini, Cursor, Perplexity, agents, notebooks, and internal automation all produce Markdown-like documents.

But Markdown alone is not a complete document:

- Images live outside the file and break when the document is moved.
- Screenshots, charts, diagrams, and generated images are part of the meaning, but are stored as loose files.
- AI-generated reports need source, model, prompt, and provenance metadata.
- Sharing a `.md` file plus an `images/` folder is fragile for normal users.
- PDF is portable, but it is not a good editable intermediate format for AI workflows.

AIMD keeps the simplicity of Markdown and adds the missing document container.

## What You Can Do

| You want to... | AIMD gives you... |
|---|---|
| Save an AI-generated report | One `.aimd` file with Markdown and images bundled together |
| Share with someone else | A portable document that will not lose images when moved |
| Send to someone without AIMD | A sealed self-rendering `.html` file |
| Keep developer workflows | Pack, unpack, inspect, preview, and export from CLI |
| Archive agent outputs | A stable container for Markdown, assets, hashes, and future provenance |
| Recover the original content | Unpack back to plain Markdown + assets at any time |

## Who It Is For

### AI Content Creators

Use AIMD when an AI tool gives you a useful report, tutorial, lesson, proposal, or visual document and you want to keep it as one editable file.

### Developers and Technical Writers

Use AIMD for README-like documents, architecture notes, API guides, design docs, and technical reports that contain diagrams, screenshots, or generated charts.

### Agent and Automation Builders

Use AIMD as the output format for weekly reports, research digests, meeting summaries, QA reports, build reports, and other generated deliverables.

## Product Experience

Start from Markdown, package it as `.aimd`, open it in AIMD Desktop, and keep the document readable, editable, inspectable, and shareable as one file.

## Quick Start

### macOS: Install and Register `.aimd`

```bash
git clone https://github.com/aimd-org/aimd.git
cd aimd
./scripts/install-mac.sh
```

The installer:

1. Builds the `aimd` binary into `~/.local/bin/aimd`.
2. Installs a user-level macOS app wrapper in `~/Applications/`.
3. Registers `.aimd` so files can be opened from Finder.

No `sudo`, no `/usr/local`, and fully reversible.

### Build from Source

Requires Go 1.22 or newer.

```bash
go install github.com/aimd-org/aimd/cmd/aimd@latest
```

For users in mainland China:

```bash
go env -w GOPROXY=https://goproxy.cn,direct
go install github.com/aimd-org/aimd/cmd/aimd@latest
```

## CLI Examples

```bash
# Package Markdown and local images into one .aimd file
aimd pack report.md -o report.aimd

# Open in a native macOS window
aimd view report.aimd

# Preview in a browser through a local server
aimd preview report.aimd

# Inspect manifest, assets, and SHA-256 integrity
aimd inspect report.aimd
aimd inspect report.aimd --json

# Unpack back to a normal Markdown project
aimd unpack report.aimd -o report-out/

# Create a self-rendering HTML file for people without AIMD
aimd seal report.aimd -o report.html

# Export static HTML with images inlined
aimd export html report.aimd -o report-static.html
```

The repository includes a sample in [`examples/report/`](examples/report/). Run the full smoke flow:

```bash
./scripts/smoke.sh
```

## Commands

| Command | Purpose |
|---|---|
| `aimd pack <md> [-o out.aimd] [--title T]` | Bundle Markdown and local image references into one `.aimd` |
| `aimd unpack <aimd> [-o dir] [--keep-asset-uri]` | Recover plain Markdown and assets |
| `aimd inspect <aimd> [--json]` | Print manifest, assets, sizes, and hash status |
| `aimd view <aimd> [--width W --height H]` | Open a native macOS viewer/editor |
| `aimd preview <aimd> [--port N] [--no-open]` | Serve a local browser preview |
| `aimd seal <aimd> [-o out.html]` | Produce a self-rendering standalone HTML file |
| `aimd export html <aimd> [-o out.html]` | Export static HTML with base64-inlined assets |
| `aimd version` | Print binary and format version |

Flags may be placed before or after positional arguments.

## File Format

An `.aimd` file is a ZIP container with a small, inspectable structure:

```text
report.aimd
├── manifest.json          document metadata, assets, hashes
├── main.md                Markdown content
└── assets/                bundled images and resources
    ├── cover.svg
    └── trend.png
```

Markdown image references are rewritten into stable asset URIs:

```markdown
![Cover](asset://cover-001)
```

When unpacked, AIMD rewrites those references back into ordinary relative paths, so the result can still be opened by standard Markdown editors.

## How AIMD Is Different

| Format | Good at | Missing for AI-generated documents |
|---|---|---|
| Markdown + assets folder | Simple, readable, Git-friendly | Images break when moved or shared |
| PDF | Portable final output | Hard to edit, poor as an AI intermediate format |
| DOCX | Office workflows | Complex for automation and developer tooling |
| Single HTML | Browser-friendly | Source content and presentation are mixed |
| AIMD | Portable Markdown document package | Early format, ecosystem still growing |

## Rendering and Sharing Modes

| Mode | Best for | How assets are delivered |
|---|---|---|
| `view` | Local reading/editing | Native window + local streaming |
| `preview` | Browser preview | Local HTTP streaming |
| `seal` | Sharing with anyone | One standalone HTML file with embedded ZIP |
| `export html` | Static publishing | HTML with inlined assets |

## Roadmap

Implemented:

- `.aimd` ZIP container with `manifest.json`, `main.md`, and `assets/`.
- `pack`, `unpack`, `inspect`, `preview`, `view`, `seal`, and `export html`.
- macOS open flow and desktop editor MVP.
- Markdown import, image insertion, image paste, and image compression in Desktop.

Next:

- AI metadata and provenance: model, prompt, source references, review status.
- Document health check: missing assets, broken links, oversized files, structure issues.
- Better share/export UI: `.aimd`, sealed HTML, PDF, DOCX, Markdown project.
- VS Code / Cursor integration for developer workflows.
- Open file format spec, manifest schema, SDK, and signing/verification.

See:

- [MRD](docs/aimd_mrd_v_0_1.md)
- [Product expansion and diagnosis](docs/product_expansion_and_diagnosis.md)
- [Desktop architecture spec](docs/aimd_desktop_tauri_spec.md)
- [Docs index](docs/README.md)

## Development

```bash
go test ./...
go build -o bin/aimd ./cmd/aimd
./scripts/smoke.sh
```

Desktop app:

```bash
cd apps/desktop-tauri
npm install
npm run typecheck
npm run build:web
npm run test:e2e
```

## License

TBD.
