#!/usr/bin/env bash
# Build dist/Music Coach.zip: a Mac app anyone can unzip and open.
# Only the app goes in: never your data/, sketches/ or API key.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist
APP="$OUT/Music Coach.app"
rm -rf "$OUT"
mkdir -p "$OUT"
osacompile -o "$APP" packaging/launcher.applescript
mkdir -p "$APP/Contents/Resources/app"
cp -R server.py web "$APP/Contents/Resources/app/"
find "$APP" -name .DS_Store -delete
codesign --force --deep -s - "$APP"
ditto -c -k --keepParent "$APP" "$OUT/Music Coach.zip"
echo "Built $OUT/Music Coach.zip ($(du -h "$OUT/Music Coach.zip" | cut -f1))"
