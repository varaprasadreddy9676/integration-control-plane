import { Card, Skeleton, Space, Typography } from 'antd';
import { BarChart } from '../../../components/charts';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle } from './DashboardPrimitives';

interface DashboardLatencyTabProps {
  performanceLoading: boolean;
  latencyDistributionData: Array<{ bucket: string; Count: number }>;
  latencySummary: { avg: number; p95: number; min: number; max: number } | null;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardLatencyTab = ({
  performanceLoading,
  latencyDistributionData,
  latencySummary,
  noDataHint,
  hiddenLegends,
  onLegendClick
}: DashboardLatencyTabProps) => {
  const { themeColors, spacing } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();

  return (
    <section className="dashboard-tab-grid">
      <Card
        style={panelStyle}
        variant="borderless"
        title={<DashboardSectionTitle title="Latency Distribution" subtitle="Response times across the selected window" />}
        styles={{ body: { padding: spacing[4] } }}
      >
        {performanceLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : latencyDistributionData.length > 0 ? (
          <BarChart
            data={latencyDistributionData}
            bars={[{ dataKey: 'Count', name: 'Requests', color: themeColors.info.text }]}
            xAxisKey="bucket"
            height={320}
            showLegend={false}
            barSize={20}
            wrapAxisLabels={true}
            axisLabelMaxWidth={80}
            axisLabelMaxLines={2}
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
        title={<DashboardSectionTitle title="Latency Summary" subtitle="Key response time metrics" />}
        styles={{ body: { padding: spacing[4] } }}
      >
        {performanceLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : latencySummary ? (
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <div className="dashboard-stat-row">
              <Typography.Text type="secondary">Average</Typography.Text>
              <Typography.Text strong>{latencySummary.avg} ms</Typography.Text>
            </div>
            <div className="dashboard-stat-row">
              <Typography.Text type="secondary">P95</Typography.Text>
              <Typography.Text strong>{latencySummary.p95} ms</Typography.Text>
            </div>
            <div className="dashboard-stat-row">
              <Typography.Text type="secondary">Min</Typography.Text>
              <Typography.Text strong>{latencySummary.min} ms</Typography.Text>
            </div>
            <div className="dashboard-stat-row">
              <Typography.Text type="secondary">Max</Typography.Text>
              <Typography.Text strong>{latencySummary.max} ms</Typography.Text>
            </div>
          </Space>
        ) : (
          <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </div>
        )}
      </Card>
    </section>
  );
};
