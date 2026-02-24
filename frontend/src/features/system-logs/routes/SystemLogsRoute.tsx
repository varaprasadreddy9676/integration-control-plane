import { useState, useEffect, useMemo } from 'react';
import { App, Card, Select, Input, Button, Tag, Typography, Space, Row, Col, Statistic, Switch, Divider, Grid, Dropdown, Modal } from 'antd';
import { ReloadOutlined, SearchOutlined, BugOutlined, WarningOutlined, InfoCircleOutlined, ToolOutlined, DownloadOutlined, DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import { PageHeader } from '../../../components/common/PageHeader';
import { FilterBar } from '../../../components/common/FilterBar';
import { ModernTable } from '../../../components/common/ModernTable';
import { getSystemLogs, type SystemLog, exportSystemLogsToJson, exportSystemLogsToCsv, clearSystemLogs } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';

type LogRecord = SystemLog & {
  meta?: Record<string, any>;
  errorCategory?: string | null;
}; // just to be explicit

// NEW: grouped row type
type PollGroupRow = {
  pollId: string; // "1252" or "NO_POLL"
  logs: LogRecord[];
  firstTimestamp: string;
  lastTimestamp: string;
  hasError: boolean;
  hasWarn: boolean;
  eventsProcessed?: number;
  retriesProcessed?: number;
};

export default function SystemLogsRoute() {
  const { spacing, token, shadows, borderRadius, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1]
      };
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>(''); // 'error', 'warn', 'ok'
  const [errorCategoryFilter, setErrorCategoryFilter] = useState<string>(''); // error category filter
  const [pollIdFilter, setPollIdFilter] = useState<string>(''); // filter by specific poll ID
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [serverStats, setServerStats] = useState<any>(null);

  // Clear selection when filters change to prevent data corruption
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter]);

  // Pagination with auto-reset on filter changes
  // NOTE: Backend doesn't support server-side pagination yet (no page/offset params)
  // This uses client-side pagination on loaded records
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 25,
    resetDeps: [levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter]
  });

  const stats = useMemo(() => {
    return {
      total: logs.length,
      error: logs.filter(l => l.level === 'error').length,
      warn: logs.filter(l => l.level === 'warn').length,
      info: logs.filter(l => l.level === 'info').length,
      debug: logs.filter(l => l.level === 'debug').length
    };
  }, [logs]);

  // NEW: extract poll id from message like "[POLL #1252] ..."
  const extractPollId = (message?: string): string | null => {
    if (!message) return null;
    const match = message.match(/\[POLL\s*#(\d+)\]/i);
    return match ? match[1] : null;
  };

  // NEW: group logs by poll id
  const pollGroups: PollGroupRow[] = useMemo(() => {
    const groups: Record<string, PollGroupRow> = {};

    logs.forEach((log) => {
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
          retriesProcessed: undefined
        };
      }

      const group = groups[pollId];
      group.logs.push(log);

      if (log.timestamp < group.firstTimestamp) {
        group.firstTimestamp = log.timestamp;
      }
      if (log.timestamp > group.lastTimestamp) {
        group.lastTimestamp = log.timestamp;
      }

      if (log.level === 'error') group.hasError = true;
      if (log.level === 'warn') group.hasWarn = true;

      if (log.meta) {
        if (typeof log.meta.eventsProcessed === 'number') {
          group.eventsProcessed = log.meta.eventsProcessed;
        }
        if (typeof log.meta.retriesProcessed === 'number') {
          group.retriesProcessed = log.meta.retriesProcessed;
        }
      }
    });

    // sort groups by last timestamp desc (most recent first)
    let filtered = Object.values(groups);

    // Apply status filter
    if (statusFilter === 'error') {
      filtered = filtered.filter(g => g.hasError);
    } else if (statusFilter === 'warn') {
      filtered = filtered.filter(g => g.hasWarn && !g.hasError);
    } else if (statusFilter === 'ok') {
      filtered = filtered.filter(g => !g.hasError && !g.hasWarn);
    }

    // Apply poll ID filter
    if (pollIdFilter) {
      filtered = filtered.filter(g =>
        g.pollId.toLowerCase().includes(pollIdFilter.toLowerCase())
      );
    }

    return filtered.sort(
      (a, b) =>
        new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
    );
  }, [logs, statusFilter, pollIdFilter]);

  const pollStats = useMemo(() => {
    return {
      total: pollGroups.length,
      withErrors: pollGroups.filter(g => g.hasError).length,
      withWarnings: pollGroups.filter(g => g.hasWarn && !g.hasError).length,
      healthy: pollGroups.filter(g => !g.hasError && !g.hasWarn).length
    };
  }, [pollGroups]);

  // Dynamically build error category options from server stats
  const errorCategoryOptions = useMemo(() => {
    if (!serverStats?.errorCategories) {
      return [];
    }

    const categoryLabels: Record<string, string> = {
      // Frontend-sent categories
      ui_error: 'UI Error',
      api_error: 'API Error',
      validation_error: 'Validation Error',
      business_logic: 'Business Logic',
      unhandled: 'Unhandled',

      // Inferred categories
      browser_error: 'Browser Error',
      http_4xx: 'HTTP 4xx',
      http_5xx: 'HTTP 5xx',
      network: 'Network',
      transform: 'Transform',
      ratelimit: 'Rate Limit',
      database: 'Database',

      // Catch-all
      other: 'Other',
      unknown: 'Unknown'
    };

    return Object.entries(serverStats.errorCategories)
      .filter(([_, count]) => (count as number) > 0) // Only show categories with errors
      .map(([category, count]) => ({
        value: category,
        label: `${categoryLabels[category] || category} (${count as number})`
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [serverStats]);

  // NEW: helper to format duration between first/last timestamp
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

  // Quick filter handlers
  const handleQuickStatusFilter = (status: 'error' | 'warn' | 'ok' | '') => {
    setStatusFilter(statusFilter === status ? '' : status);
    setSelectedRowKeys([]); // Clear selection when filtering
  };

  const hasActiveFilters = !!(levelFilter || searchFilter || statusFilter || errorCategoryFilter || pollIdFilter);

  const handleClearFilters = () => {
    setLevelFilter('');
    setSearchFilter('');
    setStatusFilter('');
    setErrorCategoryFilter('');
    setPollIdFilter('');
    setSelectedRowKeys([]);
  };

  // Export handler with format and scope (SERVER-SIDE ONLY)
  const handleExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json') => {
    if (exportLoading) return;

    try {
      setExportLoading(true);

      const filters = {
        level: levelFilter || undefined,
        search: searchFilter || undefined,
        errorCategory: errorCategoryFilter || undefined,
        pollId: pollIdFilter || undefined
      };
      const { onProgress, finish } = createExportProgress(`Export ${format.toUpperCase()}`);

      if (exportType === 'selected') {
        if (selectedRowKeys.length === 0) {
          msgApi.warning('Please select poll cycles to export');
          return;
        }
        // Extract poll IDs from selected row keys
        const selectedPollIds = selectedRowKeys.map(key => {
          const match = String(key).match(/^poll-(.+)-/);
          return match ? match[1] : null;
        }).filter(Boolean);

        // Server-side export with poll ID filter
        const pollIdList = selectedPollIds.join(',');
        if (format === 'csv') {
          await exportSystemLogsToCsv({ ...filters, pollId: pollIdList }, { onProgress });
        } else {
          await exportSystemLogsToJson({ ...filters, pollId: pollIdList }, { onProgress });
        }
        finish(`Exported ${selectedRowKeys.length} poll cycle(s)`);
      } else {
        // For all/filtered, use backend export
        if (format === 'csv') {
          await exportSystemLogsToCsv(exportType === 'all' ? {} : filters, { onProgress });
        } else {
          await exportSystemLogsToJson(exportType === 'all' ? {} : filters, { onProgress });
        }
        const count = exportType === 'filtered' && hasActiveFilters ? pollGroups.length : logs.length;
        finish(`Exported ${count} log(s)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  // Clear all system logs with confirmation
  const handleClearAll = () => {
    modal.confirm({
      title: 'Clear All System Logs',
      content: 'This will archive the current logs and clear the log file. This action cannot be undone. Continue?',
      okText: 'Clear All Logs',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await clearSystemLogs();
          msgApi.success('System logs cleared and archived successfully');
          setSelectedRowKeys([]);
          await fetchLogs();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to clear logs';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  // Download individual poll cycle as JSON (server-side)
  const handleDownloadPollCycle = async (group: PollGroupRow) => {
    try {
      setExportLoading(true);
      const { onProgress, finish } = createExportProgress('Download JSON');
      // Use server-side export with specific poll ID
      await exportSystemLogsToJson({ pollId: group.pollId }, { onProgress });
      finish(`Downloaded poll cycle ${group.pollId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to download poll cycle';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // TODO: Backend should support server-side pagination (page/offset params)
      // For now, using client-side pagination with 100 record limit
      const params: any = { limit: 100 };
      if (levelFilter) params.level = levelFilter;
      if (searchFilter) params.search = searchFilter;
      if (errorCategoryFilter) params.errorCategory = errorCategoryFilter;

      const response = await getSystemLogs(params);
      setLogs(response.logs);
      setServerStats(response.stats || null); // Save server stats including error categories
      setLastRefresh(new Date());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch system logs';
      msgApi.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const createExportProgress = (label: string) => {
    const key = `export-${Date.now()}`;
    const startedAt = Date.now();
    msgApi.open({ key, type: 'loading', content: `${label}: queued`, duration: 0 });

    const formatBytes = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return '';
      const units = ['B', 'KB', 'MB', 'GB'];
      let idx = 0;
      let size = value;
      while (size >= 1024 && idx < units.length - 1) {
        size /= 1024;
        idx += 1;
      }
      return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
    };

    const formatEta = (processed: number, total: number) => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || processed <= 0 || total <= processed) {
        return '';
      }
      const rate = processed / elapsedSec;
      if (!Number.isFinite(rate) || rate <= 0) return '';
      const remainingSec = Math.max(0, Math.round((total - processed) / rate));
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      if (mins <= 0) return `${secs}s`;
      return `${mins}m ${secs}s`;
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
      const etaDisplay = !etaLabel && sizeLabel ? 'eta unknown' : etaLabel ? `eta ${etaLabel}` : '';
      const extraLabel = [sizeLabel && `size ${sizeLabel}`, etaDisplay].filter(Boolean).join(' · ');
      msgApi.open({
        key,
        type: 'loading',
        content: `${label}: ${statusLabel}${countLabel ? ` (${countLabel})` : ''}${extraLabel ? ` · ${extraLabel}` : ''}`,
        duration: 0
      });
    };

    const finish = (message: string, isError = false) => {
      msgApi.open({ key, type: isError ? 'error' : 'success', content: message, duration: 2 });
    };

    return { onProgress, finish };
  };

  useEffect(() => {
    fetchLogs();
  }, [levelFilter, searchFilter, errorCategoryFilter]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchLogs();
      // Clear selection on auto-refresh to prevent data corruption
      setSelectedRowKeys([]);
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, levelFilter, searchFilter]);

  const levelTone: Record<string, { bg: string; text: string; border: string; icon: any; dotColor: string }> = {
    error: {
      bg: withAlpha(colors.error[100], 1),
      text: colors.error[700],
      border: colors.error[300],
      icon: <BugOutlined />,
      dotColor: colors.error[600]
    },
    warn: {
      bg: withAlpha(colors.warning[100], 1),
      text: colors.warning[700],
      border: colors.warning[300],
      icon: <WarningOutlined />,
      dotColor: colors.warning[600]
    },
    info: {
      bg: withAlpha(colors.info[100], 1),
      text: colors.info[700],
      border: colors.info[300],
      icon: <InfoCircleOutlined />,
      dotColor: colors.info[600]
    },
    debug: {
      bg: withAlpha(colors.neutral[100], 1),
      text: cssVar.text.secondary,
      border: colors.neutral[200],
      icon: <ToolOutlined />,
      dotColor: colors.neutral[600]
    }
  };

  // CHANGED: expanded row now shows all logs inside that poll group
  const renderExpandedRow = (group: PollGroupRow) => {
    const sorted = [...group.logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const startTime = new Date(sorted[0]?.timestamp).getTime();

    // Calculate relative time from poll start
    const getRelativeTime = (timestamp: string) => {
      const diffMs = new Date(timestamp).getTime() - startTime;
      if (diffMs < 1000) return `+${diffMs}ms`;
      const seconds = (diffMs / 1000).toFixed(2);
      return `+${seconds}s`;
    };

    return (
      <div
        style={{
          padding: `${spacing[3]} ${spacing[5]}`,
          background: `linear-gradient(to right, ${withAlpha(cssVar.bg.base, 0.6)} 0%, ${withAlpha(cssVar.bg.subtle, 0.9)} 100%)`
        }}
      >
        <Card
          bordered
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${withAlpha(cssVar.border.default, 0.8)}`,
            boxShadow: shadows.sm
          }}
          bodyStyle={{ padding: spacing[4] }}
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
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleDownloadPollCycle(group)}
                disabled={exportLoading}
                style={{ borderRadius: borderRadius.full }}
              >
                Download JSON
              </Button>
            </Space>
          </div>

          <div style={{ position: 'relative' }}>
            {/* Timeline vertical line */}
            <div
              style={{
                position: 'absolute',
                left: 80,
                top: 16,
                bottom: 16,
                width: 2,
                background: `linear-gradient(to bottom, ${colors.primary[200]} 0%, ${colors.neutral[200]} 100%)`,
                borderRadius: 2
              }}
            />

            <Space
              direction="vertical"
              size={spacingToNumber(spacing[3])}
              style={{ width: '100%', position: 'relative' }}
            >
              {sorted.map((log, idx) => {
                const tone = levelTone[log.level] ?? levelTone.info;
                const hasMeta = log.meta && Object.keys(log.meta).length > 0;
                const isFirst = idx === 0;
                const isLast = idx === sorted.length - 1;

                return (
                  <div
                    key={`${log.timestamp}-${idx}`}
                    style={{
                      position: 'relative',
                      paddingLeft: 100,
                      display: 'flex',
                      gap: spacing[3],
                      alignItems: 'flex-start'
                    }}
                  >
                    {/* Timeline dot */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 72,
                        top: 6,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: isFirst ? colors.success[500] : isLast ? colors.primary[500] : tone.dotColor,
                        border: `3px solid ${cssVar.bg.surface}`,
                        boxShadow: `0 0 0 2px ${withAlpha(tone.dotColor, 0.2)}`,
                        zIndex: 1
                      }}
                    />

                    {/* Relative time badge */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 4,
                        minWidth: 60,
                        textAlign: 'right'
                      }}
                    >
                      <Typography.Text
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 11,
                          color: cssVar.text.secondary,
                          fontWeight: 600
                        }}
                      >
                        {getRelativeTime(log.timestamp)}
                      </Typography.Text>
                    </div>

                    {/* Log content */}
                    <div
                      style={{
                        flex: 1,
                        padding: spacing[3],
                        borderRadius: token.borderRadius,
                        border: `1px solid ${withAlpha(tone.border, 0.3)}`,
                        background: `linear-gradient(135deg, ${cssVar.bg.surface} 0%, ${withAlpha(tone.bg, 0.3)} 100%)`,
                        transition: transitions.all
                      }}
                    >
                      <div style={{ display: 'flex', gap: spacing[2], alignItems: 'flex-start', marginBottom: hasMeta ? spacing[2] : 0 }}>
                        <div style={{ display: 'flex', gap: spacing[1], flexWrap: 'wrap' }}>
                          <Tag
                            icon={tone.icon}
                            style={{
                              borderRadius: borderRadius.full,
                              fontSize: 11,
                              padding: `${spacing['0.5']} ${spacing[2]}`,
                              background: tone.bg,
                              color: tone.text,
                              borderColor: tone.border,
                              fontWeight: 600,
                              margin: 0
                            }}
                          >
                            {log.level.toUpperCase()}
                          </Tag>
                          {/* Source badge (browser vs server) */}
                          {(log.meta?.source || (log as any).source) && (
                            <Tag
                              style={{
                                borderRadius: borderRadius.full,
                                fontSize: 10,
                                padding: `${spacing['0.5']} ${spacing[1.5]}`,
                                background: (log.meta?.source || (log as any).source) === 'browser'
                                  ? withAlpha(colors.info[500], 0.1)
                                  : withAlpha(colors.primary[500], 0.1),
                                color: (log.meta?.source || (log as any).source) === 'browser'
                                  ? colors.info[700]
                                  : colors.primary[700],
                                borderColor: (log.meta?.source || (log as any).source) === 'browser'
                                  ? withAlpha(colors.info[500], 0.3)
                                  : withAlpha(colors.primary[500], 0.3),
                                fontWeight: 600,
                                margin: 0,
                                textTransform: 'uppercase'
                              }}
                            >
                              {log.meta?.source || (log as any).source}
                            </Tag>
                          )}
                          {/* Category badge (ui_error, api_error, etc.) */}
                          {(log.meta?.category || (log as any).category || log.errorCategory) && (
                            <Tag
                              style={{
                                borderRadius: borderRadius.full,
                                fontSize: 10,
                                padding: `${spacing['0.5']} ${spacing[1.5]}`,
                                background:
                                  (log.meta?.category || (log as any).category) === 'ui_error' ? withAlpha(colors.error[500], 0.1) :
                                  (log.meta?.category || (log as any).category) === 'api_error' ? withAlpha(colors.warning[500], 0.1) :
                                  (log.meta?.category || (log as any).category) === 'validation_error' ? withAlpha(colors.warning[500], 0.1) :
                                  (log.meta?.category || (log as any).category) === 'business_logic' ? withAlpha(colors.info[500], 0.1) :
                                  (log.meta?.category || (log as any).category) === 'unhandled' ? withAlpha(colors.error[600], 0.1) :
                                  // Legacy categories
                                  log.errorCategory === 'client' ? withAlpha(colors.info[500], 0.1) :
                                  log.errorCategory === 'server' ? withAlpha(colors.error[500], 0.1) :
                                  log.errorCategory === 'transform' ? withAlpha(colors.warning[500], 0.1) :
                                  log.errorCategory === 'ratelimit' ? withAlpha(colors.warning[500], 0.1) :
                                  log.errorCategory === 'database' ? withAlpha(colors.error[600], 0.1) :
                                  withAlpha(colors.neutral[500], 0.1),
                                color:
                                  (log.meta?.category || (log as any).category) === 'ui_error' ? colors.error[700] :
                                  (log.meta?.category || (log as any).category) === 'api_error' ? colors.warning[700] :
                                  (log.meta?.category || (log as any).category) === 'validation_error' ? colors.warning[700] :
                                  (log.meta?.category || (log as any).category) === 'business_logic' ? colors.info[700] :
                                  (log.meta?.category || (log as any).category) === 'unhandled' ? colors.error[800] :
                                  // Legacy categories
                                  log.errorCategory === 'client' ? colors.info[700] :
                                  log.errorCategory === 'server' ? colors.error[700] :
                                  log.errorCategory === 'transform' ? colors.warning[700] :
                                  log.errorCategory === 'ratelimit' ? colors.warning[700] :
                                  log.errorCategory === 'database' ? colors.error[800] :
                                  cssVar.text.secondary,
                                borderColor:
                                  (log.meta?.category || (log as any).category) === 'ui_error' ? withAlpha(colors.error[500], 0.3) :
                                  (log.meta?.category || (log as any).category) === 'api_error' ? withAlpha(colors.warning[500], 0.3) :
                                  (log.meta?.category || (log as any).category) === 'validation_error' ? withAlpha(colors.warning[500], 0.3) :
                                  (log.meta?.category || (log as any).category) === 'business_logic' ? withAlpha(colors.info[500], 0.3) :
                                  (log.meta?.category || (log as any).category) === 'unhandled' ? withAlpha(colors.error[600], 0.3) :
                                  // Legacy categories
                                  log.errorCategory === 'client' ? withAlpha(colors.info[500], 0.3) :
                                  log.errorCategory === 'server' ? withAlpha(colors.error[500], 0.3) :
                                  log.errorCategory === 'transform' ? withAlpha(colors.warning[500], 0.3) :
                                  log.errorCategory === 'ratelimit' ? withAlpha(colors.warning[500], 0.3) :
                                  log.errorCategory === 'database' ? withAlpha(colors.error[600], 0.3) :
                                  withAlpha(colors.neutral[500], 0.3),
                                fontWeight: 600,
                                margin: 0,
                                textTransform: 'uppercase'
                              }}
                            >
                              {log.meta?.category || (log as any).category || log.errorCategory}
                            </Tag>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <Typography.Text
                            style={{
                              fontSize: 13,
                              color: cssVar.text.primary,
                              display: 'block',
                              marginBottom: 4,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: log.message.includes('\n') || log.message.includes('Error:') || log.message.includes('    at ')
                                ? 'ui-monospace, monospace'
                                : 'inherit'
                            }}
                          >
                            {log.message}
                          </Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: cssVar.text.secondary }}>
                            {formatDateTime(log.timestamp)}
                          </Typography.Text>
                        </div>
                      </div>

                      {hasMeta && (
                        <div
                          style={{
                            marginTop: spacing[2],
                            padding: spacing[2],
                            background: cssVar.bg.elevated,
                            borderRadius: token.borderRadiusSM,
                            border: `1px solid ${withAlpha(cssVar.border.default, 0.5)}`
                          }}
                        >
                          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: spacing[1], color: cssVar.text.secondary }}>
                            Metadata ({Object.keys(log.meta!).length} field{Object.keys(log.meta!).length > 1 ? 's' : ''})
                          </Typography.Text>
                          <div
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 11,
                              maxHeight: 180,
                              overflow: 'auto',
                              color: cssVar.text.secondary
                            }}
                          >
                            {Object.entries(log.meta!).map(([key, value], metaIdx) => (
                              <div key={key} style={{ marginBottom: metaIdx < Object.entries(log.meta!).length - 1 ? 4 : 0, display: 'flex', gap: spacing[2] }}>
                                <span style={{ fontWeight: 600, color: colors.primary[600], minWidth: 120 }}>{key}:</span>
                                <span style={{ flex: 1, wordBreak: 'break-word' }}>
                                  {typeof value === 'object'
                                    ? JSON.stringify(value, null, 2)
                                    : String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Space>
          </div>
        </Card>
      </div>
    );
  };

  // Row selection configuration
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
    selections: [
      {
        key: 'all',
        text: 'Select all poll cycles',
        onSelect: () => {
          setSelectedRowKeys(pollGroups.map(g => `poll-${g.pollId}-${g.firstTimestamp}`));
        }
      },
      {
        key: 'errors',
        text: 'Select cycles with errors',
        onSelect: () => {
          setSelectedRowKeys(
            pollGroups
              .filter(g => g.hasError)
              .map(g => `poll-${g.pollId}-${g.firstTimestamp}`)
          );
        }
      },
      {
        key: 'warnings',
        text: 'Select cycles with warnings',
        onSelect: () => {
          setSelectedRowKeys(
            pollGroups
              .filter(g => g.hasWarn && !g.hasError)
              .map(g => `poll-${g.pollId}-${g.firstTimestamp}`)
          );
        }
      },
      {
        key: 'none',
        text: 'Clear selection',
        onSelect: () => {
          setSelectedRowKeys([]);
        }
      }
    ]
  };

  // CHANGED: columns now represent a POLL GROUP, not a single log
  const columns = [
    {
      title: 'Poll',
      dataIndex: 'pollId',
      key: 'pollId',
      width: 180,
      sorter: (a: PollGroupRow, b: PollGroupRow) =>
        (a.pollId || '').localeCompare(b.pollId || ''),
      render: (pollId: string, record: PollGroupRow) => {
        const isUngrouped = pollId === 'NO_POLL';
        const label = isUngrouped ? 'Ungrouped logs' : `POLL #${pollId}`;
        const statusTone = record.hasError
          ? levelTone.error
          : record.hasWarn
          ? levelTone.warn
          : levelTone.info;

        return (
          <Space direction="vertical" size={2}>
            <Space size={6}>
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
                  margin: 0
                }}
              >
                {label}
              </Tag>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
              {record.logs.length} step{record.logs.length > 1 ? 's' : ''}
            </Typography.Text>
          </Space>
        );
      }
    },
    {
      title: 'Time window',
      key: 'timeWindow',
      width: 260,
      sorter: (a: PollGroupRow, b: PollGroupRow) =>
        new Date(a.firstTimestamp).getTime() - new Date(b.firstTimestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (_: any, record: PollGroupRow) => (
        <Space direction="vertical" size={2}>
          <Typography.Text style={{ fontSize: 13, color: cssVar.text.secondary }}>
            {formatDateTime(record.firstTimestamp)} → {formatDateTime(record.lastTimestamp)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
            Duration: {formatDuration(record.firstTimestamp, record.lastTimestamp)}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: 'Summary',
      key: 'summary',
      ellipsis: true,
      render: (_: any, record: PollGroupRow) => {
        const status = record.hasError
          ? 'Has errors'
          : record.hasWarn
          ? 'Warnings only'
          : 'OK';
        const tone = record.hasError
          ? levelTone.error
          : record.hasWarn
          ? levelTone.warn
          : levelTone.info;

        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text strong style={{ fontSize: 13, color: cssVar.text.primary }}>
              {status}
            </Typography.Text>
            <Space size={8} wrap>
              <Tag
                style={{
                  borderRadius: borderRadius.full,
                  fontSize: 11,
                  padding: `0 ${spacing[2]}`,
                  background: withAlpha(tone.bg, 0.9),
                  color: tone.text,
                  borderColor: tone.border,
                  margin: 0
                }}
              >
                {record.logs.filter(l => l.level === 'error').length} error(s)
              </Tag>
              <Tag
                style={{
                  borderRadius: borderRadius.full,
                  fontSize: 11,
                  padding: `0 ${spacing[2]}`,
                  background: withAlpha(colors.warning[50], 1),
                  color: colors.warning[700],
                  borderColor: colors.warning[300],
                  margin: 0
                }}
              >
                {record.logs.filter(l => l.level === 'warn').length} warning(s)
              </Tag>
              {typeof record.eventsProcessed === 'number' && (
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 11,
                    padding: `0 ${spacing[2]}`,
                  background: cssVar.bg.elevated,
                  color: cssVar.text.secondary,
                  borderColor: cssVar.border.default,
                  margin: 0
                }}
              >
                  events: {record.eventsProcessed}
                </Tag>
              )}
              {typeof record.retriesProcessed === 'number' && (
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 11,
                    padding: `0 ${spacing[2]}`,
                  background: cssVar.bg.elevated,
                  color: cssVar.text.secondary,
                  borderColor: cssVar.border.default,
                  margin: 0
                }}
              >
                  retries: {record.retriesProcessed}
                </Tag>
              )}
            </Space>
          </Space>
        );
      }
    }
  ];

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : '1fr auto',
          alignItems: isNarrow ? 'flex-start' : 'center',
          gap: spacing[3],
          rowGap: spacing[2],
          marginBottom: spacing[3]
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <PageHeader
            title="System logs"
            description="Monitor application logs, worker activity, and system events."
            statusChips={[
              { label: `${logs.length} raw logs` },
              { label: `${pollGroups.length} poll cycles`, color: colors.primary[600] },
              { label: `Last refresh: ${lastRefresh.toLocaleTimeString()}`, color: colors.primary[600] }
            ]}
            compact
            actions={
              <Space size={spacingToNumber(spacing[2])}>
                <Dropdown
                  trigger={['click']}
                  disabled={exportLoading}
                  menu={{
                    items: [
                      {
                        key: 'all-csv',
                        label: 'Export all logs (CSV)',
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('all', 'csv'),
                        disabled: exportLoading
                      },
                      {
                        key: 'all-json',
                        label: 'Export all logs (JSON)',
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('all', 'json'),
                        disabled: exportLoading
                      },
                      { type: 'divider' },
                      {
                        key: 'filtered-csv',
                        label: 'Export filtered logs (CSV)',
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('filtered', 'csv'),
                        disabled: !hasActiveFilters || exportLoading
                      },
                      {
                        key: 'filtered-json',
                        label: 'Export filtered logs (JSON)',
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('filtered', 'json'),
                        disabled: !hasActiveFilters || exportLoading
                      },
                      { type: 'divider' },
                      {
                        key: 'selected-csv',
                        label: `Export selected cycles (${selectedRowKeys.length}) CSV`,
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('selected', 'csv'),
                        disabled: selectedRowKeys.length === 0 || exportLoading
                      },
                      {
                        key: 'selected-json',
                        label: `Export selected cycles (${selectedRowKeys.length}) JSON`,
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('selected', 'json'),
                        disabled: selectedRowKeys.length === 0 || exportLoading
                      }
                    ]
                  }}
                >
                  <Button icon={<DownloadOutlined />} disabled={exportLoading} size="small">
                    Export logs
                  </Button>
                </Dropdown>
                <Button
                  danger
                  icon={<ClearOutlined />}
                  onClick={handleClearAll}
                  disabled={exportLoading || loading}
                  size="small"
                >
                  Clear All
                </Button>
              </Space>
            }
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isNarrow ? 'flex-start' : 'flex-end',
            flexWrap: isNarrow ? 'wrap' : 'nowrap',
            gap: spacing['1.5'],
            padding: `${spacing['1.5']} ${spacing[3]}`,
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${cssVar.border.default}`,
            background: withAlpha(cssVar.bg.surface, 0.9)
          }}
        >
          <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>Auto-refresh</Typography.Text>
          <Switch checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />
          <Divider type="vertical" style={{ margin: 0 }} />
          <Button
            type={autoRefresh ? 'primary' : 'default'}
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => setAutoRefresh(!autoRefresh)}
            size="small"
          >
            {autoRefresh ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: spacing[3],
          marginBottom: spacing[4]
        }}
      >
        {[
          { title: 'Poll Cycles', value: pollStats.total, subtitle: `${stats.total} raw logs`, tone: cssVar.text.secondary, icon: <SearchOutlined style={{ color: cssVar.text.secondary }} />, filter: '' as const },
          { title: 'With Errors', value: pollStats.withErrors, subtitle: `${stats.error} error logs`, tone: colors.error[600], icon: <BugOutlined style={{ color: colors.error[500] }} />, filter: 'error' as const },
          { title: 'With Warnings', value: pollStats.withWarnings, subtitle: `${stats.warn} warning logs`, tone: colors.warning[600], icon: <WarningOutlined style={{ color: colors.warning[500] }} />, filter: 'warn' as const },
          { title: 'Healthy', value: pollStats.healthy, subtitle: `No issues`, tone: colors.success[600], icon: <InfoCircleOutlined style={{ color: colors.success[500] }} />, filter: 'ok' as const }
        ].map((item) => (
          <Card
            key={item.title}
            bordered
            hoverable={item.filter !== ''}
            onClick={() => item.filter && handleQuickStatusFilter(item.filter)}
            style={{
              padding: spacing[3],
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${withAlpha(item.tone, (statusFilter === item.filter && item.filter) ? 0.5 : (item.title === 'With Errors' || item.title === 'With Warnings' ? 0.3 : 0.15))}`,
              boxShadow: statusFilter === item.filter && item.filter ? shadows.lg : shadows.xl,
              cursor: item.filter ? 'pointer' : 'default',
              transition: transitions.all,
              background: statusFilter === item.filter && item.filter ? withAlpha(item.tone, 0.05) : cssVar.bg.surface
            }}
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}>
                  {item.title}
                </Typography.Text>
                <Typography.Title level={3} style={{ margin: 0, color: item.tone }}>
                  {item.value}
                </Typography.Title>
                {item.subtitle && (
                  <Typography.Text type="secondary" style={{ fontSize: 11, color: cssVar.text.secondary }}>
                    {item.subtitle}
                  </Typography.Text>
                )}
              </div>
              <div
                style={{
                  width: spacing[7],
                  height: spacing[7],
                  borderRadius: token.borderRadiusLG,
                  background: withAlpha(item.tone, 0.1),
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                {item.icon}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            marginBottom: spacing[3],
            borderColor: colors.primary[300],
            background: withAlpha(colors.primary[50], 0.5)
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] }}>
            <div>
              <Typography.Text strong style={{ marginRight: spacing[2] }}>
                {selectedRowKeys.length} poll cycle(s) selected
              </Typography.Text>
              <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                Clear selection
              </Button>
            </div>
            <Space size={spacingToNumber(spacing[2])} wrap>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleExport('selected', 'json')}
              >
                Export Selected (JSON)
              </Button>
            </Space>
          </div>
        </Card>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing['1.5'],
          padding: `${spacing['1.5']} ${spacing[3]}`,
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${cssVar.border.default}`,
          background: cssVar.bg.surface,
          boxShadow: shadows.lg,
          marginBottom: spacing[2],
          alignItems: 'center'
        }}
      >
        <Select
          placeholder="Status"
          style={{ minWidth: 140, flex: isNarrow ? '1 1 auto' : '0 0 160px' }}
          allowClear
          size="small"
          value={statusFilter || undefined}
          onChange={(value) => setStatusFilter(value || '')}
          options={[
            { value: 'error', label: 'With Errors' },
            { value: 'warn', label: 'With Warnings' },
            { value: 'ok', label: 'Healthy' }
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
            { value: 'debug', label: 'Debug' }
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
        <Input
          placeholder="Poll ID (e.g., 1252)"
          allowClear
          size="small"
          value={pollIdFilter}
          onChange={(e) => setPollIdFilter(e.target.value)}
          style={{ minWidth: 140, flex: isNarrow ? '1 1 auto' : '0 0 180px' }}
          prefix={<SearchOutlined style={{ color: cssVar.text.muted }} />}
        />
        <Input.Search
          placeholder="Search messages..."
          allowClear
          size="small"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          style={{ minWidth: 180, flex: '1 1 240px' }}
        />
        <div style={{ display: 'flex', gap: spacing['1.5'], marginLeft: isNarrow ? 0 : 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
          {hasActiveFilters && (
            <Button
              size="small"
              onClick={handleClearFilters}
              icon={<ClearOutlined />}
            >
              Clear Filters
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchLogs} loading={loading} size="small">
            Refresh
          </Button>
        </div>
      </div>

      <div className="full-bleed-table" style={tableFullBleedStyle}>
        <Card
          className="panel"
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${cssVar.border.default}`,
            boxShadow: shadows.xl
          }}
          bodyStyle={{ padding: 0 }}
        >
          <ModernTable<PollGroupRow>
            columns={columns}
            dataSource={pollGroups}
            rowKey={(record) => `poll-${record.pollId}-${record.firstTimestamp}`}
            rowSelection={rowSelection}
            loading={loading}
            size="small"
            enableResize={true}
            stickyHeader={true}
            pagination={{
              ...getPaginationConfig(pollGroups.length),
              showTotal: (total) => `${total} poll cycle${total === 1 ? '' : 's'}`
            }}
            expandable={{
              expandedRowRender: (record) => renderExpandedRow(record),
              rowExpandable: (record) => record.logs.length > 0
            }}
            locale={{
              emptyText: hasActiveFilters ? (
                <div style={{ padding: spacing[6], textAlign: 'center' }}>
                  <InfoCircleOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                  <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                    No poll cycles match your filters
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                    Try adjusting or clearing your filters to see more results
                  </Typography.Text>
                  <Button onClick={handleClearFilters} icon={<ClearOutlined />}>
                    Clear All Filters
                  </Button>
                </div>
              ) : (
                <div style={{ padding: spacing[6], textAlign: 'center' }}>
                  <SearchOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
                  <Typography.Title level={4} style={{ color: cssVar.text.secondary, marginBottom: spacing[2] }}>
                    No system logs found
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[4], color: cssVar.text.secondary }}>
                    System logs from the last 24 hours will appear here
                  </Typography.Text>
                  <Button onClick={fetchLogs} icon={<ReloadOutlined />}>
                    Refresh Logs
                  </Button>
                </div>
              )
            }}
          />
        </Card>
      </div>
    </div>
  );
}
