/**
 * API Service
 * Centralized API client with authentication and error handling
 */

import { authService } from './AuthService';
import { getApiBaseUrl } from '../utils/apiConfig';
import { emitSessionEnded, SessionEndedError, isSessionEnded } from './sessionEvents';

// Log the API base URL on module load for debugging
// NOTE: no module-scope URL resolution here — see utils/apiConfig.ts.

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
    return getApiBaseUrl();
  }

  /**
   * The stored token, or a SessionEndedError. No request ever leaves the
   * phone without an Authorization header: the server would answer 422 with
   * a list-shaped detail (shown to collectors as "[object Object]").
   */
  private async requireToken(): Promise<string> {
    const token = await authService.getAccessToken();
    if (!token) {
      emitSessionEnded('missing');
      throw new SessionEndedError('missing');
    }
    return token;
  }

  /**
   * Handle API errors. A 401 ends the session the request was sent with:
   * the token is cleared and AuthContext is told (it shows the Login screen).
   * A late 401 for an older token never ends a newer session.
   */
  private async handleError(response: Response, sentToken: string): Promise<never> {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = {};
    }

    if (response.status === 401) {
      const current = await authService.getAccessToken();
      // A newer token means the collector already logged in again and this
      // answer belongs to the old session: leave the new one alone.
      if (current === null || current === sentToken) {
        if (current === sentToken) await authService.endSession();
        emitSessionEnded('expired'); // AuthContext ignores repeats
        throw new SessionEndedError('expired');
      }
    }

    // FastAPI validation errors carry a list in `detail`; never show "[object Object]"
    const detail = errorData?.detail;
    const message =
      typeof detail === 'string' ? detail
        : Array.isArray(detail) ? (detail.map((d: any) => d?.msg).filter(Boolean).join('; ') || `Request failed (${response.status})`)
        : (typeof errorData?.message === 'string' ? errorData.message : `Request failed (${response.status})`);

    const error: ApiError = {
      message,
      status: response.status,
      data: errorData,
    };
    throw error;
  }

  /**
   * Make authenticated API request
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`;
    const token = await this.requireToken();

    // Merge headers
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers: requestHeaders,
    });

    if (!response.ok) {
      await this.handleError(response, token);
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
    const token = await this.requireToken();

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

    const url = `${getApiBaseUrl()}/files/upload`;
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
        await this.handleError(response, token);
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
      if (isSessionEnded(error)) throw error;

      // This text reaches the collector's Sync alert; the URL is in the log above
      if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
        throw new Error('Cannot reach the server. Check the internet connection and try again.');
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

