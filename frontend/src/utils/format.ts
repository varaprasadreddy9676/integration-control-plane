import dayjs from 'dayjs';

export const formatDateTime = (value: string) => value ? dayjs(value).format('MMM D, YYYY HH:mm') : '—';
export const formatDateTimeWithSeconds = (value: string) => value ? dayjs(value).format('MMM D, YYYY HH:mm:ss') : '—';
export const formatDate = (value: string) => value ? dayjs(value).format('MMM D, YYYY') : '—';
export const formatNumber = (value: number) => value != null ? value.toLocaleString() : '—';

export const formatDuration = (ms?: number): string => {
  if (!ms) return '—';

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
};
