# Audio Recording Troubleshooting Guide

## Common Issues

### Issue: Only 2-3 seconds of audio recorded, then silence

This is a **common Android emulator limitation**. Android emulators often have issues with audio recording.

## Solutions

### Solution 1: Use a Real Android Device (Recommended)

The most reliable solution is to test on a real Android device:
1. Connect your Android device via USB
2. Enable USB debugging
3. Run: `npx expo run:android`
4. The app will install on your device

### Solution 2: Configure Emulator Microphone

If you must use an emulator:

1. **Open Android Studio Emulator**
2. Click the **three dots** (Extended Controls)
3. Go to **Settings → Microphone**
4. Select **"Virtual microphone uses host audio input"**
5. Make sure your Mac's microphone is working
6. Restart the emulator

### Solution 3: Change Audio Source

The code now uses `audioSource: 1` (MIC) instead of `6` (VOICE_RECOGNITION) for better emulator compatibility.

If you're on a real device and want better quality, you can change it back to `6` in `src/utils/audioRecorder.ts`:

```typescript
audioSource: Platform.OS === 'android' ? 6 : undefined, // VOICE_RECOGNITION for real devices
```

### Solution 4: Check Permissions

Ensure microphone permissions are granted:
1. Go to Android Settings → Apps → CoughCare
2. Permissions → Microphone → Allow
3. Restart the app

### Solution 5: Verify Audio File

After recording, check the console logs:
- Look for: `[AudioRecorder] File verified, size: X bytes`
- If size is very small (< 100KB for 5+ seconds), the recording is likely incomplete

## Testing Audio Recording

### Test on Real Device

1. Build and install on device:
   ```bash
   npx expo run:android
   ```

2. Test recording:
   - Record for 10+ seconds
   - Play back the recording
   - Check file size (should be ~160KB per second at 16kHz)

### Check Logs

Look for these log messages:
```
[AudioRecorder] Initializing with options: {...}
[AudioRecorder] Starting recording...
[AudioRecorder] Recording started successfully
[AudioRecorder] Stopping recording...
[AudioRecorder] Recording stopped, saved to: file://...
[AudioRecorder] File verified, size: X bytes
```

If you see errors, check:
- Permission errors → Grant microphone permission
- File not found → Check file path
- Small file size → Emulator issue (use real device)

## Known Emulator Limitations

- **Audio recording is unreliable** on Android emulators
- **Microphone input may be delayed or cut off**
- **File sizes may be incorrect**
- **Audio quality is poor**

**Recommendation**: Always test audio recording on a real Android device for accurate results.

## Alternative: Use Sample Audio for Testing

While testing sync functionality, you can use the "Load Sample Audio" button instead of recording:
1. This loads a pre-recorded sample
2. Allows you to test sync without recording
3. Works reliably on emulator

