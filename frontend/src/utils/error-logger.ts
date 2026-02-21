import { getAuthToken } from './auth-storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || 'mdcs_dev_key_1f4a';

interface ErrorContext {
  [key: string]: any;
}

export type ErrorCategory =
  | 'ui_error'           // UI rendering errors, component crashes
  | 'api_error'          // API call failures, network errors
  | 'validation_error'   // Form validation, data validation errors
  | 'business_logic'     // Business logic errors (bulk operations, etc.)
  | 'unhandled'          // Unhandled global errors
  | 'unknown';           // Fallback category

interface ClientError {
  message: string;
  stack?: string;
  context?: ErrorContext;
  url: string;
  userAgent: string;
  timestamp: string;
  type: 'error' | 'unhandled_promise' | 'react_error';
  category: ErrorCategory;
  source: 'browser';  // Always browser for client errors
}

export const logError = async (
  error: Error,
  context?: ErrorContext,
  category: ErrorCategory = 'unknown'
) => {
  const errorData: ClientError = {
    message: error.message,
    stack: error.stack,
    context,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    type: 'error',
    category,
    source: 'browser'
  };

  try {
    const token = getAuthToken();
    await fetch(`${API_BASE_URL}/client-errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(errorData)
    });
  } catch (e) {
    // Fail silently - don't want error logging to break the app
    console.error('Failed to log error to server:', e);
  }
};

export const setupGlobalErrorHandlers = () => {
  // Catch unhandled errors
  window.addEventListener('error', (event) => {
    logError(
      new Error(event.message),
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        type: 'global_error'
      },
      'unhandled'  // Category: unhandled global error
    );
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));

    logError(
      error,
      {
        type: 'unhandled_promise',
        reason: event.reason
      },
      'unhandled'  // Category: unhandled promise rejection
    );
  });

  console.log('Global error handlers installed');
};
