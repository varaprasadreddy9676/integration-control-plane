import { useMemo, useState, useEffect } from 'react';
import { Card, Typography, Skeleton, List, Space, Tag } from 'antd';
import { ClockCircleOutlined, CheckCircleOutlined, WarningOutlined, DashboardOutlined } from '@ant-design/icons';
import { BarChart, ComposedChart, LineChart } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatNumber, formatDateTime, formatDuration } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber, withAlpha } from '../../../design-system/utils';
import { DashboardSectionTitle, DashboardMetricTile, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardScheduledTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  analytics: any;
  timeseriesDaily: any;
  performanceAnalytics: any;
  errorAnalytics: any;
  integrationPerformance: Array<any>;
  scheduledJobs?: Array<any>;
  scheduledJobLogs?: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardScheduledTab = ({
  days,
  timeLabel,
  analyticsLoading,
  analytics,
  timeseriesDaily,
  performanceAnalytics,
  errorAnalytics,
  integrationPerformance,
  scheduledJobs = [],
  scheduledJobLogs = [],
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick
}: DashboardScheduledTabProps) => {
  const { themeColors, spacing, token, borderRadius } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for countdown
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Next Scheduled Run Countdown
  const nextScheduledRun = useMemo(() => {
    const activeJobs = scheduledJobs.filter((job: any) => job.isActive && job.nextRunTime);
    if (activeJobs.length === 0) return null;

    const nextJob = activeJobs.sort((a: any, b: any) =>
      new Date(a.nextRunTime).getTime() - new Date(b.nextRunTime).getTime()
    )[0];

    const ms = new Date(nextJob.nextRunTime).getTime() - currentTime;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let countdown = '';
    if (days > 0) countdown = `${days}d ${hours % 24}h`;
    else if (hours > 0) countdown = `${hours}h ${minutes % 60}m`;
    else if (minutes > 0) countdown = `${minutes}m ${seconds % 60}s`;
    else if (seconds > 0) countdown = `${seconds}s`;
    else countdown = 'Now';

    return { job: nextJob, countdown, ms };
  }, [scheduledJobs, currentTime]);

  // KPI Metrics
  const kpiMetrics = useMemo(() => {
    const summary = analytics?.summary || {};
    const total = summary.total || 0;
    const successful = summary.successful || 0;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
    const avgDuration = summary.avgResponseTime || 0;
    const p95Duration = performanceAnalytics?.percentiles?.p95 || 0;

    return [
      {
        label: 'Total Executions',
        value: formatNumber(total),
        delta: timeLabel,
        icon: <DashboardOutlined />,
        tone: themeColors.primary.default,
        onClick: () => onNavigate('/logs?triggerType=SCHEDULED')
      },
      {
        label: 'Execution Success Rate',
        value: `${successRate}%`,
        delta: `${formatNumber(successful)} successful`,
        icon: <CheckCircleOutlined />,
        tone: parseFloat(successRate) >= 95 ? themeColors.success.text : parseFloat(successRate) >= 85 ? themeColors.warning.text : themeColors.error.text,
        onClick: () => onNavigate('/logs?triggerType=SCHEDULED&status=SUCCESS')
      },
      {
        label: 'Avg Execution Duration',
        value: formatDuration(avgDuration),
        delta: `P95: ${formatDuration(p95Duration)}`,
        icon: <ClockCircleOutlined />,
        tone: themeColors.info.text
      },
      {
        label: 'Next Scheduled Run',
        value: nextScheduledRun?.countdown || '—',
        delta: nextScheduledRun?.job?.name || 'No active jobs',
        icon: <WarningOutlined />,
        tone: nextScheduledRun?.ms && nextScheduledRun.ms < 5 * 60 * 1000 ? themeColors.warning.text : themeColors.success.text
      }
    ];
  }, [analytics, performanceAnalytics, themeColors, timeLabel, nextScheduledRun, onNavigate]);

  // Job Health Table Data
  const jobHealthData = useMemo(() => {
    return integrationPerformance.map((job: any) => {
      const successRate = parseFloat(job.successRate) || 0;
      const jobDetails = scheduledJobs.find((j: any) => j.id === job.__KEEP___KEEP_integrationConfig__Id__);

      // Determine health status
      let health: { status: string; color: string } = { status: 'Healthy', color: themeColors.success.text };
      if (successRate < 85) {
        health = { status: 'Unhealthy', color: themeColors.error.text };
      } else if (successRate < 95) {
        health = { status: 'Degraded', color: themeColors.warning.text };
      }

      // Check if execution is delayed
      if (jobDetails?.nextRunTime) {
        const nextRun = new Date(jobDetails.nextRunTime).getTime();
        const now = Date.now();
        if (nextRun < now - 60 * 60 * 1000) { // More than 1 hour overdue
          health = { status: 'Delayed', color: themeColors.error.text };
        }
      }

      return {
        ...job,
        schedule: jobDetails?.schedule?.expression || jobDetails?.schedule?.intervalMs ?
          (jobDetails.schedule.expression || `Every ${formatDuration(jobDetails.schedule.intervalMs)}`) : '—',
        lastRun: job.lastSuccessful || job.lastFailed || null,
        nextRun: jobDetails?.nextRunTime || null,
        health,
        recordsProcessed: job.recordsProcessed || 0
      };
    }).sort((a, b) => a.health.status.localeCompare(b.health.status) || b.total - a.total);
  }, [integrationPerformance, scheduledJobs, themeColors]);

  // Execution Reliability Chart Data
  const reliabilityChartData = useMemo(() => {
    const dailyData = timeseriesDaily?.data || [];
    return dailyData.map((point: any) => {
      const total = point.total || 0;
      const successful = point.successful || 0;
      const failed = point.failed || 0;
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      return {
        date: point.date || point.label,
        successful,
        failed,
        successRate
      };
    });
  }, [timeseriesDaily]);

  // Failure Analysis
  const failureAnalysis = useMemo(() => {
    const topErrors = errorAnalytics?.topErrors || [];
    const failedJobs = integrationPerformance.filter((job: any) => job.failed > 0);

    // Missed schedules (executions that should have happened but didn't)
    const missedSchedules = 0; // Would need actual data from backend

    // Retry patterns
    const retriedErrors = topErrors.filter((err: any) => err.retryCount && err.retryCount > 0);

    return {
      topFailureReasons: topErrors.slice(0, 5),
      missedSchedules,
      retriedErrors: retriedErrors.length,
      failedJobsCount: failedJobs.length
    };
  }, [errorAnalytics, integrationPerformance]);

  // Records Processed Trend
  const recordsProcessedTrend = useMemo(() => {
    // Group logs by date and job
    const groupedByDate: Record<string, Record<string, number>> = {};

    scheduledJobLogs.forEach((log: any) => {
      const date = new Date(log.startedAt || log.createdAt).toISOString().split('T')[0];
      const jobName = log.integrationName || 'Unknown';
      const records = log.recordsFetched || 0;

      if (!groupedByDate[date]) groupedByDate[date] = {};
      groupedByDate[date][jobName] = (groupedByDate[date][jobName] || 0) + records;
    });

    // Convert to chart format
    const chartData = Object.entries(groupedByDate).map(([date, jobs]) => {
      const dataPoint: any = { date };
      let total = 0;
      Object.entries(jobs).forEach(([jobName, count]) => {
        dataPoint[jobName] = count;
        total += count as number;
      });
      dataPoint.total = total;
      return dataPoint;
    }).sort((a, b) => a.date.localeCompare(b.date));

    return chartData;
  }, [scheduledJobLogs]);

  // Data Source Performance (from execution logs)
  const dataSourcePerformance = useMemo(() => {
    // Group by integration to calculate data source metrics
    const grouped: Record<string, { queryTimes: number[]; timeouts: number; totalRecords: number; count: number }> = {};

    scheduledJobLogs.forEach((log: any) => {
      const integrationId = log.integrationConfigId || 'unknown';
      if (!grouped[integrationId]) {
        grouped[integrationId] = { queryTimes: [], timeouts: 0, totalRecords: 0, count: 0 };
      }

      const duration = log.durationMs || 0;
      grouped[integrationId].queryTimes.push(duration);
      grouped[integrationId].totalRecords += log.recordsFetched || 0;
      grouped[integrationId].count += 1;

      if (log.status === 'FAILED' && log.errorMessage?.toLowerCase().includes('timeout')) {
        grouped[integrationId].timeouts += 1;
      }
    });

    return Object.entries(grouped).map(([integrationId, stats]) => {
      const integration = integrationPerformance.find((j: any) =>
        j.__KEEP___KEEP_integrationConfig__Id__ === integrationId
      );

      const avgQueryTime = stats.queryTimes.length > 0
        ? stats.queryTimes.reduce((a, b) => a + b, 0) / stats.queryTimes.length
        : 0;
      const maxQueryTime = stats.queryTimes.length > 0 ? Math.max(...stats.queryTimes) : 0;
      const timeoutRate = stats.count > 0 ? (stats.timeouts / stats.count) * 100 : 0;

      return {
        dataSource: integration?.__KEEP_integrationName__ || 'Unknown',
        avgQueryTime: Math.round(avgQueryTime),
        maxQueryTime: Math.round(maxQueryTime),
        timeoutRate: timeoutRate.toFixed(1),
        totalRecords: stats.totalRecords
      };
    }).sort((a, b) => b.totalRecords - a.totalRecords).slice(0, 10);
  }, [scheduledJobLogs, integrationPerformance]);

  return (
    <>
      {/* Real-Time Health Status KPI Cards */}
      <section className="dashboard-overview" style={{ marginTop: spacing[4] }}>
        <div className="dashboard-kpis">
          {kpiMetrics.map((metric) => (
            <DashboardMetricTile
              key={metric.label}
              {...metric}
              loading={analyticsLoading}
            />
          ))}
        </div>
      </section>

      {/* Job Performance Metrics - Job Health Table */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          title={<DashboardSectionTitle title="Job Health Status" subtitle="Health and performance metrics for scheduled jobs" />}
          styles={{ body: { padding: 0 } }}
          variant="borderless"
          loading={analyticsLoading}
        >
          {jobHealthData.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={jobHealthData}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} jobs`,
                position: ['bottomCenter']
              }}
              rowKey="__KEEP___KEEP_integrationConfig__Id__"
              columns={[
                {
                  title: 'Job Name',
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 220,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.__KEEP_integrationName__.localeCompare(b.__KEEP_integrationName__),
                  render: (name: string, record: any) => (
                    <Typography.Link
                      onClick={() => onNavigate(getIntegrationPath(record))}
                      style={{ fontWeight: 600, fontSize: 14 }}
                      ellipsis
                    >
                      {name || 'Unknown'}
                    </Typography.Link>
                  )
                },
                {
                  title: 'Schedule',
                  dataIndex: 'schedule',
                  key: 'schedule',
                  width: 180,
                  ellipsis: true,
                  render: (schedule: string) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                      {schedule}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Last Run',
                  dataIndex: 'lastRun',
                  key: 'lastRun',
                  width: 150,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(timestamp)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )
                },
                {
                  title: 'Next Run',
                  dataIndex: 'nextRun',
                  key: 'nextRun',
                  width: 150,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Typography.Text style={{ fontSize: 12 }}>
                        {formatDateTime(timestamp)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: string) => {
                    const numRate = parseFloat(rate);
                    const color = numRate >= 95 ? themeColors.success.text : numRate >= 85 ? themeColors.warning.text : themeColors.error.text;
                    return (
                      <Tag style={tagTone(color)}>
                        {rate}%
                      </Tag>
                    );
                  }
                },
                {
                  title: 'Avg Duration',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (duration: number) => (
                    <Typography.Text style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
                      {formatDuration(duration)}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Records Processed',
                  dataIndex: 'recordsProcessed',
                  key: 'recordsProcessed',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.recordsProcessed - b.recordsProcessed,
                  render: (count: number) => (
                    <Typography.Text style={{ fontSize: 13 }}>
                      {count > 0 ? formatNumber(count) : '—'}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Status',
                  dataIndex: 'health',
                  key: 'health',
                  align: 'center',
                  width: 120,
                  fixed: 'right',
                  sorter: (a: any, b: any) => a.health.status.localeCompare(b.health.status),
                  render: (health: any) => (
                    <Tag
                      style={{
                        borderRadius: borderRadius.full,
                        fontSize: 12,
                        padding: `${spacing['0.5']} ${spacing[2]}`,
                        borderColor: withAlpha(health.color, 0.25),
                        background: withAlpha(health.color, 0.1),
                        color: health.color,
                        fontWeight: 700,
                        margin: 0
                      }}
                    >
                      {health.status}
                    </Tag>
                  )
                }
              ]}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[9]} 0` }}>
              <WarningOutlined style={{ fontSize: spacing[10], color: cssVar.text.disabled }} />
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: spacing[2] }}>
                {noDataHint}
              </Typography.Text>
            </div>
          )}
        </Card>
      </section>

      {/* Execution Duration Trend */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          variant="borderless"
          title={<DashboardSectionTitle title="Execution Duration Trend" subtitle={`Average job execution times over time (${timeLabel})`} />}
          styles={{ body: { padding: spacing[5] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : reliabilityChartData.length > 0 ? (
            <LineChart
              data={reliabilityChartData}
              lines={[
                { dataKey: 'successRate', name: 'Success Rate %', color: themeColors.success.text, strokeWidth: 2 }
              ]}
              xAxisKey="date"
              height={260}
              showLegend={true}
              smooth={true}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
              <Typography.Text type="secondary">{noDataHint}</Typography.Text>
            </div>
          )}
        </Card>
      </section>

      {/* Reliability Tracking */}
      <section className="dashboard-tab-grid">
        <Card
          style={panelStyle}
          variant="borderless"
          title={<DashboardSectionTitle title="Execution Reliability" subtitle={`Success vs failure by day (${timeLabel})`} />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : reliabilityChartData.length > 0 ? (
            <ComposedChart
              data={reliabilityChartData}
              bars={[
                { dataKey: 'successful', name: 'Successful', color: themeColors.success.text, stackId: 'a' },
                { dataKey: 'failed', name: 'Failed', color: themeColors.error.text, stackId: 'a' }
              ]}
              lines={[
                { dataKey: 'successRate', name: 'Success Rate %', color: themeColors.primary.default, strokeWidth: 2 }
              ]}
              xAxisKey="date"
              height={300}
              showLegend={true}
              barSize={24}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
              <Typography.Text type="secondary">{noDataHint}</Typography.Text>
            </div>
          )}
        </Card>

        <Card
          style={panelStyle}
          variant="borderless"
          title={<DashboardSectionTitle title="Failure Analysis" subtitle="Error patterns and retry metrics" />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (
            <>
              <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%', marginBottom: spacing[4] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing[3]} ${spacing[4]}`, background: token.colorBgTextHover, borderRadius: token.borderRadius }}>
                  <Typography.Text type="secondary">Failed Jobs</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 16, color: themeColors.error.text }}>
                    {failureAnalysis.failedJobsCount}
                  </Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing[3]} ${spacing[4]}`, background: token.colorBgTextHover, borderRadius: token.borderRadius }}>
                  <Typography.Text type="secondary">Retry Attempts</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 16, color: themeColors.warning.text }}>
                    {failureAnalysis.retriedErrors}
                  </Typography.Text>
                </div>
              </Space>

              {failureAnalysis.topFailureReasons.length > 0 && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: spacing[2] }}>
                    Top Failure Reasons
                  </Typography.Text>
                  <List
                    size="small"
                    dataSource={failureAnalysis.topFailureReasons}
                    renderItem={(error: any) => (
                      <List.Item style={{ padding: `${spacing[2]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Typography.Text ellipsis style={{ fontSize: 12, maxWidth: 180 }}>
                            {error.category || error.errorMessage}
                          </Typography.Text>
                          <Tag style={tagTone(themeColors.error.text)}>
                            {formatNumber(error.count)}
                          </Tag>
                        </Space>
                      </List.Item>
                    )}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {/* Data Processing Metrics */}
      {recordsProcessedTrend.length > 0 && (
        <section className="dashboard-tab-grid">
          <Card
            style={panelStyle}
            variant="borderless"
            title={<DashboardSectionTitle title="Records Processed" subtitle={`Total records fetched per day (${timeLabel})`} />}
            styles={{ body: { padding: spacing[5] } }}
          >
            {analyticsLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              <BarChart
                data={recordsProcessedTrend}
                bars={[
                  { dataKey: 'total', name: 'Records', color: themeColors.primary.default }
                ]}
                xAxisKey="date"
                height={280}
                showLegend={false}
                barSize={24}
                yAxisTickFormatter={(value) => formatNumber(value)}
                hiddenLegends={hiddenLegends}
                onLegendClick={onLegendClick}
              />
            )}
          </Card>

          <Card
            style={panelStyle}
            variant="borderless"
            title={<DashboardSectionTitle title="Data Source Performance" subtitle="Query times and timeout rates" />}
            styles={{ body: { padding: 0 } }}
          >
            {analyticsLoading ? (
              <div style={{ padding: spacing[4] }}>
                <Skeleton active paragraph={{ rows: 6 }} />
              </div>
            ) : dataSourcePerformance.length > 0 ? (
              <ModernTable<any>
                size="small"
                dataSource={dataSourcePerformance}
                enableResize={false}
                stickyHeader={false}
                pagination={false}
                rowKey="dataSource"
                columns={[
                  {
                    title: 'Data Source',
                    dataIndex: 'dataSource',
                    key: 'dataSource',
                    width: 180,
                    ellipsis: true,
                    render: (name: string) => (
                      <Typography.Text style={{ fontSize: 13, fontWeight: 500 }}>
                        {name}
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Avg Query Time',
                    dataIndex: 'avgQueryTime',
                    key: 'avgQueryTime',
                    align: 'right',
                    width: 140,
                    render: (time: number) => (
                      <Typography.Text style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                        {formatDuration(time)}
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Max Query Time',
                    dataIndex: 'maxQueryTime',
                    key: 'maxQueryTime',
                    align: 'right',
                    width: 140,
                    render: (time: number) => (
                      <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                        {formatDuration(time)}
                      </Typography.Text>
                    )
                  },
                  {
                    title: 'Timeout Rate',
                    dataIndex: 'timeoutRate',
                    key: 'timeoutRate',
                    align: 'right',
                    width: 120,
                    render: (rate: string) => {
                      const numRate = parseFloat(rate);
                      return numRate > 0 ? (
                        <Tag style={tagTone(themeColors.error.text)}>
                          {rate}%
                        </Tag>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>0%</Typography.Text>
                      );
                    }
                  },
                  {
                    title: 'Total Records',
                    dataIndex: 'totalRecords',
                    key: 'totalRecords',
                    align: 'right',
                    width: 130,
                    render: (count: number) => (
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {formatNumber(count)}
                      </Typography.Text>
                    )
                  }
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
                <Typography.Text type="secondary">{noDataHint}</Typography.Text>
              </div>
            )}
          </Card>
        </section>
      )}
    </>
  );
};
