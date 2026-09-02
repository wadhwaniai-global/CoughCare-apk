/**
 * API base URL resolution, shared by ApiService and AuthService.
 *
 * The backend environment is derived from the OTA channel at runtime, so the
 * SAME bundle is correct on every channel by construction — there is no
 * per-publish environment variable to forget:
 *
 *   channel "production"  → the live field backend
 *   channel "test" / dev  → the isolated test backend (dev defaults here so
 *                           emulator/Metro work can never touch field data)
 *
 * EXPO_PUBLIC_API_BASE_URL (via expo.extra.apiBaseUrl) remains an explicit
 * override for local development against a machine-local server.
 *
 * HARD-WON CONSTRAINTS (#72/#73 debugging):
 * - No module-scope work. Resolution is lazy (first call) and cached.
 * - Self-contained: reads Updates.channel directly instead of calling
 *   buildInfo — a cross-module call from here died with "undefined is not a
 *   function" under Hermes on device (module-init ordering) while the same
 *   call worked from screens.
 * - The entire resolution is fault-tolerant: any throw logs the real stack
 *   and falls back to the TEST backend (never silently to production).
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

const PROD_API_BASE_URL = 'https://api-ghana-cough-prod.waig-tech.dev';
const TEST_API_BASE_URL = 'https://api-ghana-cough-test.waig-tech.dev';

let cachedBaseUrl: string | null = null;

/**
 * Get API base URL with Android emulator support
 * Android emulator uses 10.0.2.2 to access host machine's localhost
 */
export const getApiBaseUrl = (): string => {
  if (cachedBaseUrl) return cachedBaseUrl;

  let baseUrl = TEST_API_BASE_URL;
  try {
    let channel = 'development';
    try {
      channel = Updates.channel || 'development';
    } catch {
      // dev client / Expo Go: updates module not configured
    }

    // Accept the override ONLY as a non-empty string. The manifest/Constants
    // layer round-trips a null extra.apiBaseUrl as {} (root cause of the
    // #72–#74 "undefined is not a function" login crashes: {} is truthy and
    // {}.includes doesn't exist).
    const override = Constants.expoConfig?.extra?.apiBaseUrl;
    const overrideUrl = typeof override === 'string' && override.trim() !== '' ? override : null;
    baseUrl = overrideUrl || (channel === 'production' ? PROD_API_BASE_URL : TEST_API_BASE_URL);

    // On Android, replace 127.0.0.1 or localhost with 10.0.2.2 (emulator host alias)
    // This only applies to localhost URLs, not production HTTPS URLs
    if (Platform.OS === 'android' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'))) {
      baseUrl = baseUrl.replace(/127\.0\.0\.1|localhost/, '10.0.2.2');
    }
  } catch (error: any) {
    console.error('[apiConfig] URL resolution failed, using TEST backend:', error, error?.stack);
    baseUrl = TEST_API_BASE_URL; // never cache a half-computed value
  }

  cachedBaseUrl = baseUrl;
  console.log('[apiConfig] Resolved API base URL:', baseUrl);
  return baseUrl;
};
