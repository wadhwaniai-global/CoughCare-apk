# Building Release APK

## Prerequisites

1. Complete Android Studio setup (see `ANDROID_SETUP.md`)
2. Run prebuild: `npx expo prebuild --clean -p android`
3. All optimizations configured (ProGuard, ABI splits, etc.)

## Method 1: Using EAS Build (Recommended for Production)

EAS Build provides cloud-based builds with proper signing and optimization.

### Setup EAS CLI
```bash
npm install -g eas-cli
eas login
```

### Build APK
```bash
# Preview APK (for testing)
eas build -p android --profile preview

# Production AAB (for Play Store)
eas build -p android --profile production
```

### Download APK
After build completes, download from:
- EAS dashboard: https://expo.dev/accounts/[your-account]/projects/coughcare/builds
- Or use: `eas build:list` to see build status

## Method 2: Local Build (For Testing)

Build APK locally using Gradle.

### Generate Signing Key (Required for Release)

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

### Configure Signing

Edit `android/app/build.gradle` and update `signingConfigs`:

```gradle
signingConfigs {
    release {
        if (project.hasProperty('MYAPP_RELEASE_STORE_FILE')) {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
    }
}
```

Create `android/gradle.properties` (add to existing file):

```properties
MYAPP_RELEASE_STORE_FILE=my-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=my-key-alias
MYAPP_RELEASE_STORE_PASSWORD=*****
MYAPP_RELEASE_KEY_PASSWORD=*****
```

### Build Release APK

```bash
cd android
./gradlew assembleRelease
```

### APK Location

After build completes, find APKs at:
- **Universal APK**: `android/app/build/outputs/apk/release/app-release.apk`
- **Split APKs**: `android/app/build/outputs/apk/release/app-<abi>-release.apk`
  - `app-armeabi-v7a-release.apk`
  - `app-arm64-v8a-release.apk`
  - `app-x86-release.apk`
  - `app-x86_64-release.apk`

## Install APK on Device/Emulator

```bash
# Install on connected device/emulator
adb install app-release.apk

# Or install specific architecture
adb install app-arm64-v8a-release.apk
```

## Verify APK

1. **Check APK size**: Should be ~15-25MB for split APKs
2. **Install and launch**: Verify app starts correctly
3. **Test ONNX models**: Verify models load and inference works
4. **Test audio recording**: Record and analyze audio
5. **Test database**: Create participant, save draft, verify data persists

## Troubleshooting

### Build Fails with ProGuard Errors
- Check `proguard-rules.pro` for missing keep rules
- Add `-dontwarn` for libraries that don't need warnings

### APK Too Large
- Verify ABI splits are enabled
- Check that resource shrinking is enabled
- Remove sample audio files if not needed (see `BUILD_OPTIMIZATION.md`)

### ONNX Models Not Loading
- Verify models are in `assets/models/` directory
- Check `MainApplication.kt` has `OnnxruntimePackage()`
- Ensure ProGuard rules keep ONNX classes

### Audio Recording Fails
- Check microphone permissions in AndroidManifest.xml
- Verify `react-native-audio-record` is properly linked
- Test on real device (emulator audio may have issues)

## Next Steps

After building and testing:
1. Test on multiple devices/emulators
2. Verify all features work correctly
3. Check APK size meets requirements
4. Prepare for distribution (Play Store, direct install, etc.)

