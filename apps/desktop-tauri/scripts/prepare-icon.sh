#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUTPUT="$ROOT_DIR/src-tauri/icons/app-icon.source.png"

REMOVE_BLACK_BG=0
INPUT_PATH=""
OUTPUT_PATH="$DEFAULT_OUTPUT"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/prepare-icon.sh [--remove-black-bg] <input-image> [output-image]

Examples:
  ./scripts/prepare-icon.sh assets/new-icon.png
  ./scripts/prepare-icon.sh --remove-black-bg ~/Desktop/icon.png /tmp/app-icon.png

Notes:
  - Outputs a 1024x1024 transparent PNG.
  - Keeps about 10% padding around the artwork.
  - --remove-black-bg removes near-black background pixels before trimming.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-black-bg)
      REMOVE_BLACK_BG=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$INPUT_PATH" ]]; then
        INPUT_PATH="$1"
      elif [[ "$OUTPUT_PATH" == "$DEFAULT_OUTPUT" ]]; then
        OUTPUT_PATH="$1"
      else
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$INPUT_PATH" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$INPUT_PATH" ]]; then
  echo "Input image not found: $INPUT_PATH" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 'magick' is required but not installed." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

if [[ "$REMOVE_BLACK_BG" -eq 1 ]]; then
  magick "$INPUT_PATH" \
    -alpha set \
    -fuzz 8% \
    -fill none \
    -opaque black \
    -trim +repage \
    -resize 820x820 \
    -background none \
    -gravity center \
    -extent 1024x1024 \
    PNG32:"$OUTPUT_PATH"
else
  magick "$INPUT_PATH" \
    -alpha set \
    -trim +repage \
    -resize 820x820 \
    -background none \
    -gravity center \
    -extent 1024x1024 \
    PNG32:"$OUTPUT_PATH"
fi

echo "Prepared icon source: $OUTPUT_PATH"
