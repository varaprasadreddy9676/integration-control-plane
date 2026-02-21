import { useState, useMemo } from "react";
import { Checkbox, Input, Modal, Space, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  FieldTimeOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  MailOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getDashboardSummary, getAnalyticsOverview, getAnalyticsTimeseries, getAnalyticsErrors, getAnalyticsPerformance, getEventAuditStats, getUIConfig, getUIConfigOverride, sendDashboardEmail, getAllIntegrations, getAllScheduledJobs, getLogs } from '../../services/api';
import { formatDateTimeWithSeconds, formatNumber } from '../../utils/format';
import { useDesignTokens } from '../../design-system/utils';
import { useNavigateWithParams } from '../../utils/navigation';
import { useDashboardExport } from './hooks/useDashboardExport';
import { DashboardDetailsTabs, DashboardDeliveriesTab, DashboardErrorsTab, DashboardHeader, DashboardKpiSection, DashboardLatencyTab, DashboardLogsTab, DashboardOverviewTab, DashboardToolbar, DashboardOutboundTab, DashboardInboundTab, DashboardScheduledTab } from './components';

export const DashboardRoute = () => {
  const navigate = useNavigateWithParams();
  const { themeColors, spacing } = useDesignTokens();
  const [days, setDays] = useState(1); // Default to "Today"
  const [eventTypeView, setEventTypeView] = useState<'chart' | 'list'>('chart');
  const [direction, setDirection] = useState<'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED'>('ALL');
  const [integrationId, setIntegrationId] = useState<string | undefined>(undefined);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'errors' | 'latency' | 'deliveries' | 'logs' | 'outbound' | 'inbound' | 'scheduled'>('overview');
  const { exportDashboard, isExporting } = useDashboardExport();

  // Email modal state
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [includePdf, setIncludePdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [performanceChartMetric, setPerformanceChartMetric] = useState<'percent' | 'count'>('percent');
  const [performanceChartLayout, setPerformanceChartLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [hiddenLegends, setHiddenLegends] = useState<Set<string>>(new Set());

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

  const { data: integrationOptions } = useQuery({
    queryKey: ['dashboard-integrations'],
    queryFn: async () => {
      const [integrations, scheduledJobs] = await Promise.all([
        getAllIntegrations(),
        getAllScheduledJobs()
      ]);

      const outboundInboundOptions = (integrations || []).map((integration: any) => ({
        label: `${integration.direction ? `${integration.direction.toLowerCase()}: ` : ''}${integration.name || integration.type || integration.id || 'Integration'}`,
        value: String(integration.id || integration._id || integration.__KEEP___KEEP_integrationConfig__Id__ || integration.type || ''),
        direction: integration.direction || 'OUTBOUND'
      }));

      const scheduledOptions = (scheduledJobs || []).map((job: any) => ({
        label: `scheduled: ${job.name || job.type || job._id}`,
        value: String(job._id || job.id),
        direction: 'SCHEDULED'
      }));

      return [...outboundInboundOptions, ...scheduledOptions].filter((opt) => opt.value);
    },
    staleTime: 5 * 60 * 1000
  });

  const integrationDirectionMap = useMemo(() => {
    const map = new Map<string, string>();
    (integrationOptions || []).forEach((option: any) => {
      if (option?.value) {
        map.set(String(option.value), option.direction || 'OUTBOUND');
      }
    });
    return map;
  }, [integrationOptions]);

  const resolvedScope = useMemo(() => {
    if (direction === 'ALL' && integrationId) {
      return (integrationDirectionMap.get(String(integrationId)) || 'ALL') as typeof direction;
    }
    return direction;
  }, [direction, integrationId, integrationDirectionMap]);

  const refreshSeconds = Number(uiOverride?.dashboard?.autoRefreshSeconds ?? uiConfig?.dashboard?.autoRefreshSeconds ?? 30);
  const refreshInterval = refreshSeconds > 0 ? refreshSeconds * 1000 : false;

  // Send email function
  const handleSendEmail = async () => {
    if (!emailRecipients.trim()) {
      message.error('Please enter at least one email address');
      return;
    }

    // Parse email addresses (comma or newline separated)
    const recipients = emailRecipients
      .split(/[,\n]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);

    if (recipients.length === 0) {
      message.error('Please enter valid email addresses');
      return;
    }

    setSendingEmail(true);
    try {
      const result = await sendDashboardEmail({
        recipients,
        days,
        includePdf
      });

      message.success(`Dashboard sent successfully to ${recipients.length} recipient(s)`);
      setEmailModalVisible(false);
      setEmailRecipients('');
      setIncludePdf(false);
    } catch (error) {
      message.error('Failed to send email. Please try again.');
      console.error('Send email error:', error);
    } finally {
      setSendingEmail(false);
    }
  };

  // Export menu items
  const exportMenuItems: MenuProps['items'] = [
    {
      key: 'send-email',
      label: 'Send via Email',
      icon: <MailOutlined />,
      onClick: () => setEmailModalVisible(true)
    },
    { type: 'divider' },
    {
      key: 'export-png',
      label: 'Export as PNG',
      icon: <FileImageOutlined />,
      onClick: () => exportDashboard('png')
    },
    {
      key: 'export-pdf',
      label: 'Export as PDF',
      icon: <FilePdfOutlined />,
      onClick: () => exportDashboard('pdf')
    }
  ];

  // Fetch dashboard summary (24h stats)
  const { data: summary, dataUpdatedAt: summaryUpdatedAt, refetch: refetchSummary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
    refetchInterval: refreshInterval
  });

  const analyticsDirection = resolvedScope === 'ALL' || resolvedScope === 'SCHEDULED' ? undefined : resolvedScope;
  const analyticsTriggerType = resolvedScope === 'SCHEDULED' ? 'SCHEDULED' : undefined;

  // Dashboard UI uses calendar-day ranges (local time), but the analytics backend defaults
  // to "last N days" as a rolling window. Passing start/end removes confusion like
  // "Today shows failures" due to late-night runs from the prior calendar day.
  const analyticsDateRange = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Math.max(0, days - 1));
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [days]);

  // Fetch analytics overview
  const { data: analytics, isLoading: analyticsLoading, dataUpdatedAt: analyticsUpdatedAt, refetch: refetchAnalytics } = useQuery({
    queryKey: ['analytics-overview', days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange.startDate, analyticsDateRange.endDate],
    queryFn: () => getAnalyticsOverview(days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange),
    refetchInterval: refreshInterval
  });

  const { data: timeseriesDaily, dataUpdatedAt: timeseriesDailyUpdatedAt, refetch: refetchTimeseriesDaily } = useQuery({
    queryKey: ['analytics-timeseries', 'day', days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange.startDate, analyticsDateRange.endDate],
    queryFn: () => getAnalyticsTimeseries(days, 'day', analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange),
    refetchInterval: refreshInterval
  });

  const { data: timeseriesHourly, dataUpdatedAt: timeseriesHourlyUpdatedAt, refetch: refetchTimeseriesHourly } = useQuery({
    queryKey: ['analytics-timeseries', 'hour', days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange.startDate, analyticsDateRange.endDate],
    queryFn: () => getAnalyticsTimeseries(days, 'hour', analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange),
    refetchInterval: refreshInterval
  });

  // Fetch error analysis
  const { data: errorAnalytics, isLoading: errorsLoading, dataUpdatedAt: errorUpdatedAt, refetch: refetchErrors } = useQuery({
    queryKey: ['analytics-errors', days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange.startDate, analyticsDateRange.endDate],
    queryFn: () => getAnalyticsErrors(days, integrationId, analyticsDirection, analyticsTriggerType, analyticsDateRange),
    refetchInterval: refreshInterval
  });

  const { data: performanceAnalytics, isLoading: performanceLoading, dataUpdatedAt: performanceUpdatedAt, refetch: refetchPerformance } = useQuery({
    queryKey: ['analytics-performance', days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange.startDate, analyticsDateRange.endDate],
    queryFn: () => getAnalyticsPerformance(days, integrationId, analyticsDirection, analyticsTriggerType, analyticsDateRange),
    refetchInterval: refreshInterval
  });

  const hoursBack = days * 24;
  const { data: eventAuditStats, isLoading: eventAuditLoading, dataUpdatedAt: eventAuditUpdatedAt, refetch: refetchEventAuditStats } = useQuery({
    queryKey: ['event-audit-stats', hoursBack],
    queryFn: () => getEventAuditStats(hoursBack),
    refetchInterval: refreshInterval
  });

  // Conditional queries for Scheduled tab
  const { data: scheduledJobs } = useQuery({
    queryKey: ['dashboard-scheduled-jobs'],
    queryFn: () => getAllScheduledJobs(),
    enabled: detailsTab === 'scheduled',
    staleTime: 5 * 60 * 1000
  });

  const scheduledLogsDateRange = useMemo(() => {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return [startDate.toISOString(), now.toISOString()] as [string, string];
  }, [days]);

  const { data: scheduledLogsResponse } = useQuery({
    queryKey: ['dashboard-scheduled-logs', days, integrationId],
    queryFn: () => getLogs({
      triggerType: 'SCHEDULED',
      integrationId,
      dateRange: scheduledLogsDateRange,
      limit: 100
    }),
    enabled: detailsTab === 'scheduled',
    refetchInterval: refreshInterval
  });

  const scheduledJobLogs = useMemo(() => scheduledLogsResponse?.data || [], [scheduledLogsResponse]);

  const lastRefreshedAt = useMemo(() => {
    const timestamps = [
      summaryUpdatedAt,
      analyticsUpdatedAt,
      timeseriesDailyUpdatedAt,
      timeseriesHourlyUpdatedAt,
      errorUpdatedAt,
      performanceUpdatedAt,
      eventAuditUpdatedAt
    ].filter(Boolean) as number[];
    if (timestamps.length === 0) return null;
    return Math.max(...timestamps);
  }, [summaryUpdatedAt, analyticsUpdatedAt, timeseriesDailyUpdatedAt, timeseriesHourlyUpdatedAt, errorUpdatedAt, performanceUpdatedAt, eventAuditUpdatedAt]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchSummary(),
        refetchAnalytics(),
        refetchTimeseriesDaily(),
        refetchTimeseriesHourly(),
        refetchErrors(),
        refetchPerformance(),
        refetchEventAuditStats()
      ]);
      message.success('Dashboard refreshed');
    } catch (err) {
      message.error('Refresh failed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  

  const timeLabel = days === 1 ? 'Today' : `${days}d`;
  const hasSummaryData = (analytics?.summary?.total ?? 0) > 0;
  const noDataHint = 'No data for this range';

  // Calculate trends from timeseries data
  const trends = useMemo(() => {
    const series = timeseriesDaily?.data || [];
    if (series.length < 2) return null;

    // Split data into two halves for comparison
    const midpoint = Math.floor(series.length / 2);
    const firstHalf = series.slice(0, midpoint);
    const secondHalf = series.slice(midpoint);

    const calcAvg = (data: any[], field: string) => {
      const sum = data.reduce((acc, point) => acc + (point[field] || 0), 0);
      return data.length > 0 ? sum / data.length : 0;
    };

    const firstTotal = calcAvg(firstHalf, 'total');
    const secondTotal = calcAvg(secondHalf, 'total');
    const firstSuccessful = calcAvg(firstHalf, 'successful');
    const secondSuccessful = calcAvg(secondHalf, 'successful');
    const firstFailed = calcAvg(firstHalf, 'failed');
    const secondFailed = calcAvg(secondHalf, 'failed');
    const firstSuccessRate = firstTotal > 0 ? (firstSuccessful / firstTotal) * 100 : 0;
    const secondSuccessRate = secondTotal > 0 ? (secondSuccessful / secondTotal) * 100 : 0;

    const calcChange = (prev: number, current: number) => {
      if (prev === 0 && current === 0) return 0;
      if (prev === 0) return 100;
      return ((current - prev) / prev) * 100;
    };

    return {
      totalChange: calcChange(firstTotal, secondTotal),
      successRateChange: secondSuccessRate - firstSuccessRate, // Absolute change for percentage
      failedChange: calcChange(firstFailed, secondFailed)
    };
  }, [timeseriesDaily]);

  const metrics = [
    {
      label: `Total Deliveries (${timeLabel})`,
      value: hasSummaryData ? formatNumber(analytics?.summary?.total || 0) : '—',
      delta: hasSummaryData ? `${analytics?.summary?.successful || 0} successful, ${analytics?.summary?.failed || 0} failed` : noDataHint,
      icon: <ThunderboltOutlined />,
      tone: themeColors.primary.default,
      trend: trends?.totalChange,
      trendLabel: trends ? `${trends.totalChange > 0 ? '+' : ''}${trends.totalChange.toFixed(1)}% vs previous period` : undefined,
      onClick: () => {
        const params = new URLSearchParams({ days: days.toString() });
        if (integrationId) params.set('integrationId', integrationId);
        if (direction !== 'ALL') params.set('direction', direction);
        navigate(`/delivery-logs?${params.toString()}`);
      }
    },
    {
      label: `Success Rate (${timeLabel})`,
      value: hasSummaryData ? `${(analytics?.summary?.successRate || 0).toFixed(1)}%` : '—',
      delta: hasSummaryData ? `${analytics.summary.successful} / ${analytics.summary.total} deliveries` : noDataHint,
      icon: <CheckCircleOutlined />,
      tone: themeColors.success.text,
      trend: trends?.successRateChange,
      trendLabel: trends ? `${trends.successRateChange > 0 ? '+' : ''}${trends.successRateChange.toFixed(1)}% vs previous period` : undefined,
      onClick: () => {
        const params = new URLSearchParams({ status: 'SUCCESS', days: days.toString() });
        if (integrationId) params.set('integrationId', integrationId);
        if (direction !== 'ALL') params.set('direction', direction);
        navigate(`/delivery-logs?${params.toString()}`);
      }
    },
    {
      label: `Average Latency (${timeLabel})`,
      value: hasSummaryData ? `${analytics?.performance?.avgResponseTime || 0} ms` : '—',
      delta: hasSummaryData ? `P95: ${analytics?.performance?.p95ResponseTime || 0} ms` : noDataHint,
      icon: <FieldTimeOutlined />,
      tone: themeColors.info.text,
      trend: undefined, // We'll calculate this later if needed
      trendLabel: undefined,
      onClick: () => setDetailsTab('latency')
    },
    {
      label: `Failed Deliveries (${timeLabel})`,
      value: hasSummaryData ? formatNumber(analytics?.summary?.failed || 0) : '—',
      delta: hasSummaryData
        ? (analytics?.summary?.retrying ? `${analytics.summary.retrying} retrying` : 'View error details below')
        : noDataHint,
      icon: <WarningOutlined />,
      tone: themeColors.error.text,
      trend: trends?.failedChange,
      trendLabel: trends ? `${trends.failedChange > 0 ? '+' : ''}${trends.failedChange.toFixed(1)}% vs previous period` : undefined,
      onClick: () => {
        const params = new URLSearchParams({ status: 'FAILED,SKIPPED,ABANDONED', days: days.toString() });
        if (integrationId) params.set('integrationId', integrationId);
        if (direction !== 'ALL') params.set('direction', direction);
        navigate(`/delivery-logs?${params.toString()}`);
      }
    }
  ];

  // Prepare chart data
  const deliveryTrendData = useMemo(() => {
    const series = timeseriesDaily?.data || [];
    if (!Array.isArray(series) || series.length === 0) return [];

    const data = series.map((point: any) => {
      const total = Number(point.total || 0);
      const successful = Number(point.successful || 0);
      const failed = Number(point.failed || 0);
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      return {
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Successful: successful,
        Failed: failed,
        'Success Rate': Number(successRate.toFixed(1)),
        Total: total
      };
    });

    return data;
  }, [timeseriesDaily]);

  const eventTypeChartData = useMemo(() => {
    if (!analytics?.eventTypes) return [];
    return Object.entries(analytics.eventTypes)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([name, value]) => ({
        name,
        value: value as number,
      }));
  }, [analytics]);

  const eventAuditStatusData = useMemo(() => {
    const totalReceived = Number(eventAuditStats?.totalReceived || 0);
    const delivered = Number(eventAuditStats?.delivered || 0);
    const skipped = Number(eventAuditStats?.skipped || 0);
    const failed = Number(eventAuditStats?.failed || 0);
    const stuck = Number(eventAuditStats?.stuck || 0);
    const accounted = delivered + skipped + failed + stuck;
    const inProgress = Math.max(0, totalReceived - accounted);

    const data = [
      { name: 'Delivered', value: delivered },
      { name: 'Skipped', value: skipped },
      { name: 'Failed', value: failed },
      { name: 'Stuck', value: stuck },
      { name: 'In Progress', value: inProgress }
    ].filter((entry) => entry.value > 0);

    return data;
  }, [eventAuditStats]);

  // Funnel chart data for event flow
  const funnelData = useMemo(() => {
    const totalReceived = Number(eventAuditStats?.totalReceived || 0);
    const delivered = Number(eventAuditStats?.delivered || 0);
    const skipped = Number(eventAuditStats?.skipped || 0);
    const processed = delivered + skipped;

    if (totalReceived === 0) return [];

    return [
      { name: 'Received', value: totalReceived },
      { name: 'Processed', value: processed },
      { name: 'Delivered', value: delivered }
    ].filter((entry) => entry.value > 0);
  }, [eventAuditStats]);

  const successFailureByIntegrationData = useMemo(() => {
    if (!analytics?.integrationPerformance) return [];
    return analytics.integrationPerformance
      .map((integration: any) => {
        const displayName = integration.__KEEP_integrationName__ || integration.integrationName || integration.__KEEP___KEEP_integrationConfig__Id__ || 'Unknown';
        const successful = integration.successful || 0;
        const failed = integration.failed || 0;
        const total = integration.total || successful + failed;
        const successRate = total > 0 ? (successful / total) * 100 : 0;
        const failureRate = total > 0 ? (failed / total) * 100 : 0;
        return {
          name: displayName,
          nameShort: displayName,
          successRate: Number(successRate.toFixed(1)),
          failureRate: Number(failureRate.toFixed(1)),
          successCount: successful,
          failedCount: failed,
          total
        };
      })
      .map((integration: any) => ({
        ...integration
      }));
  }, [analytics]);

  const integrationPerformance = analytics?.integrationPerformance || [];

  const performanceChartData = useMemo(() => {
    return [...successFailureByIntegrationData]
      .sort((a: any, b: any) => {
        if (performanceChartMetric === 'count') {
          if ((b.failedCount || 0) !== (a.failedCount || 0)) {
            return (b.failedCount || 0) - (a.failedCount || 0);
          }
          return (b.total || 0) - (a.total || 0);
        }
        if (b.failureRate !== a.failureRate) {
          return b.failureRate - a.failureRate;
        }
        return (b.total || 0) - (a.total || 0);
      });
  }, [performanceChartMetric, successFailureByIntegrationData]);

  const hourlyPatternData = useMemo(() => {
    const series = timeseriesHourly?.data || [];
    if (!Array.isArray(series) || series.length === 0) return [];

    const buckets = new Map<number, { successful: number; failed: number; total: number }>();
    series.forEach((point: any) => {
      const timestamp = point.timestamp ? new Date(point.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;
      const hour = timestamp.getHours();
      const current = buckets.get(hour) || { successful: 0, failed: 0, total: 0 };
      buckets.set(hour, {
        successful: current.successful + Number(point.successful || 0),
        failed: current.failed + Number(point.failed || 0),
        total: current.total + Number(point.total || 0)
      });
    });

    return Array.from({ length: 24 }).map((_, hour) => {
      const data = buckets.get(hour) || { successful: 0, failed: 0, total: 0 };
      const successRate = data.total > 0 ? (data.successful / data.total) * 100 : 0;
      return {
        hour: `${hour}:00`,
        Successful: data.successful,
        Failed: data.failed,
        'Success Rate': Number(successRate.toFixed(1)),
        Total: data.total
      };
    });
  }, [timeseriesHourly]);

  // Heatmap data: day of week × hour of day
  const heatmapData = useMemo(() => {
    const series = timeseriesHourly?.data || [];
    if (!Array.isArray(series) || series.length === 0) return [];

    const buckets = new Map<string, number>();
    series.forEach((point: any) => {
      const timestamp = point.timestamp ? new Date(point.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;
      const hour = timestamp.getHours();
      const dayOfWeek = timestamp.getDay(); // 0 = Sunday, 6 = Saturday
      const key = `${hour}-${dayOfWeek}`;
      const current = buckets.get(key) || 0;
      buckets.set(key, current + Number(point.total || 0));
    });

    const data: Array<{ x: string; y: string; value: number }> = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let hour = 0; hour < 24; hour++) {
      for (let day = 0; day < 7; day++) {
        const key = `${hour}-${day}`;
        const value = buckets.get(key) || 0;
        data.push({
          x: `${hour}`,
          y: dayNames[day],
          value
        });
      }
    }

    return data;
  }, [timeseriesHourly]);

  const latencyDistributionData = useMemo(() => {
    const buckets = performanceAnalytics?.distribution?.buckets || [];
    return buckets.map((bucket: any) => ({
      bucket: bucket.label,
      Count: bucket.count || 0
    }));
  }, [performanceAnalytics]);

  const latencySummary = useMemo(() => {
    const metrics = performanceAnalytics?.metrics;
    if (!metrics) return null;
    return {
      avg: metrics.avgResponseTime || 0,
      p95: metrics.p95ResponseTime || 0,
      min: metrics.minResponseTime || 0,
      max: metrics.maxResponseTime || 0
    };
  }, [performanceAnalytics]);

  const overviewMetrics = metrics.slice(0, 4);
  const detailsTabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'errors', label: 'Errors' },
    { key: 'latency', label: 'Latency' },
    { key: 'deliveries', label: 'Deliveries' },
    { key: 'logs', label: 'Logs' },
    { key: 'outbound', label: 'Outbound' },
    { key: 'inbound', label: 'Inbound' },
    { key: 'scheduled', label: 'Scheduled' }
  ];

  const scopeMeta = useMemo(() => {
    if (resolvedScope === 'INBOUND') {
      return {
        label: 'Inbound Integration',
        manageLabel: 'Manage Inbound',
        managePath: '/integrations?tab=inbound',
        createPath: '/inbound-integrations/new',
        performanceSubtitle: 'Per-inbound integration delivery quality and latency',
        eventTypeTitle: 'Event Type Distribution',
        eventTypeSubtitle: 'Top inbound event types over the selected window'
      };
    }
    if (resolvedScope === 'SCHEDULED') {
      return {
        label: 'Scheduled Job',
        manageLabel: 'Manage Scheduled Jobs',
        managePath: '/scheduled-jobs',
        createPath: '/scheduled-jobs/new',
        performanceSubtitle: 'Per-job run quality and latency',
        eventTypeTitle: 'Job Type Distribution',
        eventTypeSubtitle: 'Top scheduled job types over the selected window'
      };
    }
    if (resolvedScope === 'OUTBOUND') {
      return {
        label: 'Event Rule',
        manageLabel: 'Manage Integrations',
        managePath: '/integrations',
        createPath: '/integrations/new',
        performanceSubtitle: 'Per-rule delivery quality and latency',
        eventTypeTitle: 'Event Type Distribution',
        eventTypeSubtitle: 'Top outbound event types over the selected window'
      };
    }
    return {
      label: 'Integration',
      manageLabel: 'Manage Integrations',
      managePath: '/integrations',
      createPath: '/integrations/new',
      performanceSubtitle: 'Per-integration delivery quality and latency',
      eventTypeTitle: 'Event Type Distribution',
      eventTypeSubtitle: 'Top events over the selected window'
    };
  }, [resolvedScope]);

  const statusText = `Monitoring: ${summary?.integrationHealth?.length || 0} rules · Scope: ${resolvedScope === 'ALL' ? 'All' : resolvedScope.toLowerCase()} · Updated: ${lastRefreshedAt ? formatDateTimeWithSeconds(new Date(lastRefreshedAt).toISOString()) : '—'}`;

  const errorCategoryData = useMemo(() => {
    const categories = errorAnalytics?.summary?.errorCategories || {};
    return Object.entries(categories)
      .map(([name, value]) => ({ name, value: Number(value || 0) }))
      .filter((entry) => entry.value > 0);
  }, [errorAnalytics]);

  const logsDateRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    return [start.toISOString(), end.toISOString()] as [string, string];
  }, [days]);

  const { data: recentLogsResponse, isLoading: recentLogsLoading } = useQuery({
    queryKey: ['dashboard-recent-logs', days, analyticsDirection, analyticsTriggerType, integrationId],
    queryFn: () => getLogs({
      status: 'FAILED',
      integrationId,
      direction: analyticsDirection,
      triggerType: analyticsTriggerType,
      dateRange: logsDateRange,
      limit: 50
    }),
    refetchInterval: refreshInterval
  });

  const recentLogs = recentLogsResponse?.data || [];

  const getIntegrationPath = (record: any) => {
    const id = record?.__KEEP___KEEP_integrationConfig__Id__ || record?.integrationConfigId || record?.id;
    if (!id) return scopeMeta.managePath;
    const mappedDirection = integrationDirectionMap.get(String(id));
    const recordDirection = record?.triggerType === 'SCHEDULED'
      ? 'SCHEDULED'
      : (record?.direction || mappedDirection || resolvedScope);

    if (recordDirection === 'SCHEDULED') return `/scheduled-jobs/${id}`;
    if (recordDirection === 'INBOUND') return `/inbound-integrations/${id}`;
    return `/integrations/${id}`;
  };

  const handleChartClick = (data: any, context?: { chartType?: string }) => {
    // Build filter params based on clicked data
    const params = new URLSearchParams();

    // Add integration filter if one is selected
    if (integrationId) {
      params.set('integrationId', integrationId);
    }

    // Add direction filter if applicable
    if (analyticsDirection) {
      params.set('direction', analyticsDirection);
    }

    // Add trigger type filter if applicable
    if (analyticsTriggerType) {
      params.set('triggerType', analyticsTriggerType);
    }

    // Handle different chart types
    if (context?.chartType === 'hourly' && data?.hour) {
      // Extract hour from format like "14:00"
      const hour = parseInt(data.hour.split(':')[0]);
      params.set('hour', String(hour));
    }

    if (context?.chartType === 'heatmap' && data?.x && data?.y) {
      // Heatmap: x = hour, y = day of week
      params.set('hour', String(data.x));
      params.set('dayOfWeek', String(data.y));
    }

    // If there are failed deliveries in the clicked data, show failed logs
    if (data?.Failed > 0 || data?.failed > 0) {
      params.set('status', 'FAILED');
    }

    navigate(`/logs?${params.toString()}`);
  };

  const handleLegendClick = (dataKey: string) => {
    setHiddenLegends((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dataKey)) {
        newSet.delete(dataKey);
      } else {
        newSet.add(dataKey);
      }
      return newSet;
    });
  };

  return (
    <div className="dashboard-shell" data-dashboard-container>
      <DashboardHeader
        title="Dashboard"
        subtitle="Real-time monitoring of event delivery performance and system health."
        manageLabel={scopeMeta.manageLabel}
        onManage={() => navigate(scopeMeta.managePath)}
        onViewLogs={() => navigate('/logs')}
        onRefresh={handleManualRefresh}
        refreshing={refreshing}
        refreshSeconds={refreshSeconds}
        exportMenuItems={exportMenuItems}
        isExporting={isExporting}
      />

      <DashboardToolbar
        days={days}
        setDays={setDays}
        direction={direction}
        setDirection={setDirection}
        integrationId={integrationId}
        setIntegrationId={setIntegrationId}
        integrationOptions={integrationOptions}
        statusText={statusText}
      />

      <DashboardKpiSection metrics={overviewMetrics} loading={analyticsLoading} />

      <DashboardDetailsTabs
        activeKey={detailsTab}
        onChange={(key) => setDetailsTab(key as typeof detailsTab)}
        items={detailsTabs}
      />

      {detailsTab === 'overview' && (
        <DashboardOverviewTab
          days={days}
          deliveryTrendData={deliveryTrendData}
          hourlyPatternData={hourlyPatternData}
          heatmapData={heatmapData}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          analyticsLoading={analyticsLoading}
          noDataHint={noDataHint}
          onTrendChartClick={(data) => handleChartClick(data, { chartType: 'trend' })}
          onHourlyChartClick={(data) => handleChartClick(data, { chartType: 'hourly' })}
          onHeatmapClick={(data) => handleChartClick(data, { chartType: 'heatmap' })}
        />
      )}

      {detailsTab === 'errors' && (
        <DashboardErrorsTab
          errorsLoading={errorsLoading}
          errorCategoryData={errorCategoryData}
          topErrors={errorAnalytics?.summary?.topErrors || []}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          onViewAllFailures={() => {
            const params = new URLSearchParams({ status: 'FAILED,SKIPPED,ABANDONED', days: days.toString() });
            if (integrationId) params.set('integrationId', integrationId);
            if (analyticsDirection) params.set('direction', analyticsDirection);
            if (analyticsTriggerType) params.set('triggerType', analyticsTriggerType);
            navigate(`/delivery-logs?${params.toString()}`);
          }}
          onErrorCategoryClick={(data) => {
            const params = new URLSearchParams({ status: 'FAILED,SKIPPED,ABANDONED', days: days.toString() });
            if (integrationId) params.set('integrationId', integrationId);
            if (analyticsDirection) params.set('direction', analyticsDirection);
            if (analyticsTriggerType) params.set('triggerType', analyticsTriggerType);
            if (data?.name) params.set('errorCategory', data.name);
            navigate(`/delivery-logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'latency' && (
        <DashboardLatencyTab
          performanceLoading={performanceLoading}
          latencyDistributionData={latencyDistributionData}
          latencySummary={latencySummary}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'deliveries' && (
        <DashboardDeliveriesTab
          analyticsLoading={analyticsLoading}
          integrationPerformance={analytics?.integrationPerformance || []}
          performanceTitle={`${scopeMeta.label} Performance (${days === 1 ? 'Today' : `${days} days`})`}
          performanceSubtitle={scopeMeta.performanceSubtitle}
          performanceEntityLabel={scopeMeta.label}
          manageLabel={scopeMeta.manageLabel}
          onManageAll={() => navigate(scopeMeta.managePath)}
          onCreateNew={() => navigate(scopeMeta.createPath)}
          onViewEventAudit={() => navigate('/events')}
          onNavigate={(path) => navigate(path)}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          timeLabel={timeLabel}
          performanceChartData={performanceChartData}
          performanceChartMetric={performanceChartMetric}
          setPerformanceChartMetric={setPerformanceChartMetric}
          performanceChartLayout={performanceChartLayout}
          setPerformanceChartLayout={setPerformanceChartLayout}
          eventTypeView={eventTypeView}
          setEventTypeView={setEventTypeView}
          eventTypeTitle={scopeMeta.eventTypeTitle}
          eventTypeSubtitle={scopeMeta.eventTypeSubtitle}
          eventTypeChartData={eventTypeChartData}
          eventTypeCounts={analytics?.eventTypes || null}
          showEventAudit={resolvedScope !== 'SCHEDULED'}
          eventAuditLoading={eventAuditLoading}
          eventAuditStatusData={eventAuditStatusData}
          eventAuditStats={eventAuditStats || null}
          funnelData={funnelData}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          onEventTypeClick={(data) => {
            const params = new URLSearchParams({ days: days.toString() });
            if (integrationId) params.set('integrationId', integrationId);
            if (analyticsDirection) params.set('direction', analyticsDirection);
            if (analyticsTriggerType) params.set('triggerType', analyticsTriggerType);
            if (data?.name) params.set('eventType', data.name);
            navigate(`/delivery-logs?${params.toString()}`);
          }}
          onEventAuditClick={(data) => {
            const params = new URLSearchParams();
            if (data?.name === 'Failed') params.set('status', 'FAILED');
            else if (data?.name === 'Skipped') params.set('status', 'SKIPPED');
            else if (data?.name === 'Stuck') params.set('status', 'STUCK');
            else if (data?.name === 'Delivered') params.set('status', 'DELIVERED');
            navigate(`/events?${params.toString()}`);
          }}
          onPerformanceChartClick={(data) => {
            const params = new URLSearchParams({ days: days.toString() });
            const integration = integrationPerformance.find((i: any) =>
              (i.__KEEP_integrationName__ || i.integrationName) === data.nameShort
            );
            if (integration?.__KEEP___KEEP_integrationConfig__Id__) {
              params.set('integrationId', integration.__KEEP___KEEP_integrationConfig__Id__);
            }
            if (data?.failedCount > 0) params.set('status', 'FAILED,SKIPPED,ABANDONED');
            navigate(`/delivery-logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'logs' && (
        <DashboardLogsTab
          logsLoading={recentLogsLoading}
          logs={recentLogs}
          noDataHint={noDataHint}
          onViewAll={() => {
            const params = new URLSearchParams({ status: 'FAILED,SKIPPED,ABANDONED', days: days.toString() });
            navigate(`/delivery-logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'outbound' && (
        <DashboardOutboundTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoading}
          analytics={analytics}
          performanceAnalytics={performanceAnalytics}
          errorAnalytics={errorAnalytics}
          timeseriesDaily={timeseriesDaily}
          integrationPerformance={analytics?.integrationPerformance || []}
          onNavigate={(path) => navigate(path)}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'inbound' && (
        <DashboardInboundTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoading}
          analytics={analytics}
          timeseriesHourly={timeseriesHourly}
          timeseriesDaily={timeseriesDaily}
          performanceAnalytics={performanceAnalytics}
          errorAnalytics={errorAnalytics}
          integrationPerformance={analytics?.integrationPerformance || []}
          onNavigate={(path) => navigate(path)}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'scheduled' && (
        <DashboardScheduledTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoading}
          analytics={analytics}
          timeseriesDaily={timeseriesDaily}
          performanceAnalytics={performanceAnalytics}
          errorAnalytics={errorAnalytics}
          integrationPerformance={analytics?.integrationPerformance || []}
          scheduledJobs={scheduledJobs || []}
          scheduledJobLogs={scheduledJobLogs}
          onNavigate={(path) => navigate(path)}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {/* Email Modal */}
      <Modal
        title="Send Dashboard via Email"
        open={emailModalVisible}
        onOk={handleSendEmail}
        onCancel={() => {
          setEmailModalVisible(false);
          setEmailRecipients('');
          setIncludePdf(false);
        }}
        confirmLoading={sendingEmail}
        okText="Send Email"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Typography.Text strong>Recipient Email Addresses</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[2] }}>
              Enter one or more email addresses (comma or newline separated)
            </Typography.Text>
            <Input.TextArea
              placeholder="user1@example.com, user2@example.com"
              value={emailRecipients}
              onChange={(e) => setEmailRecipients(e.target.value)}
              rows={4}
              disabled={sendingEmail}
            />
          </div>
          <div>
            <Checkbox
              checked={includePdf}
              onChange={(e) => setIncludePdf(e.target.checked)}
              disabled={sendingEmail}
            >
              Include PDF attachment (may take longer to send)
            </Checkbox>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              The email will include dashboard statistics for the current time range ({days === 1 ? 'Today' : `${days} days`}) and a link to view the full dashboard.
            </Typography.Text>
          </div>
        </Space>
      </Modal>

    </div>
  );
};
