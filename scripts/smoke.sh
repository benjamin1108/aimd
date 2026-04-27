#!/usr/bin/env bash
# End-to-end smoke test for the aimd CLI.
# Exercises pack -> inspect -> unpack -> export html and a brief preview probe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIN="$ROOT/bin/aimd"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> build"
go build -o "$BIN" ./cmd/aimd

echo "==> pack examples/report"
"$BIN" pack examples/report/report.md -o "$TMP/report.aimd"
test -s "$TMP/report.aimd"

echo "==> inspect"
"$BIN" inspect "$TMP/report.aimd"

echo "==> unpack"
"$BIN" unpack "$TMP/report.aimd" -o "$TMP/out"
test -f "$TMP/out/main.md"
test -f "$TMP/out/manifest.json"
test -f "$TMP/out/assets/cover.svg"
grep -q "assets/cover.svg" "$TMP/out/main.md"

echo "==> export html"
"$BIN" export html "$TMP/report.aimd" -o "$TMP/report.html"
test -s "$TMP/report.html"
grep -q "data:image/svg" "$TMP/report.html"

echo "==> preview probe"
"$BIN" preview "$TMP/report.aimd" --port 18234 --no-open >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -rf "$TMP"' EXIT
sleep 0.6
curl -fs -o /dev/null http://127.0.0.1:18234/
curl -fs -o /dev/null http://127.0.0.1:18234/assets/cover-001
kill $PID 2>/dev/null || true

echo "==> all checks passed"
