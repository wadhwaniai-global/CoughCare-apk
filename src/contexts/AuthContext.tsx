/**
 * Authentication Context
 * Provides global authentication state and methods
 */

import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { authService, LoginCredentials } from '../services/AuthService';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  /**
   * Check authentication status on mount
   */
  const checkAuth = async () => {
    try {
      const authenticated = await authService.isAuthenticated();
      const storedUsername = await authService.getUsername();
      
      setIsAuthenticated(authenticated);
      setUsername(storedUsername);
    } catch (error) {
      console.error('[AuthContext] Error checking auth:', error);
      setIsAuthenticated(false);
      setUsername(null);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Login with credentials
   */
  const login = async (credentials: LoginCredentials) => {
    try {
      setIsLoading(true);
      await authService.login(credentials);
      setIsAuthenticated(true);
      setUsername(credentials.username);
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      setIsAuthenticated(false);
      setUsername(null);
      throw error; // Re-throw to let UI handle error
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Logout and clear auth state
   */
  const logout = async () => {
    try {
      setIsLoading(true);
      await authService.logout();
      setIsAuthenticated(false);
      setUsername(null);
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
      // Still clear state even if logout fails
      setIsAuthenticated(false);
      setUsername(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    username,
    login,
    logout,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

