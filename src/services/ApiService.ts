/**
 * API Service
 * Centralized API client with authentication and error handling
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { authService } from './AuthService';

/**
 * Get API base URL with Android emulator support
 * Android emulator uses 10.0.2.2 to access host machine's localhost
 */
const getApiBaseUrl = (): string => {
  const baseUrl = Constants.expoConfig?.extra?.apiBaseUrl || 'https://cough-pilot.wadhwaniaiglobal.com';
  
  // On Android, replace 127.0.0.1 or localhost with 10.0.2.2 (emulator host alias)
  // This only applies to localhost URLs, not production HTTPS URLs
  if (Platform.OS === 'android' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'))) {
    return baseUrl.replace(/127\.0\.0\.1|localhost/, '10.0.2.2');
  }
  
  return baseUrl;
};

const API_BASE_URL = getApiBaseUrl();

// Log the API base URL on module load for debugging
console.log('[ApiService] Initialized with API_BASE_URL:', API_BASE_URL);

export interface ApiError {
  message: string;
  status?: number;
  data?: any;
}

class ApiService {
  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return API_BASE_URL;
  }

  /**
   * Get authorization header with access token
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await authService.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Handle API errors
   */
  private async handleError(response: Response): Promise<never> {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { detail: `HTTP ${response.status}: ${response.statusText}` };
    }

    const error: ApiError = {
      message: errorData.detail || errorData.message || 'An error occurred',
      status: response.status,
      data: errorData,
    };

    // If unauthorized, logout user
    if (response.status === 401) {
      await authService.logout();
      // Navigation will be handled by AppNavigator detecting auth state change
    }

    throw error;
  }

  /**
   * Make authenticated API request
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = await this.getAuthHeaders();

    // Merge headers
    const requestHeaders = {
      ...headers,
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers: requestHeaders,
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    return (await response.text()) as T;
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }

  /**
   * Upload file with FormData
   * Returns: { file_id, checksum, file_path }
   */
  async uploadFile(fileUri: string, fileName?: string): Promise<{ file_id: string; checksum: string; file_path: string }> {
    const token = await authService.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    // Create FormData
    const formData = new FormData();
    
    // Determine file name
    const name = fileName || fileUri.split('/').pop() || 'file.wav';
    
    // Add file to FormData
    // @ts-ignore - FormData typing issue with React Native
    formData.append('file', {
      uri: fileUri,
      name: name,
      type: 'audio/wav', // Default to WAV, adjust if needed
    } as any);

    const url = `${API_BASE_URL}/files/upload`;
    console.log('[ApiService] Uploading file to:', url);
    console.log('[ApiService] File URI:', fileUri);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          // Don't set Content-Type, let fetch set it with boundary for FormData
        },
        body: formData,
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const result = await response.json();
      console.log('[ApiService] File upload successful:', {
        file_id: result.file_id,
        checksum: result.checksum,
        file_path: result.file_path
      });
      return result;
    } catch (error: any) {
      console.error('[ApiService] File upload error:', error);
      
      // Provide more helpful error messages
      if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
        throw new Error(
          `Cannot connect to server at ${API_BASE_URL}.\n\n` +
          `Please ensure:\n` +
          `1. Backend server is running\n` +
          `2. If using Android emulator, the URL should use 10.0.2.2\n` +
          `3. Check your network connection`
        );
      }
      
      throw error;
    }
  }

  /**
   * Submit form with file IDs
   * Expected body structure:
   * {
   *   form_data: { ... },
   *   file_ids: [{ file_id: "...", checksum: "..." }]
   * }
   */
  async submitForm(formData: any): Promise<{
    form_id: string;
    user_id: string;
    form_data: any;
    file_references: string[];
    created_at: string;
  }> {
    return this.post('/forms', formData);
  }
}

export const apiService = new ApiService();

