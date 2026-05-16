#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PREPARED_ICON="$ROOT_DIR/src-tauri/icons/app-icon.source.png"
REMOVE_BLACK_BG=0
KEEP_ALPHA=0
REMOVE_LIGHT_BG=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/update-tauri-icons.sh [--keep-alpha|--remove-black-bg|--remove-light-bg] <input-image>

Examples:
  ./scripts/update-tauri-icons.sh assets/new-icon.png
  ./scripts/update-tauri-icons.sh --keep-alpha ~/Desktop/icon.png
  ./scripts/update-tauri-icons.sh --remove-black-bg ~/Desktop/icon.png
  ./scripts/update-tauri-icons.sh --remove-light-bg ~/Desktop/ai-icon.png
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 1
fi

if [[ "${1:-}" == "--keep-alpha" ]]; then
  KEEP_ALPHA=1
  shift
elif [[ "${1:-}" == "--remove-black-bg" ]]; then
  REMOVE_BLACK_BG=1
  shift
elif [[ "${1:-}" == "--remove-light-bg" ]]; then
  REMOVE_LIGHT_BG=1
  shift
fi

INPUT_PATH="${1:-}"

if [[ -z "$INPUT_PATH" ]]; then
  usage >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ "$((KEEP_ALPHA + REMOVE_BLACK_BG + REMOVE_LIGHT_BG))" -gt 1 ]]; then
  echo "Use only one background removal mode." >&2
  exit 1
fi

if [[ "$KEEP_ALPHA" -eq 1 ]]; then
  ./scripts/prepare-icon.sh --keep-alpha "$INPUT_PATH" "$PREPARED_ICON"
elif [[ "$REMOVE_BLACK_BG" -eq 1 ]]; then
  ./scripts/prepare-icon.sh --remove-black-bg "$INPUT_PATH" "$PREPARED_ICON"
elif [[ "$REMOVE_LIGHT_BG" -eq 1 ]]; then
  ./scripts/prepare-icon.sh --remove-light-bg "$INPUT_PATH" "$PREPARED_ICON"
else
  ./scripts/prepare-icon.sh "$INPUT_PATH" "$PREPARED_ICON"
fi

npx tauri icon "$PREPARED_ICON" --output src-tauri/icons

echo "Updated Tauri icons from: $INPUT_PATH"
