#!/usr/bin/env bash
set -euo pipefail

PKG_IDENTIFIER="org.aimd.desktop.pkg"
APP_PATH="/Applications/AIMD.app"
CLI_PATH="/usr/local/bin/aimd"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/uninstall-macos-pkg.sh

Uninstalls the system-level AIMD macOS PKG install:
  /Applications/AIMD.app
  /usr/local/bin/aimd

The script also removes global AIMD Git driver config and forgets the macOS
PKG receipt. User documents and AIMD app data are not removed.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this uninstall script is for macOS only" >&2
  exit 1
fi

echo "==> uninstalling AIMD PKG install"
echo "==> removing global AIMD Git driver config"
if [[ -x "$CLI_PATH" ]]; then
  "$CLI_PATH" git-uninstall --global 2>/dev/null || true
elif command -v git >/dev/null 2>&1; then
  git config --global --unset-all diff.aimd.textconv 2>/dev/null || true
  git config --global --unset-all diff.aimd.cachetextconv 2>/dev/null || true
  git config --global --unset-all merge.aimd.name 2>/dev/null || true
  git config --global --unset-all merge.aimd.driver 2>/dev/null || true
fi

echo "==> removing $APP_PATH and $CLI_PATH"
sudo rm -rf "$APP_PATH" "$CLI_PATH"

echo "==> forgetting pkg receipt $PKG_IDENTIFIER"
sudo pkgutil --forget "$PKG_IDENTIFIER" >/dev/null 2>&1 || true

echo "==> done"
echo "AIMD user data and documents were not removed."
