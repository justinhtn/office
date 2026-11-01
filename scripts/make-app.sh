#!/bin/bash
# Makes "Agent Office.app" in Applications, which opens the office in its own Chrome window.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The main Applications folder is where Finder, Launchpad and Spotlight look first.
FOLDER=/Applications
[ -w "$FOLDER" ] || FOLDER="$HOME/Applications"
mkdir -p "$FOLDER"
APP="$FOLDER/Agent Office.app"
rm -rf "$APP"
osacompile -o "$APP" -e 'do shell script "open -na \"Google Chrome\" --args --app=http://localhost:8794 --window-size=1400,850"'
cp "$ROOT/scripts/AgentOffice.icns" "$APP/Contents/Resources/applet.icns"
# Newer macOS prefers the script editor icon in Assets.car, so remove it to use ours.
rm -f "$APP/Contents/Resources/Assets.car"
plutil -remove CFBundleIconName "$APP/Contents/Info.plist" 2>/dev/null || true
plutil -replace CFBundleIconFile -string applet "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" 2>/dev/null || true
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true
echo "Made $APP"
