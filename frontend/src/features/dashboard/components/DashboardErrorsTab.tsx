import { Button, Card, List, Skeleton, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { PieChart } from '../../../components/charts';
import { formatDateTime } from '../../../utils/format';
import { cssVar, spacingToNumber, useDesignTokens } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardErrorsTabProps {
  errorsLoading: boolean;
  errorCategoryData: Array<{ name: string; value: number }>;
  topErrors: Array<{ message: string; count: number; lastSeen: string }>;
  noDataHint: string;
  onViewAllFailures: () => void;
  onErrorCategoryClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardErrorsTab = ({
  errorsLoading,
  errorCategoryData,
  topErrors,
  noDataHint,
  onViewAllFailures,
  onErrorCategoryClick,
  hiddenLegends,
  onLegendClick
}: DashboardErrorsTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  return (
    <section className="dashboard-tab-grid">
      <Card
        style={panelStyle}
        variant="borderless"
        title={<DashboardSectionTitle title="Failure Categories" subtitle="Breakdown of error types" />}
        styles={{ body: { padding: spacing[4] } }}
      >
        {errorsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : errorCategoryData.length > 0 ? (
          <PieChart
            data={errorCategoryData}
            height={320}
            showLegend={true}
            innerRadius={70}
            outerRadius={110}
            label={true}
            paddingAngle={2}
            colors={[
              themeColors.error.text,
              themeColors.warning.text,
              themeColors.info.text,
              themeColors.primary.default,
              token.colorTextDisabled
            ]}
            onSliceClick={onErrorCategoryClick}
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
        title={<DashboardSectionTitle title="Top Errors" subtitle="Most frequent delivery issues" />}
        extra={
          <Button type="text" size="small" onClick={onViewAllFailures}>
            View All Failures
          </Button>
        }
        styles={{ body: { padding: spacing[4], display: 'flex', flexDirection: 'column', gap: spacing[1] } }}
      >
        {errorsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : topErrors.length > 0 ? (
          <List
            dataSource={topErrors}
            renderItem={(error) => (
              <List.Item style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                <Space direction="vertical" size={spacingToNumber(spacing[1])} style={{ width: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
                    <Typography.Text strong style={{ maxWidth: 320, wordBreak: 'break-word', fontSize: 13 }}>
                      {error.message}
                    </Typography.Text>
                    <Tag style={tagTone(themeColors.error.text)}>{error.count} occurrences</Tag>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Last seen {formatDateTime(error.lastSeen)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
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
            <CheckCircleOutlined style={{ fontSize: spacing[10], color: cssVar.success.text }} />
            <Typography.Text type="secondary">No errors in the selected period</Typography.Text>
          </div>
        )}
      </Card>
    </section>
  );
};
