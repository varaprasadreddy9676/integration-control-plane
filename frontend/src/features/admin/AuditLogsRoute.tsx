import { useState, useMemo } from 'react';
import {
  Card,
  Table,
  Button,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Tag,
  DatePicker,
  Row,
  Col,
  Statistic,
  Modal,
  Descriptions,
  Divider,
  message
} from 'antd';
import {
  AuditOutlined,
  SearchOutlined,
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { getAdminAuditLogs, getAdminAuditStats, exportAuditLogs } from '../../services/api';
import dayjs from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface AuditLog {
  _id: string;
  timestamp: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  orgId?: number;
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

interface AuditStats {
  totalLogs: number;
  failedActions: number;
  successRate: string;
  actionsByType: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; userEmail: string; count: number }>;
}

export const AuditLogsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [filters, setFilters] = useState({
    startDate: undefined as string | undefined,
    endDate: undefined as string | undefined,
    action: undefined as string | undefined,
    resourceType: undefined as string | undefined,
    success: undefined as boolean | undefined,
    search: undefined as string | undefined,
    page: 1,
    limit: 50
  });

  // Fetch audit logs
  const { data: logsData, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      return await getAdminAuditLogs({
        startDate: filters.startDate,
        endDate: filters.endDate,
        action: filters.action,
        resourceType: filters.resourceType,
        success: filters.success,
        search: filters.search,
        page: filters.page,
        limit: filters.limit
      });
    }
  });

  // Fetch audit stats
  const { data: stats } = useQuery({
    queryKey: ['audit-stats', filters.startDate, filters.endDate],
    queryFn: async () => {
      return await getAdminAuditStats({
        startDate: filters.startDate,
        endDate: filters.endDate
      });
    }
  });

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const blob = await exportAuditLogs({
        format,
        startDate: filters.startDate,
        endDate: filters.endDate,
        action: filters.action,
        resourceType: filters.resourceType,
        success: filters.success
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString()}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);

      message.success(`Exported audit logs as ${format.toUpperCase()}`);
    } catch (error) {
      message.error('Failed to export audit logs');
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('create')) return 'green';
    if (action.includes('update')) return 'blue';
    if (action.includes('delete')) return 'red';
    if (action.includes('login')) return 'purple';
    if (action.includes('failed')) return 'error';
    return 'default';
  };

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (timestamp: string) => (
        <Space direction="vertical" size={0}>
          <Text>{dayjs(timestamp).format('MMM DD, YYYY')}</Text>
          <Text type="secondary" style={{ fontSize: '11px' }}>
            {dayjs(timestamp).format('HH:mm:ss')}
          </Text>
        </Space>
      ),
      sorter: (a: AuditLog, b: AuditLog) => dayjs(a.timestamp).unix() - dayjs(b.timestamp).unix()
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action: string) => (
        <Tag color={getActionColor(action)} style={{ textTransform: 'uppercase' }}>
          {action.replace(/_/g, ' ')}
        </Tag>
      )
    },
    {
      title: 'Resource',
      dataIndex: 'resourceType',
      key: 'resourceType',
      width: 120,
      render: (type: string, record: AuditLog) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ textTransform: 'capitalize' }}>
            {type}
          </Text>
          {record.resourceId && (
            <Text type="secondary" style={{ fontSize: '11px' }}>
              ID: {record.resourceId}
            </Text>
          )}
        </Space>
      )
    },
    {
      title: 'User',
      dataIndex: 'userEmail',
      key: 'userEmail',
      width: 200,
      render: (email: string, record: AuditLog) => (
        <Space direction="vertical" size={0}>
          <Text>{email || 'System'}</Text>
          {record.userRole && (
            <Tag style={{ fontSize: '10px' }}>
              {record.userRole}
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'success',
      key: 'success',
      width: 100,
      align: 'center' as const,
      render: (success: boolean) =>
        success ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            SUCCESS
          </Tag>
        ) : (
          <Tag color="error" icon={<CloseCircleOutlined />}>
            FAILED
          </Tag>
        )
    },
    {
      title: 'IP Address',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 130,
      render: (ip: string) => <Text type="secondary">{ip || '-'}</Text>
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      align: 'center' as const,
      render: (_: any, record: AuditLog) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setSelectedLog(record)}
        >
          Details
        </Button>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Track all system activities and user actions"
        actions={
          <>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
            >
              Refresh
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleExport('json')}
            >
              Export JSON
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleExport('csv')}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
        {/* Statistics */}
        {stats && (
          <Card style={{ borderRadius: token.borderRadiusLG }}>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic
                  title="Total Events"
                  value={stats.totalLogs}
                  prefix={<AuditOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Success Rate"
                  value={stats.successRate}
                  suffix="%"
                  valueStyle={{ color: token.colorSuccess }}
                  prefix={<CheckCircleOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Failed Actions"
                  value={stats.failedActions}
                  valueStyle={{ color: stats.failedActions > 0 ? token.colorError : token.colorTextSecondary }}
                  prefix={<CloseCircleOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Active Users"
                  value={stats.topUsers.length}
                  prefix={<AuditOutlined />}
                />
              </Col>
            </Row>
          </Card>
        )}

        {/* Filters */}
        <Card title={<Space><FilterOutlined /> Filters</Space>} style={{ borderRadius: token.borderRadiusLG }}>
          <Form layout="vertical">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Date Range">
                  <RangePicker
                    value={[
                      filters.startDate ? dayjs(filters.startDate) : null,
                      filters.endDate ? dayjs(filters.endDate) : null
                    ]}
                    onChange={(dates) => {
                      setFilters({
                        ...filters,
                        startDate: dates?.[0]?.format('YYYY-MM-DD'),
                        endDate: dates?.[1]?.format('YYYY-MM-DD'),
                        page: 1
                      });
                    }}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Search">
                  <Input
                    placeholder="Search user, action, resource..."
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={(e) =>
                      setFilters({ ...filters, search: e.target.value || undefined, page: 1 })
                    }
                    allowClear
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Status">
                  <Select
                    placeholder="All statuses"
                    value={filters.success}
                    onChange={(value) => setFilters({ ...filters, success: value, page: 1 })}
                    allowClear
                  >
                    <Select.Option value={true}>Success Only</Select.Option>
                    <Select.Option value={false}>Failed Only</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>

        {/* Audit Logs Table */}
        <Card
          title={
            <Space>
              <span>Audit Events</span>
              {logsData && (
                <Text type="secondary">
                  ({logsData.pagination.total} total, showing page {logsData.pagination.page} of{' '}
                  {logsData.pagination.totalPages})
                </Text>
              )}
            </Space>
          }
          style={{ borderRadius: token.borderRadiusLG }}
        >
          <Table
            columns={columns}
            dataSource={logsData?.logs || []}
            rowKey="_id"
            loading={isLoading}
            pagination={{
              current: filters.page,
              pageSize: filters.limit,
              total: logsData?.pagination.total || 0,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} events`,
              onChange: (page, pageSize) => {
                setFilters({ ...filters, page, limit: pageSize });
              }
            }}
            size="small"
            scroll={{ x: 1200 }}
          />
        </Card>
      </Space>

      {/* Detail Modal */}
      <Modal
        title="Audit Log Details"
        open={!!selectedLog}
        onCancel={() => setSelectedLog(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedLog(null)}>
            Close
          </Button>
        ]}
        width={800}
      >
        {selectedLog && (
          <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Timestamp" span={2}>
                {dayjs(selectedLog.timestamp).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="Action">
                <Tag color={getActionColor(selectedLog.action)}>
                  {selectedLog.action.replace(/_/g, ' ').toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                {selectedLog.success ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    SUCCESS
                  </Tag>
                ) : (
                  <Tag color="error" icon={<CloseCircleOutlined />}>
                    FAILED
                  </Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Resource Type">
                {selectedLog.resourceType}
              </Descriptions.Item>
              <Descriptions.Item label="Resource ID">
                {selectedLog.resourceId || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="User Email">{selectedLog.userEmail || 'System'}</Descriptions.Item>
              <Descriptions.Item label="User Role">{selectedLog.userRole || '-'}</Descriptions.Item>
              <Descriptions.Item label="Organization ID">{selectedLog.orgId || '-'}</Descriptions.Item>
              <Descriptions.Item label="User ID">{selectedLog.userId || '-'}</Descriptions.Item>
              <Descriptions.Item label="IP Address">{selectedLog.ipAddress || '-'}</Descriptions.Item>
              <Descriptions.Item label="User Agent" span={2}>
                {selectedLog.userAgent || '-'}
              </Descriptions.Item>
              {selectedLog.errorMessage && (
                <Descriptions.Item label="Error Message" span={2}>
                  <Text type="danger">{selectedLog.errorMessage}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {selectedLog.changes && (
              <>
                <Divider>Changes</Divider>
                <Row gutter={16}>
                  <Col span={12}>
                    <Card title="Before" size="small">
                      <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: '11px' }}>
                        {JSON.stringify(selectedLog.changes.before, null, 2)}
                      </pre>
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card title="After" size="small">
                      <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: '11px' }}>
                        {JSON.stringify(selectedLog.changes.after, null, 2)}
                      </pre>
                    </Card>
                  </Col>
                </Row>
              </>
            )}

            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
              <>
                <Divider>Metadata</Divider>
                <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: '11px' }}>
                  {JSON.stringify(selectedLog.metadata, null, 2)}
                </pre>
              </>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};
