# APK Build Optimization Guide

## Asset Optimization

### Sample Audio Files (Optional Removal)

Sample audio files are included for testing purposes but can be excluded from production builds to reduce APK size:

- `assets/audio/20251104_150725_454926_cough.wav` (~500KB-1MB)
- `public/samples/20251104_150725_454926_cough.wav` (~500KB-1MB)
- `public/samples/sample-cough.webm` (~200-500KB)

**To exclude sample audio from production builds:**

1. Edit `app.config.js` and modify `assetBundlePatterns`:
```js
assetBundlePatterns: [
  "**/*",
  "!**/samples/**",
  "!**/assets/audio/**"
],
```

2. Note: This will disable the "Load Sample Audio" feature in production builds.

### Image Assets

Current image assets:
- `public/logo.png` - Required (used in app icon, splash, header)
- `public/lungs.png` - Used in HomeScreen
- `public/lungs.jpg` - Check if this is used (may be duplicate)

**Optimization tips:**
- Convert PNG to WebP format (smaller file size)
- Use appropriate image sizes (don't include high-res versions if not needed)
- Remove duplicate images (e.g., if both lungs.jpg and lungs.png exist, keep only one)

## Build Configuration

### ProGuard/R8
- Enabled in `android/app/build.gradle` (release build)
- Rules in `android/app/proguard-rules.pro`
- Reduces code size by ~30-50%

### ABI Splits
- Configured in `android/app/build.gradle`
- Creates separate APKs for each architecture
- Reduces individual APK size by ~60-70%

### Resource Shrinking
- Enabled in release builds
- Removes unused resources automatically

## Expected APK Sizes

### Before Optimization
- Universal APK: ~50-70MB

### After Optimization
- Universal APK: ~40-60MB
- Split APK (arm64-v8a): ~15-25MB (most common)
- Split APK (armeabi-v7a): ~15-25MB
- Split APK (x86_64): ~15-25MB (emulator)

## Building Optimized APK

### Using EAS Build (Recommended)
```bash
eas build -p android --profile preview
```

### Local Build
```bash
cd android
./gradlew assembleRelease
```

APK location: `android/app/build/outputs/apk/release/`

## Further Optimization (Advanced)

1. **Remove Hermes debug symbols** - Already configured in `build.gradle`
2. **Use App Bundle (AAB)** - Smaller than APK, requires Play Store:
   ```bash
   eas build -p android --profile production
   ```
3. **Further ONNX model optimization** - Models are already quantized (int8)
4. **Remove unused dependencies** - Review `package.json` for unused packages

