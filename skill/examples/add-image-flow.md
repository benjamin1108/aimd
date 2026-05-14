# Add Image Flow

```bash
aimd assets add report.aimd ./chart.png --name chart.png --role content-image
```

The command prints an `asset://id`. Insert that URI into the Markdown:

```bash
aimd read report.aimd > /tmp/report.md
```

Edit `/tmp/report.md`, then write and validate:

```bash
aimd write report.aimd --input /tmp/report.md --canonicalize
aimd doctor report.aimd
```
