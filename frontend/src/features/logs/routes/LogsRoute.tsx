import { useMemo, useState, useEffect } from 'react';
import { App, Button, Card, DatePicker, Input, Select, Space, Tag, Typography, Timeline, Divider, Tabs, Grid, Dropdown, Modal, Skeleton } from 'antd';
import { DownloadOutlined, RedoOutlined, HistoryOutlined, ReloadOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useLocation } from 'react-router-dom';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { getLogs, getIntegrations, getLogStatsSummary, exportLogsToCsv, exportLogsToJson, exportSelectedLogs, getLogById, retryLog, bulkRetryLogs, bulkDeleteLogs, getEventTypes, getUIConfig, getUIConfigOverride, type PaginatedResponse } from '../../../services/api';
import type { DeliveryLog } from '../../../mocks/types';
import { formatDateTime, formatDateTimeWithSeconds } from '../../../utils/format';
import { useDesignTokens, withAlpha, spacingToNumber, cssVar } from '../../../design-system/utils';
import { generateCurlCommand } from '../../../utils/curl';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

// Helper to get today's date range as ISO start/end
const getTodayDateRange = (): [string, string] => {
  const start = dayjs().startOf('day').toISOString();
  const end = dayjs().endOf('day').toISOString();
  return [start, end];
};

const formatForCodeBlock = (value: unknown): string => {
  if (value === null || value === undefined) return 'No response body';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
};

const maskSecret = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
};

