#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PREPARED_ICON="$ROOT_DIR/src-tauri/icons/app-icon.source.png"
REMOVE_BLACK_BG=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/update-tauri-icons.sh [--remove-black-bg] <input-image>

Examples:
  ./scripts/update-tauri-icons.sh assets/new-icon.png
  ./scripts/update-tauri-icons.sh --remove-black-bg ~/Desktop/icon.png
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 1
fi

if [[ "${1:-}" == "--remove-black-bg" ]]; then
  REMOVE_BLACK_BG=1
  shift
fi

INPUT_PATH="${1:-}"

if [[ -z "$INPUT_PATH" ]]; then
  usage >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ "$REMOVE_BLACK_BG" -eq 1 ]]; then
  ./scripts/prepare-icon.sh --remove-black-bg "$INPUT_PATH" "$PREPARED_ICON"
else
  ./scripts/prepare-icon.sh "$INPUT_PATH" "$PREPARED_ICON"
fi

npx tauri icon "$PREPARED_ICON" --output src-tauri/icons

echo "Updated Tauri icons from: $INPUT_PATH"
