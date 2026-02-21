const TOKEN_KEY = 'integration_gateway_token';
const USER_KEY = 'integration_gateway_user';
const IMPERSONATION_BACKUP_KEY = 'integration_gateway_impersonation_backup';

export interface AuthUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'ORG_ADMIN' | 'ORG_USER' | string;
  orgId?: number | null;
  impersonatedBy?: string | null;
  impersonated?: boolean;
}

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const setAuthToken = (token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth-storage'));
  }
};

export const clearAuthToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth-storage'));
  }
};

export const getAuthUser = (): AuthUser | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch (err) {
    return null;
  }
};

export const setAuthUser = (user: AuthUser) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth-storage'));
  }
};

export const clearAuthUser = () => {
  localStorage.removeItem(USER_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth-storage'));
  }
};

export const clearAuthStorage = () => {
  clearAuthToken();
  clearAuthUser();
};

export const setImpersonationBackup = (token: string, user: AuthUser) => {
  localStorage.setItem(IMPERSONATION_BACKUP_KEY, JSON.stringify({ token, user }));
};

export const getImpersonationBackup = (): { token: string; user: AuthUser } | null => {
  const raw = localStorage.getItem(IMPERSONATION_BACKUP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { token: string; user: AuthUser };
  } catch (err) {
    return null;
  }
};

export const clearImpersonationBackup = () => {
  localStorage.removeItem(IMPERSONATION_BACKUP_KEY);
};
