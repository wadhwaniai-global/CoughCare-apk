export default {
  expo: {
    name: "Cough Against TB",
    owner: "aakashwaig",
    slug: "coughcare",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./public/logo.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./public/logo.png",
      resizeMode: "contain",
      backgroundColor: "#158B95"
    },
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
        "RECORD_AUDIO"
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
      "expo-dev-client",
      "expo-secure-store",
      // Plugin to automatically add OnnxruntimePackage to MainApplication.kt
      // This fixes the Expo 54 autolinking bug
      "./app.plugin.js",
      "expo-sqlite"
    ],
    extra: {
      eas: {
        projectId: "02293b0f-a184-4e1c-b4d2-9da490ba8abb"
      },
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "https://cough-pilot.wadhwaniaiglobal.com",
      logoVersion: process.env.EXPO_PUBLIC_LOGO_VERSION || "1",
      logoAlt: process.env.EXPO_PUBLIC_LOGO_ALT || "AI Cough Screening Assistant"
    }
  }
};

