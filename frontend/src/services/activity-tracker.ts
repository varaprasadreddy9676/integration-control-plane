/**
 * User Activity Tracker - Frontend Service
 * Modular, robust activity tracking with batching and queueing
 * Tracks all user interactions for comprehensive audit trail
 */

import { getAuthToken } from '../utils/auth-storage';

// API base URL configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

// Activity event types (matches backend)
export const ACTIVITY_EVENTS = {
  // Authentication & Session
  LOGIN: 'login',
  LOGOUT: 'logout',
  SESSION_EXPIRED: 'session_expired',

  // Navigation & Page Views
  PAGE_VIEW: 'page_view',
  NAVIGATION: 'navigation',
  DASHBOARD_VIEW: 'dashboard_view',

  // Feature Usage
  INTEGRATION_VIEWED: 'integration_viewed',
  INTEGRATION_CREATED: 'integration_created',
  INTEGRATION_EDITED: 'integration_edited',
  INTEGRATION_DELETED: 'integration_deleted',
  INTEGRATION_TESTED: 'integration_tested',

  // AI Feature Usage
  AI_ASSISTANT_OPENED: 'ai_assistant_opened',
  AI_PROMPT_SENT: 'ai_prompt_sent',
  AI_CONFIG_VIEWED: 'ai_config_viewed',
  AI_CONFIG_UPDATED: 'ai_config_updated',

  // Data Operations
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  LOGS_VIEWED: 'logs_viewed',
  LOGS_FILTERED: 'logs_filtered',
  REPORT_DOWNLOADED: 'report_downloaded',

  // User Management
  USER_PROFILE_VIEWED: 'user_profile_viewed',
  USER_PROFILE_UPDATED: 'user_profile_updated',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',

  // Role & Permission Management
  ROLE_VIEWED: 'role_viewed',
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  ROLE_DELETED: 'role_deleted',
  PERMISSIONS_VIEWED: 'permissions_viewed',

  // Organization Management
  ORG_SWITCHED: 'org_switched',
  ORG_VIEWED: 'org_viewed',

  // Button Clicks & Interactions
  BUTTON_CLICKED: 'button_clicked',
  FORM_SUBMITTED: 'form_submitted',
  MODAL_OPENED: 'modal_opened',
  MODAL_CLOSED: 'modal_closed',
  TAB_SWITCHED: 'tab_switched',

  // Search & Filter
  SEARCH_PERFORMED: 'search_performed',
  FILTER_APPLIED: 'filter_applied',

  // Settings
  SETTINGS_VIEWED: 'settings_viewed',
  SETTINGS_UPDATED: 'settings_updated',

  // Errors
  ERROR_ENCOUNTERED: 'error_encountered',
  API_ERROR: 'api_error'
} as const;

export type ActivityEvent = typeof ACTIVITY_EVENTS[keyof typeof ACTIVITY_EVENTS];

interface ActivityPayload {
  event: ActivityEvent;
  page?: string;
  feature?: string;
  action?: string;
  target?: any;
  metadata?: Record<string, any>;
  changes?: {
    before?: any;
    after?: any;
  };
  duration?: number;
  success?: boolean;
  errorMessage?: string;
}

interface QueuedActivity extends ActivityPayload {
  timestamp: Date;
  sessionId: string;
}

