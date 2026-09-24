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
# Signed with a Developer ID and checked by Apple (notarized) when the keys are
# there, so a downloaded copy opens without macOS warning about malware.
# Without them (a local build) the app is signed for this Mac only.
#   SIGN_IDENTITY   "Developer ID Application: Name (TEAMID)", in the keychain
#   NOTARY_PROFILE  a notarytool keychain profile (xcrun notarytool store-credentials), or
#   NOTARY_KEY, NOTARY_KEY_ID, NOTARY_ISSUER  an App Store Connect API key (.p8 path) and its ids
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --options runtime --timestamp -s "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    NOTARY=(--keychain-profile "$NOTARY_PROFILE")
  elif [ -n "${NOTARY_KEY:-}" ]; then
    NOTARY=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
  else
    echo "SIGN_IDENTITY is set but no notary key: the app is signed, not notarized." >&2
    NOTARY=()
  fi
  if [ ${#NOTARY[@]} -gt 0 ]; then
    ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
    xcrun notarytool submit "$OUT/notarize.zip" "${NOTARY[@]}" --wait --timeout 30m
    rm "$OUT/notarize.zip"
    # The ticket goes inside the app, so it opens even with no internet.
    xcrun stapler staple "$APP"
    spctl --assess --type execute --verbose=2 "$APP"
  fi
else
  codesign --force --deep -s - "$APP"
fi
ditto -c -k --keepParent "$APP" "$OUT/Music Coach.zip"
cp "$OUT/Music Coach.zip" "$OUT/Music-Coach-$VERSION.zip"
echo "Built $OUT/Music Coach.zip and $OUT/Music-Coach-$VERSION.zip ($(du -h "$OUT/Music Coach.zip" | cut -f1)), version $VERSION"
