---
name: aimd
description: Work with AIMD .aimd single-file Markdown documents using the aimd CLI. Use when reading, summarizing, editing, validating, creating, packaging Markdown with embedded assets, adding or extracting images/resources, cleaning orphan assets, or installing the AIMD skill into other agent skill directories.
---

# AIMD

Use the `aimd` CLI as the only write path for `.aimd` files. Keep this file loaded; read references only when the task needs the detail.

## Hard Rules

- Do not unzip, mutate, and re-zip AIMD packages by hand.
- Do not convert `asset://id` references to relative file paths inside the AIMD body.
- Before editing, read the current body with `aimd read`.
- After any write or asset operation, run `aimd doctor`.
- If `aimd doctor` reports manifest corruption, missing entry, missing asset, SHA mismatch, or size mismatch, stop and report before further writes.

## Fast Workflows

Summarize:

```bash
aimd info report.aimd --json
aimd read report.aimd
aimd assets list report.aimd --json
```

Edit body:

```bash
aimd read report.aimd > /tmp/report.md
# edit /tmp/report.md
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```

Edit body and manifest title together:

```bash
aimd read report.aimd > /tmp/report.md
# edit /tmp/report.md
aimd write report.aimd --input /tmp/report.md --title "Updated title" --canonicalize
aimd doctor report.aimd
```

Update only the manifest title:

```bash
aimd set-title report.aimd "Updated title" --canonicalize
aimd doctor report.aimd
```

Add image:

```bash
aimd assets add report.aimd ./diagram.png --name diagram.png
aimd read report.aimd > /tmp/report.md
# insert the printed asset://id into /tmp/report.md
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```

Create from Markdown:

```bash
aimd new report.aimd --input report.md --embed-local-images
aimd doctor report.aimd
```

Use `aimd new` only when creating a new package. Do not use it to change a title
or update the body of an existing `.aimd`; `aimd write` and `aimd set-title`
preserve existing asset ids and package metadata.

Clean:

```bash
aimd gc report.aimd
aimd canonicalize report.aimd
aimd doctor report.aimd
```

Install AIMD skill into another agent directory:

```bash
aimd skill list-agents
aimd skill install --agent codex --scope user
aimd skill install --agent claude-code --scope project --project /path/to/repo
```

## Commands

- Read: `aimd read`, `aimd info --json`, `aimd manifest`, `aimd assets list --json`, `aimd assets extract`.
- Edit: `aimd write`, `aimd set-title`, `aimd assets add`, `aimd assets remove`, `aimd gc`, `aimd canonicalize`, `aimd doctor`.
- Generate: `aimd new --embed-local-images`.
- Install: `aimd skill list-agents`, `aimd skill install`, `aimd skill doctor`.

## Load References Only When Needed

- `references/cli.md`: exact command syntax and semantics.
- `references/format.md`: AIMD ZIP layout, manifest fields, asset records.
- `references/agent-install.md`: supported agent names, aliases, user/project paths.
- `references/safety.md`: failure handling and write safety checklist.
- `examples/`: short task-specific flows.
