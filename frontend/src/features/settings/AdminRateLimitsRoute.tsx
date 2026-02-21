import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Progress, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../utils/navigation';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { bulkApplyAdminRateLimits, bulkResetAdminRateLimits, exportAdminRateLimits, listAdminRateLimits, resetAdminRateLimit, updateAdminRateLimit, type AdminRateLimitItem } from '../../services/api';

const formatResetAt = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const buildLimitLabel = (item: AdminRateLimitItem) => {
  const enabled = item.rateLimits?.enabled;
  if (!enabled) return 'Disabled';
  const maxRequests = item.rateLimits?.maxRequests ?? 100;
  const windowSeconds = item.rateLimits?.windowSeconds ?? 60;
  return `${maxRequests} / ${windowSeconds}s`;
};

export const AdminRateLimitsRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const { spacing, token } = useDesignTokens();
  const navigate = useNavigateWithParams();
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState('');
  const [filterOrgId, setFilterOrgId] = useState<number | undefined>(undefined);
  const [filterDirection, setFilterDirection] = useState<string | undefined>(undefined);
  const [filterEnabled, setFilterEnabled] = useState<'enabled' | 'disabled' | 'all'>('enabled');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editTarget, setEditTarget] = useState<AdminRateLimitItem | null>(null);
  const [editForm] = Form.useForm();
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkForm] = Form.useForm();

  const filterPayload = useMemo(() => ({
    orgId: filterOrgId,
    direction: filterDirection,
    enabled: filterEnabled === 'all' ? undefined : filterEnabled === 'enabled',
    search: search || undefined,
    page,
    limit: pageSize
  }), [filterOrgId, filterDirection, filterEnabled, search, page, pageSize]);

  const bulkFilters = useMemo(() => ({
    orgId: filterOrgId,
    direction: filterDirection,
    enabled: filterEnabled === 'all' ? undefined : filterEnabled === 'enabled',
    search: search || undefined
  }), [filterOrgId, filterDirection, filterEnabled, search]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['adminRateLimits', filterPayload],
    queryFn: () => listAdminRateLimits(filterPayload),
    enabled: isAdmin,
    staleTime: 5 * 1000
  });

  const items = data?.items || [];
  const total = data?.total || 0;

  const columns = [
    {
      title: 'Integration',
      key: 'integration',
      render: (_: any, record: AdminRateLimitItem) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Space size="small" wrap>
            <Tag>{record.type}</Tag>
            <Tag color={record.direction === 'INBOUND' ? 'blue' : 'green'}>{record.direction}</Tag>
            {!record.isActive && <Tag color="red">Inactive</Tag>}
          </Space>
        </Space>
      )
    },
    {
      title: 'Org ID',
      dataIndex: 'tenantId',
      key: 'tenantId',
      width: 100
    },
    {
      title: 'Limit',
      key: 'limit',
      render: (_: any, record: AdminRateLimitItem) => buildLimitLabel(record)
    },
    {
      title: 'Usage',
      key: 'usage',
      render: (_: any, record: AdminRateLimitItem) => {
        const enabled = record.rateLimits?.enabled;
        if (!enabled) return '—';
        const current = record.status?.current ?? 0;
        const limit = record.status?.limit ?? record.rateLimits?.maxRequests ?? 0;
        const percent = limit ? Math.min(100, Math.round((current / limit) * 100)) : 0;
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text>{`${current} / ${limit}`}</Typography.Text>
            <Progress percent={percent} size="small" />
          </Space>
        );
      }
    },
    {
      title: 'Reset At',
      key: 'resetAt',
      render: (_: any, record: AdminRateLimitItem) => formatResetAt(record.status?.resetAt)
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: AdminRateLimitItem) => (
        <Space size="small">
          <Button
            size="small"
            onClick={() => {
              const path = record.direction === 'INBOUND'
                ? `/inbound-integrations/${record.id}`
                : `/integrations/${record.id}`;
              navigate(path);
            }}
          >
            Open
          </Button>
          <Button
            size="small"
            onClick={() => {
              setEditTarget(record);
              editForm.setFieldsValue({
                enabled: record.rateLimits?.enabled ?? false,
                maxRequests: record.rateLimits?.maxRequests ?? 100,
                windowSeconds: record.rateLimits?.windowSeconds ?? 60
              });
            }}
          >
            Edit
          </Button>
          <Button
            size="small"
            danger
            disabled={!record.rateLimits?.enabled}
            onClick={() => {
              Modal.confirm({
                title: 'Reset rate limit window?',
                content: 'This will clear the current window counters for this integration.',
                okText: 'Reset',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                async onOk() {
                  try {
                    await resetAdminRateLimit(record.id);
                    messageApi.success('Rate limit reset');
                    refetch();
                  } catch (error: any) {
                    messageApi.error(error?.message || 'Failed to reset rate limit');
                  }
                }
              });
            }}
          >
            Reset
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Rate Limits"
        description="Monitor and manage per-integration rate limits across all orgs."
      />

      {!isAdmin ? (
        <Alert
          type="error"
          message="Admin access only"
          description="You need an admin account to manage rate limits."
          showIcon
        />
      ) : (
        <>
          <Card className="panel" style={{ borderRadius: token.borderRadiusLG }}>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              <Space wrap>
                <Input.Search
                  placeholder="Search by name or type"
                  allowClear
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onSearch={() => {
                    setPage(1);
                    refetch();
                  }}
                  style={{ minWidth: 220 }}
                />
                <InputNumber
                  placeholder="Filter orgId"
                  value={filterOrgId}
                  min={1}
                  onChange={(value) => {
                    setFilterOrgId(value ? Number(value) : undefined);
                    setPage(1);
                  }}
                />
                <Select
                  placeholder="Direction"
                  allowClear
                  value={filterDirection}
                  onChange={(value) => {
                    setFilterDirection(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'OUTBOUND', value: 'OUTBOUND' },
                    { label: 'INBOUND', value: 'INBOUND' }
                  ]}
                  style={{ minWidth: 140 }}
                />
                <Select
                  value={filterEnabled}
                  onChange={(value) => {
                    setFilterEnabled(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'Enabled', value: 'enabled' },
                    { label: 'Disabled', value: 'disabled' },
                    { label: 'All', value: 'all' }
                  ]}
                  style={{ minWidth: 120 }}
                />
                <Button onClick={() => refetch()}>Refresh</Button>
                <Button
                  onClick={async () => {
                    try {
                      await exportAdminRateLimits(bulkFilters);
                    } catch (error: any) {
                      messageApi.error(error?.message || 'Failed to export');
                    }
                  }}
                >
                  Export CSV
                </Button>
                <Button
                  onClick={() => {
                    bulkForm.setFieldsValue({
                      enabled: true,
                      maxRequests: 100,
                      windowSeconds: 60
                    });
                    setBulkModalOpen(true);
                  }}
                >
                  Apply Defaults
                </Button>
                <Button
                  danger
                  onClick={() => {
                    Modal.confirm({
                      title: 'Disable rate limits for filtered integrations?',
                      content: 'This will disable rate limits for all integrations matching the current filters.',
                      okText: 'Disable',
                      okButtonProps: { danger: true },
                      cancelText: 'Cancel',
                      async onOk() {
                        try {
                          const isGlobal = Object.values(bulkFilters).every((value) => value === undefined);
                          if (isGlobal) {
                            const confirmed = await new Promise<boolean>((resolve) => {
                              Modal.confirm({
                                title: 'Apply to ALL integrations?',
                                content: 'No filters are selected. This will disable rate limits for every integration.',
                                okText: 'Confirm',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: () => resolve(true),
                                onCancel: () => resolve(false)
                              });
                            });
                            if (!confirmed) return;
                          }

                          const result = await bulkApplyAdminRateLimits({
                            filters: bulkFilters,
                            rateLimits: { enabled: false },
                            mode: 'merge',
                            confirmAll: Object.values(bulkFilters).every((value) => value === undefined)
                          });
                          messageApi.success(`Updated ${result.modified} integrations`);
                          refetch();
                        } catch (error: any) {
                          messageApi.error(error?.message || 'Bulk update failed');
                        }
                      }
                    });
                  }}
                >
                  Disable Limits
                </Button>
                <Button
                  onClick={() => {
                    Modal.confirm({
                      title: 'Reset rate limit windows for filtered integrations?',
                      content: 'This clears current counters for all integrations matching the filters.',
                      okText: 'Reset',
                      okButtonProps: { danger: true },
                      cancelText: 'Cancel',
                      async onOk() {
                        try {
                          const isGlobal = Object.values(bulkFilters).every((value) => value === undefined);
                          if (isGlobal) {
                            const confirmed = await new Promise<boolean>((resolve) => {
                              Modal.confirm({
                                title: 'Reset ALL integrations?',
                                content: 'No filters are selected. This will reset counters for every integration.',
                                okText: 'Confirm',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancel',
                                onOk: () => resolve(true),
                                onCancel: () => resolve(false)
                              });
                            });
                            if (!confirmed) return;
                          }

                          const result = await bulkResetAdminRateLimits({
                            ...bulkFilters,
                            confirmAll: isGlobal
                          });
                          messageApi.success(`Reset ${result.integrations} integrations`);
                          refetch();
                        } catch (error: any) {
                          messageApi.error(error?.message || 'Failed to reset rate limits');
                        }
                      }
                    });
                  }}
                >
                  Reset Usage
                </Button>
              </Space>

              <Table
                rowKey="id"
                columns={columns}
                dataSource={items}
                loading={isLoading}
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

          <Modal
            open={!!editTarget}
            title={editTarget ? `Edit Rate Limits · ${editTarget.name}` : 'Edit Rate Limits'}
            onCancel={() => setEditTarget(null)}
            onOk={async () => {
              try {
                const values = await editForm.validateFields();
                await updateAdminRateLimit(editTarget!.id, {
                  enabled: values.enabled,
                  maxRequests: values.maxRequests,
                  windowSeconds: values.windowSeconds
                });
                messageApi.success('Rate limits updated');
                setEditTarget(null);
                refetch();
              } catch (error: any) {
                if (error?.errorFields) return;
                messageApi.error(error?.message || 'Failed to update rate limits');
              }
            }}
            okText="Save"
          >
            <Form layout="vertical" form={editForm}>
              <Form.Item name="enabled" label="Enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="maxRequests"
                label="Max Requests"
                rules={[{ required: true, message: 'Max requests required' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="windowSeconds"
                label="Window (seconds)"
                rules={[{ required: true, message: 'Window duration required' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            open={bulkModalOpen}
            title="Apply Default Rate Limits"
            onCancel={() => setBulkModalOpen(false)}
            onOk={async () => {
              try {
                const values = await bulkForm.validateFields();
                const isGlobal = Object.values(bulkFilters).every((value) => value === undefined);
                if (isGlobal) {
                  const confirmed = await new Promise<boolean>((resolve) => {
                    Modal.confirm({
                      title: 'Apply to ALL integrations?',
                      content: 'No filters are selected. This will update every integration.',
                      okText: 'Confirm',
                      okButtonProps: { danger: true },
                      cancelText: 'Cancel',
                      onOk: () => resolve(true),
                      onCancel: () => resolve(false)
                    });
                  });
                  if (!confirmed) return;
                }

                const result = await bulkApplyAdminRateLimits({
                  filters: bulkFilters,
                  rateLimits: {
                    enabled: values.enabled,
                    maxRequests: values.maxRequests,
                    windowSeconds: values.windowSeconds
                  },
                  mode: 'override',
                  confirmAll: isGlobal
                });
                messageApi.success(`Updated ${result.modified} integrations`);
                setBulkModalOpen(false);
                refetch();
              } catch (error: any) {
                if (error?.errorFields) return;
                messageApi.error(error?.message || 'Bulk update failed');
              }
            }}
            okText="Apply"
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: spacingToNumber(spacing[2]) }}>
              Applies the default rate limits to all integrations matching the current filters.
            </Typography.Paragraph>
            <Form layout="vertical" form={bulkForm}>
              <Form.Item name="enabled" label="Enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="maxRequests"
                label="Max Requests"
                rules={[{ required: true, message: 'Max requests required' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="windowSeconds"
                label="Window (seconds)"
                rules={[{ required: true, message: 'Window duration required' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </div>
  );
};
