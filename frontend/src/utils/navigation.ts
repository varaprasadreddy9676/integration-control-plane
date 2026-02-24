import { useNavigate, NavigateOptions } from 'react-router-dom';
import { useCallback } from 'react';

const EXTERNAL_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const SPECIAL_PROTOCOL_PATTERN = /^(?:mailto:|tel:|sms:)/i;

const getCurrentOrgIdFromUrl = (): string | null => {
  const currentParams = new URLSearchParams(window.location.search);
  return currentParams.get('orgId');
};

/**
 * Custom hook that wraps useNavigate to automatically preserve orgId query parameter
 * This ensures the parameter persists across all navigation throughout the app
 */
export const useNavigateWithParams = () => {
  const navigate = useNavigate();

  const navigateWithParams = useCallback((to: string | number, options?: NavigateOptions) => {
    // If navigating back/forward with a number, use default navigate
    if (typeof to === 'number') {
      return navigate(to);
    }

    if (typeof to === 'string') {
      return navigate(buildUrlWithOrgId(to), options);
    }

    return navigate(to, options);
  }, [navigate]);

  return navigateWithParams;
};

/**
 * Helper to build URLs with orgId preserved
 * Useful for Link components or manual URL construction
 */
export const buildUrlWithOrgId = (path: string): string => {
  if (!path || EXTERNAL_URL_PATTERN.test(path) || SPECIAL_PROTOCOL_PATTERN.test(path)) {
    return path;
  }

  const orgId = getCurrentOrgIdFromUrl();
  if (!orgId) return path;

  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;

  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const queryString = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const params = new URLSearchParams(queryString);
  params.set('orgId', orgId);

  const rebuiltQuery = params.toString();
  return `${pathname}${rebuiltQuery ? `?${rebuiltQuery}` : ''}${hash}`;
};
