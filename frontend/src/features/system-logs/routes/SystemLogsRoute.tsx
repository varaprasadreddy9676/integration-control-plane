import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react';
import { Alert, App, Button, Card, Divider, Dropdown, Grid, Input, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import {
  BugOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import {
  clearSystemLogs,
  exportSystemLogsToCsv,
  exportSystemLogsToJson,
  getSystemLogs,
  getSystemProcessLogTail,
  type ProcessLogTailResponse,
  type SystemLog,
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { cssVar, spacingToNumber, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';

type LogRecord = SystemLog & {
  meta?: Record<string, any>;
  errorCategory?: string | null;
  stream?: 'app' | 'access' | string;
};

type PollGroupRow = {
  pollId: string;
  logs: LogRecord[];
  firstTimestamp: string;
  lastTimestamp: string;
  hasError: boolean;
  hasWarn: boolean;
  eventsProcessed?: number;
  retriesProcessed?: number;
};

type ActiveTab = 'app' | 'access' | 'process';

type ProcessLogLine = {
  lineNumber: number;
  text: string;
};

const extractPollId = (message?: string): string | null => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

const formatDuration = (start: string, end: string) => {
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '-';
  if (diffMs < 1000) return `${diffMs} ms`;
  const seconds = diffMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem.toFixed(0)}s`;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = value;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const filterLogsByStatus = (logs: LogRecord[], statusFilter: string) => {
  if (!statusFilter) return logs;
  if (statusFilter === 'error') return logs.filter((log) => log.level === 'error');
  if (statusFilter === 'warn') return logs.filter((log) => log.level === 'warn');
  if (statusFilter === 'ok') return logs.filter((log) => !['error', 'warn'].includes(log.level));
  return logs;
};

export default function SystemLogsRoute() {
  const { spacing, token, shadows, borderRadius, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [activeTab, setActiveTab] = useState<ActiveTab>('app');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [processTail, setProcessTail] = useState<ProcessLogTailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [errorCategoryFilter, setErrorCategoryFilter] = useState<string>('');
  const [pollIdFilter, setPollIdFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshCountdown, setRefreshCountdown] = useState<number>(5);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [serverStats, setServerStats] = useState<any>(null);
  const [processLineLimit, setProcessLineLimit] = useState<number>(200);

  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1],
      };

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter, activeTab]);

  useEffect(() => {
    if (activeTab !== 'app') {
      setPollIdFilter('');
    }
  }, [activeTab]);

  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 25,
    resetDeps: [activeTab, levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter],
  });

  const rawStats = useMemo(() => ({
    total: logs.length,
    error: logs.filter((log) => log.level === 'error').length,
    warn: logs.filter((log) => log.level === 'warn').length,
    info: logs.filter((log) => log.level === 'info').length,
    debug: logs.filter((log) => log.level === 'debug').length,
  }), [logs]);

  const pollGroups: PollGroupRow[] = useMemo(() => {
    const appLogs = logs.filter((log) => log.stream !== 'access');
    const groups: Record<string, PollGroupRow> = {};

    appLogs.forEach((log) => {
      const pollId = extractPollId(log.message) ?? 'NO_POLL';
      if (!groups[pollId]) {
        groups[pollId] = {
          pollId,
          logs: [],
          firstTimestamp: log.timestamp,
          lastTimestamp: log.timestamp,
          hasError: false,
          hasWarn: false,
          eventsProcessed: undefined,
          retriesProcessed: undefined,
        };
      }

      const group = groups[pollId];
      group.logs.push(log);
      if (log.timestamp < group.firstTimestamp) group.firstTimestamp = log.timestamp;
      if (log.timestamp > group.lastTimestamp) group.lastTimestamp = log.timestamp;
      if (log.level === 'error') group.hasError = true;
      if (log.level === 'warn') group.hasWarn = true;

      if (log.meta) {
        if (typeof log.meta.eventsProcessed === 'number') group.eventsProcessed = log.meta.eventsProcessed;
        if (typeof log.meta.retriesProcessed === 'number') group.retriesProcessed = log.meta.retriesProcessed;
      }
    });

    let filtered = Object.values(groups);
    if (statusFilter === 'error') filtered = filtered.filter((group) => group.hasError);
    if (statusFilter === 'warn') filtered = filtered.filter((group) => group.hasWarn && !group.hasError);
    if (statusFilter === 'ok') filtered = filtered.filter((group) => !group.hasError && !group.hasWarn);
    if (pollIdFilter) {
      filtered = filtered.filter((group) => group.pollId.toLowerCase().includes(pollIdFilter.toLowerCase()));
    }

    return filtered.sort(
      (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
    );
  }, [logs, pollIdFilter, statusFilter]);

  const pollStats = useMemo(() => ({
    total: pollGroups.length,
    withErrors: pollGroups.filter((group) => group.hasError).length,
    withWarnings: pollGroups.filter((group) => group.hasWarn && !group.hasError).length,
    healthy: pollGroups.filter((group) => !group.hasError && !group.hasWarn).length,
  }), [pollGroups]);

  const accessLogs = useMemo(() => filterLogsByStatus(logs, statusFilter), [logs, statusFilter]);

  const errorCategoryOptions = useMemo(() => {
    if (!serverStats?.errorCategories) return [];

    const categoryLabels: Record<string, string> = {
      ui_error: 'UI Error',
      api_error: 'API Error',
      validation_error: 'Validation Error',
      business_logic: 'Business Logic',
      unhandled: 'Unhandled',
      browser_error: 'Browser Error',
      http_4xx: 'HTTP 4xx',
      http_5xx: 'HTTP 5xx',
      network: 'Network',
      transform: 'Transform',
      ratelimit: 'Rate Limit',
      database: 'Database',
      other: 'Other',
      unknown: 'Unknown',
    };

    return Object.entries(serverStats.errorCategories)
      .filter(([, count]) => Number(count) > 0)
      .map(([category, count]) => ({
        value: category,
        label: `${categoryLabels[category] || category} (${count})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [serverStats]);

  const levelTone: Record<string, { bg: string; text: string; border: string; icon: ReactNode; dotColor: string }> = {
    error: {
      bg: withAlpha(colors.error[100], 1),
      text: colors.error[700],
      border: colors.error[300],
      icon: <BugOutlined />,
      dotColor: colors.error[600],
    },
    warn: {
      bg: withAlpha(colors.warning[100], 1),
      text: colors.warning[700],
      border: colors.warning[300],
      icon: <WarningOutlined />,
      dotColor: colors.warning[600],
    },
    info: {
      bg: withAlpha(colors.info[100], 1),
      text: colors.info[700],
      border: colors.info[300],
      icon: <InfoCircleOutlined />,
      dotColor: colors.info[600],
    },
    debug: {
      bg: withAlpha(colors.neutral[100], 1),
      text: cssVar.text.secondary,
      border: colors.neutral[200],
      icon: <ToolOutlined />,
      dotColor: colors.neutral[600],
    },
  };

  const hasActiveFilters = activeTab === 'process'
    ? false
    : !!(levelFilter || searchFilter || statusFilter || errorCategoryFilter || (activeTab === 'app' && pollIdFilter));

  const fetchLogs = async ({ silent = false, manual = false }: { silent?: boolean; manual?: boolean } = {}) => {
    if (activeTab === 'process') return;
    if (!silent) setLoading(true);
    if (manual) setManualRefreshPending(true);

    try {
      const response = await getSystemLogs({
        limit: 200,
        level: levelFilter || undefined,
        search: searchFilter || undefined,
        errorCategory: errorCategoryFilter || undefined,
        pollId: activeTab === 'app' && pollIdFilter ? pollIdFilter : undefined,
        source: activeTab,
      });
      setLogs(response.logs as LogRecord[]);
      setServerStats(response.stats || null);
      setLastRefresh(new Date());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch system logs';
      msgApi.error(errorMessage);
    } finally {
      if (!silent) setLoading(false);
      if (manual) setManualRefreshPending(false);
    }
  };

  const fetchProcessTail = async ({ silent = false, manual = false }: { silent?: boolean; manual?: boolean } = {}) => {
    if (!silent) setProcessLoading(true);
    if (manual) setManualRefreshPending(true);

    try {
      const response = await getSystemProcessLogTail({ lines: processLineLimit });
      setProcessTail(response);
      setLastRefresh(new Date());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch process output';
      msgApi.error(errorMessage);
    } finally {
      if (!silent) setProcessLoading(false);
      if (manual) setManualRefreshPending(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'process') {
      fetchLogs();
    }
  }, [activeTab, levelFilter, searchFilter, errorCategoryFilter, pollIdFilter]);

  useEffect(() => {
    if (activeTab === 'process') {
      fetchProcessTail();
    }
  }, [activeTab, processLineLimit]);

  useEffect(() => {
    if (!autoRefresh) return;

    const refreshSeconds = 5;
    const updateCountdown = () => {
      const elapsedMs = Date.now() - lastRefresh.getTime();
      const remainingSeconds = Math.max(0, Math.ceil((refreshSeconds * 1000 - elapsedMs) / 1000));
      setRefreshCountdown(remainingSeconds > 0 ? remainingSeconds : 0);
    };

    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 1000);
    const interval = setInterval(() => {
      if (activeTab === 'process') {
        fetchProcessTail({ silent: true });
      } else {
        fetchLogs({ silent: true });
        setSelectedRowKeys([]);
      }
    }, refreshSeconds * 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdownInterval);
    };
  }, [autoRefresh, activeTab, levelFilter, searchFilter, errorCategoryFilter, pollIdFilter, processLineLimit, lastRefresh]);

  useEffect(() => {
    if (!autoRefresh) setRefreshCountdown(5);
  }, [autoRefresh]);

  const handleQuickStatusFilter = (status: 'error' | 'warn' | 'ok' | '') => {
    setStatusFilter((current) => (current === status ? '' : status));
    setSelectedRowKeys([]);
  };

  const handleClearFilters = () => {
    setLevelFilter('');
    setSearchFilter('');
    setStatusFilter('');
    setErrorCategoryFilter('');
    setPollIdFilter('');
    setSelectedRowKeys([]);
  };

  const createExportProgress = (label: string) => {
    const key = `export-${Date.now()}`;
    const startedAt = Date.now();
    msgApi.open({ key, type: 'loading', content: `${label}: queued`, duration: 0 });

    const formatEta = (processed: number, total: number) => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || processed <= 0 || total <= processed) return '';
      const rate = processed / elapsedSec;
      if (!Number.isFinite(rate) || rate <= 0) return '';
      const remainingSec = Math.max(0, Math.round((total - processed) / rate));
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      return mins <= 0 ? `${secs}s` : `${mins}m ${secs}s`;
    };

    const onProgress = (progress: { status: string; processedRecords?: number; totalRecords?: number; fileSizeBytes?: number }) => {
      const total = progress.totalRecords ?? 0;
      const processed = progress.processedRecords ?? 0;
      const statusLabel = progress.status === 'PROCESSING'
        ? 'Processing'
        : progress.status === 'COMPLETED'
          ? 'Finalizing'
          : progress.status === 'FAILED'
            ? 'Failed'
            : 'Queued';
      const countLabel = total > 0 ? `${processed}/${total}` : processed > 0 ? `${processed}` : '';
      const sizeLabel = progress.fileSizeBytes ? formatBytes(progress.fileSizeBytes) : '';
      const etaLabel = formatEta(processed, total);
      const extraLabel = [sizeLabel && `size ${sizeLabel}`, etaLabel && `eta ${etaLabel}`].filter(Boolean).join(' · ');
      msgApi.open({
        key,
        type: 'loading',
        content: `${label}: ${statusLabel}${countLabel ? ` (${countLabel})` : ''}${extraLabel ? ` · ${extraLabel}` : ''}`,
        duration: 0,
      });
    };

    const finish = (message: string, isError = false) => {
      msgApi.open({ key, type: isError ? 'error' : 'success', content: message, duration: 2 });
    };

    return { onProgress, finish };
  };

  const handleExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json') => {
    if (exportLoading || activeTab === 'process') return;

    try {
      setExportLoading(true);
      const filters = {
        level: levelFilter || undefined,
        search: searchFilter || undefined,
        errorCategory: errorCategoryFilter || undefined,
        pollId: activeTab === 'app' && pollIdFilter ? pollIdFilter : undefined,
        source: activeTab,
      };
      const { onProgress, finish } = createExportProgress(`Export ${format.toUpperCase()}`);

      if (exportType === 'selected' && activeTab === 'app') {
        if (selectedRowKeys.length === 0) {
          msgApi.warning('Please select poll cycles to export');
          return;
        }
        const selectedPollIds = selectedRowKeys.map((key) => {
          const match = String(key).match(/^poll-(.+)-/);
          return match ? match[1] : null;
        }).filter(Boolean);
        const pollIdList = selectedPollIds.join(',');
        if (format === 'csv') {
          await exportSystemLogsToCsv({ ...filters, pollId: pollIdList }, { onProgress });
        } else {
          await exportSystemLogsToJson({ ...filters, pollId: pollIdList }, { onProgress });
        }
        finish(`Exported ${selectedRowKeys.length} poll cycle(s)`);
        return;
      }

      if (format === 'csv') {
        await exportSystemLogsToCsv(exportType === 'all' ? { source: activeTab } : filters, { onProgress });
      } else {
        await exportSystemLogsToJson(exportType === 'all' ? { source: activeTab } : filters, { onProgress });
      }
      const count = activeTab === 'app'
        ? (exportType === 'filtered' && hasActiveFilters ? pollGroups.length : logs.length)
        : accessLogs.length;
      finish(`Exported ${count} log(s)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const handleClearAll = () => {
    modal.confirm({
      title: 'Clear current log files',
      content: 'This archives and truncates the current app/access log files. Rotated historical files are not deleted. Continue?',
      okText: 'Clear Logs',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await clearSystemLogs();
          msgApi.success('Current log files cleared and archived');
          setSelectedRowKeys([]);
          if (activeTab === 'process') {
            await fetchProcessTail();
          } else {
            await fetchLogs();
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to clear logs';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const handleDownloadPollCycle = async (group: PollGroupRow) => {
    try {
      setExportLoading(true);
      const { onProgress, finish } = createExportProgress('Download JSON');
      await exportSystemLogsToJson({ pollId: group.pollId, source: 'app' }, { onProgress });
      finish(`Downloaded poll cycle ${group.pollId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to download poll cycle';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const appColumns = [
    {
      title: 'Poll',
      dataIndex: 'pollId',
      key: 'pollId',
      width: 180,
      sorter: (a: PollGroupRow, b: PollGroupRow) => (a.pollId || '').localeCompare(b.pollId || ''),
      render: (pollId: string, record: PollGroupRow) => {
        const label = pollId === 'NO_POLL' ? 'Ungrouped logs' : `POLL #${pollId}`;
        const statusTone = record.hasError ? levelTone.error : record.hasWarn ? levelTone.warn : levelTone.info;
        return (
          <Space direction="vertical" size={2}>
            <Tag
              icon={statusTone.icon}
              style={{
                borderRadius: borderRadius.full,
                fontSize: 12,
                padding: `${spacing['1']} ${spacing[2]}`,
                background: statusTone.bg,
                color: statusTone.text,
                borderColor: statusTone.border,
                fontWeight: 700,
                margin: 0,
              }}
            >
              {label}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
              {record.logs.length} step{record.logs.length > 1 ? 's' : ''}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'Time window',
      key: 'timeWindow',
      width: 260,
      sorter: (a: PollGroupRow, b: PollGroupRow) => new Date(a.firstTimestamp).getTime() - new Date(b.firstTimestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, record: PollGroupRow) => (
        <Space direction="vertical" size={2}>
          <Typography.Text style={{ fontSize: 13, color: cssVar.text.secondary }}>
            {formatDateTime(record.firstTimestamp)} → {formatDateTime(record.lastTimestamp)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
            Duration: {formatDuration(record.firstTimestamp, record.lastTimestamp)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Summary',
      key: 'summary',
      ellipsis: true,
      render: (_: unknown, record: PollGroupRow) => {
        const tone = record.hasError ? levelTone.error : record.hasWarn ? levelTone.warn : levelTone.info;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text strong style={{ fontSize: 13, color: cssVar.text.primary }}>
              {record.hasError ? 'Has errors' : record.hasWarn ? 'Warnings only' : 'OK'}
            </Typography.Text>
            <Space size={8} wrap>
              <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `0 ${spacing[2]}`, background: withAlpha(tone.bg, 0.9), color: tone.text, borderColor: tone.border, margin: 0 }}>
                {record.logs.filter((log) => log.level === 'error').length} error(s)
              </Tag>
              <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `0 ${spacing[2]}`, background: withAlpha(colors.warning[50], 1), color: colors.warning[700], borderColor: colors.warning[300], margin: 0 }}>
                {record.logs.filter((log) => log.level === 'warn').length} warning(s)
              </Tag>
              {typeof record.eventsProcessed === 'number' && (
                <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `0 ${spacing[2]}`, background: cssVar.bg.elevated, color: cssVar.text.secondary, borderColor: cssVar.border.default, margin: 0 }}>
                  events: {record.eventsProcessed}
                </Tag>
              )}
              {typeof record.retriesProcessed === 'number' && (
                <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `0 ${spacing[2]}`, background: cssVar.bg.elevated, color: cssVar.text.secondary, borderColor: cssVar.border.default, margin: 0 }}>
                  retries: {record.retriesProcessed}
                </Tag>
              )}
            </Space>
          </Space>
        );
      },
    },
  ];

  const rawAccessColumns = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 210,
      sorter: (a: LogRecord, b: LogRecord) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (value: string) => (
        <Typography.Text style={{ fontSize: 12, color: cssVar.text.secondary }}>
          {formatDateTime(value)}
        </Typography.Text>
      ),
    },
    {
      title: 'Level',
      dataIndex: 'level',
      key: 'level',
      width: 120,
      render: (level: string) => {
        const tone = levelTone[level] || levelTone.info;
        return (
          <Tag icon={tone.icon} style={{ borderRadius: borderRadius.full, background: tone.bg, color: tone.text, borderColor: tone.border, margin: 0 }}>
            {String(level).toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Request',
      key: 'request',
      render: (_: unknown, record: LogRecord) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: cssVar.text.primary }}>
            {record.meta?.method || 'REQUEST'} {record.meta?.url || record.message}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
            stream: {record.stream || 'access'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, record: LogRecord) => record.meta?.status ?? '—',
    },
    {
      title: 'Resp. Time',
      key: 'responseTimeMs',
      width: 120,
      render: (_: unknown, record: LogRecord) =>
        typeof record.meta?.responseTimeMs === 'number' ? `${record.meta.responseTimeMs} ms` : '—',
    },
  ];

  const renderExpandedRow = (group: PollGroupRow) => {
    const sorted = [...group.logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const startTime = new Date(sorted[0]?.timestamp).getTime();
    const getRelativeTime = (timestamp: string) => {
      const diffMs = new Date(timestamp).getTime() - startTime;
      if (diffMs < 1000) return `+${diffMs}ms`;
      return `+${(diffMs / 1000).toFixed(2)}s`;
    };

    return (
      <div style={{ padding: `${spacing[3]} ${spacing[5]}`, background: `linear-gradient(to right, ${withAlpha(cssVar.bg.base, 0.6)} 0%, ${withAlpha(cssVar.bg.subtle, 0.9)} 100%)` }}>
        <Card
          variant="outlined"
          style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${withAlpha(cssVar.border.default, 0.8)}`, boxShadow: shadows.sm }}
          styles={{ body: { padding: spacing[4] } }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] }}>
            <Typography.Text strong style={{ fontSize: 14, color: cssVar.text.primary }}>
              Poll Cycle Timeline
            </Typography.Text>
            <Space size={spacingToNumber(spacing[2])}>
              <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `2px ${spacing[2]}`, background: withAlpha(colors.info[50], 1), color: colors.info[700], borderColor: colors.info[200], margin: 0 }}>
                {sorted.length} event{sorted.length > 1 ? 's' : ''}
              </Tag>
              <Tag style={{ borderRadius: borderRadius.full, fontSize: 11, padding: `2px ${spacing[2]}`, background: cssVar.bg.elevated, color: cssVar.text.secondary, borderColor: cssVar.border.default, margin: 0 }}>
                {formatDuration(group.firstTimestamp, group.lastTimestamp)} duration
              </Tag>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadPollCycle(group)} disabled={exportLoading} style={{ borderRadius: borderRadius.full }}>
                Download JSON
              </Button>
            </Space>
          </div>

          <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
            {sorted.map((entry, index) => {
              const tone = levelTone[entry.level] || levelTone.info;
              return (
                <Card
                  key={`${entry.timestamp}-${index}`}
                  variant="outlined"
                  style={{ borderRadius: token.borderRadius, borderColor: withAlpha(tone.border, 0.4), background: `linear-gradient(135deg, ${cssVar.bg.surface} 0%, ${withAlpha(tone.bg, 0.3)} 100%)` }}
                  styles={{ body: { padding: spacing[3] } }}
                >
                  <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag icon={tone.icon} style={{ borderRadius: borderRadius.full, background: tone.bg, color: tone.text, borderColor: tone.border, margin: 0 }}>
                        {entry.level.toUpperCase()}
                      </Tag>
                      <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>{getRelativeTime(entry.timestamp)}</Tag>
                      {entry.errorCategory && <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>{entry.errorCategory}</Tag>}
                    </Space>
                    <Typography.Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: cssVar.text.primary }}>
                      {entry.message}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
                      {formatDateTime(entry.timestamp)}
                    </Typography.Text>
                    {entry.meta && Object.keys(entry.meta).length > 0 && (
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, background: cssVar.bg.elevated, border: `1px solid ${withAlpha(cssVar.border.default, 0.5)}`, borderRadius: token.borderRadiusSM, padding: spacing[2], overflowX: 'auto' }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: cssVar.text.secondary }}>{JSON.stringify(entry.meta, null, 2)}</pre>
                      </div>
                    )}
                  </Space>
                </Card>
              );
            })}
          </Space>
        </Card>
      </div>
    );
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (nextRowKeys: Key[]) => setSelectedRowKeys(nextRowKeys),
    selections: [
      {
        key: 'all',
        text: 'Select all poll cycles',
        onSelect: () => setSelectedRowKeys(pollGroups.map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)),
      },
      {
        key: 'errors',
        text: 'Select cycles with errors',
        onSelect: () => setSelectedRowKeys(
          pollGroups.filter((group) => group.hasError).map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)
        ),
      },
      {
        key: 'warnings',
        text: 'Select cycles with warnings',
        onSelect: () => setSelectedRowKeys(
          pollGroups.filter((group) => group.hasWarn && !group.hasError).map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)
        ),
      },
      {
        key: 'none',
        text: 'Clear selection',
        onSelect: () => setSelectedRowKeys([]),
      },
    ],
  };

  const pageDescription = activeTab === 'app'
    ? 'Monitor application logs, worker activity, and scheduler cycles.'
    : activeTab === 'access'
      ? 'Inspect rotated access logs from the backend request stream.'
      : 'Tail the process bootstrap output from nohup.out.';

  const statusChips = activeTab === 'process'
    ? [
        { label: processTail?.fileName || 'nohup.out' },
        { label: `${processTail?.returnedLines || 0} lines`, color: colors.primary[600] },
        { label: `Last refresh: ${lastRefresh.toLocaleTimeString()}`, color: colors.primary[600] },
      ]
    : [
        { label: `${logs.length} ${activeTab === 'app' ? 'raw logs' : 'access logs'}` },
        { label: activeTab === 'app' ? `${pollGroups.length} poll cycles` : `${serverStats?.byStream?.access ?? logs.length} access entries`, color: colors.primary[600] },
        { label: `Last refresh: ${lastRefresh.toLocaleTimeString()}`, color: colors.primary[600] },
      ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr auto', alignItems: isNarrow ? 'flex-start' : 'center', gap: spacing[3], rowGap: spacing[2], marginBottom: spacing[3] }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <PageHeader
            title="System logs"
            description={pageDescription}
            statusChips={statusChips}
            compact
            actions={
              activeTab === 'process' ? null : (
                <Space size={spacingToNumber(spacing[2])}>
                  <Dropdown
                    trigger={['click']}
                    disabled={exportLoading}
                    menu={{
                      items: [
                        { key: 'all-csv', label: 'Export all logs (CSV)', icon: <DownloadOutlined />, onClick: () => handleExport('all', 'csv'), disabled: exportLoading },
                        { key: 'all-json', label: 'Export all logs (JSON)', icon: <DownloadOutlined />, onClick: () => handleExport('all', 'json'), disabled: exportLoading },
                        { type: 'divider' as const },
                        { key: 'filtered-csv', label: 'Export filtered logs (CSV)', icon: <DownloadOutlined />, onClick: () => handleExport('filtered', 'csv'), disabled: !hasActiveFilters || exportLoading },
                        { key: 'filtered-json', label: 'Export filtered logs (JSON)', icon: <DownloadOutlined />, onClick: () => handleExport('filtered', 'json'), disabled: !hasActiveFilters || exportLoading },
                        ...(activeTab === 'app'
                          ? [
                              { type: 'divider' as const },
                              { key: 'selected-csv', label: `Export selected cycles (${selectedRowKeys.length}) CSV`, icon: <DownloadOutlined />, onClick: () => handleExport('selected', 'csv'), disabled: selectedRowKeys.length === 0 || exportLoading },
                              { key: 'selected-json', label: `Export selected cycles (${selectedRowKeys.length}) JSON`, icon: <DownloadOutlined />, onClick: () => handleExport('selected', 'json'), disabled: selectedRowKeys.length === 0 || exportLoading },
                            ]
                          : []),
                      ],
                    }}
                  >
                    <Button icon={<DownloadOutlined />} disabled={exportLoading} size="small">
                      Export logs
                    </Button>
                  </Dropdown>
                  <Button danger icon={<DeleteOutlined />} onClick={handleClearAll} disabled={exportLoading || loading} size="small">
                    Clear All
                  </Button>
                </Space>
              )
            }
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isNarrow ? 'flex-start' : 'flex-end', flexWrap: isNarrow ? 'wrap' : 'nowrap', gap: spacing['1.5'], padding: `${spacing['1.5']} ${spacing[3]}`, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}`, background: withAlpha(cssVar.bg.surface, 0.9) }}>
          <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>
            {autoRefresh ? `Auto-refresh in ${refreshCountdown}s` : 'Auto-refresh off'}
          </Typography.Text>
          <Switch checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />
          <Divider type="vertical" style={{ margin: 0 }} />
          <Button type={autoRefresh ? 'primary' : 'default'} icon={<ReloadOutlined />} onClick={() => setAutoRefresh(!autoRefresh)} size="small">
            {autoRefresh ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as ActiveTab)}
        items={[
          { key: 'app', label: 'Application Logs' },
          { key: 'access', label: 'Access Logs' },
          { key: 'process', label: 'Process Output' },
        ]}
        style={{ marginBottom: spacing[3] }}
      />

      {activeTab === 'process' ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], padding: `${spacing['1.5']} ${spacing[3]}`, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}`, background: cssVar.bg.surface, boxShadow: shadows.lg, marginBottom: spacing[3], alignItems: 'center' }}>
            <Select
              placeholder="Lines"
              size="small"
              value={processLineLimit}
              onChange={(value) => setProcessLineLimit(value)}
              style={{ minWidth: 140 }}
              options={[
                { value: 100, label: 'Last 100 lines' },
                { value: 200, label: 'Last 200 lines' },
                { value: 500, label: 'Last 500 lines' },
              ]}
            />
            <div style={{ display: 'flex', gap: spacing['1.5'], marginLeft: 'auto' }}>
              <Button icon={<ReloadOutlined />} onClick={() => fetchProcessTail({ manual: true, silent: true })} loading={manualRefreshPending} size="small">
                {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>

          {processTail?.truncated && (
            <Alert
              type="info"
              showIcon
              message="Showing the tail of nohup.out"
              description="The response is intentionally capped to the most recent lines so the page stays fast."
              style={{ marginBottom: spacing[3] }}
            />
          )}

          <Card variant="outlined" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}`, boxShadow: shadows.xl }} styles={{ body: { padding: spacing[4] } }}>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              <Space wrap>
                <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>{processTail?.fileName || 'nohup.out'}</Tag>
                <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>{processTail?.returnedLines || 0} lines</Tag>
                <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>{formatBytes(processTail?.sizeBytes || 0)}</Tag>
                <Tag style={{ borderRadius: borderRadius.full, margin: 0 }}>
                  {processTail?.updatedAt ? `Updated ${formatDateTime(processTail.updatedAt)}` : 'No process log found'}
                </Tag>
              </Space>

              {!processTail?.fileExists ? (
                <div style={{ padding: spacing[6], textAlign: 'center' }}>
                  <InfoCircleOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                  <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                    No nohup.out file found
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>
                    The process output file does not exist at the configured path.
                  </Typography.Text>
                </div>
              ) : (
                <div style={{ maxHeight: 720, overflow: 'auto', borderRadius: token.borderRadius, border: `1px solid ${cssVar.border.default}`, background: '#0d1117', color: '#c9d1d9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.6, padding: spacing[3] }}>
                  {(processTail.lines || []).map((line: ProcessLogLine) => (
                    <div key={`${line.lineNumber}-${line.text.slice(0, 20)}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: spacing[2] }}>
                      <span style={{ color: '#8b949e', textAlign: 'right' }}>{line.lineNumber}</span>
                      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </Space>
          </Card>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing[3], marginBottom: spacing[4] }}>
            {(activeTab === 'app'
              ? [
                  { title: 'Poll Cycles', value: pollStats.total, subtitle: `${rawStats.total} raw logs`, tone: cssVar.text.secondary, icon: <SearchOutlined style={{ color: cssVar.text.secondary }} />, filter: '' as const },
                  { title: 'With Errors', value: pollStats.withErrors, subtitle: `${rawStats.error} error logs`, tone: colors.error[600], icon: <BugOutlined style={{ color: colors.error[500] }} />, filter: 'error' as const },
                  { title: 'With Warnings', value: pollStats.withWarnings, subtitle: `${rawStats.warn} warning logs`, tone: colors.warning[600], icon: <WarningOutlined style={{ color: colors.warning[500] }} />, filter: 'warn' as const },
                  { title: 'Healthy', value: pollStats.healthy, subtitle: 'No issues', tone: colors.success[600], icon: <InfoCircleOutlined style={{ color: colors.success[500] }} />, filter: 'ok' as const },
                ]
              : [
                  { title: 'Access Entries', value: accessLogs.length, subtitle: `${serverStats?.byStream?.access ?? accessLogs.length} in period`, tone: cssVar.text.secondary, icon: <SearchOutlined style={{ color: cssVar.text.secondary }} />, filter: '' as const },
                  { title: '5xx / Errors', value: rawStats.error, subtitle: 'Server-side request failures', tone: colors.error[600], icon: <BugOutlined style={{ color: colors.error[500] }} />, filter: 'error' as const },
                  { title: '4xx / Warnings', value: rawStats.warn, subtitle: 'Client/request warnings', tone: colors.warning[600], icon: <WarningOutlined style={{ color: colors.warning[500] }} />, filter: 'warn' as const },
                  { title: 'Informational', value: rawStats.info, subtitle: '2xx/3xx and normal traffic', tone: colors.success[600], icon: <InfoCircleOutlined style={{ color: colors.success[500] }} />, filter: 'ok' as const },
                ]).map((item) => (
              <Card
                key={item.title}
                variant="outlined"
                hoverable={item.filter !== ''}
                onClick={() => item.filter && handleQuickStatusFilter(item.filter)}
                style={{
                  padding: spacing[3],
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${withAlpha(item.tone, statusFilter === item.filter && item.filter ? 0.5 : 0.15)}`,
                  boxShadow: statusFilter === item.filter && item.filter ? shadows.lg : shadows.xl,
                  cursor: item.filter ? 'pointer' : 'default',
                  transition: transitions.all,
                  background: statusFilter === item.filter && item.filter ? withAlpha(item.tone, 0.05) : cssVar.bg.surface,
                }}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}>
                      {item.title}
                    </Typography.Text>
                    <Typography.Title level={3} style={{ margin: 0, color: item.tone }}>
                      {item.value}
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
                      {item.subtitle}
                    </Typography.Text>
                  </div>
                  <div style={{ width: spacing[7], height: spacing[7], borderRadius: token.borderRadiusLG, background: withAlpha(item.tone, 0.1), display: 'grid', placeItems: 'center' }}>
                    {item.icon}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {activeTab === 'app' && selectedRowKeys.length > 0 && (
            <Card style={{ borderRadius: token.borderRadiusLG, marginBottom: spacing[3], borderColor: colors.primary[300], background: withAlpha(colors.primary[50], 0.5) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] }}>
                <div>
                  <Typography.Text strong style={{ marginRight: spacing[2] }}>
                    {selectedRowKeys.length} poll cycle(s) selected
                  </Typography.Text>
                  <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                    Clear selection
                  </Button>
                </div>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport('selected', 'json')}>
                  Export Selected (JSON)
                </Button>
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], padding: `${spacing['1.5']} ${spacing[3]}`, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}`, background: cssVar.bg.surface, boxShadow: shadows.lg, marginBottom: spacing[2], alignItems: 'center' }}>
            <Select
              placeholder="Status"
              style={{ minWidth: 140, flex: isNarrow ? '1 1 auto' : '0 0 160px' }}
              allowClear
              size="small"
              value={statusFilter || undefined}
              onChange={(value) => setStatusFilter(value || '')}
              options={[
                { value: 'error', label: activeTab === 'access' ? '5xx / Errors' : 'With Errors' },
                { value: 'warn', label: activeTab === 'access' ? '4xx / Warnings' : 'With Warnings' },
                { value: 'ok', label: activeTab === 'access' ? 'Informational' : 'Healthy' },
              ]}
            />
            <Select
              placeholder="Log Level"
              style={{ minWidth: 130, flex: isNarrow ? '1 1 auto' : '0 0 150px' }}
              allowClear
              size="small"
              value={levelFilter || undefined}
              onChange={(value) => setLevelFilter(value || '')}
              options={[
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warning' },
                { value: 'error', label: 'Error' },
                { value: 'debug', label: 'Debug' },
              ]}
            />
            <Select
              placeholder="Error Category"
              style={{ minWidth: 160, flex: isNarrow ? '1 1 auto' : '0 0 200px' }}
              allowClear
              size="small"
              value={errorCategoryFilter || undefined}
              onChange={(value) => setErrorCategoryFilter(value || '')}
              options={errorCategoryOptions}
              loading={loading && errorCategoryOptions.length === 0}
              disabled={errorCategoryOptions.length === 0}
              notFoundContent={errorCategoryOptions.length === 0 ? 'No error categories' : 'No matches'}
            />
            {activeTab === 'app' && (
              <Input
                placeholder="Poll ID (e.g., 1252)"
                allowClear
                size="small"
                value={pollIdFilter}
                onChange={(event) => setPollIdFilter(event.target.value)}
                style={{ minWidth: 140, flex: isNarrow ? '1 1 auto' : '0 0 180px' }}
                prefix={<SearchOutlined style={{ color: cssVar.text.muted }} />}
              />
            )}
            <Input
              placeholder={activeTab === 'app' ? 'Search messages...' : 'Search URL, method, or message...'}
              allowClear
              size="small"
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
              style={{ minWidth: 180, flex: '1 1 240px' }}
              prefix={<SearchOutlined style={{ color: cssVar.text.muted }} />}
            />
            <div style={{ display: 'flex', gap: spacing['1.5'], marginLeft: isNarrow ? 0 : 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              {hasActiveFilters && (
                <Button size="small" onClick={handleClearFilters} icon={<ClearOutlined />}>
                  Clear Filters
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={() => fetchLogs({ manual: true, silent: true })} loading={manualRefreshPending} size="small">
                {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>

          <div className="full-bleed-table" style={tableFullBleedStyle}>
            <Card className="panel" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}`, boxShadow: shadows.xl }} styles={{ body: { padding: 0 } }}>
              {activeTab === 'app' ? (
                <ModernTable<PollGroupRow>
                  columns={appColumns}
                  dataSource={pollGroups}
                  rowKey={(record) => `poll-${record.pollId}-${record.firstTimestamp}`}
                  rowSelection={rowSelection}
                  loading={loading}
                  size="small"
                  enableResize={true}
                  stickyHeader={true}
                  pagination={{ ...getPaginationConfig(pollGroups.length), showTotal: (total) => `${total} poll cycle${total === 1 ? '' : 's'}` }}
                  expandable={{ expandedRowRender: (record) => renderExpandedRow(record), rowExpandable: (record) => record.logs.length > 0 }}
                  locale={{
                    emptyText: hasActiveFilters ? (
                      <div style={{ padding: spacing[6], textAlign: 'center' }}>
                        <InfoCircleOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                        <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                          No poll cycles match your filters
                        </Typography.Title>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                          Try adjusting or clearing your filters to see more results.
                        </Typography.Text>
                        <Button onClick={handleClearFilters} icon={<ClearOutlined />}>
                          Clear All Filters
                        </Button>
                      </div>
                    ) : (
                      <div style={{ padding: spacing[6], textAlign: 'center' }}>
                        <SearchOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                        <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                          No application logs found
                        </Typography.Title>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                          Worker, scheduler, and backend logs from the last 24 hours will appear here.
                        </Typography.Text>
                        <Button onClick={() => fetchLogs({ manual: true, silent: true })} icon={<ReloadOutlined />}>
                          Refresh Logs
                        </Button>
                      </div>
                    ),
                  }}
                />
              ) : (
                <ModernTable<LogRecord>
                  columns={rawAccessColumns}
                  dataSource={accessLogs}
                  rowKey={(record) => `${record.timestamp}-${record.message}`}
                  loading={loading}
                  size="small"
                  enableResize={true}
                  stickyHeader={true}
                  pagination={{ ...getPaginationConfig(accessLogs.length), showTotal: (total) => `${total} access log${total === 1 ? '' : 's'}` }}
                  locale={{
                    emptyText: hasActiveFilters ? (
                      <div style={{ padding: spacing[6], textAlign: 'center' }}>
                        <InfoCircleOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                        <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                          No access logs match your filters
                        </Typography.Title>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                          Adjust the request filters or clear them to widen the view.
                        </Typography.Text>
                        <Button onClick={handleClearFilters} icon={<ClearOutlined />}>
                          Clear All Filters
                        </Button>
                      </div>
                    ) : (
                      <div style={{ padding: spacing[6], textAlign: 'center' }}>
                        <SearchOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                        <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                          No access logs found
                        </Typography.Title>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                          Recent rotated access logs will appear here.
                        </Typography.Text>
                        <Button onClick={() => fetchLogs({ manual: true, silent: true })} icon={<ReloadOutlined />}>
                          Refresh Logs
                        </Button>
                      </div>
                    ),
                  }}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
