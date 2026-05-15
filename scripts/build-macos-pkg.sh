#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
OUT_DIR="$ROOT/dist"
IDENTIFIER="org.aimd.desktop.pkg"
VERSION=""
SKIP_ENV="${AIMD_SKIP_ENV:-0}"
SKIP_BUILD=0
CLEAN_BUILD=0
BUILD_TARGET="$ROOT/target"
BUNDLE_MACOS=""
CLI_PATH=""
PKGROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN_BUILD=1; shift
      ;;
    --skip-env)
      SKIP_ENV=1; shift
      ;;
    --skip-build)
      SKIP_BUILD=1; shift
      ;;
    --out-dir)
      OUT_DIR="${2:-}"; shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage:
  ./scripts/build-macos-pkg.sh
  ./scripts/build-macos-pkg.sh --skip-env
  ./scripts/build-macos-pkg.sh --clean
  ./scripts/build-macos-pkg.sh --skip-build

Builds AIMD Desktop, builds the aimd CLI, and creates a system-level PKG that installs:
  /Applications/AIMD Desktop.app
  /usr/local/bin/aimd
  /usr/local/share/aimd/skill/aimd

The package postinstall also installs the AIMD skill into supported user-level
Agent skill directories for the active console user and refreshes
~/.local/bin/aimd when that user-local path shadows /usr/local/bin/aimd.
The package preinstall quits a running AIMD Desktop before replacing the app.

The final package is written to dist/. Cargo/Tauri caches stay under target/.
After a successful package build, distributable byproducts such as .app/.dmg
bundles are removed so dist/ contains the PKG and target/ remains a build cache.

Set AIMD_RELEASE=1 or AIMD_UPDATER_ARTIFACTS=1 to additionally create and sign
the Tauri updater app archive:
  dist/AIMD-Desktop_<version>_macos_aarch64.app.tar.gz
  dist/AIMD-Desktop_<version>_macos_aarch64.app.tar.gz.sig

By default the script reuses target/ for faster builds. Pass --clean to remove
the target/ cache first and perform a fresh build.
USAGE
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2; exit 1
      ;;
  esac
done

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
  echo "error: finish the Xcode Command Line Tools installer, then rerun ./scripts/build-macos-pkg.sh" >&2
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
  ensure_brew_package cargo rust
}

sync_version() {
  echo "==> synchronizing release version"
  cd "$ROOT"
  node scripts/sync-version.mjs
  VERSION="$(node -e "process.stdout.write(require('./release.config.json').version)")"
}

build_release_artifacts() {
  echo "==> building AIMD Desktop ($(uname -sm))"
  cd "$DESKTOP"

  local needs_npm_install=0
  if [[ ! -d node_modules || ! -f node_modules/.package-lock.json ]]; then
    needs_npm_install=1
  elif [[ package.json -nt node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
    needs_npm_install=1
  fi

  if [[ "$needs_npm_install" == "1" ]]; then
    echo "==> installing npm dependencies"
    npm install
  fi

  export CARGO_TARGET_DIR="$BUILD_TARGET"
  npm run build:injector
  npx tauri build --bundles app
  cd "$ROOT"
  echo "==> building aimd CLI"
  cargo build --release -p aimd-cli
}

remove_path() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    return
  fi
  chmod -R u+rwX "$path" 2>/dev/null || true
  if ! rm -rf "$path" 2>/dev/null; then
    echo "warning: could not remove $path; check ownership/permissions" >&2
  fi
}

prepare_build_paths() {
  BUNDLE_MACOS="$BUILD_TARGET/release/bundle/macos"
  CLI_PATH="$BUILD_TARGET/release/aimd"
}

updater_artifacts_required() {
  [[ "${AIMD_RELEASE:-0}" == "1" || "${AIMD_UPDATER_ARTIFACTS:-0}" == "1" ]]
}

ensure_updater_signing_env() {
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
    echo "error: updater signing requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH" >&2
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}"
}

sign_updater_artifact() {
  local artifact="$1"
  ensure_updater_signing_env
  node "$ROOT/scripts/sign-updater-artifact.mjs" "$artifact" --cwd "$DESKTOP"
}

create_macos_updater_artifact() {
  if ! updater_artifacts_required; then
    return
  fi
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "error: macOS updater contract currently supports darwin-aarch64 only; runner is $(uname -m)" >&2
    exit 1
  fi
  local updater="$OUT_DIR/AIMD-Desktop_${VERSION}_macos_aarch64.app.tar.gz"
  echo "==> creating macOS updater artifact"
  rm -f "$updater" "$updater.sig"
  COPYFILE_DISABLE=1 tar -czf "$updater" -C "$BUNDLE_MACOS" "$(basename "$APP_PATH")"
  sign_updater_artifact "$updater"
  echo "updater -> $updater"
  echo "signature -> $updater.sig"
}

