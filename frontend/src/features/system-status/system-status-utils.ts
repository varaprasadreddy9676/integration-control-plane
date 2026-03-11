export type HealthColor = 'green' | 'orange' | 'red' | 'blue' | 'default';

export type DisplayStatus =
  | 'healthy'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'
  | 'disabled'
  | 'stopped'
  | 'stale'
  | 'unknown';

export interface StatusPresentation {
  tone: DisplayStatus;
  color: HealthColor;
  label: string;
}

export interface WorkerStatusLike {
  enabled?: boolean;
  running?: boolean;
  alive?: boolean;
  status?: string | null;
}

export interface EventSourceConfigurationLike {
  configured?: boolean;
  state?: string | null;
}

export interface EventSourceAdapterLike {
  connectionStatus?: string | null;
}

export function formatAgeLabel(timestamp?: string | null, now = Date.now()): string {
  if (!timestamp) return '—';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return '—';
  const diffSeconds = Math.max(0, Math.floor((now - time) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} m`;
}

export function formatPercentage(value?: number | null, digits = 1): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function getWorkerStatusPresentation(worker: WorkerStatusLike): StatusPresentation {
  if (!worker.enabled) {
    return { tone: 'disabled', color: 'default', label: 'Disabled' };
  }
  if (worker.status === 'healthy' || worker.alive) {
    return { tone: 'healthy', color: 'green', label: 'Healthy' };
  }
  if (worker.status === 'stale' || (worker.running && !worker.alive)) {
    return { tone: 'stale', color: 'orange', label: 'Stale' };
  }
  if (worker.status === 'stopped' || worker.running === false) {
    return { tone: 'stopped', color: 'default', label: 'Stopped' };
  }
  return { tone: 'unknown', color: 'default', label: 'Unknown' };
}

export function getEventSourceConfigurationPresentation(
  configuration?: EventSourceConfigurationLike | null
): StatusPresentation {
  const state = String(configuration?.state || '').toLowerCase();
  if (!configuration?.configured || state === 'not_configured') {
    return { tone: 'info', color: 'blue', label: 'Not Configured' };
  }
  if (state === 'error') {
    return { tone: 'error', color: 'red', label: 'Configuration Error' };
  }
  if (state === 'running') {
    return { tone: 'healthy', color: 'green', label: 'Configured & Running' };
  }
  if (state === 'configured') {
    return { tone: 'neutral', color: 'default', label: 'Configured' };
  }
  return { tone: 'unknown', color: 'default', label: 'Unknown' };
}

export function getAdapterStatusPresentation(adapter?: EventSourceAdapterLike | null): StatusPresentation {
  const state = String(adapter?.connectionStatus || '').toLowerCase();
  switch (state) {
    case 'connected':
      return { tone: 'healthy', color: 'green', label: 'Connected' };
    case 'reconnecting':
      return { tone: 'warning', color: 'orange', label: 'Reconnecting' };
    case 'error':
      return { tone: 'error', color: 'red', label: 'Error' };
    case 'stale':
      return { tone: 'stale', color: 'orange', label: 'Stale' };
    case 'not_applicable':
      return { tone: 'neutral', color: 'default', label: 'Not Applicable' };
    case 'unavailable':
      return { tone: 'warning', color: 'orange', label: 'Unavailable' };
    case 'disconnected':
      return { tone: 'warning', color: 'orange', label: 'Disconnected' };
    case 'stopped':
      return { tone: 'stopped', color: 'default', label: 'Stopped' };
    case 'unknown':
    case '':
      return { tone: 'unknown', color: 'default', label: 'Unknown' };
    default:
      return { tone: 'neutral', color: 'default', label: state.replace(/_/g, ' ') };
  }
}

export function getOverallStatusPresentation(status?: string | null): StatusPresentation {
  const normalized = String(status || '').toLowerCase();
  switch (normalized) {
    case 'healthy':
      return { tone: 'healthy', color: 'green', label: 'Healthy' };
    case 'warning':
    case 'degraded':
      return { tone: 'warning', color: 'orange', label: 'Degraded' };
    case 'critical':
    case 'error':
      return { tone: 'error', color: 'red', label: 'Critical' };
    default:
      return { tone: 'unknown', color: 'default', label: 'Unknown' };
  }
}

