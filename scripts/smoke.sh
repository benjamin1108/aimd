#!/usr/bin/env bash
# smoke.sh — basic smoke test for AIMD Desktop e2e tests.
# Run from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"

echo "==> running AIMD Desktop e2e tests"
cd "$DESKTOP"
npm run test:e2e

echo "==> all checks passed"
