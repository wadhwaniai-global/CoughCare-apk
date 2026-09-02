/**
 * Authentication Service
 * Handles login, logout, and token management using secure storage
 */

import { Platform } from 'react-native';
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

export interface UserProfile {
  first_name: string;
  last_name: string;
  facility: string;
  region: string;
  district: string;
  country: string;
  user_type: string;
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
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Login failed' }));
        throw new Error(errorData.detail || errorData.message || `Login failed: ${response.status}`);
      }

      const data: LoginResponse = await response.json();
      
      // Store access token securely
      if (data.access_token) {
        await secureStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        await secureStorage.setItem(USERNAME_KEY, credentials.username);
        if (data.profile) {
          await secureStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
        }
        console.log('[AuthService] Login successful, token stored');
      } else {
        throw new Error('No access token received from server');
      }

      return data;
    } catch (error: any) {
      console.error('[AuthService] Login error:', error);
      
      // Provide more helpful error messages
      if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
        throw new Error(
          `Cannot connect to server at ${getApiBaseUrl()}.\n\n` +
          `Please ensure:\n` +
          `1. Backend server is running\n` +
          `2. If using Android emulator with localhost, use 10.0.2.2 instead of 127.0.0.1\n` +
          `3. Check your network connection`
        );
      }
      
      throw error;
    }
  }

  /**
   * Logout - clear stored tokens
   */
  async logout(): Promise<void> {
    try {
      await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
      await secureStorage.deleteItem(USERNAME_KEY);
      await secureStorage.deleteItem(PROFILE_KEY);
    } catch (error) {
      console.error('[AuthService] Logout error:', error);
      // Continue even if deletion fails
    }
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

