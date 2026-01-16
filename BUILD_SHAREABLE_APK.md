# Building Shareable Minimum-Size APK

## ✅ Optimizations Enabled

The following optimizations are now configured for minimum APK size:

1. **Code Minification (R8/ProGuard)**: Enabled
2. **Resource Shrinking**: Enabled  
3. **ABI Splits**: Enabled (separate APKs per architecture)
4. **PNG Crunching**: Enabled
5. **ProGuard Rules**: Configured for ONNX Runtime, React Native, and Expo

## 📋 Step-by-Step Instructions

### Step 1: Ensure Prebuild is Complete

```bash
# Navigate to project root
cd /Users/aakashpant-waig/CoughCare-apk

# Run prebuild to ensure native code is up to date
npx expo prebuild --clean -p android
```

### Step 2: Build Release APK

```bash
# Navigate to android directory
cd android

# Build release APK with all optimizations
./gradlew assembleRelease
```

**Note**: The build will take 5-10 minutes depending on your machine.

### Step 3: Find Your APKs

After the build completes, you'll find APKs in:

```
android/app/build/outputs/apk/release/
```

You'll see **4 separate APKs** (one per architecture):
- `app-armeabi-v7a-release.apk` (~15-20 MB) - For older 32-bit ARM devices
- `app-arm64-v8a-release.apk` (~15-20 MB) - For modern 64-bit ARM devices (most common)
- `app-x86-release.apk` (~15-20 MB) - For x86 emulators/devices
- `app-x86_64-release.apk` (~15-20 MB) - For x86_64 emulators/devices

### Step 4: Choose the Right APK

**For sharing/testing:**
- **Most devices**: Use `app-arm64-v8a-release.apk` (covers 95% of modern Android devices)
- **Older devices**: Use `app-armeabi-v7a-release.apk`
- **Emulator testing**: Use `app-x86_64-release.apk` or `app-x86-release.apk`

### Step 5: Install on Device/Emulator

```bash
# Install on connected device/emulator
adb install android/app/build/outputs/apk/release/app-arm64-v8a-release.apk

# Or drag and drop the APK file to your device/emulator
```

## 📊 Expected APK Sizes

With all optimizations enabled:
- **Per-architecture APK**: ~15-25 MB each
- **Universal APK** (if created): ~60-80 MB (not recommended, use split APKs)

## 🔍 Verify the Build

1. **Check APK size**: Should be ~15-25 MB per architecture
2. **Install and test**:
   - ✅ App launches correctly
   - ✅ Login works (connects to https://cough-pilot.wadhwaniaiglobal.com)
   - ✅ Audio recording works
   - ✅ ONNX inference works
   - ✅ Database operations work
   - ✅ Sync functionality works

## 🚀 Quick Build Command (All-in-One)

```bash
# From project root - one command to build everything
cd /Users/aakashpant-waig/CoughCare-apk && \
npx expo prebuild --clean -p android && \
cd android && \
./gradlew assembleRelease && \
echo "✅ APKs built successfully! Find them in: android/app/build/outputs/apk/release/"
```

## 📤 Sharing the APK

1. **For testing**: Share `app-arm64-v8a-release.apk` (works on most devices)
2. **For distribution**: You can share all 4 APKs and let users choose, or use a service that auto-detects architecture
3. **File size**: Each APK is ~15-25 MB, easy to share via:
   - Email
   - Google Drive
   - Dropbox
   - Direct download link
   - File sharing services

## ⚠️ Important Notes

1. **Signing**: Currently using debug keystore. For production, generate a release keystore:
   ```bash
   cd android/app
   keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore \
     -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Architecture Detection**: Users need to install the APK matching their device architecture. Most modern devices are `arm64-v8a`.

3. **Testing**: Always test the APK on a real device before sharing, as some features (like audio recording) may behave differently than in the emulator.

## 🐛 Troubleshooting

### Build Fails with ProGuard Errors
- Check `android/app/proguard-rules.pro` for missing keep rules
- The file now includes rules for ONNX Runtime, React Native, and Expo

### APK Too Large
- Verify ABI splits are enabled (check `android/app/build.gradle`)
- Check that resource shrinking is enabled (check `android/gradle.properties`)
- Remove any sample audio files if included

### ONNX Models Not Loading
- Verify models are in `assets/models/` directory
- Check ProGuard rules keep ONNX classes (already configured)

### Build Takes Too Long
- First build takes longer (10-15 minutes)
- Subsequent builds are faster (5-10 minutes)
- Use `./gradlew assembleRelease --parallel` for faster builds

## ✅ Checklist Before Sharing

- [ ] APK size is reasonable (~15-25 MB)
- [ ] App installs successfully
- [ ] Login works with production backend
- [ ] Audio recording works
- [ ] ONNX inference works
- [ ] Database operations work
- [ ] Sync functionality works
- [ ] Tested on real device (not just emulator)

## 📝 Next Steps

After building and testing:
1. Test on multiple devices/emulators
2. Verify all features work correctly
3. Share the appropriate APK for your target devices
4. Consider setting up automated builds for future releases