class ActivityTrackerService {
  private queue: QueuedActivity[] = [];
  private sessionId: string;
  private flushInterval: NodeJS.Timeout | null = null;
  private pageLoadTime: number = Date.now();
  private currentPage: string = '';
  private isEnabled: boolean = true;
  private readonly BATCH_SIZE = 10;
  private readonly FLUSH_INTERVAL_MS = 5000; // Send batch every 5 seconds
  private readonly MAX_QUEUE_SIZE = 100;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.init();
  }

  /**
   * Initialize the tracker
   */
  private init() {
    // Start auto-flush interval
    this.startAutoFlush();

    // Track page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush(true); // Synchronous flush on unload
      });

      // Track visibility changes (tab switching)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.track({
            event: ACTIVITY_EVENTS.TAB_SWITCHED,
            metadata: { visibility: 'hidden' }
          });
        }
      });
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start automatic flush interval
   */
  private startAutoFlush() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Track an activity event
   */
  track(payload: ActivityPayload) {
    if (!this.isEnabled) return;

    try {
      const activity: QueuedActivity = {
        ...payload,
        timestamp: new Date(),
        sessionId: this.sessionId,
        page: payload.page || this.currentPage || window.location.pathname
      };

      // Add to queue
      this.queue.push(activity);

      // Auto-flush if queue is full
      if (this.queue.length >= this.BATCH_SIZE) {
        this.flush();
      }

      // Safety: prevent queue overflow
      if (this.queue.length > this.MAX_QUEUE_SIZE) {
        console.warn('[ActivityTracker] Queue overflow, flushing...');
        this.flush();
      }
    } catch (error) {
      console.error('[ActivityTracker] Failed to track activity:', error);
    }
  }

  /**
   * Track page view
   */
  trackPageView(page: string, metadata?: Record<string, any>) {
    this.currentPage = page;
    const pageLoadDuration = Date.now() - this.pageLoadTime;

    this.track({
      event: ACTIVITY_EVENTS.PAGE_VIEW,
      page,
      duration: pageLoadDuration,
      metadata
    });

    this.pageLoadTime = Date.now();
  }

  /**
   * Track navigation
   */
  trackNavigation(from: string, to: string) {
    this.track({
      event: ACTIVITY_EVENTS.NAVIGATION,
      metadata: {
        from,
        to
      }
    });
  }

  /**
   * Track button click
   */
  trackClick(buttonName: string, metadata?: Record<string, any>) {
    this.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      action: buttonName,
      metadata
    });
  }

  /**
   * Track form submission
   */
  trackFormSubmit(formName: string, success: boolean, metadata?: Record<string, any>) {
    this.track({
      event: ACTIVITY_EVENTS.FORM_SUBMITTED,
      feature: formName,
      success,
      metadata
    });
  }

  /**
   * Track modal interaction
   */
  trackModal(modalName: string, action: 'opened' | 'closed', metadata?: Record<string, any>) {
    this.track({
      event: action === 'opened' ? ACTIVITY_EVENTS.MODAL_OPENED : ACTIVITY_EVENTS.MODAL_CLOSED,
      feature: modalName,
      metadata
    });
  }

  /**
   * Track search
   */
  trackSearch(query: string, resultsCount?: number, metadata?: Record<string, any>) {
    this.track({
      event: ACTIVITY_EVENTS.SEARCH_PERFORMED,
      action: 'search',
      metadata: {
        query,
        resultsCount,
        ...metadata
      }
    });
  }

  /**
   * Track filter application
   */
  trackFilter(filterName: string, filterValue: any, metadata?: Record<string, any>) {
    this.track({
      event: ACTIVITY_EVENTS.FILTER_APPLIED,
      action: filterName,
      metadata: {
        filterValue,
        ...metadata
      }
    });
  }

  /**
   * Track error
   */
  trackError(error: Error | string, metadata?: Record<string, any>) {
    const errorMessage = typeof error === 'string' ? error : error.message;

    this.track({
      event: ACTIVITY_EVENTS.ERROR_ENCOUNTERED,
      success: false,
      errorMessage,
      metadata: {
        stack: typeof error === 'object' ? error.stack : undefined,
        ...metadata
      }
    });
  }

  /**
   * Track API error
   */
  trackApiError(endpoint: string, statusCode: number, error: string) {
    this.track({
      event: ACTIVITY_EVENTS.API_ERROR,
      success: false,
      metadata: {
        endpoint,
        statusCode,
        error
      }
    });
  }

  /**
   * Track feature usage with timing
   */
  trackFeatureUsage(feature: string, action: string, metadata?: Record<string, any>) {
    this.track({
      event: `${feature}_${action}`.toLowerCase() as ActivityEvent,
      feature,
      action,
      metadata
    });
  }

  /**
   * Start timing an action
   */
  startTiming(actionName: string): () => void {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;
      this.track({
        event: ACTIVITY_EVENTS.BUTTON_CLICKED,
        action: actionName,
        duration
      });
    };
  }

  /**
   * Flush the queue to the server
   */
  async flush(synchronous: boolean = false) {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    try {
      const token = getAuthToken();
      if (!token) return; // Don't send if not authenticated

      const endpoint = `${API_BASE_URL}/admin/audit/activities/batch`;

      if (synchronous && navigator.sendBeacon) {
        // Use sendBeacon for synchronous requests (page unload)
        const blob = new Blob([JSON.stringify({ activities: batch })], {
          type: 'application/json'
        });
        navigator.sendBeacon(endpoint, blob);
      } else {
        // Normal async request
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ activities: batch })
        });
      }
    } catch (error) {
      console.error('[ActivityTracker] Failed to flush activities:', error);
      // Re-queue failed items
      this.queue = [...batch, ...this.queue];
    }
  }

  /**
   * Enable tracking
   */
  enable() {
    this.isEnabled = true;
    this.startAutoFlush();
  }

  /**
   * Disable tracking
   */
  disable() {
    this.isEnabled = false;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Clear all queued activities
   */
  clear() {
    this.queue = [];
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }
}

// Create singleton instance
const activityTracker = new ActivityTrackerService();

// Export singleton and class
export { activityTracker, ActivityTrackerService };
export default activityTracker;
