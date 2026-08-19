export default {
  expo: {
    name: "Cough Against TB",
    owner: "rishi-waig13",
    slug: "cough-against-tb",
    // Keep in sync with versionName in android/app/build.gradle (gitignored)
    version: "1.0.2",
    orientation: "portrait",
    icon: "./public/logo.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./public/logo.png",
      resizeMode: "contain",
      backgroundColor: "#158B95"
    },
    updates: {
      url: "https://u.expo.dev/b4a88731-0c6b-4aec-a0f5-451585590fad",
      // Channel for locally built (gradle) APKs. EAS cloud builds override
      // this with the channel from their eas.json build profile.
      requestHeaders: {
        "expo-channel-name": "preview"
      }
    },
    runtimeVersion: "1.1.0",
    // Fix for Expo SDK 54 autolinking issues with native modules
    autolinking: {
      legacy_shallowReactNativeLinking: true,
      searchPaths: ["../../node_modules", "node_modules"]
    },
    assetBundlePatterns: [
      "**/*"
    ],
    // Exclude sample audio files from production builds to reduce APK size
    // Sample files are only needed for development/testing
    // Uncomment the following to exclude samples in production:
    // assetBundlePatterns: [
    //   "**/*",
    //   "!**/samples/**",
    //   "!**/assets/audio/**"
    // ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.coughcare.app"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./public/logo.png",
        backgroundColor: "#158B95"
      },
      package: "com.coughcare.app",
      permissions: [
        "RECORD_AUDIO",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION"
      ]
    },
    web: {
      favicon: "./public/logo.png"
    },
    plugins: [
      [
        "expo-av",
        {
          microphonePermission: "Allow CoughCare to access your microphone to record cough sounds."
        }
      ],
      [
        "expo-location",
        {
          locationWhenInUsePermission: "Allow CoughCare to record participant GPS location."
        }
      ],
      [
        "expo-build-properties",
        {
          android: {
            // Release hardening (2026-08-19): HTTPS only, and patient data
            // must not be extractable via device backup. Debug builds keep
            // cleartext via android/app/src/debug/AndroidManifest.xml so
            // Metro over HTTP still works.
            usesCleartextTraffic: false,
            allowBackup: false
          }
        }
      ],
      "expo-dev-client",
      "expo-secure-store",
      // Plugin to automatically add OnnxruntimePackage to MainApplication.kt
      // This fixes the Expo 54 autolinking bug
      "./app.plugin.js",
      "expo-sqlite"
    ],
    extra: {
      eas: {
        projectId: "b4a88731-0c6b-4aec-a0f5-451585590fad"
      },
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "https://cough-pilot.wadhwaniaiglobal.com",
      logoVersion: process.env.EXPO_PUBLIC_LOGO_VERSION || "1",
      logoAlt: process.env.EXPO_PUBLIC_LOGO_ALT || "AI Cough Screening Assistant"
    }
  }
};

