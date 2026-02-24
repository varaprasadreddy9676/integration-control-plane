import { useState, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens } from '../../design-system/utils';
import { BarChart } from '../../components/charts/BarChart';
import { PieChart } from '../../components/charts/PieChart';
import { getAdminStorageStats, type CollectionStat } from '../../services/api';

const { Text } = Typography;

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const StorageStatsRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ORG_ADMIN';
  const { spacing, token } = useDesignTokens();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['adminStorageStats'],
    queryFn: getAdminStorageStats,
    staleTime: 20_000,
    refetchInterval: autoRefresh ? 30_000 : false,
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!dataUpdatedAt) return;
    setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  if (!isAdmin) {
    return (
      <Alert
        type="error"
        showIcon
        message="Admin access only"
        description="You need SUPER_ADMIN, ADMIN, or ORG_ADMIN role to view storage stats."
      />
    );
  }

  const db = data?.db;
  const collections = data?.collections ?? [];
  const isOrgView = data?.isOrgView ?? false;

  const compressionRatio =
    db && db.storageSize > 0
      ? (db.dataSize / db.storageSize).toFixed(1)
      : '—';

  // Bar chart: top 10 by storageSize (converted to MB)
  const barData = collections.slice(0, 10).map(c => ({
    label: c.label,
    storageMB: +(c.storageSize / 1024 ** 2).toFixed(2),
  }));

  // Pie chart: top 7 + Other
  const pieTop7 = collections.slice(0, 7);
  const otherSum = collections.slice(7).reduce((s, c) => s + c.storageSize, 0);
  const pieData = [
    ...pieTop7.map(c => ({ name: c.label, value: c.storageSize })),
    ...(otherSum > 0 ? [{ name: 'Other', value: otherSum }] : []),
  ];

  const columns = [
    {
      title: 'Collection',
      key: 'collection',
      render: (_: unknown, row: CollectionStat) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Text strong>{row.label}</Text>
            {row.percentOfTotal > 50 && (
              <Tag color="orange">Dominant</Tag>
            )}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.name}</Text>
        </Space>
      ),
    },
    {
      title: 'Documents',
      dataIndex: 'count',
      key: 'count',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.count - b.count,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: (
        <Tooltip title="Raw size before compression">
          Data Size
        </Tooltip>
      ),
      dataIndex: 'dataSize',
      key: 'dataSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.dataSize - b.dataSize,
      render: (v: number, row: CollectionStat) =>
        row.count === 0 && row.storageSize === 0
          ? <Text type="secondary">—</Text>
          : formatBytes(v),
    },
    {
      title: (
        <Tooltip title="Actual disk usage">
          Stored on Disk
        </Tooltip>
      ),
      dataIndex: 'storageSize',
      key: 'storageSize',
      align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.storageSize - b.storageSize,
      render: (v: number, row: CollectionStat) =>
        row.count === 0 && row.storageSize === 0
          ? <Text type="secondary">empty</Text>
          : formatBytes(v),
    },
    {
      title: 'Index Size',
      dataIndex: 'indexSize',
      key: 'indexSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.indexSize - b.indexSize,
      render: (v: number) => v === 0 ? <Text type="secondary">—</Text> : formatBytes(v),
    },
    {
      title: '% of Total',
      dataIndex: 'percentOfTotal',
      key: 'percentOfTotal',
      sorter: (a: CollectionStat, b: CollectionStat) => a.percentOfTotal - b.percentOfTotal,
      render: (v: number) =>
        v === 0
          ? <Text type="secondary">—</Text>
          : <Progress percent={v} size="small" />,
      width: 160,
    },
    {
      title: 'Avg Doc',
      dataIndex: 'avgObjSize',
      key: 'avgObjSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.avgObjSize - b.avgObjSize,
      render: (v: number) => v === 0 ? <Text type="secondary">—</Text> : formatBytes(v),
    },
  ];

  return (
    <div style={{ padding: spacing['6'] }}>
      <PageHeader
        title="Storage & Usage"
        description={dataUpdatedAt ? `Last updated: ${secondsAgo}s ago` : undefined}
        actions={
          <Space>
            <Space size={8}>
              <Text type="secondary" style={{ fontSize: 13 }}>Auto-refresh</Text>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
            </Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isLoading}
            >
              Refresh
            </Button>
          </Space>
        }
      />

      {isOrgView && (
        <Alert
          type="info"
          showIcon
          message="Org-scoped view"
          description="Document counts are specific to your organization. Storage sizes (disk usage, index size) reflect the entire platform — MongoDB does not support per-org storage breakdown."
          style={{ marginBottom: spacing['4'] }}
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message="Failed to load storage stats"
          description={(error as Error).message}
          style={{ marginBottom: spacing['4'] }}
        />
      )}

      {/* KPI Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: spacing['6'] }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Tooltip title="Actual disk space used (after MongoDB compression)">
              <Statistic
                title="Total Storage"
                value={db ? formatBytes(db.storageSize) : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Tooltip title={isOrgView ? 'Total records belonging to your organization' : 'Total records across all collections'}>
              <Statistic
                title={isOrgView ? 'Your Documents' : 'Documents Stored'}
                value={db ? db.objects.toLocaleString() : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Tooltip title="Extra space for query indexes — 20–40% of data is normal">
              <Statistic
                title="Index Overhead"
                value={db ? formatBytes(db.indexSize) : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Tooltip title="How effectively MongoDB compressed your data. Higher = better.">
              <Statistic
                title="Compression"
                value={db && db.storageSize > 0 ? `${compressionRatio}×` : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]} style={{ marginBottom: spacing['6'] }}>
        <Col xs={24} md={14}>
          <Card title="Top 10 Collections by Disk Usage" loading={isLoading}>
            {barData.length > 0 ? (
              <BarChart
                data={barData}
                bars={[{ dataKey: 'storageMB', name: 'Storage (MB)' }]}
                xAxisKey="label"
                layout="vertical"
                height={320}
                showLegend={false}
                yAxisWidth={130}
                tooltipFormatter={(value: number) => [`${value} MB`, 'Storage']}
              />
            ) : (
              !isLoading && <Empty description="No collections with data yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card title="Storage Distribution" loading={isLoading}>
            {pieData.length > 0 ? (
              <PieChart
                data={pieData}
                innerRadius={60}
                height={320}
              />
            ) : (
              !isLoading && <Empty description="No data to display" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Collections Table */}
      <Card title="All Collections" loading={isLoading}>
        <Table
          dataSource={collections}
          columns={columns}
          rowKey="name"
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          style={{ background: token.colorBgContainer }}
        />
      </Card>
    </div>
  );
};
