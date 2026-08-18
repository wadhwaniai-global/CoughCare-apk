#!/usr/bin/env bash
# Build the "CoughCare Test" APK — the tester's sandbox app.
#
#   package     com.coughcare.test      (installs alongside the field app)
#   app name    CoughCare Test
#   OTA channel test                    (npm run ota:test reaches only this app)
#
# The android/ folder is a gitignored local prebuild, so this script edits the
# three identifiers in place, builds, and restores the originals afterwards
# (also on failure). The field APK build (./gradlew :app:assembleRelease with
# an untouched android/) is unaffected.
#
# Usage: scripts/build-test-apk.sh
# Output: ~/Desktop/CoughCare-TEST-<date>.apk

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRADLE="$ROOT/android/app/build.gradle"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
STRINGS="$ROOT/android/app/src/main/res/values/strings.xml"

# Toolchain (user-local install, mirrors ~/.zshrc)
export JAVA_HOME="${JAVA_HOME:-$HOME/Library/Java/JavaVirtualMachines/jdk-17.0.20+8/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$HOME/.local/node/bin:$JAVA_HOME/bin:$PATH"

# Backups live OUTSIDE android/ — a stray backup inside res/ breaks the
# resource-packaging step, which requires every file there to be .xml.
BAK="$(mktemp -d)"
for f in "$GRADLE" "$MANIFEST" "$STRINGS"; do
  [ -f "$f" ] || { echo "Missing $f — run a prebuild first"; exit 1; }
  cp "$f" "$BAK/$(basename "$f")"
done

restore() {
  cp "$BAK/build.gradle" "$GRADLE"
  cp "$BAK/AndroidManifest.xml" "$MANIFEST"
  cp "$BAK/strings.xml" "$STRINGS"
  rm -rf "$BAK"
}
trap restore EXIT

# Sanity: refuse to run if the files don't contain the expected field values,
# so we never build a half-converted APK.
grep -q "applicationId 'com.coughcare.app'" "$GRADLE" || { echo "Unexpected applicationId in build.gradle"; exit 1; }
grep -q 'expo-channel-name&quot;:&quot;preview' "$MANIFEST" || { echo "Unexpected channel in AndroidManifest.xml"; exit 1; }
grep -q '<string name="app_name">Cough Against TB</string>' "$STRINGS" || { echo "Unexpected app_name in strings.xml"; exit 1; }

sed -i '' "s/applicationId 'com.coughcare.app'/applicationId 'com.coughcare.test'/" "$GRADLE"
sed -i '' 's/expo-channel-name\&quot;:\&quot;preview/expo-channel-name\&quot;:\&quot;test/' "$MANIFEST"
sed -i '' 's|<string name="app_name">Cough Against TB</string>|<string name="app_name">CoughCare Test</string>|' "$STRINGS"

echo "Building CoughCare Test (com.coughcare.test, channel: test)..."
# Bundle sequence shown as "#<n>" in the app; Metro inlines it during the
# gradle bundling step (see src/utils/buildInfo.ts).
export EXPO_PUBLIC_BUNDLE_SEQ="$(git -C "$ROOT" rev-list --count HEAD)"
"$ROOT/android/gradlew" -p "$ROOT/android" :app:assembleRelease --console=plain

OUT="$HOME/Desktop/CoughCare-TEST-$(date +%Y-%m-%d).apk"
cp "$ROOT/android/app/build/outputs/apk/release/app-release.apk" "$OUT"
echo "Done: $OUT"
echo "NOTE: android/ has been restored to field values. Rebuild before"
echo "distributing a FIELD apk if you use the build outputs directory directly —"
echo "android/app/build/outputs currently contains the TEST apk."
