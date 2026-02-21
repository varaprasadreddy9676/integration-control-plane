import { useMemo } from 'react';
import { Card, Typography, Skeleton, List, Space, Tag } from 'antd';
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { LineChart, BarChart, ComposedChart, HeatmapChart, HeatmapData } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatNumber } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { DashboardSectionTitle, DashboardMetricTile, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardInboundTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  analytics: any;
  timeseriesHourly: any;
  timeseriesDaily: any;
  performanceAnalytics: any;
  errorAnalytics: any;
  integrationPerformance: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardInboundTab = ({
  days,
  timeLabel,
  analyticsLoading,
  analytics,
  timeseriesHourly,
  timeseriesDaily,
  performanceAnalytics,
  errorAnalytics,
  integrationPerformance,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick
}: DashboardInboundTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  // KPI Metrics
  const kpiMetrics = useMemo(() => {
    const summary = analytics?.summary || {};
    const total = summary.total || 0;
    const successful = summary.successful || 0;
    const failed = summary.failed || 0;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
    const avgResponseTime = summary.avgResponseTime || 0;
    const p95 = performanceAnalytics?.percentiles?.p95 || 0;

    // Calculate rate limit status (placeholder - would need actual rate limit data)
    const rateLimitPercentage = 100; // Assume 100% available if no data

    return [
      {
        label: 'Total Requests',
        value: formatNumber(total),
        delta: timeLabel,
        icon: <ApiOutlined />,
        tone: themeColors.primary.default,
        onClick: () => onNavigate('/logs?direction=INBOUND')
      },
      {
        label: 'Success Rate',
        value: `${successRate}%`,
        delta: `${formatNumber(successful)} successful`,
        icon: <CheckCircleOutlined />,
        tone: parseFloat(successRate) >= 95 ? themeColors.success.text : parseFloat(successRate) >= 85 ? themeColors.warning.text : themeColors.error.text,
        onClick: () => onNavigate('/logs?direction=INBOUND&status=SUCCESS')
      },
      {
        label: 'Avg Response Time',
        value: `${Math.round(avgResponseTime)} ms`,
        delta: `P95: ${Math.round(p95)} ms`,
        icon: <ClockCircleOutlined />,
        tone: themeColors.info.text
      },
      {
        label: 'Rate Limit Status',
        value: `${rateLimitPercentage}%`,
        delta: 'Available capacity',
        icon: <WarningOutlined />,
        tone: rateLimitPercentage > 80 ? themeColors.success.text : rateLimitPercentage > 50 ? themeColors.warning.text : themeColors.error.text
      }
    ];
  }, [analytics, performanceAnalytics, themeColors, timeLabel, onNavigate]);

  // Response Time Trend Data
  const responseTimeTrend = useMemo(() => {
    const hourlyData = timeseriesHourly?.data || [];
    return hourlyData.map((point: any) => ({
      hour: point.hour || point.date || point.label,
      count: point.total || 0,
      avgResponseTime: point.avgResponseTime || 0,
      successful: point.successful || 0,
      failed: point.failed || 0
    }));
  }, [timeseriesHourly]);

  // Performance by Endpoint Table Data
  const endpointPerformance = useMemo(() => {
    return integrationPerformance.map((integration: any) => {
      const p95 = integration.p95 || integration.avgResponseTime * 1.5; // Estimate if not available
      const p99 = integration.p99 || integration.avgResponseTime * 2; // Estimate if not available
      return {
        ...integration,
        p95: Math.round(p95),
        p99: Math.round(p99)
      };
    }).sort((a, b) => b.total - a.total);
  }, [integrationPerformance]);

  // Success Rate by Integration for Reliability Chart
  const reliabilityChartData = useMemo(() => {
    return integrationPerformance
      .slice(0, 10) // Top 10
      .map((integration: any) => {
        const successRate = parseFloat(integration.successRate) || 0;
        const failureRate = 100 - successRate;
        return {
          name: integration.__KEEP_integrationName__?.substring(0, 30) || 'Unknown',
          nameShort: integration.__KEEP_integrationName__?.substring(0, 20) || 'Unknown',
          successRate,
          failureRate,
          total: integration.total
        };
      })
      .sort((a, b) => a.successRate - b.successRate); // Sort by success rate ascending to show problematic ones first
  }, [integrationPerformance]);

  // Authentication Metrics (derived from error analytics)
  const authMetrics = useMemo(() => {
    const authErrors = errorAnalytics?.topErrors?.filter((err: any) =>
      err.category?.toLowerCase().includes('auth') ||
      err.category?.toLowerCase().includes('unauthorized') ||
      err.errorMessage?.toLowerCase().includes('auth')
    ) || [];

    const authFailureCount = authErrors.reduce((sum: number, err: any) => sum + (err.count || 0), 0);
    const totalRequests = analytics?.summary?.total || 0;
    const authSuccessRate = totalRequests > 0 ? ((totalRequests - authFailureCount) / totalRequests * 100).toFixed(1) : '100.0';

    return {
      authSuccessRate,
      authFailureCount,
      topAuthErrors: authErrors.slice(0, 5)
    };
  }, [errorAnalytics, analytics]);

  // Request Volume Trend
  const requestVolumeTrend = useMemo(() => {
    const dailyData = timeseriesDaily?.data || [];

    return dailyData.map((point: any) => ({
      date: point.date || point.label,
      total: point.total || 0
    }));
  }, [timeseriesDaily]);

  // Peak Hours Heatmap
  const heatmapData: HeatmapData[] = useMemo(() => {
    const hourlyData = timeseriesHourly?.data || [];
    const heatmap: HeatmapData[] = [];

    // Group by day of week and hour
    const groupedData: Record<string, Record<string, number>> = {};

    hourlyData.forEach((point: any) => {
      if (point.hour && point.dayOfWeek !== undefined) {
        const day = point.dayOfWeek;
        const hour = point.hour;
        if (!groupedData[day]) groupedData[day] = {};
        groupedData[day][hour] = (groupedData[day][hour] || 0) + (point.total || 0);
      }
    });

    // Convert to heatmap format
    Object.entries(groupedData).forEach(([day, hours]) => {
      Object.entries(hours).forEach(([hour, value]) => {
        heatmap.push({
          x: parseInt(hour),
          y: parseInt(day),
          value
        });
      });
    });

    return heatmap;
  }, [timeseriesHourly]);

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

      {/* API Performance Metrics */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          variant="borderless"
          title={<DashboardSectionTitle title="API Performance Trends" subtitle={`Response time and request volume over time (${timeLabel})`} />}
          styles={{ body: { padding: spacing[5] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : responseTimeTrend.length > 0 ? (
            <ComposedChart
              data={responseTimeTrend}
              bars={[
                { dataKey: 'count', name: 'Requests', color: themeColors.primary.default }
              ]}
              lines={[
                { dataKey: 'avgResponseTime', name: 'Avg Response Time (ms)', color: themeColors.info.text, strokeWidth: 2 }
              ]}
              xAxisKey="hour"
              height={280}
              showLegend={true}
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
          style={{ marginTop: spacing[4] }}
          variant="borderless"
          title={<DashboardSectionTitle title="Performance by Endpoint" subtitle="Latency and success metrics per inbound integration" />}
          styles={{ body: { padding: 0 } }}
        >
          {analyticsLoading ? (
            <div style={{ padding: spacing[4] }}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </div>
          ) : endpointPerformance.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={endpointPerformance}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} endpoints`,
                position: ['bottomCenter']
              }}
              rowKey="__KEEP___KEEP_integrationConfig__Id__"
              columns={[
                {
                  title: 'Endpoint',
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 250,
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
                  title: 'Total Requests',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {formatNumber(value)}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 140,
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
                  title: 'Avg Response',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Typography.Text style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
                      {Math.round(latency)} ms
                    </Typography.Text>
                  )
                },
                {
                  title: 'P95',
                  dataIndex: 'p95',
                  key: 'p95',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.p95 - b.p95,
                  render: (latency: number) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                      {latency} ms
                    </Typography.Text>
                  )
                },
                {
                  title: 'P99',
                  dataIndex: 'p99',
                  key: 'p99',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.p99 - b.p99,
                  render: (latency: number) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                      {latency} ms
                    </Typography.Text>
                  )
                }
              ]}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[9]} 0` }}>
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
          title={<DashboardSectionTitle title="Reliability by Integration" subtitle="Success vs failure rates for inbound APIs" />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : reliabilityChartData.length > 0 ? (
            <BarChart
              data={reliabilityChartData}
              bars={[
                { dataKey: 'successRate', name: 'Success %', color: themeColors.success.text, stackId: 'a' },
                { dataKey: 'failureRate', name: 'Failure %', color: themeColors.error.text, stackId: 'a' }
              ]}
              xAxisKey="nameShort"
              height={320}
              layout="horizontal"
              showLegend={true}
              barSize={24}
              wrapAxisLabels={true}
              axisLabelMaxWidth={110}
              yAxisTickFormatter={(value) => `${value}%`}
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
          title={<DashboardSectionTitle title="Authentication Metrics" subtitle="API authentication success and failure analysis" />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (
            <>
              <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing[3]} ${spacing[4]}`, background: token.colorBgTextHover, borderRadius: token.borderRadius }}>
                  <Typography.Text type="secondary">Auth Success Rate</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 16, color: themeColors.success.text }}>
                    {authMetrics.authSuccessRate}%
                  </Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${spacing[3]} ${spacing[4]}`, background: token.colorBgTextHover, borderRadius: token.borderRadius }}>
                  <Typography.Text type="secondary">Failed Auth Attempts</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 16, color: authMetrics.authFailureCount > 0 ? themeColors.error.text : cssVar.text.secondary }}>
                    {formatNumber(authMetrics.authFailureCount)}
                  </Typography.Text>
                </div>
              </Space>

              {authMetrics.topAuthErrors.length > 0 && (
                <div style={{ marginTop: spacing[4] }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: spacing[2] }}>
                    Top Auth Failures
                  </Typography.Text>
                  <List
                    size="small"
                    dataSource={authMetrics.topAuthErrors}
                    renderItem={(error: any) => (
                      <List.Item style={{ padding: `${spacing[2]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Typography.Text ellipsis style={{ fontSize: 12, maxWidth: 180 }}>
                            {error.errorMessage || error.category}
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

      {/* Usage Patterns */}
      <section className="dashboard-tab-grid">
        <Card
          style={panelStyle}
          variant="borderless"
          title={<DashboardSectionTitle title="Request Volume Trends" subtitle={`Daily request volume (${timeLabel})`} />}
          styles={{ body: { padding: spacing[5] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : requestVolumeTrend.length > 0 ? (
            <ComposedChart
              data={requestVolumeTrend}
              bars={[
                { dataKey: 'total', name: 'Requests', color: themeColors.primary.default }
              ]}
              lines={[]}
              xAxisKey="date"
              height={280}
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

        {days >= 7 && heatmapData.length > 0 && (
          <Card
            style={panelStyle}
            variant="borderless"
            title={<DashboardSectionTitle title="Peak Hours Heatmap" subtitle="Request patterns by day of week and hour" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            {analyticsLoading ? (
              <Skeleton active paragraph={{ rows: 8 }} />
            ) : (
              <HeatmapChart
                data={heatmapData}
                xLabels={hourLabels}
                yLabels={dayLabels}
                height={280}
                valueFormatter={(v) => formatNumber(v)}
                onCellClick={(data) => {
                  onNavigate(`/logs?direction=INBOUND&hour=${data.x}&dayOfWeek=${data.y}`);
                }}
              />
            )}
          </Card>
        )}
      </section>
    </>
  );
};
