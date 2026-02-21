import { Button, Card, List, Skeleton, Space, Tag, Typography } from 'antd';
import { formatDateTime } from '../../../utils/format';
import { cssVar, spacingToNumber, useDesignTokens } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle, useDashboardTagTone } from './DashboardPrimitives';

interface DashboardLogsTabProps {
  logsLoading: boolean;
  logs: Array<any>;
  noDataHint: string;
  onViewAll: () => void;
}

export const DashboardLogsTab = ({ logsLoading, logs, noDataHint, onViewAll }: DashboardLogsTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  return (
    <section style={{ ...panelStyle, marginTop: spacing[4] }}>
      <Card
        variant="borderless"
        title={<DashboardSectionTitle title="Recent Failures" subtitle="Most recent failed deliveries" />}
        extra={
          <Button type="text" size="small" onClick={onViewAll}>
            View Logs
          </Button>
        }
        styles={{ body: { padding: spacing[4] } }}
      >
        {logsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : logs.length > 0 ? (
          <List
            dataSource={logs}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: ['10', '25', '50'],
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} logs`,
              size: 'small'
            }}
            renderItem={(log: any) => (
              <List.Item style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                <Space direction="vertical" size={spacingToNumber(spacing[1])} style={{ width: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] }}>
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {log.__KEEP_integrationName__ || log.integrationName || 'Unknown integration'}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {log.errorMessage || 'Failed delivery'}
                      </Typography.Text>
                    </div>
                    <Tag style={tagTone(themeColors.error.text)}>FAILED</Tag>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(log.createdAt)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </div>
        )}
      </Card>
    </section>
  );
};
