import { useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { exportAdminAuditLogs, exportAdminAuditTrend, listAdminAuditLogs, type AdminAuditLog } from '../../services/api';

const { RangePicker } = DatePicker;

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const buildSummary = (record: AdminAuditLog) => {
  if (record.matched !== null || record.modified !== null) {
    return `Matched ${record.matched ?? 0}, Updated ${record.modified ?? 0}`;
  }
  if (record.integrations !== null || record.deleted !== null) {
    return `Integrations ${record.integrations ?? 0}, Deleted ${record.deleted ?? 0}`;
  }
  if (record.count !== null) {
    return `Count ${record.count}`;
  }
  return '—';
};

export const AdminAuditLogsRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const { spacing, token, borderRadius } = useDesignTokens();
  const [messageApi, contextHolder] = message.useMessage();
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [adminIdFilter, setAdminIdFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<[string | null, string | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [bucketDays, setBucketDays] = useState(7);

  const filterPayload = useMemo(() => ({
    action: actionFilter,
    role: roleFilter,
    adminId: adminIdFilter || undefined,
    search: search || undefined,
    startDate: dateRange?.[0] || undefined,
    endDate: dateRange?.[1] || undefined,
    days: bucketDays,
    page,
    limit: pageSize
  }), [actionFilter, roleFilter, adminIdFilter, search, dateRange, bucketDays, page, pageSize]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['adminAuditLogs', filterPayload],
    queryFn: () => listAdminAuditLogs(filterPayload),
    enabled: isAdmin,
    staleTime: 5 * 1000
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const summary = data?.summary;
  const trendData = summary?.dailyCounts || [];
  const trendMax = Math.max(1, ...trendData.map((item) => item.count || 0));
  const actionBreakdown = summary?.actionBreakdown || [];
  const actionMax = Math.max(1, ...actionBreakdown.map((item) => item.count || 0));

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDate(value)
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (value: string) => <Tag>{value}</Tag>
    },
    {
      title: 'Admin',
      key: 'admin',
      render: (_: any, record: AdminAuditLog) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.adminEmail || '—'}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.adminId || '—'}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: 'Role',
      dataIndex: 'adminRole',
      key: 'adminRole',
      render: (value: string) => value || '—'
    },
    {
      title: 'Summary',
      key: 'summary',
      render: (_: any, record: AdminAuditLog) => buildSummary(record)
    }
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Admin Audit Logs"
        description="Track admin changes and bulk operations."
      />

      {!isAdmin ? (
        <Alert
          type="error"
          message="Admin access only"
          description="You need an admin account to view audit logs."
          showIcon
        />
      ) : (
        <>
          <Card className="panel" style={{ borderRadius: token.borderRadiusLG, marginBottom: spacingToNumber(spacing[3]) }}>
            <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
              <Typography.Text strong>Summary</Typography.Text>
              <Space wrap>
                <Card size="small" style={{ minWidth: 180 }}>
                  <Typography.Text type="secondary">Total Events</Typography.Text>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {summary?.total ?? total}
                  </Typography.Title>
                </Card>
                <Card size="small" style={{ minWidth: 360 }}>
                  <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Typography.Text type="secondary">Trend</Typography.Text>
                    <Select
                      value={bucketDays}
                      onChange={(value) => {
                        setBucketDays(value);
                        setPage(1);
                      }}
                      options={[
                        { label: 'Last 7 days', value: 7 },
                        { label: 'Last 30 days', value: 30 },
                        { label: 'Last 90 days', value: 90 }
                      ]}
                      size="small"
                      style={{ minWidth: 130 }}
                    />
                  </Space>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
                    {trendData.length === 0 && (
                      <Typography.Text type="secondary">No data</Typography.Text>
                    )}
                    {trendData.map((item) => (
                      <div key={item.date} style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            width: 16,
                            height: Math.max(6, Math.round((item.count / trendMax) * 64)),
                            borderRadius: 6,
                            background: token.colorPrimary
                          }}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                          {bucketDays > 14 ? item.date.slice(5) : item.date.slice(5)}
                        </Typography.Text>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="small"
                    style={{ marginTop: 12 }}
                    onClick={async () => {
                      try {
                        await exportAdminAuditTrend({
                          action: actionFilter,
                          role: roleFilter,
                          adminId: adminIdFilter || undefined,
                          search: search || undefined,
                          startDate: dateRange?.[0] || undefined,
                          endDate: dateRange?.[1] || undefined,
                          days: bucketDays
                        });
                      } catch (error: any) {
                        messageApi.error(error?.message || 'Trend export failed');
                      }
                    }}
                  >
                    Export Trend CSV
                  </Button>
                </Card>
                <Card size="small" style={{ minWidth: 320 }}>
                  <Typography.Text type="secondary">Top Actions</Typography.Text>
                  <Space direction="vertical" size={6} style={{ marginTop: 8, width: '100%' }}>
                    {(actionBreakdown.length === 0) && (
                      <Typography.Text type="secondary">No data</Typography.Text>
                    )}
                    {actionBreakdown.map((item) => (
                      <div key={item.action} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Typography.Text style={{ minWidth: 180 }} ellipsis>
                          {item.action}
                        </Typography.Text>
                        <div style={{ flex: 1, height: 8, background: token.colorFillSecondary, borderRadius: borderRadius.full }}>
                          <div
                            style={{
                              height: 8,
                              width: `${Math.round((item.count / actionMax) * 100)}%`,
                              background: token.colorPrimaryHover,
                              borderRadius: borderRadius.full
                            }}
                          />
                        </div>
                        <Typography.Text>{item.count}</Typography.Text>
                      </div>
                    ))}
                  </Space>
                </Card>
                <Card size="small" style={{ minWidth: 260 }}>
                  <Typography.Text type="secondary">Top Admins</Typography.Text>
                  <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
                    {(summary?.topAdmins || []).length === 0 && (
                      <Typography.Text type="secondary">No data</Typography.Text>
                    )}
                    {(summary?.topAdmins || []).map((item) => (
                      <Space key={item.adminEmail} size="small">
                        <Tag>{item.adminEmail}</Tag>
                        <Typography.Text>{item.count}</Typography.Text>
                      </Space>
                    ))}
                  </Space>
                </Card>
              </Space>
            </Space>
          </Card>

          <Card className="panel" style={{ borderRadius: token.borderRadiusLG }}>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              <Space wrap>
                <Select
                  allowClear
                  placeholder="Action"
                  value={actionFilter}
                  onChange={(value) => {
                    setActionFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'RATE_LIMITS_BULK_APPLY', value: 'RATE_LIMITS_BULK_APPLY' },
                    { label: 'RATE_LIMITS_BULK_RESET', value: 'RATE_LIMITS_BULK_RESET' },
                    { label: 'RATE_LIMITS_EXPORT', value: 'RATE_LIMITS_EXPORT' }
                  ]}
                  style={{ minWidth: 220 }}
                />
                <Select
                  allowClear
                  placeholder="Role"
                  value={roleFilter}
                  onChange={(value) => {
                    setRoleFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'ADMIN', value: 'ADMIN' },
                    { label: 'ORG_ADMIN', value: 'ORG_ADMIN' }
                  ]}
                  style={{ minWidth: 160 }}
                />
                <Input
                  placeholder="Admin ID"
                  value={adminIdFilter}
                  onChange={(event) => {
                    setAdminIdFilter(event.target.value);
                    setPage(1);
                  }}
                  style={{ minWidth: 200 }}
                />
                <Input.Search
                  placeholder="Search action/admin"
                  allowClear
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onSearch={() => {
                    setPage(1);
                    refetch();
                  }}
                  style={{ minWidth: 220 }}
                />
                <RangePicker
                  onChange={(values) => {
                    if (!values || values.length !== 2) {
                      setDateRange(null);
                      return;
                    }
                    setDateRange([
                      values[0]?.toISOString() || null,
                      values[1]?.toISOString() || null
                    ]);
                  }}
                />
                <Button onClick={() => refetch()}>Refresh</Button>
                <Button
                  onClick={async () => {
                    try {
                      await exportAdminAuditLogs({
                        action: actionFilter,
                        role: roleFilter,
                        adminId: adminIdFilter || undefined,
                        search: search || undefined,
                        startDate: dateRange?.[0] || undefined,
                        endDate: dateRange?.[1] || undefined
                      });
                    } catch (error: any) {
                      messageApi.error(error?.message || 'Export failed');
                    }
                  }}
                >
                  Export CSV
                </Button>
              </Space>

              <Table
                rowKey="id"
                columns={columns}
                dataSource={items}
                loading={isLoading}
                expandable={{
                  expandedRowRender: (record) => (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Typography.Text type="secondary">Filters:</Typography.Text>
                      <pre className="clamped-code-block" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(record.filters || {}, null, 2)}
                      </pre>
                      <Typography.Text type="secondary">Rate Limits:</Typography.Text>
                      <pre className="clamped-code-block" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(record.rateLimits || {}, null, 2)}
                      </pre>
                    </Space>
                  )
                }}
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => {
                    setPage(nextPage);
                    setPageSize(nextPageSize || pageSize);
                  }
                }}
              />
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};
