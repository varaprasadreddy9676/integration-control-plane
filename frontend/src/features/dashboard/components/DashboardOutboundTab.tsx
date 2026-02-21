import { useMemo } from 'react';
import { Card, Tag, Typography, Skeleton, List, Space } from 'antd';
import { WarningOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { BarChart, PieChart } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatNumber, formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber, withAlpha } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardOutboundTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  analytics: any;
  performanceAnalytics: any;
  errorAnalytics: any;
  timeseriesDaily: any;
  integrationPerformance: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardOutboundTab = ({
  days,
  timeLabel,
  analyticsLoading,
  analytics,
  performanceAnalytics,
  errorAnalytics,
  timeseriesDaily,
  integrationPerformance,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick
}: DashboardOutboundTabProps) => {
  const { themeColors, spacing, token, borderRadius } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  // Event Type Performance Metrics
  const eventTypeMetrics = useMemo(() => {
    const eventTypes = analytics?.eventTypes || {};
    const timeseriesData = timeseriesDaily?.data || [];

    return Object.entries(eventTypes).map(([eventType, stats]: [string, any]) => {
      const total = stats.total || 0;
      const successful = stats.successful || 0;
      const failed = stats.failed || 0;
      const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
      const avgLatency = stats.avgResponseTime || 0;

      // Calculate trend from timeseries
      const eventTypeSeries = timeseriesData
        .map((point: any) => {
          const eventData = point.eventTypes?.[eventType];
          return eventData ? (eventData.successful / (eventData.total || 1)) * 100 : 0;
        })
        .filter((v: number) => v > 0);

      let trend = 0;
      if (eventTypeSeries.length >= 2) {
        const recent = eventTypeSeries.slice(-Math.ceil(eventTypeSeries.length / 2));
        const older = eventTypeSeries.slice(0, Math.floor(eventTypeSeries.length / 2));
        const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a: number, b: number) => a + b, 0) / older.length;
        trend = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
      }

      return {
        eventType,
        total,
        successRate: parseFloat(successRate),
        avgLatency: Math.round(avgLatency),
        failed,
        trend
      };
    }).sort((a, b) => b.total - a.total);
  }, [analytics, timeseriesDaily]);

  // Per-Integration Health Status
  const integrationHealth = useMemo(() => {
    return integrationPerformance.map((integration: any) => {
      const successRate = parseFloat(integration.successRate) || 0;
      const health = successRate >= 95
        ? { status: 'Healthy', color: themeColors.success.text }
        : successRate >= 85
        ? { status: 'Degraded', color: themeColors.warning.text }
        : { status: 'Unhealthy', color: themeColors.error.text };

      // Find primary failure reason from error analytics
      const integrationErrors = errorAnalytics?.topErrors?.filter((err: any) =>
        err.__KEEP_integrationConfigId__ === integration.__KEEP___KEEP_integrationConfig__Id__
      ) || [];
      const primaryFailure = integrationErrors[0]?.category || integrationErrors[0]?.errorMessage || '—';

      return {
        ...integration,
        health,
        primaryFailure: primaryFailure.length > 50 ? primaryFailure.substring(0, 50) + '...' : primaryFailure,
        lastDelivery: integration.lastSuccessful || integration.lastFailed || null
      };
    }).sort((a, b) => a.health.status.localeCompare(b.health.status) || b.total - a.total);
  }, [integrationPerformance, errorAnalytics, themeColors]);

  // Response Time Distribution
  const responseTimeDistribution = useMemo(() => {
    const buckets = performanceAnalytics?.distribution?.buckets || [];
    return buckets.map((bucket: any) => ({
      label: bucket.label,
      count: bucket.count,
      percentage: performanceAnalytics?.distribution?.total > 0
        ? ((bucket.count / performanceAnalytics.distribution.total) * 100).toFixed(1)
        : '0.0'
    }));
  }, [performanceAnalytics]);

  // Top Failures by Category
  const failuresByCategory = useMemo(() => {
    const categories = errorAnalytics?.summary?.errorCategories || {};
    return Object.entries(categories).map(([category, count]) => ({
      name: category,
      value: count as number
    })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [errorAnalytics]);

  // Affected Integrations by Failures
  const affectedIntegrations = useMemo(() => {
    return integrationPerformance
      .filter((integration: any) => integration.failed > 0)
      .sort((a: any, b: any) => b.failed - a.failed)
      .slice(0, 10);
  }, [integrationPerformance]);

  return (
    <>
      {/* Event Type Performance Table */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          title={<DashboardSectionTitle title="Event Type Performance" subtitle="Success rates and latency by event type" />}
          styles={{ body: { padding: 0 } }}
          variant="borderless"
          loading={analyticsLoading}
        >
          {eventTypeMetrics.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={eventTypeMetrics}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} event types`,
                position: ['bottomCenter']
              }}
              rowKey="eventType"
              onRow={(record) => ({
                onClick: () => onNavigate(`/logs?eventType=${encodeURIComponent(record.eventType)}`),
                style: { cursor: 'pointer' }
              })}
              columns={[
                {
                  title: 'Event Type',
                  dataIndex: 'eventType',
                  key: 'eventType',
                  width: 280,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.eventType.localeCompare(b.eventType),
                  render: (name: string) => (
                    <Typography.Text style={{ fontWeight: 600, fontSize: 14 }}>
                      {name}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Total Deliveries',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Typography.Text strong style={{ fontSize: 13, color: token.colorText }}>
                      {formatNumber(value)}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.successRate - b.successRate,
                  render: (rate: number) => {
                    const color = rate >= 95 ? themeColors.success : rate >= 85 ? themeColors.warning : themeColors.error;
                    return (
                      <Tag
                        style={{
                          borderRadius: borderRadius.full,
                          fontSize: 12,
                          padding: `${spacing['1']} ${spacing[2]}`,
                          borderColor: color.border,
                          background: color.bg,
                          color: color.text,
                          fontWeight: 700,
                          margin: 0
                        }}
                      >
                        {rate}%
                      </Tag>
                    );
                  }
                },
                {
                  title: 'Avg Latency',
                  dataIndex: 'avgLatency',
                  key: 'avgLatency',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgLatency - b.avgLatency,
                  render: (latency: number) => (
                    <Typography.Text style={{ fontSize: 13, color: token.colorText, fontFamily: 'ui-monospace, monospace' }}>
                      {latency} ms
                    </Typography.Text>
                  )
                },
                {
                  title: 'Failures',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 120,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  render: (count: number) =>
                    count > 0 ? (
                      <Tag style={tagTone(themeColors.error.text)}>
                        {formatNumber(count)}
                      </Tag>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>—</Typography.Text>
                    )
                },
                {
                  title: 'Trend',
                  dataIndex: 'trend',
                  key: 'trend',
                  align: 'right',
                  width: 100,
                  render: (trend: number) => {
                    if (Math.abs(trend) < 0.5) {
                      return <Typography.Text type="secondary" style={{ fontSize: 13 }}>—</Typography.Text>;
                    }
                    const color = trend > 0 ? themeColors.success.text : themeColors.error.text;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing['0.5'], justifyContent: 'flex-end' }}>
                        {trend > 0 ? <ArrowUpOutlined style={{ color, fontSize: 12 }} /> : <ArrowDownOutlined style={{ color, fontSize: 12 }} />}
                        <Typography.Text style={{ color, fontSize: 12, fontWeight: 600 }}>
                          {Math.abs(trend).toFixed(1)}%
                        </Typography.Text>
                      </div>
                    );
                  }
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

      {/* Per-Integration Health Table */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          title={<DashboardSectionTitle title="Integration Health" subtitle="Health status and performance by integration" />}
          styles={{ body: { padding: 0 } }}
          variant="borderless"
          loading={analyticsLoading}
        >
          {integrationHealth.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={integrationHealth}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} integrations`,
                position: ['bottomCenter']
              }}
              rowKey="__KEEP___KEEP_integrationConfig__Id__"
              columns={[
                {
                  title: 'Integration Name',
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
                  title: 'Health',
                  dataIndex: 'health',
                  key: 'health',
                  align: 'center',
                  width: 120,
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
                  title: 'Avg Latency',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Typography.Text style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
                      {Math.round(latency)} ms
                    </Typography.Text>
                  )
                },
                {
                  title: 'Last Delivery',
                  dataIndex: 'lastDelivery',
                  key: 'lastDelivery',
                  align: 'right',
                  width: 140,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(timestamp)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>—</Typography.Text>
                    )
                },
                {
                  title: 'Total',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Typography.Text style={{ fontSize: 13 }}>
                      {formatNumber(value)}
                    </Typography.Text>
                  )
                },
                {
                  title: 'Failed',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  render: (count: number) =>
                    count > 0 ? (
                      <Tag style={tagTone(themeColors.error.text)}>
                        {formatNumber(count)}
                      </Tag>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>—</Typography.Text>
                    )
                },
                {
                  title: 'Primary Failure Reason',
                  dataIndex: 'primaryFailure',
                  key: 'primaryFailure',
                  width: 280,
                  ellipsis: true,
                  render: (reason: string) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: reason }}>
                      {reason}
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

      {/* Response Time Distribution & Top Failures */}
      <section className="dashboard-tab-grid">
        <Card
          style={panelStyle}
          variant="borderless"
          title={<DashboardSectionTitle title="Response Time Distribution" subtitle={`Distribution of webhook response times (${timeLabel})`} />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : responseTimeDistribution.length > 0 ? (
            <BarChart
              data={responseTimeDistribution}
              bars={[
                { dataKey: 'count', name: 'Deliveries', color: themeColors.primary.default }
              ]}
              xAxisKey="label"
              height={300}
              layout="horizontal"
              showLegend={false}
              yAxisTickFormatter={(value) => formatNumber(value)}
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
          title={<DashboardSectionTitle title="Top Failures Analysis" subtitle={`Error categories and affected integrations (${timeLabel})`} />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : failuresByCategory.length > 0 ? (
            <>
              <PieChart
                data={failuresByCategory}
                height={220}
                showLegend={false}
                innerRadius={50}
                outerRadius={80}
                label={true}
                paddingAngle={2}
                onSliceClick={(data) => onNavigate(`/logs?status=FAILED&errorCategory=${encodeURIComponent(data.name)}`)}
                hiddenLegends={hiddenLegends}
                onLegendClick={onLegendClick}
              />
              <div style={{ marginTop: spacing[3], maxHeight: 180, overflowY: 'auto' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: spacing[2] }}>
                  Most Affected Integrations
                </Typography.Text>
                <List
                  size="small"
                  dataSource={affectedIntegrations}
                  renderItem={(integration: any) => (
                    <List.Item
                      style={{
                        padding: `${spacing[2]} 0`,
                        borderBlockEnd: `1px solid ${cssVar.border.default}`,
                        cursor: 'pointer'
                      }}
                      onClick={() => onNavigate(getIntegrationPath(integration))}
                    >
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Typography.Text
                          ellipsis
                          style={{ fontSize: 13, fontWeight: 500, maxWidth: 200 }}
                        >
                          {integration.__KEEP_integrationName__}
                        </Typography.Text>
                        <Tag style={tagTone(themeColors.error.text)}>
                          {formatNumber(integration.failed)} failures
                        </Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
              <Typography.Text type="secondary">{noDataHint}</Typography.Text>
            </div>
          )}
        </Card>
      </section>
    </>
  );
};
