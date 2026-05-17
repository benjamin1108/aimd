#!/usr/bin/env bash
# smoke.sh — basic smoke test for AIMD Desktop e2e tests.
# Run from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"

echo "==> running AIMD Desktop checks and e2e tests"
npm run check
cd "$DESKTOP"
npm run test:e2e

echo "==> all checks passed"
