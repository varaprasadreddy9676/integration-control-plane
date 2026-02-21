/**
 * React Hook for Automatic Activity Tracking
 * Tracks page views, navigation, and user interactions
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import activityTracker, { ACTIVITY_EVENTS } from '../services/activity-tracker';

/**
 * Hook to automatically track page views and navigation
 * Use this in your main App component or route wrapper
 */
export function usePageViewTracking() {
  const location = useLocation();
  const previousPath = useRef<string>('');

  useEffect(() => {
    const currentPath = location.pathname;
    const previousPathValue = previousPath.current;

    // Track page view
    activityTracker.trackPageView(currentPath, {
      search: location.search,
      hash: location.hash,
      state: location.state
    });

    // Track navigation if there was a previous page
    if (previousPathValue && previousPathValue !== currentPath) {
      activityTracker.trackNavigation(previousPathValue, currentPath);
    }

    // Update previous path
    previousPath.current = currentPath;
  }, [location]);
}

/**
 * Hook to track feature usage with automatic cleanup
 * Use this in feature components to track when users interact with specific features
 *
 * @param featureName - Name of the feature (e.g., 'integrations', 'ai-assistant')
 * @param metadata - Additional metadata to track
 */
export function useFeatureTracking(featureName: string, metadata?: Record<string, any>) {
  useEffect(() => {
    // Track feature view on mount
    activityTracker.track({
      event: ACTIVITY_EVENTS.PAGE_VIEW,
      feature: featureName,
      metadata
    });

    // Cleanup is not needed for activity tracking
  }, [featureName, metadata]);
}

/**
 * Hook to track modal lifecycle
 *
 * @param modalName - Name of the modal
 * @param isOpen - Whether modal is open
 */
export function useModalTracking(modalName: string, isOpen: boolean) {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      // Modal opened
      activityTracker.trackModal(modalName, 'opened');
      wasOpen.current = true;
    } else if (!isOpen && wasOpen.current) {
      // Modal closed
      activityTracker.trackModal(modalName, 'closed');
      wasOpen.current = false;
    }
  }, [modalName, isOpen]);
}

/**
 * Hook to track timing of an action
 * Returns a function to call when the action completes
 *
 * @param actionName - Name of the action to track
 * @returns Function to call when action completes
 *
 * @example
 * const endTiming = useActionTiming('export-data');
 * // ... perform action
 * endTiming();
 */
export function useActionTiming(actionName: string) {
  const timingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Create timing function
    timingRef.current = activityTracker.startTiming(actionName);

    // Cleanup: if component unmounts before action completes
    return () => {
      timingRef.current = null;
    };
  }, [actionName]);

  return () => {
    if (timingRef.current) {
      timingRef.current();
    }
  };
}

/**
 * Hook to track errors that occur in a component
 *
 * @param error - Error object or null
 * @param componentName - Name of the component where error occurred
 */
export function useErrorTracking(error: Error | null, componentName: string) {
  useEffect(() => {
    if (error) {
      activityTracker.trackError(error, {
        component: componentName,
        timestamp: new Date().toISOString()
      });
    }
  }, [error, componentName]);
}

/**
 * Hook to track form interactions
 * Returns helper functions for form tracking
 *
 * @param formName - Name of the form
 */
export function useFormTracking(formName: string) {
  const trackFormView = () => {
    activityTracker.track({
      event: ACTIVITY_EVENTS.PAGE_VIEW,
      feature: formName,
      action: 'form_viewed'
    });
  };

  const trackFormSubmit = (success: boolean, metadata?: Record<string, any>) => {
    activityTracker.trackFormSubmit(formName, success, metadata);
  };

  const trackFieldInteraction = (fieldName: string, action: 'focused' | 'changed') => {
    activityTracker.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      feature: formName,
      action: `field_${action}`,
      metadata: { fieldName }
    });
  };

  return {
    trackFormView,
    trackFormSubmit,
    trackFieldInteraction
  };
}

/**
 * Hook to track search and filter usage
 */
export function useSearchTracking() {
  const trackSearch = (query: string, resultsCount?: number, metadata?: Record<string, any>) => {
    activityTracker.trackSearch(query, resultsCount, metadata);
  };

  const trackFilter = (filterName: string, filterValue: any, metadata?: Record<string, any>) => {
    activityTracker.trackFilter(filterName, filterValue, metadata);
  };

  return {
    trackSearch,
    trackFilter
  };
}

/**
 * Direct access to activity tracker for custom tracking
 * Use this when you need more control over what gets tracked
 */
export { activityTracker, ACTIVITY_EVENTS };
export default activityTracker;
