import { useMemo, useState } from 'react';
import { App, Button, Dropdown, Modal, Select, Space, Tag, Typography, Card, Grid, Input, Switch, Divider, Empty } from 'antd';
import { FilterOutlined, MoreOutlined, ReloadOutlined, SearchOutlined, CloseCircleOutlined, DownloadOutlined, CopyOutlined, DeleteOutlined, CheckOutlined, StopOutlined, EditOutlined, AppstoreOutlined, ThunderboltOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { ModernTable } from '../../../components/common/ModernTable';
import { getIntegrations, deleteIntegration, testIntegration, bulkEnableIntegrations, bulkDisableIntegrations, bulkDeleteIntegrations, updateIntegration, duplicateIntegration } from '../../../services/api';
import type { IntegrationConfig, IntegrationScope } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens, withAlpha, cssVar } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';

interface IntegrationsRouteProps {
  hideHeader?: boolean;
  isActive?: boolean;
}

export const IntegrationsRoute = ({ hideHeader = false, isActive = true }: IntegrationsRouteProps = {}) => {
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { data = [], refetch, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: getIntegrations,
    enabled: isActive
  });
  const [eventFilter, setEventFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>();
  const [scopeFilter, setScopeFilter] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  // Pagination with auto-reset on filter changes
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 20,
    resetDeps: [eventFilter, statusFilter, scopeFilter, searchQuery]
  });

  const filtered = useMemo(() => {
    return data.filter((item: any) => {
      // Filter out INBOUND integrations (only show OUTBOUND)
      if (item.direction === 'INBOUND') return false;

      if (eventFilter && item.eventType !== eventFilter) return false;
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      if (scopeFilter && item.scope !== scopeFilter) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesUrl = item.targetUrl.toLowerCase().includes(query);
        const matchesEventType = item.eventType.toLowerCase().includes(query);
        if (!matchesName && !matchesUrl && !matchesEventType) return false;
      }

      return true;
    });
  }, [data, eventFilter, statusFilter, scopeFilter, searchQuery]);

  const eventOptions = useMemo(() => [...new Set(data.map((item) => item.eventType))], [data]);

  const hasActiveFilters = !!(eventFilter || statusFilter || scopeFilter || searchQuery);
  const outboundData = useMemo(() => data.filter((item: any) => item.direction !== 'INBOUND'), [data]);

  const onDelete = async (record: IntegrationConfig) => {
    Modal.confirm({
      title: `Delete ${record.name}?`,
      content: 'This cannot be undone. Downstream systems will stop receiving this event.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteIntegration(record.id);
          msgApi.success('Event rule deleted');
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete event rule';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  const onTest = async (id: string) => {
    const hide = msgApi.loading('Sending test event...', 0);
    try {
      await testIntegration(id);
      hide();
      msgApi.success('Test event queued');
    } catch (error) {
      hide();
      const errorMessage = error instanceof Error ? error.message : 'Failed to send test event';
      msgApi.error(errorMessage);
    }
  };

  const onQuickToggle = async (record: IntegrationConfig, checked: boolean) => {
    if (!checked) {
      modal.confirm({
        title: `Disable "${record.name}"?`,
        content: 'This integration will stop processing events immediately. You can re-enable it anytime.',
        okText: 'Yes, Disable',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await updateIntegration(record.id, { ...record, isActive: false });
            msgApi.success('Event rule disabled');
            refetch();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update event rule';
            msgApi.error(errorMessage);
          }
        }
      });
      return;
    }

    try {
      await updateIntegration(record.id, { ...record, isActive: checked });
      msgApi.success('Event rule enabled');
      refetch();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update event rule';
      msgApi.error(errorMessage);
    }
  };

  const onDuplicate = async (record: IntegrationConfig) => {
    try {
      const sameEventTypeIntegrations = data.filter(w =>
        w.eventType === record.eventType &&
        w.id !== record.id
      );

      const proceedWithDuplicate = async () => {
        try {
          const newIntegration = await duplicateIntegration(record.id);
          msgApi.success('Event rule duplicated successfully');
          queryClient.invalidateQueries({ queryKey: ['integrations'] });
          navigate(`/integrations/${newIntegration.id}`);
        } catch (error) {
          msgApi.error('Failed to duplicate event rule');
          console.error('Duplicate error:', error);
        }
      };

      if (sameEventTypeIntegrations.length > 0) {
        modal.confirm({
          title: 'Duplicate event rule for same event type?',
          content: `You already have ${sameEventTypeIntegrations.length} integration(s) configured for "${record.eventType}". Are you sure you want to create another one for the same event type?`,
          okText: 'Yes, Duplicate',
          onOk: proceedWithDuplicate
        });
      } else {
        await proceedWithDuplicate();
      }
    } catch (error) {
      msgApi.error('An error occurred while duplicating');
      console.error('Duplicate check error:', error);
    }
  };

  const handleBulkEnable = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to enable');
      return;
    }

    try {
      const result = await bulkEnableIntegrations(selectedRowKeys as string[]);
      msgApi.success(result.message || `Enabled ${result.updatedCount} event rule(s)`);

      if (result.failedIds && result.failedIds.length > 0) {
        msgApi.warning(`Failed to enable ${result.failedIds.length} event rule(s)`);
      }

      setSelectedRowKeys([]);
      refetch();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to enable event rules';
      msgApi.error(errorMessage);
    }
  };

  const handleBulkDisable = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to disable');
      return;
    }

    modal.confirm({
      title: `Disable ${selectedRowKeys.length} event rule(s)?`,
      content: 'Selected event rules will stop processing events immediately. This may affect production systems.',
      okText: 'Yes, Disable All',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDisableIntegrations(selectedRowKeys as string[]);
          msgApi.success(result.message || `Disabled ${result.updatedCount} event rule(s)`);

          if (result.failedIds && result.failedIds.length > 0) {
            msgApi.warning(`Failed to disable ${result.failedIds.length} event rule(s)`);
          }

          setSelectedRowKeys([]);
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to disable event rules';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to delete');
      return;
    }

    modal.confirm({
      title: `Delete ${selectedRowKeys.length} event rule(s)?`,
      content: 'This action cannot be undone. Downstream systems will stop receiving these events.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDeleteIntegrations(selectedRowKeys as string[]);
          msgApi.success(result.message || `Deleted ${result.deletedCount} event rule(s)`);

          if (result.failedIds && result.failedIds.length > 0) {
            msgApi.warning(`Failed to delete ${result.failedIds.length} event rule(s)`);
          }

          setSelectedRowKeys([]);
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete event rules';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  const handleExport = (exportType: 'all' | 'selected' | 'filtered') => {
    try {
      let exportData: IntegrationConfig[] = [];
      let filename = 'integrations';

      switch (exportType) {
        case 'all':
          exportData = data;
          filename = `integrations-all-${new Date().toISOString().split('T')[0]}`;
          break;
        case 'selected':
          if (selectedRowKeys.length === 0) {
            msgApi.warning('Please select event rules to export');
            return;
          }
          exportData = data.filter((w) => selectedRowKeys.includes(w.id));
          filename = `integrations-selected-${selectedRowKeys.length}-${new Date().toISOString().split('T')[0]}`;
          break;
        case 'filtered':
          exportData = filtered;
          filename = `integrations-filtered-${filtered.length}-${new Date().toISOString().split('T')[0]}`;
          break;
      }

      if (exportData.length === 0) {
        msgApi.warning('No event rules to export');
        return;
      }

      const cleanData = exportData.map(({ id, tenantId, entityName, updatedAt, ...rest }) => rest);

      const dataStr = JSON.stringify(cleanData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      msgApi.success(`Exported ${exportData.length} event rule(s)`);
    } catch (error) {
      msgApi.error('Failed to export event rules');
      console.error('Export error:', error);
    }
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
    getCheckboxProps: (record: IntegrationConfig) => ({
      disabled: record.isInherited,
      name: record.name
    })
  };

  return (
    <div>
      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <div
          style={{
            borderBottom: `1px solid ${colors.primary[300]}`,
            background: withAlpha(colors.primary[50], 0.6),
            padding: `${spacing[2]} ${spacing[3]}`,
            marginBottom: spacing[2]
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size="small">
              <Typography.Text strong style={{ color: colors.primary[700] }}>
                {selectedRowKeys.length} selected
              </Typography.Text>
            </Space>
            <Space size="small">
              <Button
                size="small"
                icon={<CheckOutlined />}
                onClick={handleBulkEnable}
              >
                Enable
              </Button>
              <Button
                size="small"
                icon={<StopOutlined />}
                onClick={handleBulkDisable}
              >
                Disable
              </Button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'selected',
                      label: 'Export selected',
                      icon: <DownloadOutlined />,
                      onClick: () => handleExport('selected')
                    },
                    {
                      key: 'filtered',
                      label: 'Export filtered results',
                      icon: <DownloadOutlined />,
                      onClick: () => handleExport('filtered')
                    },
                    {
                      key: 'all',
                      label: 'Export all',
                      icon: <DownloadOutlined />,
                      onClick: () => handleExport('all')
                    }
                  ]
                }}
              >
                <Button size="small" icon={<DownloadOutlined />}>
                  Export
                </Button>
              </Dropdown>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={handleBulkDelete}
              >
                Delete
              </Button>
            </Space>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          padding: `${spacing[2]} ${spacing[3]}`,
          borderBottom: `1px solid ${token.colorBorder}`,
          background: cssVar.bg.surface,
          alignItems: 'center',
          marginBottom: spacing[2]
        }}
      >
          {/* Count Tags */}
          <Space size="small">
            <MetaTag variant="neutral" size="small">
              {`${data?.length ?? 0} total`}
            </MetaTag>
            <MetaTag variant="method" size="small">
              {(data ?? []).filter((w) => w.isInherited).length} inherited
            </MetaTag>
          </Space>

          <Divider type="vertical" style={{ height: 24, margin: 0 }} />

          {/* Search */}
          <Input
            placeholder="Search..."
            prefix={<SearchOutlined />}
            suffix={
              searchQuery ? (
                <CloseCircleOutlined
                  onClick={() => setSearchQuery('')}
                  style={{ cursor: 'pointer', color: token.colorTextSecondary }}
                />
              ) : null
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: isNarrow ? '100%' : 200 }}
            size="small"
            allowClear
          />

          {/* Filters */}
          <Select
            placeholder="Event"
            allowClear
            style={{ width: isNarrow ? '100%' : 140 }}
            size="small"
            value={eventFilter}
            onChange={(value) => setEventFilter(value)}
            options={eventOptions.map((event) => ({ value: event, label: event }))}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: isNarrow ? '100%' : 110 }}
            size="small"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'active' | 'inactive' | undefined)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' }
            ]}
          />
          <Select
            placeholder="Scope"
            allowClear
            style={{ width: isNarrow ? '100%' : 140 }}
            size="small"
            value={scopeFilter}
            onChange={(value) => setScopeFilter(value)}
            options={[
              { value: 'ENTITY_ONLY', label: 'Entity only' },
              { value: 'INCLUDE_CHILDREN', label: 'Include children' }
            ]}
          />

          {/* Actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: spacing[1] }}>
            <Button
              icon={<FilterOutlined />}
              size="small"
              type="text"
              onClick={() => {
                setEventFilter(undefined);
                setStatusFilter(undefined);
                setScopeFilter(undefined);
                setSearchQuery('');
              }}
            >
              Reset
            </Button>
            <Button icon={<ReloadOutlined />} size="small" onClick={() => refetch()} />
            <Button icon={<AppstoreOutlined />} size="small" onClick={() => navigate('/templates')}>
              Templates
            </Button>
          </div>
        </div>

      {/* Empty states */}
      {!isLoading && outboundData.length === 0 && (
        <div style={{ padding: `${spacing[12]} ${spacing[4]}`, textAlign: 'center' }}>
          <Empty
            description={
              <Space direction="vertical" size="small">
                <Typography.Text strong style={{ fontSize: 16 }}>No event rules yet</Typography.Text>
                <Typography.Text type="secondary">
                  Event rules define where to deliver events when they occur. Create your first rule to start routing events.
                </Typography.Text>
              </Space>
            }
          >
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/integrations/new')}>
                Create Event Rule
              </Button>
              <Button icon={<AppstoreOutlined />} onClick={() => navigate('/templates')}>
                Browse Templates
              </Button>
            </Space>
          </Empty>
        </div>
      )}

      {!isLoading && outboundData.length > 0 && filtered.length === 0 && hasActiveFilters && (
        <div style={{ padding: `${spacing[10]} ${spacing[4]}`, textAlign: 'center' }}>
          <Empty
            description={
              <Space direction="vertical" size="small">
                <Typography.Text strong>No event rules match your filters</Typography.Text>
                <Typography.Text type="secondary">
                  Try adjusting your search or filters to find what you're looking for.
                </Typography.Text>
              </Space>
            }
          >
            <Button
              icon={<FilterOutlined />}
              onClick={() => {
                setEventFilter(undefined);
                setStatusFilter(undefined);
                setScopeFilter(undefined);
                setSearchQuery('');
              }}
            >
              Clear all filters
            </Button>
          </Empty>
        </div>
      )}

      {/* Table */}
      {(isLoading || filtered.length > 0) && <div
        style={{
          border: `1px solid ${token.colorBorder}`,
          borderRadius: 8,
          background: cssVar.bg.surface
        }}
      >
        <ModernTable<IntegrationConfig>
          loading={isLoading}
          dataSource={filtered}
          rowKey="id"
          size="middle"
          enableResize={true}
          stickyHeader={true}
          rowSelection={rowSelection}
          pagination={{
            ...getPaginationConfig(filtered.length),
            showTotal: (total) => `${total} event rules`
          }}
          columns={[
            {
              title: 'Event Rule',
              dataIndex: 'name',
              key: 'name',
              width: 300,
              ellipsis: true,
              sorter: (a, b) => a.name.localeCompare(b.name),
              render: (_: unknown, record) => (
                <Space direction="vertical" size={2}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <Typography.Link
                      onClick={() => navigate(`/integrations/${record.id}`)}
                      style={{ fontWeight: 600, fontSize: 14 }}
                      ellipsis
                    >
                      {record.name}
                    </Typography.Link>
                    {record.isInherited && <StatusBadge status="INHERITED" size="small" />}
                  </div>
                  <Space size={6}>
                    <MetaTag variant="event" size="small">{record.eventType}</MetaTag>
                    <MetaTag variant="method" size="small">{(record.httpMethod || 'POST').toUpperCase()}</MetaTag>
                  </Space>
                </Space>
              )
            },
            {
              title: 'Scope',
              dataIndex: 'scope',
              key: 'scope',
              width: 180,
              sorter: (a, b) => a.scope.localeCompare(b.scope),
              filters: [
                { text: 'Include children', value: 'INCLUDE_CHILDREN' },
                { text: 'Entity only', value: 'ENTITY_ONLY' }
              ],
              onFilter: (value, record) => record.scope === value,
              render: (scope: IntegrationScope, record) => (
                <Space direction="vertical" size={4}>
                  <MetaTag variant="neutral" size="default">
                    {scope === 'INCLUDE_CHILDREN' ? 'Include children' : 'Entity only'}
                  </MetaTag>
                  {record.excludedEntityRids && record.excludedEntityRids.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {record.excludedEntityRids.length} excluded
                    </Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: 'Endpoint',
              dataIndex: 'targetUrl',
              key: 'targetUrl',
              width: 300,
              ellipsis: true,
              render: (url: string) => (
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 13 }}
                  ellipsis={{ tooltip: url }}
                >
                  {url}
                </Typography.Text>
              )
            },
            {
              title: 'Status',
              dataIndex: 'isActive',
              key: 'isActive',
              width: 120,
              align: 'center',
              filters: [
                { text: 'Active', value: true },
                { text: 'Inactive', value: false }
              ],
              onFilter: (value, record) => record.isActive === value,
              sorter: (a, b) => Number(a.isActive) - Number(b.isActive),
              render: (_: unknown, record) => (
                <Switch
                  checked={record.isActive}
                  onChange={(checked) => onQuickToggle(record, checked)}
                  size="small"
                  disabled={record.isInherited}
                />
              )
            },
            {
              title: 'Last Updated',
              dataIndex: 'updatedAt',
              key: 'updatedAt',
              width: 180,
              sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
              defaultSortOrder: 'descend',
              render: (date: string) => (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {formatDateTime(date)}
                </Typography.Text>
              )
            },
            {
              title: '',
              key: 'actions',
              width: 50,
              align: 'center',
              render: (_: unknown, record) => (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'edit',
                        label: 'Edit',
                        icon: <EditOutlined />,
                        onClick: () => navigate(`/integrations/${record.id}`)
                      },
                      {
                        key: 'duplicate',
                        label: 'Duplicate',
                        icon: <CopyOutlined />,
                        onClick: () => onDuplicate(record),
                        disabled: record.isInherited
                      },
                      {
                        key: 'test',
                        label: 'Send test event',
                        icon: <ThunderboltOutlined />,
                        onClick: () => onTest(record.id),
                        disabled: !record.isActive
                      },
                      {
                        type: 'divider'
                      },
                      {
                        key: 'delete',
                        label: 'Delete',
                        danger: true,
                        icon: <DeleteOutlined />,
                        onClick: () => onDelete(record),
                        disabled: record.isInherited
                      }
                    ]
                  }}
                >
                  <Button type="text" size="small" icon={<MoreOutlined />} />
                </Dropdown>
              )
            }
          ]}
        />
      </div>}
    </div>
  );
};
