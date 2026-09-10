#!/usr/bin/env bash
# Build the FIELD APK: package com.coughcare.app, app name "Cough Against TB",
# OTA channel production. Uses the local android/ prebuild untouched and the
# real release keystore (see android/app/build.gradle signingConfigs.release).
#
# Usage: scripts/build-field-apk.sh
# Output: ~/Desktop/CoughCare-FIELD-<date>.apk
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/Library/Java/JavaVirtualMachines/jdk-17.0.20+8/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$HOME/.local/node/bin:$JAVA_HOME/bin:$PATH"

GRADLE="$ROOT/android/app/build.gradle"
grep -q "applicationId 'com.coughcare.app'" "$GRADLE" || { echo "android/ is not in field state (applicationId)"; exit 1; }
grep -q 'expo-channel-name&quot;:&quot;production' "$ROOT/android/app/src/main/AndroidManifest.xml" || { echo "android/ is not in field state (channel)"; exit 1; }

export EXPO_PUBLIC_BUNDLE_SEQ="$(git -C "$ROOT" rev-list --count HEAD)"
# Force a fresh JS bundle: gradle ignores the env var above when deciding
# whether the bundling task is up to date.
rm -rf "$ROOT/android/app/build/generated/assets/createBundleReleaseJsAndAssets" \
       "$ROOT/android/app/build/generated/res/createBundleReleaseJsAndAssets"
echo "Building Cough Against TB (com.coughcare.app, channel: production, seq #$EXPO_PUBLIC_BUNDLE_SEQ)..."
"$ROOT/android/gradlew" -p "$ROOT/android" :app:assembleRelease --console=plain

OUT="$HOME/Desktop/CoughCare-FIELD-$(date +%Y-%m-%d).apk"
cp "$ROOT/android/app/build/outputs/apk/release/app-release.apk" "$OUT"
echo "Done: $OUT"
