# Read And Edit Flow

```bash
aimd info report.aimd --json
aimd read report.aimd > /tmp/report.md
```

Edit `/tmp/report.md`, then write it back:

```bash
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```
