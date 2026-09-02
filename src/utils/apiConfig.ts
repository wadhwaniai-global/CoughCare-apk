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
 * Resolution is deliberately LAZY (first call, then cached) — nothing here
 * runs at module-initialization time. An earlier version computed the URL at
 * module scope and hit a Hermes module-init ordering failure ("undefined is
 * not a function" calling into buildInfo before it was evaluated), which
 * poisoned every importer. Do not reintroduce module-scope work here.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getBuildInfo } from './buildInfo';

const PROD_API_BASE_URL = 'https://api-ghana-cough-prod.waig-tech.dev';
const TEST_API_BASE_URL = 'https://api-ghana-cough-test.waig-tech.dev';

let cachedBaseUrl: string | null = null;

/**
 * Get API base URL with Android emulator support
 * Android emulator uses 10.0.2.2 to access host machine's localhost
 */
export const getApiBaseUrl = (): string => {
  if (cachedBaseUrl) return cachedBaseUrl;

  const override = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined | null;
  let baseUrl =
    override || (getBuildInfo().channel === 'production' ? PROD_API_BASE_URL : TEST_API_BASE_URL);

  // On Android, replace 127.0.0.1 or localhost with 10.0.2.2 (emulator host alias)
  // This only applies to localhost URLs, not production HTTPS URLs
  if (Platform.OS === 'android' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'))) {
    baseUrl = baseUrl.replace(/127\.0\.0\.1|localhost/, '10.0.2.2');
  }

  cachedBaseUrl = baseUrl;
  console.log('[apiConfig] Resolved API base URL:', baseUrl);
  return baseUrl;
};
