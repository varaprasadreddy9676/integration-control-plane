/**
 * Set VITE_LANDING_PUBLIC_MODE=true in .env when deploying to the public internet.
 * Enables: GitHub nav link, social icons in footer, full footer link columns.
 * Leave false (default) for internal / office deployments.
 */
export const LANDING_PUBLIC_MODE = import.meta.env.VITE_LANDING_PUBLIC_MODE === 'true';

/**
 * GitHub repository URL — set VITE_GITHUB_URL in .env when LANDING_PUBLIC_MODE is enabled.
 * Falls back to the organization root if not set.
 */
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com';
