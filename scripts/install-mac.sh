#!/usr/bin/env bash
# install-mac.sh — install aimd CLI and register .aimd extension on macOS.
# After running this, double-click any .aimd file in Finder to view it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AIMD_BIN="$ROOT/bin/aimd"

# 1. Build the binary if it isn't already there.
if [ ! -x "$AIMD_BIN" ]; then
  echo "==> building aimd"
  (cd "$ROOT" && go build -o bin/aimd ./cmd/aimd)
fi

# 2. Install the binary to a stable location.
INSTALL_BIN="$HOME/.local/bin/aimd"
mkdir -p "$(dirname "$INSTALL_BIN")"
cp "$AIMD_BIN" "$INSTALL_BIN"
echo "==> installed binary to $INSTALL_BIN"

# 3. Compile a tiny AppleScript .app whose only job is to run
#    'aimd seal <file>' and open the resulting HTML in the default browser.
APP_DIR="$HOME/Applications"
APP="$APP_DIR/AIMD Viewer.app"
mkdir -p "$APP_DIR"
rm -rf "$APP"

osacompile -o "$APP" -e '
on open theFiles
  repeat with f in theFiles
    set fpath to POSIX path of f
    try
      do shell script "'"$INSTALL_BIN"' view " & quoted form of fpath & " > /dev/null 2>&1 &"
    on error errmsg
      display dialog "AIMD launch failed:" & return & return & errmsg buttons {"OK"} default button 1 with icon stop
    end try
  end repeat
end open
on run
  display dialog "AIMD Viewer" & return & return & "Double-click any .aimd file in Finder, or drag one onto this app icon." buttons {"OK"} default button 1
end run
'
echo "==> created app at $APP"

# 4. Patch the .app's Info.plist to declare the .aimd document type.
PLIST="$APP/Contents/Info.plist"
PB() { /usr/libexec/PlistBuddy -c "$1" "$PLIST" >/dev/null 2>&1 || true; }

PB "Delete :CFBundleDocumentTypes"
PB "Add :CFBundleDocumentTypes array"
PB "Add :CFBundleDocumentTypes:0 dict"
PB "Add :CFBundleDocumentTypes:0:CFBundleTypeName string AIMD Document"
PB "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array"
PB "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string aimd"
PB "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer"
PB "Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner"
PB "Set :CFBundleIdentifier org.aimd.viewer"
echo "==> registered .aimd document type in Info.plist"

# 5. Tell Launch Services about the new bundle.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
"$LSREGISTER" -f "$APP"
echo "==> registered with Launch Services"

cat <<EOF

✓ Done.

  CLI:   $INSTALL_BIN
  App:   $APP

Now double-click any .aimd file in Finder — it opens in a native window
(macOS WKWebView; no browser, no temp files).

If you want 'aimd' on your shell PATH, add this to ~/.zshrc:
  export PATH="\$HOME/.local/bin:\$PATH"

EOF
