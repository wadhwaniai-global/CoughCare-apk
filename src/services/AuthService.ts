/**
 * Authentication Service
 * Handles login, logout, and token management using secure storage
 */

import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import { getApiBaseUrl } from '../utils/apiConfig';

// Dynamically import SecureStore to handle cases where native module isn't available
let SecureStore: any = null;
try {
  SecureStore = require('expo-secure-store');
} catch (error) {
  console.warn('[AuthService] expo-secure-store not available, using fallback');
}

// Fallback to AsyncStorage if SecureStore is not available
import AsyncStorage from '@react-native-async-storage/async-storage';
const ACCESS_TOKEN_KEY = 'access_token';
const USERNAME_KEY = 'username';
const PROFILE_KEY = 'user_profile';
// Who was logged in when the server ended the session: pre-fills the Login
// screen so the collector logs back in to the account that owns the pending
// records (records are scoped by created_by = username). Cleared by Logout.
const LAST_USERNAME_KEY = 'last_username';
// When this login expires, in milliseconds on THIS PHONE's clock (see login).
// Only for the Dashboard notice: the server stays the judge of a session.
const SESSION_EXPIRES_KEY = 'session_expires_at';
// A login that gets no answer must not spin forever (RN fetch has no timeout).
const LOGIN_TIMEOUT_MS = 30000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An HTTP Date header ("Wed, 01 Oct 2026 05:16:00 GMT") in ms, else NaN.
 *  Parsed by hand rather than trusting each JS engine's Date.parse. */
const httpDateMs = (value: string | null | undefined): number => {
  const m = /^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec((value || '').trim());
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  if (!m || month < 0) return Date.parse(value || '');
  return Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
};

/** The token's own expiry (`exp`, server clock) in ms, or null if unreadable. */
const tokenExpiryMs = (token: string): number | null => {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const exp = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

export interface UserProfile {
  first_name: string;
  last_name: string;
  facility: string;
  region: string;
  district: string;
  country: string;
  user_type: string;
  /** 4-digit collector code assigned by the backend (admin), unique per
   *  account: data collectors 0001 upward, internal accounts 9999 downward.
   *  Part of every participant ID this user mints. Optional until all
   *  accounts carry one (Stage 1 rollout). */
  collector_code?: string;
}

// Token storage: hardware-backed SecureStore on native, AsyncStorage on web
// (web has no SecureStore). On native this FAILS CLOSED: if SecureStore is
// unavailable we refuse to fall back to plaintext AsyncStorage — a failed
// login is recoverable, tokens on disk in plaintext are not.
const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return await AsyncStorage.getItem(key);
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.warn('[AuthService] SecureStore getItem failed; treating as absent:', error);
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }
    // No plaintext fallback — let the caller surface the failure.
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.warn('[AuthService] SecureStore deleteItem failed:', error);
    }
    // Also clear any plaintext copy left behind by older builds that fell
    // back to AsyncStorage.
    await AsyncStorage.removeItem(key);
  },
};

export interface LoginResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  profile?: UserProfile;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

