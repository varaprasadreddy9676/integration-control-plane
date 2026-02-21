import { createContext, useContext, useMemo, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { login as loginRequest, impersonate as impersonateRequest } from '../services/auth-api';
import {
  type AuthUser,
  getAuthToken,
  getAuthUser,
  setAuthToken,
  setAuthUser,
  clearAuthStorage,
  setImpersonationBackup,
  getImpersonationBackup,
  clearImpersonationBackup
} from '../utils/auth-storage';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  impersonate: (orgId: number, role?: 'ORG_ADMIN' | 'ORG_USER') => Promise<void>;
  exitImpersonation: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [user, setUser] = useState<AuthUser | null>(() => getAuthUser());

  useEffect(() => {
    const handleStorage = () => {
      setToken(getAuthToken());
      setUser(getAuthUser());
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('auth-storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('auth-storage', handleStorage);
    };
  }, []);

  const login = async (email: string, password: string) => {
    const response = await loginRequest(email, password);
    clearImpersonationBackup();
    setAuthToken(response.accessToken);
    setAuthUser(response.user as AuthUser);
    setToken(response.accessToken);
    setUser(response.user as AuthUser);
  };

  const logout = () => {
    clearImpersonationBackup();
    clearAuthStorage();
    // Clear orgId storage on logout to prevent stale data
    localStorage.removeItem('integration_gateway_org_id');
    sessionStorage.removeItem('integration_gateway_org_id');
    localStorage.removeItem('integration_gateway_entity_rid');
    sessionStorage.removeItem('integration_gateway_entity_rid');
    setToken(null);
    setUser(null);
  };

  const impersonate = async (orgId: number, role: 'ORG_ADMIN' | 'ORG_USER' = 'ORG_ADMIN') => {
    if (token && user && !getImpersonationBackup()) {
      setImpersonationBackup(token, user);
    }
    const response = await impersonateRequest(orgId, role);
    const impersonatedUser = {
      ...(response.user as AuthUser),
      impersonated: true,
      impersonatedBy: response.impersonatedBy || user?.id || null
    };
    setAuthToken(response.accessToken);
    setAuthUser(impersonatedUser);
    setToken(response.accessToken);
    setUser(impersonatedUser);
  };

  const exitImpersonation = () => {
    const backup = getImpersonationBackup();
    if (backup) {
      setAuthToken(backup.token);
      setAuthUser(backup.user);
      setToken(backup.token);
      setUser(backup.user);
      clearImpersonationBackup();
    }
  };

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      token,
      isAuthenticated: !!token,
      login,
      logout,
      impersonate,
      exitImpersonation
    };
  }, [user, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
