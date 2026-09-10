#!/usr/bin/env bash
# Launch the CoughCare Android emulator with host microphone passthrough.
#
# Mic passthrough matters for this app: the cough recording flow needs real
# audio input. Without -allow-host-audio the guest gets a silent virtual mic,
# so recordings come back empty and inference has nothing to score.
#
# Usage: ./scripts/run-emulator.sh [avd-name]
set -euo pipefail

AVD="${1:-CoughCare_API36}"
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
EMULATOR="$ANDROID_HOME/emulator/emulator"

if [ ! -x "$EMULATOR" ]; then
  echo "error: emulator not found at $EMULATOR" >&2
  echo "hint: is ANDROID_HOME set correctly? (currently: $ANDROID_HOME)" >&2
  exit 1
fi

if ! "$EMULATOR" -list-avds | grep -qx "$AVD"; then
  echo "error: AVD '$AVD' not found. Available:" >&2
  "$EMULATOR" -list-avds >&2
  exit 1
fi

echo "Starting $AVD with host microphone passthrough..."
exec "$EMULATOR" -avd "$AVD" \
  -gpu host \
  -no-boot-anim \
  -no-snapshot-save \
  -allow-host-audio
