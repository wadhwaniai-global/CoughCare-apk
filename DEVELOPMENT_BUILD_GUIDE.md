# How to Use the Development Build

This guide explains how to install and use the development build (Custom Development Client) on your Android device.

## 1. Install the Development Build (APK)

Once the EAS Build completes, you will receive a link to download the APK.

1.  **Download**: Open the build link on your Android device and download the `.apk` file.
2.  **Install**: Tap the downloaded file to install it. You may need to allow installation from unknown sources.
    *   *Note: This app is a "Development Client". It looks like your app but has the ability to connect to your local development server.*

## 2. Start the Development Server

On your computer, start the Expo development server specifically for the dev client:

```bash
npm run start:dev-client
# OR
npx expo start --dev-client
```

This command starts the Metro bundler and generates a QR code.

## 3. Connect Your Device

1.  Ensure your Android device and computer are on the **same Wi-Fi network**.
2.  Open the **CoughCare** app you just installed on your phone.
3.  You should see a screen asking to connect to a development server.
4.  **Scan QR Code**: Use the app's built-in QR scanner (or your camera if supported) to scan the QR code displayed in your terminal.
    *   *Alternatively, if you are logged in to the same Expo account on both the CLI and the app, it might appear under "Recently in development".*

## Troubleshooting

*   **Connection Issues**: If the app cannot connect, ensure both devices are on the same network. You might need to disable your computer's firewall temporarily or check your network settings.
*   **"Plain text" environment variables**: If you see warnings about missing environment variables, ensure your `.env` files are correctly set up and loaded.
