#!/usr/bin/env bash
# Prepare the macOS build environment, build AIMD Desktop, and copy the
# .dmg / .app into <repo-root>/dist/.
#
# Usage:
#   ./build-dmg.sh                         # prepare env, build with current icons
#   ./build-dmg.sh --skip-env              # skip dependency checks/installs
#   ./build-dmg.sh --icon <path>           # regenerate icons (raw, no padding)
#   ./build-dmg.sh --icon <path> --pad     # regenerate via prepare-icon.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$ROOT/apps/desktop-tauri"
ICONS="$DESKTOP/src-tauri/icons"
BUNDLE="$DESKTOP/src-tauri/target/release/bundle"
DIST="$ROOT/dist"

ICON_SRC=""
ICON_PAD=0
SKIP_ENV="${AIMD_SKIP_ENV:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --icon)
      ICON_SRC="${2:-}"; shift 2
      ;;
    --pad)
      ICON_PAD=1; shift
      ;;
    --skip-env)
      SKIP_ENV=1; shift
      ;;
    -h|--help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2; exit 1
      ;;
  esac
done

if [[ ! -d "$DESKTOP" ]]; then
  echo "error: $DESKTOP not found - run this from the AIMD repo root" >&2
  exit 1
fi

have() {
  command -v "$1" >/dev/null 2>&1
}

ensure_xcode_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    echo "==> Xcode Command Line Tools found"
    return
  fi
  echo "==> installing Xcode Command Line Tools"
  xcode-select --install || true
  echo "error: finish the Xcode Command Line Tools installer, then rerun ./build-dmg.sh" >&2
  exit 1
}

ensure_brew() {
  if have brew; then
    echo "==> Homebrew found"
    return
  fi
  echo "==> installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_brew_package() {
  local cmd="$1"
  local pkg="$2"
  if have "$cmd"; then
    echo "==> $cmd found"
    return
  fi
  echo "==> installing $pkg"
  brew install "$pkg"
}

prepare_env() {
  if [[ "$SKIP_ENV" == "1" ]]; then
    echo "==> skipping environment preparation"
    return
  fi
  ensure_xcode_clt
  ensure_brew
  ensure_brew_package node node
  ensure_brew_package go go
  ensure_brew_package cargo rust
}

start_ts=$(date +%s)
echo "==> building AIMD Desktop ($(uname -sm))"
prepare_env

if [[ -n "$ICON_SRC" ]]; then
  if [[ ! -f "$ICON_SRC" ]]; then
    echo "error: icon source not found: $ICON_SRC" >&2
    exit 1
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
if [[ ! -d node_modules ]]; then
  echo "==> installing npm dependencies"
  npm install
fi
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
