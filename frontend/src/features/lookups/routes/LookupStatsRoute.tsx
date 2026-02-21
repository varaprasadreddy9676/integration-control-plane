import { App, Card, Col, Row, Statistic, Table, Typography, Space, Tag, Grid } from 'antd';
import { DatabaseOutlined, CheckCircleOutlined, ClockCircleOutlined, ThunderboltOutlined, TagsOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getLookupStats } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { BarChart } from '../../../components/charts/BarChart';
import { useMemo } from 'react';

export const LookupStatsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const { data: stats, isLoading } = useQuery({
    queryKey: ['lookup-stats'],
    queryFn: getLookupStats
  });

  const mostUsedTypesData = stats?.mostUsedTypes?.map(item => ({
    name: item.type,
    value: item.count
  })) || [];

  return (
    <div style={{ padding: isNarrow ? spacing[4] : spacing[6] }}>
      <div style={{ marginBottom: spacing[6] }}>
        <Typography.Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <DatabaseOutlined style={{ color: colors.primary[600] }} />
          Lookup Statistics
        </Typography.Title>
        <Typography.Text type="secondary">
          Usage analytics and insights for lookup tables
        </Typography.Text>
      </div>

      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: spacing[6] }}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Total Mappings"
              value={stats?.totalMappings || 0}
              prefix={<DatabaseOutlined style={{ color: colors.primary[600] }} />}
              loading={isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Active (Parent)"
              value={stats?.activeParent || 0}
              prefix={<CheckCircleOutlined style={{ color: colors.success[600] }} />}
              loading={isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Active (Entity)"
              value={stats?.activeEntity || 0}
              prefix={<CheckCircleOutlined style={{ color: colors.info[600] }} />}
              loading={isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="Mapping Types"
              value={stats?.typesCount || 0}
              prefix={<TagsOutlined style={{ color: colors.warning[600] }} />}
              loading={isLoading}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts and Tables */}
      <Row gutter={[16, 16]}>
        {/* Most Used Types Chart */}
        <Col xs={24} lg={12}>
          <Card
            bordered={false}
            title="Most Used Mapping Types"
            style={{
              background: cssVar.bg.surface,
              borderRadius: token.borderRadiusLG
            }}
          >
            {mostUsedTypesData.length > 0 ? (
              <BarChart
                data={mostUsedTypesData}
                xAxisKey="name"
                bars={[
                  { dataKey: 'value', name: 'Count', color: colors.primary[600] }
                ]}
                height={300}
                showLegend={false}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: spacing[6] }}>
                <Typography.Text type="secondary">No data available</Typography.Text>
              </div>
            )}
          </Card>
        </Col>

        {/* Most Used Types Table */}
        <Col xs={24} lg={12}>
          <Card
            bordered={false}
            title="Type Breakdown"
            style={{
              background: cssVar.bg.surface,
              borderRadius: token.borderRadiusLG
            }}
          >
            <Table
              dataSource={stats?.mostUsedTypes || []}
              loading={isLoading}
              pagination={false}
              size="small"
              columns={[
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  render: (type: string) => <Tag color="blue">{type}</Tag>
                },
                {
                  title: 'Count',
                  dataIndex: 'count',
                  key: 'count',
                  align: 'right',
                  render: (count: number) => count.toLocaleString()
                },
                {
                  title: 'Last Used',
                  dataIndex: 'lastUsedAt',
                  key: 'lastUsedAt',
                  render: (date: string | null) =>
                    date ? formatDateTime(date) : <Typography.Text type="secondary">Never</Typography.Text>
                }
              ]}
              scroll={{ y: 300 }}
            />
          </Card>
        </Col>

        {/* Recently Used Mappings */}
        <Col xs={24}>
          <Card
            bordered={false}
            title={
              <Space>
                <ClockCircleOutlined />
                Recently Used Mappings
              </Space>
            }
            style={{
              background: cssVar.bg.surface,
              borderRadius: token.borderRadiusLG
            }}
          >
            <Table
              dataSource={stats?.recentlyUsed || []}
              loading={isLoading}
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  width: 150,
                  render: (type: string) => <Tag color="blue">{type}</Tag>
                },
                {
                  title: 'Source Code',
                  dataIndex: 'sourceId',
                  key: 'sourceId',
                  width: 150,
                  render: (id: string) => <Typography.Text code>{id}</Typography.Text>
                },
                {
                  title: 'Target Code',
                  dataIndex: 'targetId',
                  key: 'targetId',
                  width: 150,
                  render: (id: string) => <Typography.Text code>{id}</Typography.Text>
                },
                {
                  title: 'Usage Count',
                  dataIndex: 'usageCount',
                  key: 'usageCount',
                  width: 120,
                  align: 'right',
                  render: (count: number) => (
                    <Space>
                      <ThunderboltOutlined style={{ color: colors.warning[600] }} />
                      {count.toLocaleString()}
                    </Space>
                  ),
                  sorter: (a: any, b: any) => a.usageCount - b.usageCount
                },
                {
                  title: 'Last Used',
                  dataIndex: 'lastUsedAt',
                  key: 'lastUsedAt',
                  width: 180,
                  render: (date: string) => formatDateTime(date),
                  sorter: (a: any, b: any) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
                }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};