class AuthService {
  /**
   * Login with username and password
   * Returns access token and stores it securely
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    try {
      const url = `${getApiBaseUrl()}/auth/login`;
      console.log('[AuthService] Attempting login to:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
        signal: controller.signal,
      });
      // The server's clock as of this answer, against the phone's: the gap
      // turns the token's expiry into a moment on the phone's own clock
      const answeredAt = Date.now();
      const serverNow = httpDateMs(response.headers?.get?.('date'));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData?.detail;
        const loginError: any = new Error(typeof detail === 'string' ? detail : `Login failed (${response.status}). Try again.`);
        loginError.status = response.status; // 401: wrong credentials (LoginScreen clears the password)
        throw loginError;
      }

      const data: LoginResponse = await response.json();
      if (!data.access_token) {
        throw new Error('No access token received from server');
      }

      // When the login expires by the phone's clock, so the Dashboard can say
      // so offline. Corrected by the server-phone clock gap measured above: a
      // phone whose clock is hours off still shows the notice when the token
      // actually runs out, as long as its clock is not changed meanwhile.
      const exp = tokenExpiryMs(data.access_token);
      const skew = Number.isFinite(serverNow) ? serverNow - answeredAt : 0;

      // Token LAST: a stored token always comes with its username and
      // profile, so a half-finished write never looks like a session.
      try {
        await secureStorage.setItem(USERNAME_KEY, credentials.username);
        if (data.profile) {
          await secureStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
        } else {
          await secureStorage.deleteItem(PROFILE_KEY);
        }
        if (exp !== null) {
          await secureStorage.setItem(SESSION_EXPIRES_KEY, String(exp - skew));
        } else {
          await secureStorage.deleteItem(SESSION_EXPIRES_KEY);
        }
        await secureStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        await secureStorage.deleteItem(LAST_USERNAME_KEY);
      } catch (storeError) {
        await this.logout();
        throw storeError;
      }
      console.log('[AuthService] Login successful, token stored');

      return data;
    } catch (error: any) {
      console.error('[AuthService] Login error:', error);

      if (error?.name === 'AbortError') {
        throw new Error('The server did not answer. Check the internet connection and try again.');
      }
      if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
        throw new Error('Cannot reach the server. Check the internet connection and try again.');
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Logout - clear stored tokens (the collector chose to log out)
   */
  async logout(): Promise<void> {
    try {
      await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
      await secureStorage.deleteItem(USERNAME_KEY);
      await secureStorage.deleteItem(PROFILE_KEY);
      await secureStorage.deleteItem(SESSION_EXPIRES_KEY);
      await secureStorage.deleteItem(LAST_USERNAME_KEY);
    } catch (error) {
      console.error('[AuthService] Logout error:', error);
      // Continue even if deletion fails
    }
  }

  /**
   * The server ended the session (401). Clear the session but remember who
   * was logged in, so the Login screen can pre-fill the username. Local
   * records are never touched here.
   */
  async endSession(): Promise<void> {
    try {
      const username = await secureStorage.getItem(USERNAME_KEY);
      if (username) {
        await secureStorage.setItem(LAST_USERNAME_KEY, username);
      }
    } catch (error) {
      console.warn('[AuthService] Could not remember the last username:', error);
    }
    await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
    await secureStorage.deleteItem(USERNAME_KEY);
    await secureStorage.deleteItem(PROFILE_KEY);
    await secureStorage.deleteItem(SESSION_EXPIRES_KEY);
  }

  /** Username to pre-fill after the server ended a session (null after Logout). */
  async getLastUsername(): Promise<string | null> {
    return secureStorage.getItem(LAST_USERNAME_KEY);
  }

  /**
   * When the current login expires, in ms on this phone's clock, or null when
   * nobody is logged in or it cannot be told. Works offline. A login made
   * before this was stored falls back to the token's own expiry, uncorrected.
   */
  async getSessionExpiresAt(): Promise<number | null> {
    const stored = Number(await secureStorage.getItem(SESSION_EXPIRES_KEY));
    if (stored > 0 && Number.isFinite(stored)) return stored;
    const token = await this.getAccessToken();
    return token ? tokenExpiryMs(token) : null;
  }

  /**
   * Get stored user profile
   */
  async getProfile(): Promise<UserProfile | null> {
    try {
      const raw = await secureStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as UserProfile;
    } catch (error) {
      console.error('[AuthService] Error getting profile:', error);
      return null;
    }
  }

  /**
   * Store user profile
   */
  async setProfile(profile: UserProfile): Promise<void> {
    await secureStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  /**
   * Get stored access token
   */
  async getAccessToken(): Promise<string | null> {
    try {
      return await secureStorage.getItem(ACCESS_TOKEN_KEY);
    } catch (error) {
      console.error('[AuthService] Error getting access token:', error);
      return null;
    }
  }

  /**
   * Get stored username
   */
  async getUsername(): Promise<string | null> {
    try {
      return await secureStorage.getItem(USERNAME_KEY);
    } catch (error) {
      console.error('[AuthService] Error getting username:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token !== null && token.length > 0;
  }

  /**
   * Refresh access token (if refresh tokens are implemented)
   * This is a placeholder for future implementation
   */
  async refreshToken(): Promise<string | null> {
    // TODO: Implement refresh token logic if backend supports it
    console.warn('[AuthService] Refresh token not implemented');
    return null;
  }
}

export const authService = new AuthService();

