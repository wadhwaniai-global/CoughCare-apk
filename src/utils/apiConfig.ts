/**
 * API base URL resolution, shared by ApiService and AuthService.
 * Reads expo.extra.apiBaseUrl (set from EXPO_PUBLIC_API_BASE_URL in app.config.js).
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Get API base URL with Android emulator support
 * Android emulator uses 10.0.2.2 to access host machine's localhost
 */
export const getApiBaseUrl = (): string => {
  const baseUrl =
    Constants.expoConfig?.extra?.apiBaseUrl || 'https://api-ghana-cough-prod.waig-tech.dev';

  // On Android, replace 127.0.0.1 or localhost with 10.0.2.2 (emulator host alias)
  // This only applies to localhost URLs, not production HTTPS URLs
  if (Platform.OS === 'android' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'))) {
    return baseUrl.replace(/127\.0\.0\.1|localhost/, '10.0.2.2');
  }

  return baseUrl;
};

export const API_BASE_URL = getApiBaseUrl();
