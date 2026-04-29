#!/usr/bin/env bash
# Build AIMD Desktop and copy the .dmg / .app into <repo-root>/dist/.
#
# Usage:
#   ./build-dmg.sh                         # just build with current icons
#   ./build-dmg.sh --icon <path>           # regenerate icons (raw, no padding)
#                                          # for full-bleed art like solid-bg
#   ./build-dmg.sh --icon <path> --pad     # regenerate via prepare-icon.sh
#                                          # (trim + 10% transparent padding,
#                                          #  the macOS-standard look; needs
#                                          #  ImageMagick `magick` installed)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$ROOT/apps/desktop-tauri"
ICONS="$DESKTOP/src-tauri/icons"
BUNDLE="$DESKTOP/src-tauri/target/release/bundle"
DIST="$ROOT/dist"

ICON_SRC=""
ICON_PAD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --icon)
      ICON_SRC="${2:-}"; shift 2
      ;;
    --pad)
      ICON_PAD=1; shift
      ;;
    -h|--help)
      sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2; exit 1
      ;;
  esac
done

if [[ ! -d "$DESKTOP" ]]; then
  echo "error: $DESKTOP not found — run this from the AIMD repo root" >&2
  exit 1
fi

start_ts=$(date +%s)
echo "==> building AIMD Desktop ($(uname -sm))"

if [[ -n "$ICON_SRC" ]]; then
  if [[ ! -f "$ICON_SRC" ]]; then
    echo "error: icon source not found: $ICON_SRC" >&2; exit 1
  fi
  echo "==> regenerating icons from: $ICON_SRC"
  cd "$DESKTOP"
  if [[ "$ICON_PAD" -eq 1 ]]; then
    ./scripts/update-tauri-icons.sh "$ICON_SRC"
  else
    cp -f "$ICON_SRC" "$ICONS/icon.png"
    npx tauri icon "$ICONS/icon.png" --output src-tauri/icons
  fi
fi

mkdir -p "$DIST"
cd "$DESKTOP"
npm run build

dmg_src="$(ls -t "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -n 1 || true)"
app_src="$(ls -dt "$BUNDLE"/macos/*.app 2>/dev/null | head -n 1 || true)"

if [[ -z "$dmg_src" ]]; then
  echo "error: no .dmg produced under $BUNDLE/dmg/" >&2
  exit 1
fi

cp -f "$dmg_src" "$DIST/"
echo "  dmg -> $DIST/$(basename "$dmg_src")"

if [[ -n "$app_src" ]]; then
  rm -rf "$DIST/$(basename "$app_src")"
  cp -R "$app_src" "$DIST/"
  echo "  app -> $DIST/$(basename "$app_src")"
fi

elapsed=$(( $(date +%s) - start_ts ))
echo "==> done in ${elapsed}s"
ls -lh "$DIST/" | sed 's/^/  /'
