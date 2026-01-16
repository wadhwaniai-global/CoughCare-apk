# Android Studio Setup Guide

## Prerequisites Installation

### 1. Install Android Studio
- Download from: https://developer.android.com/studio
- Install Android SDK (API 33+ recommended)
- Install Android SDK Build Tools
- Install Android SDK Platform Tools
- Install Android Emulator

### 2. Install Java Development Kit (JDK)
- Required: JDK 17 or 21
- Check installation: `java -version`
- If not installed, download from: https://adoptium.net/

### 3. Set Environment Variables (macOS/Linux)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
```

Then reload: `source ~/.zshrc` (or `source ~/.bashrc`)

### 4. Create Android Virtual Device (AVD)

1. Open Android Studio
2. Go to **Tools → Device Manager**
3. Click **Create Device**
4. Select device: **Pixel 6** (or similar modern device)
5. System Image: **API 33 (Android 13)** or **API 34 (Android 14)**
   - **Important**: Choose **x86_64** architecture (not ARM) for better performance on Mac
6. Click **Finish**
7. Start the emulator by clicking the play button

### 5. Enable Audio Input in Emulator

The emulator needs microphone access for audio recording:

1. In the running emulator, click the **three dots** (Extended Controls)
2. Go to **Settings → Microphone**
3. Select **"Virtual microphone uses host audio input"**
   - This uses your Mac's microphone
   - Or use **"Virtual microphone"** for testing without real mic

**Alternative**: Use ADB to forward host microphone:
```bash
adb forward tcp:8000 tcp:8000
```

### 6. Verify Setup

```bash
# Check ADB is available
adb version

# Check connected devices/emulators
adb devices

# Check Android SDK location
echo $ANDROID_HOME
```

## Next Steps

After completing this setup, proceed with:
1. Run `npx expo prebuild --clean -p android`
2. Build and test the app on the emulator

