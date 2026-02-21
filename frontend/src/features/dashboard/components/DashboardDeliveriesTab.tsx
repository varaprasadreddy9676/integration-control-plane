import { Button, Card, List, Segmented, Space, Tag, Typography, Skeleton } from 'antd';
import { BarChartOutlined, LineChartOutlined, WarningOutlined } from '@ant-design/icons';
import { BarChart, PieChart, FunnelChart, FunnelData } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { chartColors } from '../../../design-system/theme/chart-theme';
import { formatNumber } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardDeliveriesTabProps {
  analyticsLoading: boolean;
  integrationPerformance: Array<any>;
  performanceTitle: string;
  performanceSubtitle: string;
  performanceEntityLabel: string;
  manageLabel: string;
  onManageAll: () => void;
  onCreateNew: () => void;
  onViewEventAudit: () => void;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  timeLabel: string;
  performanceChartData: Array<any>;
  performanceChartMetric: 'percent' | 'count';
  setPerformanceChartMetric: (value: 'percent' | 'count') => void;
  performanceChartLayout: 'horizontal' | 'vertical';
  setPerformanceChartLayout: (value: 'horizontal' | 'vertical') => void;
  eventTypeView: 'chart' | 'list';
  setEventTypeView: (value: 'chart' | 'list') => void;
  eventTypeTitle: string;
  eventTypeSubtitle: string;
  eventTypeChartData: Array<{ name: string; value: number }>;
  eventTypeCounts: Record<string, number> | null;
  showEventAudit: boolean;
  eventAuditLoading: boolean;
  eventAuditStatusData: Array<{ name: string; value: number }>;
  eventAuditStats: { totalReceived?: number } | null;
  funnelData: FunnelData[];
  onEventTypeClick?: (data: any) => void;
  onEventAuditClick?: (data: any) => void;
  onPerformanceChartClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardDeliveriesTab = ({
  analyticsLoading,
  integrationPerformance,
  performanceTitle,
  performanceSubtitle,
  performanceEntityLabel,
  manageLabel,
  onManageAll,
  onCreateNew,
  onViewEventAudit,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  timeLabel,
  performanceChartData,
  performanceChartMetric,
  setPerformanceChartMetric,
  performanceChartLayout,
  setPerformanceChartLayout,
  eventTypeView,
  setEventTypeView,
  eventTypeTitle,
  eventTypeSubtitle,
  eventTypeChartData,
  eventTypeCounts,
  showEventAudit,
  eventAuditLoading,
  eventAuditStatusData,
  eventAuditStats,
  funnelData,
  onEventTypeClick,
  onEventAuditClick,
  onPerformanceChartClick,
  hiddenLegends,
  onLegendClick
}: DashboardDeliveriesTabProps) => {
  const { themeColors, spacing, token, borderRadius } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  const performanceChartBars = performanceChartMetric === 'count'
    ? [
      { dataKey: 'successCount', name: 'Success', color: themeColors.success.text, stackId: 'a' },
      { dataKey: 'failedCount', name: 'Failed', color: themeColors.error.text, stackId: 'a' }
    ]
    : [
      { dataKey: 'successRate', name: 'Success %', color: themeColors.success.text, stackId: 'a' },
      { dataKey: 'failureRate', name: 'Failure %', color: themeColors.error.text, stackId: 'a' }
    ];
  const formatMetric = (value: any) => (performanceChartMetric === 'percent' ? `${value}%` : `${value}`);

  return (
    <>
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          title={<DashboardSectionTitle title={performanceTitle} subtitle={performanceSubtitle} />}
          extra={
            <Button type="text" size="small" onClick={onManageAll}>
              {manageLabel}
            </Button>
          }
          styles={{ body: { padding: 0 } }}
          variant="borderless"
          loading={analyticsLoading}
        >
          {integrationPerformance && integrationPerformance.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={integrationPerformance}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 25,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50', '100'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} integrations`,
                position: ['bottomCenter']
              }}
              rowKey="__KEEP___KEEP_integrationConfig__Id__"
              columns={[
                {
                  title: performanceEntityLabel,
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 300,
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
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: number) => (
                    <Tag
                      style={{
                        borderRadius: borderRadius.full,
                        fontSize: 12,
                        padding: `${spacing['1']} ${spacing[2]}`,
                        borderColor: themeColors.success.border,
                        background: themeColors.success.bg,
                        color: themeColors.success.text,
                        fontWeight: 700,
                        margin: 0
                      }}
                    >
                      {rate}%
                    </Tag>
                  )
                },
                {
                  title: 'Avg Latency',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Typography.Text style={{ fontSize: 13, color: token.colorText, fontFamily: 'ui-monospace, monospace' }}>
                      {latency} ms
                    </Typography.Text>
                  )
                },
                {
                  title: 'Successful',
                  dataIndex: 'successful',
                  key: 'successful',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.successful - b.successful,
                  render: (count: number) => (
                    <Tag
                      style={{
                        borderRadius: borderRadius.full,
                        fontSize: 12,
                        padding: `${spacing['1']} ${spacing[2]}`,
                        borderColor: themeColors.success.border,
                        background: themeColors.success.bg,
                        color: themeColors.success.text,
                        fontWeight: 600,
                        margin: 0
                      }}
                    >
                      {formatNumber(count)}
                    </Tag>
                  )
                },
                {
                  title: 'Failed',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 120,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  resizable: false,
                  render: (count: number) =>
                    count > 0 ? (
                      <Tag
                        style={{
                          borderRadius: borderRadius.full,
                          fontSize: 12,
                          padding: `${spacing['1']} ${spacing[2]}`,
                          borderColor: themeColors.error.border,
                          background: themeColors.error.bg,
                          color: themeColors.error.text,
                          fontWeight: 700,
                          margin: 0
                        }}
                      >
                        {formatNumber(count)}
                      </Tag>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>—</Typography.Text>
                    )
                }
              ]}
            />
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: `${spacing[9]} 0`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: spacing[2]
              }}
            >
              <WarningOutlined style={{ fontSize: spacing[10], color: cssVar.text.disabled }} />
              <Typography.Text type="secondary">No activity in the selected period</Typography.Text>
              <Button type="primary" onClick={onCreateNew}>
                Create {performanceEntityLabel}
              </Button>
            </div>
          )}
        </Card>
      </section>

      <section className="dashboard-tab-grid">
        <Card
          style={panelStyle}
          variant="borderless"
          title={<DashboardSectionTitle title={`Success vs Failures (${timeLabel})`} subtitle={`Per ${performanceEntityLabel.toLowerCase()} delivery mix`} />}
          extra={
            <Space size={spacingToNumber(spacing[1])}>
              <Segmented
                size="small"
                value={performanceChartMetric}
                onChange={(value) => setPerformanceChartMetric(value as 'percent' | 'count')}
                options={[
                  { label: '% Rate', value: 'percent' },
                  { label: 'Count', value: 'count' }
                ]}
              />
              <Segmented
                size="small"
                value={performanceChartLayout}
                onChange={(value) => setPerformanceChartLayout(value as 'horizontal' | 'vertical')}
                options={[
                  { label: <BarChartOutlined />, value: 'horizontal' },
                  { label: <LineChartOutlined />, value: 'vertical' }
                ]}
              />
            </Space>
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : performanceChartData.length > 0 ? (
            <BarChart
              data={performanceChartData}
              bars={performanceChartBars}
              xAxisKey="nameShort"
              height={320}
              showLegend={true}
              layout={performanceChartLayout}
              barSize={performanceChartLayout === 'vertical' ? 18 : 24}
              wrapAxisLabels={true}
              axisLabelMaxWidth={110}
              axisLabelMaxLines={2}
              yAxisTickFormatter={performanceChartLayout === 'horizontal' ? formatMetric : undefined}
              xAxisTickFormatter={performanceChartLayout === 'vertical' ? formatMetric : undefined}
              onBarClick={onPerformanceChartClick}
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
          title={<DashboardSectionTitle title={`${eventTypeTitle} (${timeLabel})`} subtitle={eventTypeSubtitle} />}
          extra={
            <Segmented
              size="small"
              value={eventTypeView}
              onChange={(value) => setEventTypeView(value as 'chart' | 'list')}
              options={[
                { label: <BarChartOutlined />, value: 'chart' },
                { label: <LineChartOutlined />, value: 'list' }
              ]}
            />
          }
          styles={{ body: { padding: eventTypeView === 'chart' ? spacing[5] : spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : eventTypeChartData.length > 0 ? (
            eventTypeView === 'chart' ? (
              <>
                <PieChart
                  data={eventTypeChartData}
                  height={300}
                  showLegend={false}
                  innerRadius={60}
                  outerRadius={100}
                  label={true}
                  paddingAngle={2}
                  onSliceClick={onEventTypeClick}
                  hiddenLegends={hiddenLegends}
                  onLegendClick={onLegendClick}
                />
                <div
                  style={{
                    marginTop: spacing[2],
                    maxHeight: 120,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: spacing[1]
                  }}
                >
                  {eventTypeChartData.map((item, index) => (
                    <div
                      key={item.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing['0.5'],
                        minWidth: 0
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: borderRadius.full,
                          background: chartColors.categorical[index % chartColors.categorical.length],
                          flexShrink: 0
                        }}
                      />
                      <Typography.Text style={{ fontSize: 12, minWidth: 0 }} ellipsis={{ tooltip: item.name }}>
                        {item.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                        {formatNumber(item.value)}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1], maxHeight: 600, overflowY: 'auto' }}>
                <List
                  dataSource={Object.entries(eventTypeCounts || {})
                    .sort(([, a], [, b]) => (b as number) - (a as number))}
                  renderItem={([eventType, count]: [string, any]) => (
                    <List.Item style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography.Text style={{ color: token.colorText, fontSize: 13, fontWeight: 500 }}>{eventType}</Typography.Text>
                        <Tag style={tagTone(themeColors.info.text)}>{formatNumber(count)} events</Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
              <Typography.Text type="secondary">{noDataHint}</Typography.Text>
            </div>
          )}
        </Card>

        {showEventAudit && (
          <Card
            style={panelStyle}
            variant="borderless"
            title={<DashboardSectionTitle title={`Event Audit Status (${timeLabel})`} subtitle="Delivered, skipped, failed, and in-progress events" />}
            extra={
              <Button type="text" size="small" onClick={onViewEventAudit}>
                View Event Audit
              </Button>
            }
            styles={{ body: { padding: spacing[4] } }}
          >
            {eventAuditLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : eventAuditStatusData.length > 0 ? (
              <>
                <PieChart
                  data={eventAuditStatusData}
                  height={320}
                  showLegend={true}
                  innerRadius={70}
                  outerRadius={110}
                  label={true}
                  paddingAngle={2}
                  colors={[
                    themeColors.success.text,
                    themeColors.warning.text,
                    themeColors.error.text,
                    '#B91C1C',
                    themeColors.info.text
                  ]}
                  hiddenLegends={hiddenLegends}
                  onLegendClick={onLegendClick}
                  onSliceClick={onEventAuditClick}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: spacing[2] }}>
                  <Typography.Text type="secondary">Total received</Typography.Text>
                  <Typography.Text strong>{formatNumber(eventAuditStats?.totalReceived || 0)}</Typography.Text>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
                <Typography.Text type="secondary">{noDataHint}</Typography.Text>
              </div>
            )}
          </Card>
        )}

        {/* Funnel Chart */}
        {showEventAudit && funnelData.length > 0 && (
          <Card
            style={panelStyle}
            variant="borderless"
            title={<DashboardSectionTitle title={`Event Flow (${timeLabel})`} subtitle="Conversion funnel from received to delivered" />}
            styles={{ body: { padding: spacing[4] } }}
          >
            {eventAuditLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              <FunnelChart
                data={funnelData}
                height={300}
                showPercentages={true}
                onSegmentClick={onViewEventAudit}
              />
            )}
          </Card>
        )}
      </section>
    </>
  );
};
