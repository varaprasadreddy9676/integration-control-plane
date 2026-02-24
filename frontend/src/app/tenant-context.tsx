import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getTenantInfo, setCurrentOrgId } from '../services/api';
import type { TenantInfo } from '../mocks/types';
import { useAuth } from './auth-context';

interface TenantContextValue {
  tenant?: TenantInfo;
  orgId: number;
  isLoading: boolean;
  error?: Error | null;
  setManualOrgId: (orgId: number) => void;
  clearOrgId: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

const STORAGE_KEY = 'integration_gateway_org_id';
const LEGACY_STORAGE_KEY = 'integration_gateway_entity_rid';

/**
 * Get orgId from multiple sources (in priority order):
 * 1. URL query parameter
 * 2. SessionStorage (persists across refresh in same tab)
 * 3. LocalStorage (persists across tabs/sessions - fallback)
 */
const resolveOrgIdFromContext = (): number => {
  // 1. Try URL parameter first (highest priority)
  const params = new URLSearchParams(window.location.search);
  const fromUrl = Number(params.get('orgId') || '0');
  if (Number.isFinite(fromUrl) && fromUrl > 0) {
    // Found in URL - save to storage for future refreshes
    sessionStorage.setItem(STORAGE_KEY, fromUrl.toString());
    localStorage.setItem(STORAGE_KEY, fromUrl.toString());
    return fromUrl;
  }

  // 2. Try sessionStorage (survives refresh in same tab)
  const fromSession = sessionStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(LEGACY_STORAGE_KEY);
  if (fromSession) {
    const rid = Number(fromSession);
    if (Number.isFinite(rid) && rid > 0) {
      sessionStorage.setItem(STORAGE_KEY, rid.toString());
      return rid;
    }
  }

  // 3. Try localStorage (survives across tabs/sessions)
  const fromLocal = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (fromLocal) {
    const rid = Number(fromLocal);
    if (Number.isFinite(rid) && rid > 0) {
      // Move to sessionStorage for this session
      sessionStorage.setItem(STORAGE_KEY, rid.toString());
      localStorage.setItem(STORAGE_KEY, rid.toString());
      return rid;
    }
  }

  // No orgId found anywhere
  return 0;
};

/**
 * Save orgId to both storages
 */
const saveOrgId = (orgId: number) => {
  sessionStorage.setItem(STORAGE_KEY, orgId.toString());
  localStorage.setItem(STORAGE_KEY, orgId.toString());
  // Keep legacy key during transition window
  sessionStorage.setItem(LEGACY_STORAGE_KEY, orgId.toString());
  localStorage.setItem(LEGACY_STORAGE_KEY, orgId.toString());
  setCurrentOrgId(orgId);
};

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [orgId, setOrgId] = useState(() => {
    const resolvedOrgId = resolveOrgIdFromContext();
    if (resolvedOrgId > 0) {
      setCurrentOrgId(resolvedOrgId);
    } else {
      setCurrentOrgId(null);
    }
    return resolvedOrgId;
  });

  // If user is org-scoped, ensure orgId matches their user.orgId
  // This prevents stale orgId from localStorage when switching users
  useEffect(() => {
    if (user?.orgId && Number.isFinite(user.orgId)) {
      const current = resolveOrgIdFromContext();
      // Update orgId if missing OR if it doesn't match the user's orgId
      if (!current || current <= 0 || current !== user.orgId) {
        saveOrgId(user.orgId);
        setOrgId(user.orgId);
      }
    }
  }, [user?.orgId]);

  // SUPER_ADMIN doesn't need a default orgId - they can navigate to admin routes without one
  // They will explicitly select an org when needed via the org switcher dropdown

  // Sync URL with orgId if missing from URL but present in storage
  // Skip on the landing page — orgId has no meaning there and should not appear in the URL
  useEffect(() => {
    if (orgId > 0 && location.pathname !== '/') {
      const params = new URLSearchParams(location.search);
      const urlRid = params.get('orgId');

      // If URL doesn't have orgId, add it
      if (!urlRid) {
        params.set('orgId', orgId.toString());
        // Replace current URL without creating new history entry
        navigate(`${location.pathname}?${params.toString()}`, { replace: true });
      }
    }
  }, [orgId, location.pathname, location.search, navigate]);

  // Function to manually set orgId (for recovery/development)
  const setManualOrgId = useCallback((nextOrgId: number) => {
    if (Number.isFinite(nextOrgId) && nextOrgId > 0) {
      saveOrgId(nextOrgId);
      setOrgId(nextOrgId);

      // Update URL
      const params = new URLSearchParams(location.search);
      params.set('orgId', nextOrgId.toString());
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const clearOrgId = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setCurrentOrgId(null);
    setOrgId(0);

    const params = new URLSearchParams(location.search);
    params.delete('orgId');
    const query = params.toString();
    navigate(query ? `${location.pathname}?${query}` : location.pathname, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Load tenant info when orgId is set (for all roles, including SUPER_ADMIN when they switch orgs)
  const shouldFetchTenant = orgId > 0;

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['tenant', orgId],
    queryFn: () => getTenantInfo(),
    enabled: shouldFetchTenant,
    retry: 1, // Don't retry indefinitely if the server is offline
    refetchOnWindowFocus: false,
  });

  const value = useMemo<TenantContextValue>(() => {
    return {
      tenant: data,
      orgId,
      isLoading,
      error: queryError || (!shouldFetchTenant && orgId === 0 ? new Error('Missing orgId parameter') : null),
      setManualOrgId,
      clearOrgId
    };
  }, [data, orgId, isLoading, queryError, shouldFetchTenant, setManualOrgId, clearOrgId]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = () => {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
};
