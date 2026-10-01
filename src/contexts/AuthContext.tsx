/**
 * Authentication Context
 * Provides global authentication state and methods
 *
 * Session policy (docs/SECURITY-BACKLOG.md): 24 h tokens, no refresh. Only the
 * server ends a session: a 401 on any call (the startup check, sync, re-issue)
 * takes the collector to the Login screen with a notice and the username
 * pre-filled. Nothing is decided offline, so collection without signal is
 * never interrupted, and local records are never touched.
 */

import React, { createContext, useState, useEffect, useContext, useCallback, useRef, ReactNode } from 'react';
import { authService, LoginCredentials, UserProfile } from '../services/AuthService';
import { syncService } from '../services/SyncService';
import { onSessionEnded, SessionEndReason } from '../services/sessionEvents';

const SESSION_NOTICE: Record<SessionEndReason, string> = {
  expired: 'Your login has expired. Log in again to continue. Records that are not synced yet are safe on this phone.',
  missing: 'Log in again to continue. Records that are not synced yet are safe on this phone.',
};

interface AuthContextType {
  isAuthenticated: boolean;
  /** True only while the stored session is read at app start. */
  isBooting: boolean;
  username: string | null;
  profile: UserProfile | null;
  /** Why the Login screen is showing; null after a normal Logout. */
  sessionNotice: string | null;
  /** Username to pre-fill after the server ended the session. */
  lastUsername: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  /** For data-entry screens: while held, an ended session waits until the
   *  collector has left the screen; call the returned function to release. */
  holdSignOut: () => () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Keep a data-entry screen open while the server ends the session: the
 * collector finishes and saves as usual (records are saved under the username
 * still held in memory), and the Login screen follows once they leave the
 * screen. Showing Login at once would unmount the screen and lose its input.
 */
export const useSignOutHold = (active: boolean = true) => {
  const { holdSignOut } = useAuth();
  useEffect(() => (active ? holdSignOut() : undefined), [active, holdSignOut]);
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState<string | null>(null);

  // Mirrors for listeners that outlive a render
  const authedRef = useRef(false);
  const usernameRef = useRef<string | null>(null);
  const holds = useRef(0);
  const pendingEnd = useRef<SessionEndReason | null>(null);

  const setSession = useCallback((user: string | null, prof: UserProfile | null) => {
    authedRef.current = user !== null;
    usernameRef.current = user;
    setUsername(user);
    setProfile(prof);
    setIsAuthenticated(user !== null);
  }, []);

  const showLogin = useCallback((reason: SessionEndReason) => {
    setLastUsername(usernameRef.current);
    setSessionNotice(SESSION_NOTICE[reason]);
    setSession(null, null);
  }, [setSession]);

  /**
   * Check authentication status on mount
   */
  const checkAuth = async () => {
    try {
      const token = await authService.getAccessToken();
      const storedUsername = await authService.getUsername();
      const storedProfile = await authService.getProfile();
      const last = await authService.getLastUsername();

      // A token without its username is a broken write, not a session
      const authenticated = !!token && !!storedUsername;
      setSession(authenticated ? storedUsername : null, authenticated ? storedProfile : null);
      setLastUsername(authenticated ? null : last);
      setSessionNotice(!authenticated && last ? SESSION_NOTICE.expired : null);
      if (authenticated) {
        // Continue this collector's participant-ID sequence from the server.
        // Also the first server check of the stored session: a 401 ends it.
        syncService.seedSequenceFromServer().catch(() => {});
      }
    } catch (error) {
      console.error('[AuthContext] Error checking auth:', error);
      setSession(null, null);
    } finally {
      setIsBooting(false);
    }
  };

  /**
   * Login with credentials. Errors are thrown to LoginScreen, which stays
   * mounted (no global spinner) and shows them inline.
   */
  const login = async (credentials: LoginCredentials) => {
    const response = await authService.login(credentials);
    pendingEnd.current = null;
    setSessionNotice(null);
    setLastUsername(null);
    setSession(credentials.username, response.profile ?? null);
    // Fresh login (incl. reinstall / new device): pick up where the
    // server says this collector's ID sequence left off.
    syncService.seedSequenceFromServer(true).catch(() => {});
  };

  /**
   * Logout and clear auth state (the collector chose to log out)
   */
  const logout = async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
    }
    pendingEnd.current = null;
    setSessionNotice(null);
    setLastUsername(null);
    setSession(null, null);
  };

  const holdSignOut = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current -= 1;
      if (holds.current === 0 && pendingEnd.current !== null) {
        const reason = pendingEnd.current;
        pendingEnd.current = null;
        showLogin(reason);
      }
    };
  }, [showLogin]);

  // The server ended the session (or no token was found): go to Login, unless
  // a data-entry screen is open; then wait quietly until the collector leaves
  // it. No alert mid-interview: there is nothing to do but finish and save.
  useEffect(() => onSessionEnded((reason) => {
    if (!authedRef.current) return; // already logged out
    if (holds.current > 0) {
      if (pendingEnd.current === null) pendingEnd.current = reason;
      return;
    }
    showLogin(reason);
  }), [showLogin]);

  // Check auth status on mount (after the listener above is in place)
  useEffect(() => {
    checkAuth();
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isBooting,
    username,
    profile,
    sessionNotice,
    lastUsername,
    login,
    logout,
    checkAuth,
    holdSignOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
