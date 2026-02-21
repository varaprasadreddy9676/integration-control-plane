import { useNavigate, NavigateOptions } from 'react-router-dom';
import { useCallback } from 'react';

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

    // Get current orgId from URL
    const currentParams = new URLSearchParams(window.location.search);
    const orgId = currentParams.get('orgId');

    // If there's an orgId and the target is a string path
    if (orgId && typeof to === 'string') {
      // Parse the target URL to check if it already has query params
      const hasQueryParams = to.includes('?');
      const separator = hasQueryParams ? '&' : '?';

      // Don't add if it's already in the target
      if (!to.includes('orgId=')) {
        const newPath = `${to}${separator}orgId=${orgId}`;
        return navigate(newPath, options);
      }
    }

    // Default navigation if no orgId or already present
    return navigate(to, options);
  }, [navigate]);

  return navigateWithParams;
};

/**
 * Helper to build URLs with orgId preserved
 * Useful for Link components or manual URL construction
 */
export const buildUrlWithEntityParentRid = (path: string): string => {
  const currentParams = new URLSearchParams(window.location.search);
  const orgId = currentParams.get('orgId');

  if (!orgId) return path;

  const hasQueryParams = path.includes('?');
  const separator = hasQueryParams ? '&' : '?';

  // Don't add if already present
  if (path.includes('orgId=')) return path;

  return `${path}${separator}orgId=${orgId}`;
};
