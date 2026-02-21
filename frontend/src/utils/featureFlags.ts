/**
 * Feature Flags Utility
 *
 * Manages feature flags stored in localStorage
 */

const FEATURE_FLAGS_KEY = 'ig_feature_flags';

export interface FeatureFlags {
  integrationFlowBuilderEnabled: boolean;
  // Add more feature flags here as needed
}

const DEFAULT_FLAGS: FeatureFlags = {
  integrationFlowBuilderEnabled: false, // Disabled - will be improved in future
};

/**
 * Get all feature flags from localStorage
 */
export function getFeatureFlags(): FeatureFlags {
  try {
    const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FLAGS, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load feature flags:', error);
  }
  return DEFAULT_FLAGS;
}

/**
 * Check if a specific feature flag is enabled
 */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  const flags = getFeatureFlags();
  return flags[flag] ?? false;
}

/**
 * Enable a feature flag
 */
export function enableFeature(flag: keyof FeatureFlags): void {
  const flags = getFeatureFlags();
  flags[flag] = true;
  saveFeatureFlags(flags);
}

/**
 * Disable a feature flag
 */
export function disableFeature(flag: keyof FeatureFlags): void {
  const flags = getFeatureFlags();
  flags[flag] = false;
  saveFeatureFlags(flags);
}

/**
 * Toggle a feature flag
 */
export function toggleFeature(flag: keyof FeatureFlags): boolean {
  const flags = getFeatureFlags();
  flags[flag] = !flags[flag];
  saveFeatureFlags(flags);
  return flags[flag];
}

/**
 * Save feature flags to localStorage
 */
function saveFeatureFlags(flags: FeatureFlags): void {
  try {
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
  } catch (error) {
    console.error('Failed to save feature flags:', error);
  }
}

/**
 * Reset all feature flags to defaults
 */
export function resetFeatureFlags(): void {
  localStorage.removeItem(FEATURE_FLAGS_KEY);
}

/**
 * React hook for using feature flags
 */
export function useFeatureFlag(flag: keyof FeatureFlags): boolean {
  const [enabled, setEnabled] = React.useState(() => isFeatureEnabled(flag));

  React.useEffect(() => {
    // Listen for storage changes (in case flags are changed in another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === FEATURE_FLAGS_KEY) {
        setEnabled(isFeatureEnabled(flag));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [flag]);

  return enabled;
}

// For debugging in console
if (typeof window !== 'undefined') {
  (window as any).featureFlags = {
    get: getFeatureFlags,
    enable: enableFeature,
    disable: disableFeature,
    toggle: toggleFeature,
    reset: resetFeatureFlags,
  };
}

// Export React for the hook
import React from 'react';
