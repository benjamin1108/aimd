#!/usr/bin/env bash
# install-mac.sh — install AIMD Desktop on macOS.
# The desktop application is built with Tauri (Rust + TS); no Go required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"

echo "==> AIMD Desktop install"
echo "    To build and run AIMD Desktop, use:"
echo "    cd $DESKTOP && npm install && npm run build"
echo ""
echo "    Or use the pre-built .dmg from dist/ if available."
echo ""
echo "    Required tools: Node.js, Rust (cargo), Xcode Command Line Tools"