export const LogsRoute = () => {
  const { colors, spacing, token, borderRadius, shadows } = useDesignTokens();
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [integrationFilter, setIntegrationFilter] = useState<string>();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>();
  const [flowFilter, setFlowFilter] = useState<string>();
  const [dateRange, setDateRange] = useState<[string, string] | null>(getTodayDateRange());
  const [search, setSearch] = useState('');
  const [expandedLogDetails, setExpandedLogDetails] = useState<Record<string, DeliveryLog>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [retryingLogs, setRetryingLogs] = useState<Record<string, boolean>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  useEffect(() => {
    const hasStatusParam = searchParams.has('status');
    const statusParam = searchParams.get('status') || undefined;
    const dateRangeParam = searchParams.get('dateRange');
    const hasDateRangeParam = searchParams.has('dateRange');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    let consumedPrefillParams = false;

    if (hasStatusParam && statusParam !== statusFilter) {
      setStatusFilter(statusParam);
      consumedPrefillParams = true;
    }

    if (hasDateRangeParam && dateRangeParam === 'all') {
      if (dateRange !== null) {
        setDateRange(null);
      }
      consumedPrefillParams = true;
    } else if (searchParams.has('startDate') && searchParams.has('endDate') && startDate && endDate) {
      if (!dateRange || dateRange[0] !== startDate || dateRange[1] !== endDate) {
        setDateRange([startDate, endDate]);
      }
      consumedPrefillParams = true;
    }

    // Header shortcut params should prefill once, then be removed so users
    // can interact with filter controls without this effect forcing values back.
    if (consumedPrefillParams) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('status');
      nextParams.delete('dateRange');
      nextParams.delete('startDate');
      nextParams.delete('endDate');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, statusFilter, dateRange]);

  // Clear selection when filters change to prevent data corruption
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [statusFilter, integrationFilter, eventTypeFilter, flowFilter, search, dateRange]);

  // Refetch whenever the user navigates to this page — including clicking the
  // sidebar link while already on this route (location.key changes every time).
  useEffect(() => {
    refetchLogs();
    refetchStats();
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pagination with auto-reset on filter changes
  const { currentPage, pageSize, getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 15,
    pageSizeOptions: ['10', '15', '25', '50', '100'],
    resetDeps: [statusFilter, integrationFilter, eventTypeFilter, flowFilter, search, dateRange],
    syncWithUrl: true // Enable URL params for bookmarkable pages
  });

  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000
  });
  const { data: uiOverride } = useQuery({
    queryKey: ['uiConfigOverride'],
    queryFn: getUIConfigOverride,
    staleTime: 5 * 60 * 1000
  });

  const refreshSeconds = Number(uiOverride?.dashboard?.autoRefreshSeconds ?? uiConfig?.dashboard?.autoRefreshSeconds ?? 30);
  const refreshInterval = refreshSeconds > 0 ? refreshSeconds * 1000 : false;

  const resolvedDirection = flowFilter === 'INBOUND'
    ? 'INBOUND'
    : flowFilter === 'OUTBOUND'
      ? 'OUTBOUND'
      : flowFilter === 'SCHEDULED'
        ? 'SCHEDULED'
        : flowFilter === 'COMMUNICATION'
          ? 'COMMUNICATION'
          : undefined;
  const resolvedTriggerType = flowFilter === 'SCHEDULED' ? 'SCHEDULE' : undefined;

  const resolvedDateRange = useMemo(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return null;
    return [
      dayjs(dateRange[0]).startOf('day').toISOString(),
      dayjs(dateRange[1]).endOf('day').toISOString()
    ] as [string, string];
  }, [dateRange]);

  const { data: logsResponse, refetch: refetchLogs, isFetching: logsFetching } = useQuery<PaginatedResponse<DeliveryLog>>({
    queryKey: ['logs', statusFilter, integrationFilter, eventTypeFilter, flowFilter, search, resolvedDateRange, currentPage, pageSize],
    queryFn: () => getLogs({
      status: statusFilter === 'PENDING_OR_RETRYING' ? undefined : statusFilter, // Don't send special filter to backend
      integrationId: integrationFilter,
      eventType: eventTypeFilter,
      direction: resolvedDirection,
      triggerType: resolvedTriggerType,
      search,
      dateRange: resolvedDateRange,
      page: currentPage,
      limit: pageSize
    }),
    refetchInterval: refreshInterval
  });

  const logs = logsResponse?.data || [];
  const pagination = logsResponse?.pagination;

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations });
  const { data: eventTypes = [] } = useQuery<string[]>({ queryKey: ['event-types'], queryFn: getEventTypes });
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['log-stats'],
    queryFn: getLogStatsSummary,
    refetchInterval: refreshInterval
  });

  const clearExportFilter = (key: string) => {
    switch (key) {
      case 'status':
        setStatusFilter(undefined);
        break;
      case 'flow':
        setFlowFilter(undefined);
        break;
      case 'integration':
        setIntegrationFilter(undefined);
        break;
      case 'eventType':
        setEventTypeFilter(undefined);
        break;
      case 'date':
        setDateRange(null);
        break;
      case 'search':
        setSearch('');
        break;
      default:
        break;
    }
  };

  const exportFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onClear?: () => void }> = [];
    if (statusFilter) {
      chips.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => clearExportFilter('status') });
    }
    if (flowFilter) {
      const flowLabel = flowFilter === 'SCHEDULED'
        ? 'Scheduled'
        : flowFilter === 'INBOUND'
          ? 'Inbound'
          : flowFilter === 'COMMUNICATION'
            ? 'Communication'
            : 'Outbound';
      chips.push({ key: 'flow', label: `Flow: ${flowLabel}`, onClear: () => clearExportFilter('flow') });
    }
    if (integrationFilter) {
      const __KEEP_integrationName__ = integrations.find(wh => wh.id === integrationFilter)?.name || integrationFilter;
      chips.push({ key: 'integration', label: `Integration: ${__KEEP_integrationName__}`, onClear: () => clearExportFilter('integration') });
    }
    if (eventTypeFilter) {
      chips.push({ key: 'eventType', label: `Event: ${eventTypeFilter}`, onClear: () => clearExportFilter('eventType') });
    }
    if (dateRange?.[0] && dateRange?.[1]) {
      const startLabel = dayjs(dateRange[0]).format('YYYY-MM-DD');
      const endLabel = dayjs(dateRange[1]).format('YYYY-MM-DD');
      chips.push({ key: 'date', label: `Date: ${startLabel} → ${endLabel}`, onClear: () => clearExportFilter('date') });
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      const display = trimmedSearch.length > 28 ? `${trimmedSearch.slice(0, 28)}…` : trimmedSearch;
      chips.push({ key: 'search', label: `Search: ${display}`, onClear: () => clearExportFilter('search') });
    }
    return chips;
  }, [statusFilter, flowFilter, integrationFilter, eventTypeFilter, dateRange, search, integrations]);

  const filtered = useMemo(() => {
    // Handle "Pending" filter - show both PENDING and RETRYING
    // (backend counts both as "pending" in stats)
    if (statusFilter === 'PENDING_OR_RETRYING') {
      return logs.filter(log => log.status === 'PENDING' || log.status === 'RETRYING');
    }
    return logs;
  }, [logs, statusFilter]);

  const exportCount = pagination?.total ?? filtered.length;
  const exportLabel = exportFilterChips.length > 0
    ? `Export filtered (${exportCount.toLocaleString()})`
    : `Export (${exportCount.toLocaleString()})`;

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.1),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM
  });
  const mutedSurface = withAlpha(token.colorTextBase, 0.04);
  const errorSurface = withAlpha(colors.error[500], 0.1);
  const panelStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    boxShadow: shadows.xl
  } as const;
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[4]}`,
        paddingRight: spacing[1]
      };

  const handleExportCsv = async () => {
    try {
      const { onProgress, finish } = createExportProgress('Export CSV');
      await exportLogsToCsv({
        status: statusFilter,
        integrationId: integrationFilter,
        search: search || undefined,
        dateRange: resolvedDateRange || undefined
      }, { onProgress });
      finish('Export complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      msgApi.error(errorMessage);
    }
  };

  const handleRowExpand = async (expanded: boolean, record: DeliveryLog) => {
    if (expanded && !expandedLogDetails[record.id]) {
      setLoadingDetails(prev => ({ ...prev, [record.id]: true }));
      try {
        const fullLog = await getLogById(record.id);
        if (fullLog) {
          setExpandedLogDetails(prev => ({ ...prev, [record.id]: fullLog }));
        }
      } catch (error) {
        msgApi.error('Failed to load log details');
      } finally {
        setLoadingDetails(prev => ({ ...prev, [record.id]: false }));
      }
    }
  };

  const handleRetry = async (record: DeliveryLog, options: { force?: boolean } = {}) => {
    const forceRetry = Boolean(options.force);
    setRetryingLogs(prev => ({ ...prev, [record.id]: true }));
    try {
      await retryLog(record.id, {
        force: forceRetry,
        reason: forceRetry ? 'Force retry from UI' : 'Manual retry from UI'
      });
      msgApi.success(forceRetry
        ? 'Force retry initiated. Circuit breaker bypassed for this replay.'
        : 'Delivery retry initiated. The integration will be retried shortly.');
      // Refetch logs after a short delay to show the updated status
      setTimeout(() => {
        refetchLogs();
        refetchStats();
      }, 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retry delivery';
      msgApi.error(errorMessage);
    } finally {
      setRetryingLogs(prev => ({ ...prev, [record.id]: false }));
    }
  };

  const confirmForceRetry = (record: DeliveryLog) => {
    modal.confirm({
      title: 'Force retry delivery?',
      content: 'This will bypass the circuit breaker and attempt delivery immediately. Use only if the target endpoint is healthy.',
      okText: 'Force retry',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        await handleRetry(record, { force: true });
      }
    });
  };

  // Bulk retry handler
  const handleBulkRetry = () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select logs to retry.');
      return;
    }

    modal.confirm({
      title: 'Bulk Retry Logs',
      content: `Retry ${selectedRowKeys.length} selected delivery log(s)? Only FAILED logs will be retried.`,
      okText: 'Retry',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await bulkRetryLogs(selectedRowKeys.map(k => String(k)));
          if (result.retriedCount > 0) {
            msgApi.success(`Queued ${result.retriedCount} log(s) for retry`);
          }
          if (result.retriedCount < selectedRowKeys.length) {
            msgApi.info(`${selectedRowKeys.length - result.retriedCount} log(s) were skipped (not in FAILED status)`);
          }
          setSelectedRowKeys([]);
          setTimeout(() => {
            refetchLogs();
            refetchStats();
          }, 1000);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to retry logs';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  const handleBulkForceRetry = () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select logs to force retry.');
      return;
    }

    modal.confirm({
      title: 'Force retry logs?',
      content: `Force retry ${selectedRowKeys.length} selected delivery log(s)? This bypasses the circuit breaker and sends immediately. Only FAILED logs will be retried.`,
      okText: 'Force retry',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        const logIds = selectedRowKeys.map(k => String(k));
        const nextRetrying = logIds.reduce<Record<string, boolean>>((acc, id) => {
          acc[id] = true;
          return acc;
        }, {});
        setRetryingLogs(prev => ({ ...prev, ...nextRetrying }));

        try {
          const results = await Promise.allSettled(
            logIds.map(id => retryLog(id, { force: true, reason: 'Force retry from UI' }))
          );
          const successCount = results.filter(result => result.status === 'fulfilled').length;
          const failureCount = results.length - successCount;
          if (successCount > 0) {
            msgApi.success(`Force retried ${successCount} log(s)`);
          }
          if (failureCount > 0) {
            msgApi.warning(`${failureCount} log(s) were skipped or failed (not in FAILED status or error occurred)`);
          }
          setSelectedRowKeys([]);
          setTimeout(() => {
            refetchLogs();
            refetchStats();
          }, 1000);
        } finally {
          const resetRetrying = logIds.reduce<Record<string, boolean>>((acc, id) => {
            acc[id] = false;
            return acc;
          }, {});
          setRetryingLogs(prev => ({ ...prev, ...resetRetrying }));
        }
      }
    });
  };

  // Bulk delete handler
  const handleBulkDelete = () => {
    modal.confirm({
      title: 'Delete Selected Logs',
      content: `Permanently delete ${selectedRowKeys.length} delivery log(s)? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await bulkDeleteLogs(selectedRowKeys.map(k => String(k)));
          msgApi.success(`Deleted ${result.deletedCount} log(s)`);
          setSelectedRowKeys([]);
          refetchLogs();
          refetchStats();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete logs';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  // Export handler with format and scope (ALL SERVER-SIDE)
  const handleExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json') => {
    if (exportLoading) return;

    const filters = {
      status: statusFilter,
      integrationId: integrationFilter,
      eventType: eventTypeFilter,
      direction: resolvedDirection,
      triggerType: resolvedTriggerType,
      search: search || undefined,
      dateRange: dateRange || undefined
    };

    // Calculate count before export
    let count = 0;
    if (exportType === 'selected') {
      if (selectedRowKeys.length === 0) {
        msgApi.warning('Please select logs to export');
        return;
      }
      count = selectedRowKeys.length;
    } else {
      count = exportType === 'all' ? logs.length : filtered.length;
    }

    // Warn for large exports (>10,000 records)
    if (count > 10000) {
      modal.confirm({
        title: 'Large Export Warning',
        content: `You're about to export ${count.toLocaleString()} logs. This may take several minutes and could result in a very large file. Continue?`,
        okText: 'Yes, Export',
        cancelText: 'Cancel',
        onOk: async () => {
          await performExport(exportType, format, filters, count);
        }
      });
      return;
    }

    // Proceed with export for smaller datasets
    await performExport(exportType, format, filters, count);
  };

  const performExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json', filters: any, count: number) => {
    try {
      setExportLoading(true);
      const { onProgress, finish } = createExportProgress(`Export ${format.toUpperCase()}`);

      if (exportType === 'selected') {
        // Server-side export for selected logs
        await exportSelectedLogs(selectedRowKeys as string[], format, { onProgress });
        finish(`Exported ${count} log(s)`);
      } else {
        // For all/filtered, use backend export
        if (format === 'csv') {
          await exportLogsToCsv(exportType === 'all' ? {} : filters, { onProgress });
        } else {
          await exportLogsToJson(exportType === 'all' ? {} : filters, { onProgress });
        }
        finish(`Exported ${count} log(s)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  // Row selection config
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      msgApi.success('Copied to clipboard');
    }).catch(() => {
      msgApi.error('Failed to copy');
    });
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

  // Quick status filter handler
  const handleQuickStatusFilter = (status: string) => {
    setStatusFilter(statusFilter === status ? undefined : status);
  };

  return (
    <div>
      <PageHeader
        title="Delivery logs"
        description="Click a row to inspect payload, retries, and response."
        statusChips={[
          { label: `${filtered.length} records` },
          stats?.total != null ? { label: `Last updated: ${formatDateTimeWithSeconds(stats?.refreshedAt ?? new Date().toISOString())}` } : undefined
        ].filter(Boolean) as Array<{ label: string; color?: string }>}
        compact
        actions={
          <Dropdown
            disabled={exportLoading}
            menu={{
              items: [
                {
                  key: 'export-header',
                  type: 'group',
                  label: 'Export Format'
                },
                {
                  key: 'csv-all',
                  label: 'All logs (CSV)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('all', 'csv'),
                  disabled: exportLoading
                },
                {
                  key: 'json-all',
                  label: 'All logs (JSON)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('all', 'json'),
                  disabled: exportLoading
                },
                { type: 'divider' },
                {
                  key: 'csv-filtered',
                  label: 'Filtered results (CSV)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('filtered', 'csv'),
                  disabled: exportLoading
                },
                {
                  key: 'json-filtered',
                  label: 'Filtered results (JSON)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('filtered', 'json'),
                  disabled: exportLoading
                }
              ]
            }}
          >
            <Button icon={<DownloadOutlined />} disabled={exportLoading} size="small">
              {exportLabel}
            </Button>
          </Dropdown>
        }
      />
      {stats && (
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            marginBottom: spacing[2]
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[2], alignItems: 'center' }}>
            {[
              { title: 'Total', value: stats.total, tone: cssVar.text.secondary, filterValue: null },
              { title: 'Success', value: stats.success, tone: colors.success[600], filterValue: 'SUCCESS' },
              { title: 'Failed', value: stats.failed, tone: colors.error[600], filterValue: 'FAILED' },
              { title: 'Pending', value: stats.pending, tone: colors.warning[600], filterValue: 'PENDING_OR_RETRYING' }
            ].map((item) => {
              const isActive = item.filterValue === null
                ? !statusFilter
                : statusFilter === item.filterValue;
              const label = `${item.title}: ${item.value?.toLocaleString() ?? 0}`;
              return (
                <Tag
                  key={item.title}
                  onClick={() => {
                    if (item.filterValue === null) {
                      setStatusFilter(undefined);
                    } else {
                      setStatusFilter(statusFilter === item.filterValue ? undefined : item.filterValue);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (item.filterValue === null) {
                        setStatusFilter(undefined);
                      } else {
                        setStatusFilter(statusFilter === item.filterValue ? undefined : item.filterValue);
                      }
                    }
                  }}
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(item.tone, isActive ? 0.35 : 0.25),
                    background: withAlpha(item.tone, isActive ? 0.15 : 0.08),
                    color: item.tone,
                    fontWeight: 700,
                    margin: 0,
                    cursor: 'pointer'
                  }}
                >
                  {label}
                </Tag>
              );
            })}
          </div>
        </div>
      )}
      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${colors.primary[300]}`,
            background: withAlpha(colors.primary[50], 0.6),
            marginBottom: spacing[2]
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] }}>
            <div>
              <Typography.Text strong style={{ marginRight: spacing[2], color: colors.primary[700] }}>
                {selectedRowKeys.length} selected
              </Typography.Text>
              <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                Clear selection
              </Button>
            </div>
            <Space size={spacingToNumber(spacing[2])} wrap>
              <Button size="small" icon={<RedoOutlined />} onClick={handleBulkRetry}>
                Retry
              </Button>
              <Button size="small" danger icon={<RedoOutlined />} onClick={handleBulkForceRetry}>
                Force retry
              </Button>
              <Dropdown
                trigger={['click']}
                disabled={exportLoading}
                menu={{
                  items: [
                    {
                      key: 'csv-selected',
                      label: 'Export selected (CSV)',
                      icon: <DownloadOutlined />,
                      onClick: () => handleExport('selected', 'csv'),
                      disabled: exportLoading
                    },
                    {
                      key: 'json-selected',
                      label: 'Export selected (JSON)',
                      icon: <DownloadOutlined />,
                      onClick: () => handleExport('selected', 'json'),
                      disabled: exportLoading
                    }
                  ]
                }}
              >
                <Button size="small" icon={<DownloadOutlined />} disabled={exportLoading}>
                  Export
                </Button>
              </Dropdown>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
                Delete
              </Button>
            </Space>
          </div>
        </div>
      )}
      <div
        style={{
          padding: `${spacing[2]} ${spacing[3]}`,
          borderBottom: `1px solid ${token.colorBorder}`,
          background: token.colorBgContainer,
          marginBottom: spacing[2],
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          alignItems: 'center'
        }}
      >
        <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
          Filters
        </Typography.Text>
        <Select
          placeholder="Status"
          style={{ minWidth: 160, flex: '1 1 170px' }}
          allowClear
          size="small"
          value={statusFilter === 'PENDING_OR_RETRYING' ? undefined : statusFilter}
          onChange={(value) => setStatusFilter(value)}
          options={['PENDING', 'SUCCESS', 'FAILED', 'RETRYING', 'SKIPPED', 'ABANDONED'].map((status) => ({ value: status, label: status }))}
        />
        <RangePicker
          style={{ flex: '1 1 240px', minWidth: 220 }}
          size="small"
          value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : undefined}
          onChange={(dates) => {
            if (dates?.[0] && dates?.[1]) {
              setDateRange([dates[0].toISOString(), dates[1].toISOString()]);
            } else {
              setDateRange(null);
            }
          }}
        />
        <Select
          placeholder="Integration"
          style={{ minWidth: 200, flex: '1 1 220px' }}
          allowClear
          size="small"
          value={integrationFilter}
          onChange={(value) => setIntegrationFilter(value)}
          options={integrations.map((wh) => ({ value: wh.id, label: wh.name }))}
        />
        <Select
          placeholder="Flow"
          style={{ minWidth: 160, flex: '1 1 170px' }}
          allowClear
          size="small"
          value={flowFilter}
          onChange={(value) => setFlowFilter(value)}
          options={[
            { value: 'OUTBOUND', label: 'Outbound' },
            { value: 'INBOUND', label: 'Inbound' },
            { value: 'SCHEDULED', label: 'Scheduled' },
            { value: 'COMMUNICATION', label: 'Communication' }
          ]}
        />
        <Input.Search
          placeholder="Search message, target URL, or error"
          allowClear
          size="small"
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 200, flex: '1 1 220px' }}
        />
        <Button
          type="text"
          size="small"
          onClick={() => setShowMoreFilters(prev => !prev)}
          style={{ color: cssVar.text.secondary }}
        >
          {showMoreFilters ? 'Less filters' : 'More filters'}
        </Button>
        <div style={{ marginLeft: isNarrow ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          {refreshInterval && (
            <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              Auto-refreshing every {refreshSeconds}s
            </Typography.Text>
          )}
          <Button
            type="default"
            icon={<ReloadOutlined spin={logsFetching} />}
            loading={false}
            onClick={() => { refetchLogs(); refetchStats(); }}
            size="small"
          >
            {logsFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      {showMoreFilters && (
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            marginBottom: spacing[2],
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            alignItems: 'center'
          }}
        >
          <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
            More filters
          </Typography.Text>
          <Select
            placeholder="Event Type"
            style={{ minWidth: 200, flex: '1 1 220px' }}
            allowClear
            size="small"
            value={eventTypeFilter}
            onChange={(value) => setEventTypeFilter(value)}
            options={eventTypes.map((type) => ({ value: type, label: type }))}
          />
        </div>
      )}
      <div
        style={{
          padding: `${spacing[2]} ${spacing[3]}`,
          borderBottom: `1px solid ${token.colorBorder}`,
          background: token.colorBgContainer,
          marginBottom: spacing[2],
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          alignItems: 'center'
        }}
      >
        <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
          Export filters
        </Typography.Text>
        <Space wrap size={spacingToNumber(spacing[1])}>
          {exportFilterChips.length > 0 ? (
            <>
              {exportFilterChips.map((chip) => (
                <Tag
                  key={chip.key}
                  onClick={chip.onClear}
                  role={chip.onClear ? 'button' : undefined}
                  tabIndex={chip.onClear ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (!chip.onClear) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      chip.onClear();
                    }
                  }}
                  title="Click to clear"
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(colors.info[400], 0.25),
                    background: withAlpha(colors.info[100], 0.5),
                    color: colors.info[700],
                    fontWeight: 600,
                    margin: 0,
                    cursor: 'pointer'
                  }}
                >
                  {chip.label}
                </Tag>
              ))}
              <Tag
                onClick={() => {
                  clearExportFilter('status');
                  clearExportFilter('flow');
                  clearExportFilter('integration');
                  clearExportFilter('eventType');
                  clearExportFilter('date');
                  clearExportFilter('search');
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    clearExportFilter('status');
                    clearExportFilter('flow');
                    clearExportFilter('integration');
                    clearExportFilter('eventType');
                    clearExportFilter('date');
                    clearExportFilter('search');
                  }
                }}
                title="Clear all filters"
                style={{
                  borderRadius: borderRadius.full,
                  fontSize: 12,
                  padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(cssVar.border.default, 0.8),
                    background: cssVar.bg.elevated,
                    color: cssVar.text.secondary,
                    fontWeight: 600,
                    margin: 0,
                    cursor: 'pointer'
                }}
              >
                Clear all
              </Tag>
            </>
          ) : (
            <Tag
              style={{
                borderRadius: borderRadius.full,
                fontSize: 12,
                padding: `${spacing['0.5']} ${spacing[2]}`,
                borderColor: withAlpha(cssVar.border.default, 0.8),
                background: cssVar.bg.elevated,
                color: cssVar.text.secondary,
                fontWeight: 600,
                margin: 0
              }}
            >
              All logs
            </Tag>
          )}
        </Space>
      </div>
      <div className="logs-table-wrapper" style={tableFullBleedStyle}>
        <div
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 8,
            background: token.colorBgContainer,
            padding: spacing[2]
          }}
        >
        {selectedRowKeys.length === 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: spacing[1],
              marginBottom: spacing[2],
              padding: `${spacing['0.5']} ${spacing[2]}`,
              borderRadius: borderRadius.full,
              border: `1px solid ${withAlpha(cssVar.border.default, 0.8)}`,
              background: cssVar.bg.elevated
            }}
          >
            <Typography.Text style={{ fontSize: 12, color: cssVar.text.secondary }}>
              Select rows to enable bulk actions like retry, export, or delete.
            </Typography.Text>
          </div>
        )}
        <ModernTable<DeliveryLog>
          dataSource={filtered}
          rowKey="id"
          rowSelection={rowSelection}
          size="small"
          enableResize={true}
          stickyHeader={true}
          loading={logsFetching}
          pagination={{
            ...getPaginationConfig(pagination?.total || 0),
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total.toLocaleString()} delivery logs`,
            showQuickJumper: pagination && pagination.totalPages > 10
          }}
          expandable={{
            onExpand: handleRowExpand,
            expandedRowRender: (record) => {
              const fullLog = expandedLogDetails[record.id] || record;
              const isLoading = loadingDetails[record.id];
              const curlCommand = fullLog.__KEEP_integrationConfig__
                ? generateCurlCommand(fullLog.__KEEP_integrationConfig__, fullLog.requestPayload, fullLog.requestHeaders, {
                    direction: fullLog.direction,
                    request: (fullLog as any).request,
                    orgId: (fullLog as any).orgId
                  })
                : null;
              const isCommunicationLog = fullLog.httpMethod === 'COMMUNICATION' || fullLog.direction === 'COMMUNICATION';
              const integrationConfig = fullLog.__KEEP_integrationConfig__;
              const actionIndex = typeof fullLog.actionIndex === 'number' ? fullLog.actionIndex : 0;
              const actionConfig =
                integrationConfig?.actions?.[actionIndex]
                || integrationConfig?.actions?.find((a: any) => a?.kind === 'COMMUNICATION')
                || null;
              const communicationConfig = actionConfig?.communicationConfig || null;
              const smtpConfig = communicationConfig?.smtp || null;
              const payloadForProvider = (fullLog.requestPayload || {}) as Record<string, any>;
              const requestBodyForProvider = (fullLog.request?.body || {}) as Record<string, any>;
              const providerDetails = {
                channel: fullLog.requestHeaders?.channel || fullLog.request?.headers?.channel || null,
                provider: fullLog.requestHeaders?.provider || fullLog.request?.headers?.provider || null,
                target: fullLog.targetUrl || fullLog.request?.url || null,
                method: fullLog.httpMethod || fullLog.request?.method || null,
                smtp: smtpConfig ? {
                  host: smtpConfig.host || null,
                  port: smtpConfig.port || null,
                  username: smtpConfig.username || null,
                  password: maskSecret(smtpConfig.password),
                  fromEmail: smtpConfig.fromEmail || null
                } : null,
                message: {
                  to: payloadForProvider.to || requestBodyForProvider.to || null,
                  from: smtpConfig?.fromEmail || null,
                  subject: payloadForProvider.subject || requestBodyForProvider.subject || null
                }
              };
              const formattedResponseBody = formatForCodeBlock(fullLog.responseBody);

              return (
                <div style={{ padding: 0, background: 'transparent' }}>
                  {isLoading ? (
                    <div style={{ padding: spacing[3] }}>
                      <Skeleton active paragraph={{ rows: 4 }} />
                      <Skeleton active paragraph={{ rows: 6 }} />
                    </div>
                  ) : (
                    <Card
                      bordered
                      style={{ ...panelStyle, boxShadow: 'none', margin: 0 }}
                      bodyStyle={{ padding: spacing[2], display: 'flex', flexDirection: 'column', gap: spacing[2] }}
                    >
                      {(curlCommand || isCommunicationLog) && (
                        <Tabs
                          size="small"
                          defaultActiveKey={isCommunicationLog ? 'provider' : 'curl'}
                          items={[
                            ...(isCommunicationLog ? [{
                              key: 'provider',
                              label: 'Provider',
                              children: (
                                <div style={{ position: 'relative' }}>
                                  <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => copyToClipboard(formatForCodeBlock(providerDetails))}
                                    style={{
                                      position: 'absolute',
                                      top: spacing[2],
                                      left: spacing[2],
                                      zIndex: 1
                                    }}
                                  />
                                  <pre
                                    className="clamped-code-block"
                                    tabIndex={0}
                                    style={{
                                      background: withAlpha(cssVar.bg.overlay, 0.96),
                                      color: cssVar.text.primary,
                                      padding: spacing[3],
                                      borderRadius: token.borderRadiusLG,
                                      overflow: 'auto',
                                      maxHeight: 280,
                                      border: `1px solid ${cssVar.border.default}`,
                                      fontSize: token.fontSizeSM,
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                      outline: 'none'
                                    }}
                                  >
{formatForCodeBlock(providerDetails)}
                                  </pre>
                                </div>
                              )
                            }] : [{
                              key: 'curl',
                              label: 'cURL',
                              children: (
                                <div style={{ position: 'relative' }}>
                                  <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => copyToClipboard(curlCommand || '')}
                                    style={{
                                      position: 'absolute',
                                      top: spacing[2],
                                      left: spacing[2],
                                      zIndex: 1
                                    }}
                                  />
                                  <pre
                                    className="clamped-code-block"
                                    ref={(el) => {
                                      if (el) {
                                        el.onkeydown = (e) => {
                                          if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                                            e.preventDefault();
                                            const selection = window.getSelection();
                                            const range = document.createRange();
                                            range.selectNodeContents(el);
                                            selection?.removeAllRanges();
                                            selection?.addRange(range);
                                          }
                                        };
                                      }
                                    }}
                                    tabIndex={0}
                                    style={{
                                      background: withAlpha(cssVar.bg.overlay, 0.96),
                                      color: cssVar.text.primary,
                                      padding: spacing[3],
                                      borderRadius: token.borderRadiusLG,
                                      overflow: 'auto',
                                      maxHeight: 280,
                                      border: `1px solid ${cssVar.border.default}`,
                                      fontSize: token.fontSizeSM,
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                      outline: 'none'
                                    }}
                                  >
{curlCommand}
                                  </pre>
                                </div>
                              )
                            }]),
                            {
                              key: 'response',
                              label: 'Response',
                              children: (
                                <div style={{ position: 'relative' }}>
                                  <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => copyToClipboard(formattedResponseBody)}
                                    style={{
                                      position: 'absolute',
                                      top: spacing[2],
                                      left: spacing[2],
                                      zIndex: 1
                                    }}
                                  />
                                  <pre
                                    className="clamped-code-block"
                                    ref={(el) => {
                                      if (el) {
                                        el.onkeydown = (e) => {
                                          if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                                            e.preventDefault();
                                            const selection = window.getSelection();
                                            const range = document.createRange();
                                            range.selectNodeContents(el);
                                            selection?.removeAllRanges();
                                            selection?.addRange(range);
                                          }
                                        };
                                      }
                                    }}
                                    tabIndex={0}
                                    style={{
                                      background: mutedSurface,
                                      color: token.colorText,
                                      padding: spacing[3],
                                      borderRadius: token.borderRadiusLG,
                                      overflow: 'auto',
                                      maxHeight: 280,
                                      fontSize: token.fontSizeSM,
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                      outline: 'none'
                                    }}
                                  >
{formattedResponseBody}
                                  </pre>
                                </div>
                              )
                            }
                          ]}
                        />
                      )}

                      {fullLog.errorMessage && (
                        <>
                          <Divider style={{ margin: `${spacing[2]} 0` }} />
                          <Typography.Text strong>Error Details</Typography.Text>
                          <pre
                            className="clamped-code-block"
                            style={{
                              background: errorSurface,
                              color: colors.error[800],
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              overflow: 'auto',
                              border: `1px solid ${withAlpha(colors.error[500], 0.3)}`,
                              fontSize: token.fontSizeSM,
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word'
                            }}
                          >
{fullLog.errorMessage}
                          </pre>
                        </>
                      )}

                      {fullLog.retryAttempts && fullLog.retryAttempts.length > 0 && (
                        <>
                          <Divider style={{ margin: `${spacing[2]} 0` }} />
                          <Typography.Text strong>
                            Retry History ({fullLog.retryAttempts.length} {fullLog.retryAttempts.length === 1 ? 'attempt' : 'attempts'})
                          </Typography.Text>
                          <Timeline
                            style={{ marginTop: spacing[2] }}
                            items={fullLog.retryAttempts.map((attempt) => ({
                              color: attempt.status === 'SUCCESS'
                                ? colors.success[600]
                                : attempt.status === 'FAILED'
                                  ? colors.error[600]
                                  : colors.warning[600],
                              dot: attempt.status === 'SUCCESS'
                                ? <CheckCircleOutlined style={{ fontSize: 14 }} />
                                : attempt.status === 'FAILED'
                                  ? <CloseCircleOutlined style={{ fontSize: 14 }} />
                                  : <ClockCircleOutlined style={{ fontSize: 14 }} />,
                              children: (
                                <div>
                                  <div style={{ marginBottom: spacing[1] }}>
                                    <Space size={spacingToNumber(spacing[2])}>
                                      <Tag style={tagTone(
                                        attempt.status === 'SUCCESS'
                                          ? colors.success[600]
                                          : attempt.status === 'FAILED'
                                            ? colors.error[600]
                                            : colors.warning[600]
                                      )}>
                                        Attempt #{attempt.attemptNumber}
                                      </Tag>
                                      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}>
                                        {formatDateTime(attempt.attemptedAt)}
                                      </Typography.Text>
                                      {attempt.responseStatus && (
                                        <Tag style={tagTone(
                                          attempt.responseStatus >= 200 && attempt.responseStatus < 300
                                            ? colors.success[600]
                                            : colors.error[600]
                                        )}>
                                          HTTP {attempt.responseStatus}
                                        </Tag>
                                      )}
                                      {attempt.responseTimeMs && (
                                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}>
                                          {attempt.responseTimeMs}ms
                                        </Typography.Text>
                                      )}
                                    </Space>
                                  </div>
                                  {attempt.retryReason && (
                                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1], color: cssVar.text.secondary }}>
                                      Reason: {attempt.retryReason}
                                    </Typography.Text>
                                  )}
                                  {attempt.errorMessage && (
                                    <pre
                                      style={{
                                        background: errorSurface,
                                        color: colors.error[700],
                                        padding: spacing[2],
                                        borderRadius: token.borderRadiusSM,
                                        fontSize: token.fontSizeSM,
                                        marginTop: spacing[2],
                                        marginBottom: spacing[2]
                                      }}
                                    >
{attempt.errorMessage}
                                    </pre>
                                  )}
                                  {attempt.responseBody && (
                                    <pre
                                      style={{
                                        background: mutedSurface,
                                        color: token.colorText,
                                        padding: spacing[2],
                                        borderRadius: token.borderRadiusSM,
                                        fontSize: token.fontSizeSM,
                                        maxHeight: 150,
                                        overflow: 'auto',
                                        marginTop: spacing[2]
                                      }}
                                    >
{formatForCodeBlock(attempt.responseBody)}
                                    </pre>
                                  )}
                                </div>
                              )
                            }))}
                          />
                        </>
                      )}
                    </Card>
                  )}
                </div>
              );
            }
          }}
          columns={[
            {
              title: 'Time',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 200,
              sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              defaultSortOrder: 'descend',
              render: (date: string) => (
                <Typography.Text style={{ fontSize: 13, color: cssVar.text.secondary }}>
                  {formatDateTimeWithSeconds(date)}
                </Typography.Text>
              )
            },
            {
              title: 'Integration',
              dataIndex: '__KEEP_integrationName__',
              key: '__KEEP_integrationName__',
              width: 250,
              ellipsis: true,
              sorter: (a, b) => (a.__KEEP_integrationName__ || '').localeCompare(b.__KEEP_integrationName__ || ''),
              render: (name: string | null) => name ? (
                <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: cssVar.text.primary }} ellipsis>
                  {name}
                </Typography.Text>
              ) : (
                <Typography.Text style={{ fontSize: 13, color: cssVar.text.muted, fontStyle: 'italic' }}>
                  Unknown Integration
                </Typography.Text>
              )
            },
            {
              title: 'Flow',
              dataIndex: 'direction',
              key: 'direction',
              width: 140,
              render: (_: string, record: DeliveryLog) => {
                const direction = record.direction || 'OUTBOUND';
                const trigger = record.triggerType || 'EVENT';
                const label = direction === 'SCHEDULED' || trigger === 'SCHEDULE'
                  ? 'SCHEDULED'
                  : direction;

                return <MetaTag variant="flow" size="small">{label}</MetaTag>;
              }
            },
            {
              title: 'Event',
              dataIndex: 'eventType',
              key: 'eventType',
              width: 220,
              ellipsis: true,
              sorter: (a, b) => (a.eventType || '').localeCompare(b.eventType || ''),
              render: (event: string | null) => event ? (
                <MetaTag variant="event" size="small">{event}</MetaTag>
              ) : (
                <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>
                  —
                </Typography.Text>
              )
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              width: 130,
              sorter: (a, b) => a.status.localeCompare(b.status),
              filters: [
                { text: 'Success', value: 'SUCCESS' },
                { text: 'Failed', value: 'FAILED' },
                { text: 'Retrying', value: 'RETRYING' },
                { text: 'Pending', value: 'PENDING' },
                { text: 'Skipped', value: 'SKIPPED' },
                { text: 'Abandoned', value: 'ABANDONED' }
              ],
              onFilter: (value, record) => record.status === value,
              render: (status: string) => (
                <div onClick={() => handleQuickStatusFilter(status)} style={{ cursor: 'pointer' }}>
                  <StatusBadge status={status as any} size="default" />
                </div>
              )
            },
            {
              title: 'Category',
              dataIndex: 'errorCategory',
              key: 'errorCategory',
              width: 220,
              ellipsis: true,
              render: (category?: string | null) => category ? (
                <MetaTag variant="category" size="small">{category}</MetaTag>
              ) : (
                <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>
                  —
                </Typography.Text>
              )
            },
            {
              title: 'HTTP Status',
              dataIndex: 'responseStatus',
              key: 'responseStatus',
              align: 'right',
              width: 140,
              sorter: (a, b) => (a.responseStatus || 0) - (b.responseStatus || 0),
              render: (status: number | null) => (
                <Tag
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['1']} ${spacing[2]}`,
                    borderColor: withAlpha(
                      !status
                        ? colors.warning[400]
                        : status >= 200 && status < 300
                          ? colors.success[400]
                          : colors.error[400],
                      0.3
                    ),
                    background: withAlpha(
                      !status
                        ? colors.warning[100]
                        : status >= 200 && status < 300
                          ? colors.success[100]
                          : colors.error[100],
                      0.6
                    ),
                    color: !status
                      ? colors.warning[700]
                      : status >= 200 && status < 300
                        ? colors.success[700]
                        : colors.error[700],
                    fontWeight: 700,
                    margin: 0,
                    fontFamily: 'ui-monospace, monospace'
                  }}
                >
                  {status ?? '—'}
                </Tag>
              )
            },
            {
              title: 'Latency',
              dataIndex: 'responseTimeMs',
              key: 'responseTimeMs',
              align: 'right',
              width: 120,
              sorter: (a, b) => a.responseTimeMs - b.responseTimeMs,
              render: (val: number) => {
                const tone = val < 100
                  ? colors.success[600]
                  : val < 500
                    ? colors.warning[700]
                    : colors.error[700];
                return (
                  <Typography.Text style={{ fontSize: 13, color: tone, fontFamily: 'ui-monospace, monospace' }}>
                    {val} ms
                  </Typography.Text>
                );
              }
            },
            {
              title: 'Attempts',
              dataIndex: 'attemptCount',
              key: 'attemptCount',
              align: 'right',
              width: 120,
              sorter: (a, b) => a.attemptCount - b.attemptCount,
              resizable: false,
              render: (val: number, record) => (
                <Space size={spacingToNumber(spacing[1])} style={{ justifyContent: 'flex-end', width: '100%' }}>
                  <HistoryOutlined style={{ color: cssVar.text.secondary }} />
                  <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: cssVar.text.secondary }}>{val}</Typography.Text>
                  {record.status === 'RETRYING' && <ReloadOutlined spin style={{ color: colors.warning[600] }} />}
                </Space>
              )
            },
            {
              title: 'Actions',
              key: 'actions',
              width: 170,
              align: 'center',
              resizable: false,
              render: (_: unknown, record: DeliveryLog) => {
                const canRetry = record.status === 'FAILED';
                const isRetrying = retryingLogs[record.id];

                if (!canRetry) {
                  return (
                    <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>
                      —
                    </Typography.Text>
                  );
                }

                return (
                  <Space size={spacingToNumber(spacing[1])}>
                    <Button
                      type="text"
                      size="small"
                      icon={<RedoOutlined spin={isRetrying} />}
                      disabled={!canRetry || isRetrying}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetry(record);
                      }}
                      style={{
                        color: canRetry ? colors.primary[600] : cssVar.text.muted,
                        fontWeight: 500
                      }}
                    >
                      Retry
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      danger
                      disabled={!canRetry || isRetrying}
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmForceRetry(record);
                      }}
                      style={{
                        fontWeight: 500
                      }}
                    >
                      Force
                    </Button>
                  </Space>
                );
              }
            }
          ]}
        />
        </div>
      </div>
    </div>
  );
};
