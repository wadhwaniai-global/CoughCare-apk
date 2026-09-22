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

# Refuse to build with a backend override active: the app must derive its
# backend from the OTA channel. An EXPO_PUBLIC_API_BASE_URL in .env or the
# environment would silently point this build (test app included) at one URL.
if [ -n "${EXPO_PUBLIC_API_BASE_URL:-}" ] || grep -qE '^[[:space:]]*EXPO_PUBLIC_API_BASE_URL=' "$ROOT/.env" 2>/dev/null; then
  echo "EXPO_PUBLIC_API_BASE_URL override is set (env or .env); unset it before building." >&2
  exit 1
fi

GRADLE="$ROOT/android/app/build.gradle"
grep -q "applicationId 'com.coughcare.app'" "$GRADLE" || { echo "android/ is not in field state (applicationId)"; exit 1; }
grep -q 'expo-channel-name&quot;:&quot;production' "$ROOT/android/app/src/main/AndroidManifest.xml" || { echo "android/ is not in field state (channel)"; exit 1; }

export EXPO_PUBLIC_BUNDLE_SEQ="$(git -C "$ROOT" rev-list --count HEAD)"
# Force a fresh JS bundle: gradle ignores the env var above when deciding
# whether the bundling task is up to date.
rm -rf "$ROOT/android/app/build/generated/assets/createBundleReleaseJsAndAssets" \
       "$ROOT/android/app/build/generated/res/createBundleReleaseJsAndAssets"
# Same problem, worse consequence: the expo-updates task that writes the EMBEDDED
# asset manifest (assets/app.manifest) also reused a stale output (dated Aug 15)
# in every build until 2026-09-17, so the APK listed the retired models and not
# the CED graph, and cough analysis failed on any install running the embedded
# bundle. Always regenerate it.
rm -rf "$ROOT/android/app/build/generated/assets/createReleaseUpdatesResources"
echo "Building Cough Against TB (com.coughcare.app, channel: production, seq #$EXPO_PUBLIC_BUNDLE_SEQ)..."
"$ROOT/android/gradlew" -p "$ROOT/android" :app:assembleRelease --console=plain

OUT="$HOME/Desktop/CoughCare-FIELD-$(date +%Y-%m-%d).apk"
MANIFEST="$ROOT/android/app/build/generated/assets/createReleaseUpdatesResources/app.manifest"
grep -q '"CED_int8.app"' "$MANIFEST" || { echo "Embedded manifest does not list the CED model; refusing to ship this APK"; exit 1; }
cp "$ROOT/android/app/build/outputs/apk/release/app-release.apk" "$OUT"
echo "Done: $OUT"