prepare_output_dir() {
  mkdir -p "$OUT_DIR"
  if [[ "$OUT_DIR" == "$ROOT/dist" ]]; then
    find "$OUT_DIR" -maxdepth 1 \( -name 'AIMD-*.pkg' -o -name 'AIMD*.dmg' -o -name 'AIMD*.app' -o -name 'AIMD-Desktop_*_macos_*.app.tar.gz' -o -name 'AIMD-Desktop_*_macos_*.app.tar.gz.sig' -o -name '.DS_Store' \) -exec rm -rf {} +
  fi
}

cleanup_package_products() {
  echo "==> cleaning package products"
  remove_path "$BUILD_TARGET/release/bundle"
  remove_path "$BUILD_TARGET/pkg"
  if [[ "$OUT_DIR" == "$ROOT/dist" && -d "$OUT_DIR" ]]; then
    find "$OUT_DIR" -maxdepth 1 \( -name 'AIMD-*.pkg' -o -name 'AIMD*.dmg' -o -name 'AIMD*.app' -o -name '.DS_Store' \) -exec rm -rf {} +
  fi
}

cleanup_packaging_byproducts() {
  echo "==> cleaning app/dmg packaging byproducts"
  remove_path "$BUILD_TARGET/release/bundle"
  remove_path "$BUILD_TARGET/pkg"
  if [[ "$OUT_DIR" == "$ROOT/dist" && -d "$OUT_DIR" ]]; then
    find "$OUT_DIR" -maxdepth 1 \( -name 'AIMD*.dmg' -o -name 'AIMD*.app' -o -name '.DS_Store' \) -exec rm -rf {} +
  fi
}

cleanup_build_cache() {
  echo "==> cleaning build cache"
  remove_path "$BUILD_TARGET"
}

prepare_build_paths

start_ts=$(date +%s)
prepare_env
sync_version
if [[ "$SKIP_BUILD" != "1" ]]; then
  if [[ "$CLEAN_BUILD" == "1" ]]; then
    cleanup_build_cache
  fi
  build_release_artifacts
else
  echo "==> skipping build; using existing release artifacts"
fi

APP_PATH="$(ls -dt "$BUNDLE_MACOS"/*.app 2>/dev/null | head -n 1 || true)"
if [[ ! -d "$APP_PATH" ]]; then
  echo "error: no app bundle produced under $BUNDLE_MACOS" >&2
  exit 1
fi

if [[ ! -x "$CLI_PATH" ]]; then
  echo "error: missing executable CLI: $CLI_PATH" >&2
  exit 1
fi

SKILL_SOURCE="$ROOT/skill"
if [[ ! -f "$SKILL_SOURCE/SKILL.md" ]]; then
  echo "error: missing AIMD skill source: $SKILL_SOURCE/SKILL.md" >&2
  exit 1
fi

PKGROOT="$(mktemp -d "${TMPDIR:-/tmp}/aimd-pkgroot.XXXXXX")"
trap '[[ -n "${PKGROOT:-}" ]] && rm -rf "$PKGROOT"' EXIT
prepare_output_dir
mkdir -p "$PKGROOT/Applications" "$PKGROOT/usr/local/bin" "$PKGROOT/usr/local/share/aimd/skill/aimd"
xattr -cr "$APP_PATH" 2>/dev/null || true
mkdir -p "$PKGROOT/Applications/AIMD Desktop.app"
cp -R "$APP_PATH"/. "$PKGROOT/Applications/AIMD Desktop.app/"
install -m 0755 "$CLI_PATH" "$PKGROOT/usr/local/bin/aimd"
cp -R "$SKILL_SOURCE"/. "$PKGROOT/usr/local/share/aimd/skill/aimd/"
find "$PKGROOT" -name '._*' -delete
xattr -cr "$PKGROOT" 2>/dev/null || true
chmod -R u+rwX,go+rX "$PKGROOT"

pkgbuild \
  --root "$PKGROOT" \
  --scripts "$ROOT/scripts/pkg" \
  --filter '(^|/)\._[^/]*$' \
  --filter '.*\.DS_Store$' \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT_DIR/AIMD-${VERSION}.pkg"

create_macos_updater_artifact
cleanup_packaging_byproducts

echo "pkg -> $OUT_DIR/AIMD-${VERSION}.pkg"
elapsed=$(( $(date +%s) - start_ts ))
echo "==> done in ${elapsed}s"
