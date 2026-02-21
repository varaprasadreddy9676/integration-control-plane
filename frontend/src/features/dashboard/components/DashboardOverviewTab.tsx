import { Card, Skeleton, Typography } from 'antd';
import { LineChart, BarChart, ComposedChart, HeatmapChart, HeatmapData } from '../../../components/charts';
import { useDesignTokens } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle } from './DashboardPrimitives';
import { formatNumber } from '../../../utils/format';

interface DashboardOverviewTabProps {
  days: number;
  deliveryTrendData: Array<Record<string, any>>;
  hourlyPatternData: Array<Record<string, any>>;
  heatmapData: HeatmapData[];
  analyticsLoading: boolean;
  noDataHint: string;
  onTrendChartClick?: (data: any) => void;
  onHourlyChartClick?: (data: any) => void;
  onHeatmapClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardOverviewTab = ({
  days,
  deliveryTrendData,
  hourlyPatternData,
  heatmapData,
  analyticsLoading,
  noDataHint,
  onTrendChartClick,
  onHourlyChartClick,
  onHeatmapClick,
  hiddenLegends,
  onLegendClick
}: DashboardOverviewTabProps) => {
  const { themeColors, spacing } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      {analyticsLoading ? (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle
                title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                subtitle="Daily delivery success and failure rates"
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </section>
      ) : deliveryTrendData.length > 0 ? (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle
                title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                subtitle="Daily delivery success and failure breakdown"
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <ComposedChart
              data={deliveryTrendData}
              bars={[
                { dataKey: 'Successful', name: 'Successful', color: themeColors.success.text, stackId: 'a' },
                // "Failed" in analytics includes SKIPPED/ABANDONED as well (by design).
                { dataKey: 'Failed', name: 'Failed/Skipped', color: themeColors.error.text, stackId: 'a' }
              ]}
              lines={[]}
              xAxisKey="date"
              height={320}
              showLegend={true}
              smooth={true}
              barSize={24}
              onBarClick={onTrendChartClick}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          </Card>
        </section>
      ) : (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle
                title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                subtitle="Daily delivery success and failure rates"
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </Card>
        </section>
      )}

      {analyticsLoading ? (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={<DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            <Skeleton active paragraph={{ rows: 5 }} />
          </Card>
        </section>
      ) : hourlyPatternData.length > 0 ? (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={<DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Deliveries and success rate by hour of day" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            <BarChart
              data={hourlyPatternData}
              bars={[
                { dataKey: 'Successful', name: 'Successful', color: themeColors.success.text, stackId: 'a' },
                // "Failed" in analytics includes SKIPPED/ABANDONED as well (by design).
                { dataKey: 'Failed', name: 'Failed/Skipped', color: themeColors.error.text, stackId: 'a' }
              ]}
              xAxisKey="hour"
              height={280}
              showLegend={true}
              barSize={20}
              onBarClick={onHourlyChartClick}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          </Card>
        </section>
      ) : (
        <section style={{ ...panelStyle, marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={<DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </Card>
        </section>
      )}

      {/* Heatmap */}
      {days >= 7 && (
        analyticsLoading ? (
          <section style={{ ...panelStyle, marginTop: spacing[4] }}>
            <Card
              variant="borderless"
              title={<DashboardSectionTitle title="Activity Heatmap" subtitle="Delivery patterns by day and hour" />}
              styles={{ body: { padding: spacing[5] } }}
            >
              <Skeleton active paragraph={{ rows: 8 }} />
            </Card>
          </section>
        ) : heatmapData.length > 0 ? (
          <section style={{ ...panelStyle, marginTop: spacing[4] }}>
            <Card
              variant="borderless"
              title={<DashboardSectionTitle title="Activity Heatmap" subtitle="Delivery patterns by day of week and hour of day" />}
              styles={{ body: { padding: spacing[5] } }}
            >
              <HeatmapChart
                data={heatmapData}
                xLabels={hourLabels}
                yLabels={dayLabels}
                height={280}
                valueFormatter={(v) => formatNumber(v)}
                onCellClick={onHeatmapClick}
              />
            </Card>
          </section>
        ) : null
      )}
    </>
  );
};
