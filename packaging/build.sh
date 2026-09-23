#!/usr/bin/env bash
# Build dist/Music Coach.zip, and the same zip with the version in its name:
# a Mac app anyone can unzip and open.
# Only the app goes in: never your data/, sketches/ or API key.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist
APP="$OUT/Music Coach.app"
# The version release-please sets in package.json.
VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
rm -rf "$OUT"
mkdir -p "$OUT"
osacompile -o "$APP" packaging/launcher.applescript
mkdir -p "$APP/Contents/Resources/app"
cp -R server.py web "$APP/Contents/Resources/app/"
# The app shows this version; Finder's Get Info reads it from Info.plist.
echo "$VERSION" > "$APP/Contents/Resources/app/VERSION"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$VERSION" "$APP/Contents/Info.plist"
find "$APP" -name .DS_Store -delete
codesign --force --deep -s - "$APP"
ditto -c -k --keepParent "$APP" "$OUT/Music Coach.zip"
cp "$OUT/Music Coach.zip" "$OUT/Music-Coach-$VERSION.zip"
echo "Built $OUT/Music Coach.zip and $OUT/Music-Coach-$VERSION.zip ($(du -h "$OUT/Music Coach.zip" | cut -f1)), version $VERSION"
