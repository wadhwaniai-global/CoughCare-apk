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
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getBuildInfo } from './buildInfo';

const PROD_API_BASE_URL = 'https://api-ghana-cough-prod.waig-tech.dev';
const TEST_API_BASE_URL = 'https://api-ghana-cough-test.waig-tech.dev';

/**
 * Get API base URL with Android emulator support
 * Android emulator uses 10.0.2.2 to access host machine's localhost
 */
export const getApiBaseUrl = (): string => {
  const override = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined | null;
  const baseUrl =
    override || (getBuildInfo().channel === 'production' ? PROD_API_BASE_URL : TEST_API_BASE_URL);

  // On Android, replace 127.0.0.1 or localhost with 10.0.2.2 (emulator host alias)
  // This only applies to localhost URLs, not production HTTPS URLs
  if (Platform.OS === 'android' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'))) {
    return baseUrl.replace(/127\.0\.0\.1|localhost/, '10.0.2.2');
  }

  return baseUrl;
};

export const API_BASE_URL = getApiBaseUrl();
