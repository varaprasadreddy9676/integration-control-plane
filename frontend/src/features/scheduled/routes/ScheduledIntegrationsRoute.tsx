import { useMemo, useState, useCallback } from 'react';
import { App, Button, Card, Input, Select, Space, Tag, Typography, Divider, Grid, Modal, Skeleton, DatePicker } from 'antd';
import { ClockCircleOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, SendOutlined, StopOutlined, DownloadOutlined, ExclamationCircleOutlined, EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import { getScheduledIntegrations, deleteScheduledIntegration, bulkDeleteScheduledIntegrations, getIntegrations, updateScheduledIntegration } from '../../../services/api';
import type { ScheduledIntegration } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import dayjs from 'dayjs';

const getStatusIcon = (status: ScheduledIntegration['status']) => {
  switch (status) {
    case 'PENDING': return <ClockCircleOutlined />;
    case 'OVERDUE': return <ExclamationCircleOutlined />;
    case 'SENT': return <CheckCircleOutlined />;
    case 'FAILED': return <CloseCircleOutlined />;
    case 'CANCELLED': return <StopOutlined />;
    default: return <ClockCircleOutlined />;
  }
};

const getStatusColor = (status: ScheduledIntegration['status'], colors: any) => {
  switch (status) {
    case 'PENDING': return colors.info[600];
    case 'OVERDUE': return colors.warning[600];
    case 'SENT': return colors.success[600];
    case 'FAILED': return colors.error[600];
    case 'CANCELLED': return colors.warning[600];
    default: return cssVar.text.secondary;
  }
};

export const ScheduledIntegrationsRoute = () => {
  const { spacing, token, shadows, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi, modal } = App.useApp();
  const navigate = useNavigateWithParams();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const [statusFilter, setStatusFilter] = useState<string | undefined>('PENDING'); // Default to PENDING filter
  const [integrationFilter, setIntegrationFilter] = useState<string>();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>();
  const [search, setSearch] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingScheduledFor, setEditingScheduledFor] = useState<dayjs.Dayjs | null>(null);

  const { data: scheduledIntegrations = [], refetch: refetchScheduled, isFetching: scheduledFetching } = useQuery<ScheduledIntegration[]>({
    queryKey: ['scheduled-integrations', statusFilter, integrationFilter, eventTypeFilter],
    queryFn: () => getScheduledIntegrations({
      status: statusFilter,
      integrationConfigId: integrationFilter,
      eventType: eventTypeFilter,
      limit: 500
    })
  });

  const { data: integrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations });

  const filtered = useMemo(() => {
    let result = scheduledIntegrations;

    // Hide CANCELLED integrations by default unless specifically filtering for them
    if (statusFilter !== 'CANCELLED') {
      result = result.filter(sw => sw.status !== 'CANCELLED');
    }

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(sw => {
        // Search across all text fields
        const searchableFields = [
          sw.integrationName,
          sw.__KEEP_integrationName__,
          sw.eventType,
          sw.targetUrl,
          sw.status,
          sw.originalEventId,
          sw.errorMessage,
          sw.id,
          // Search in payload JSON
          sw.payload ? JSON.stringify(sw.payload) : '',
          // Search in recurring config if present
          sw.recurringConfig ? JSON.stringify(sw.recurringConfig) : '',
          // Search in cancellation info if present
          sw.cancellationInfo ? JSON.stringify(sw.cancellationInfo) : ''
        ];

        return searchableFields
          .filter(Boolean)
          .some(field => String(field).toLowerCase().includes(searchLower));
      });
    }

    return result;
  }, [scheduledIntegrations, search, statusFilter]);

  // Calculate statistics (excluding CANCELLED unless specifically filtered)
  const stats = useMemo(() => {
    const activeIntegrations = statusFilter === 'CANCELLED'
      ? scheduledIntegrations.filter(sw => sw.status === 'CANCELLED')
      : scheduledIntegrations.filter(sw => sw.status !== 'CANCELLED');

    const total = activeIntegrations.length;
    const pending = activeIntegrations.filter(sw => sw.status === 'PENDING').length;
    const overdue = activeIntegrations.filter(sw => sw.status === 'OVERDUE').length;
    const sent = activeIntegrations.filter(sw => sw.status === 'SENT').length;
    const failed = activeIntegrations.filter(sw => sw.status === 'FAILED').length;
    const cancelled = scheduledIntegrations.filter(sw => sw.status === 'CANCELLED').length;

    return { total, pending, overdue, sent, failed, cancelled };
  }, [scheduledIntegrations, statusFilter]);

  // Get unique event types for filter
  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    scheduledIntegrations.forEach(sw => types.add(sw.eventType));
    return Array.from(types).sort();
  }, [scheduledIntegrations]);

  const tagTone = useCallback((base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.1),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM
  }), [spacing, token.fontSizeSM]);

  const panelStyle = useMemo(() => ({
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface,
    boxShadow: shadows.xl
  } as const), [token.borderRadiusLG, cssVar.border.default, cssVar.bg.surface]);

  const tableFullBleedStyle = useMemo(() => isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1]
      }, [isNarrow, spacing]);

  const handleEditScheduledFor = useCallback((record: ScheduledIntegration) => {
    setEditingRowId(record.id);
    // Parse the scheduledFor as a UTC timestamp and convert to local time for editing
    setEditingScheduledFor(dayjs(record.scheduledFor));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingRowId(null);
    setEditingScheduledFor(null);
  }, []);

  const handleSaveScheduledFor = useCallback(async (recordId: string) => {
    if (!editingScheduledFor) {
      msgApi.error('Please select a valid date and time');
      return;
    }

    try {
      // Ensure seconds and milliseconds are set to 0 for consistent scheduling
      // The user enters time in HH:mm format, so we set ss and ms to 0
      const normalizedDate = editingScheduledFor.second(0).millisecond(0);
      const isoString = normalizedDate.toISOString();

      await updateScheduledIntegration(recordId, {
        scheduledFor: isoString
      });
      msgApi.success('Scheduled time updated successfully');
      setEditingRowId(null);
      setEditingScheduledFor(null);
      refetchScheduled();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update scheduled time';
      msgApi.error(errorMessage);
    }
  }, [editingScheduledFor, msgApi, refetchScheduled]);

  const handleDelete = useCallback(async (record: ScheduledIntegration) => {
    modal.confirm({
      title: 'Cancel Scheduled Event',
      content: `Cancel the scheduled event "${record.integrationName}" for ${formatDateTime(record.scheduledFor)}?`,
      okText: 'Cancel Event',
      okType: 'danger',
      cancelText: 'Keep Scheduled',
      onOk: async () => {
        try {
          await deleteScheduledIntegration(record.id);
          msgApi.success('Scheduled event cancelled successfully');
          refetchScheduled();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to cancel scheduled event';
          msgApi.error(errorMessage);
        }
      }
    });
  }, [modal, msgApi, refetchScheduled]);

  const handleBulkDelete = () => {
    const selectedScheduled = filtered.filter(sw => selectedRowKeys.includes(sw.id));

    modal.confirm({
      title: 'Bulk Delete Scheduled Events',
      content: `Delete ${selectedScheduled.length} scheduled event(s)? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await bulkDeleteScheduledIntegrations(selectedRowKeys as string[]);
          msgApi.success(`Deleted ${result.deletedCount} scheduled event(s)`);
          if (result.failedIds.length > 0) {
            msgApi.warning(`Failed to delete ${result.failedIds.length} event(s)`);
          }
          setSelectedRowKeys([]);
          refetchScheduled();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete scheduled events';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    }
  };

  const handleQuickStatusFilter = (status: string) => {
    setStatusFilter(statusFilter === status ? undefined : status);
  };

  const handleExportCsv = () => {
    if (exportLoading) return;

    try {
      setExportLoading(true);

      // Prepare CSV headers
      const headers = ['Scheduled For', 'Integration Name', 'Event Type', 'Status', 'Target URL', 'Created At'];
      const csvRows = [headers.join(',')];

      // Add data rows
      filtered.forEach(sw => {
        const row = [
          `"${formatDateTime(sw.scheduledFor)}"`,
          `"${sw.integrationName}"`,
          `"${sw.eventType}"`,
          `"${sw.status}"`,
          `"${sw.targetUrl}"`,
          `"${formatDateTime(sw.createdAt)}"`
        ];
        csvRows.push(row.join(','));
      });

      // Create CSV blob and download
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `scheduled-integrations-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      msgApi.success(`Exported ${filtered.length} scheduled integration(s) to CSV`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export CSV';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const columns = useMemo(() => [
    {
      title: 'Scheduled For',
      dataIndex: 'scheduledFor',
      key: 'scheduledFor',
      width: 300,
      sorter: (a: ScheduledIntegration, b: ScheduledIntegration) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
      defaultSortOrder: 'ascend' as const,
      render: (scheduledFor: string, record: ScheduledIntegration) => {
        const isEditing = editingRowId === record.id;
        const canEdit = record.status === 'PENDING' || record.status === 'OVERDUE';

        if (isEditing) {
          return (
            <Space size="small">
              <DatePicker
                showTime={{
                  format: 'HH:mm',
                  defaultValue: dayjs('00:00', 'HH:mm')
                }}
                value={editingScheduledFor}
                onChange={(date) => setEditingScheduledFor(date)}
                format="YYYY-MM-DD HH:mm"
                size="small"
                style={{ width: 200 }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Select date and time"
                showNow={false}
              />
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveScheduledFor(record.id);
                }}
              />
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelEdit();
                }}
              />
            </Space>
          );
        }

        return (
          <Space size="small">
            <Typography.Text style={{ whiteSpace: 'nowrap' }}>
              {formatDateTime(scheduledFor)}
            </Typography.Text>
            {canEdit && (
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditScheduledFor(record);
                }}
                style={{ padding: '0 4px' }}
              />
            )}
          </Space>
        );
      }
    },
    {
      title: 'Event Rule',
      dataIndex: 'integrationName',
      key: 'integrationName',
      width: 220,
      ellipsis: true,
      render: (name: string, record: ScheduledIntegration) => (
        <Button
          type="link"
          onClick={() => navigate(`/integrations/${record.integrationConfigId}`)}
          style={{ padding: 0, height: 'auto', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {name}
        </Button>
      )
    },
    {
      title: 'Event Type',
      dataIndex: 'eventType',
      key: 'eventType',
      width: 200,
      render: (eventType: string) => (
        <Tag style={tagTone(colors.neutral[600])}>{eventType}</Tag>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: ScheduledIntegration['status']) => (
        <Tag
          icon={getStatusIcon(status)}
          style={tagTone(getStatusColor(status, colors))}
        >
          {status}
        </Tag>
      )
    },
    {
      title: 'Target URL',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      width: 300,
      ellipsis: true,
      render: (url: string) => (
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
          ellipsis={{ tooltip: url }}
        >
          {url}
        </Typography.Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right' as const,
      render: (_: any, record: ScheduledIntegration) => (
        <Space size="small">
          {(record.status === 'PENDING' || record.status === 'OVERDUE') && (
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
            >
              Cancel
            </Button>
          )}
        </Space>
      )
    }
  ], [editingRowId, editingScheduledFor, colors, token, tagTone, navigate, handleEditScheduledFor, handleCancelEdit, handleSaveScheduledFor, handleDelete]);

  return (
    <div>
      <PageHeader
        title="Scheduled Events"
        description="View and manage scheduled events. Cancelled events are hidden by default."
        statusChips={[
          { label: `${filtered.length} active` }
        ]}
        compact
        actions={
          <Space>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportCsv}
              loading={exportLoading}
              disabled={filtered.length === 0}
              size="small"
            >
              Export CSV
            </Button>
            <Button icon={<ReloadOutlined />} loading={scheduledFetching} onClick={() => refetchScheduled()} size="small">
              Refresh
            </Button>
          </Space>
        }
      />

      {/* Statistics Strip */}
      {scheduledFetching ? (
        <Card style={{ ...panelStyle, marginBottom: spacingToNumber(spacing[2]) }}>
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      ) : (
        <Card
          style={{ ...panelStyle, marginBottom: spacingToNumber(spacing[2]), padding: `${spacing['1.5']} ${spacing[3]}` }}
          bodyStyle={{ padding: 0 }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], alignItems: 'center' }}>
            {[
              { title: 'Total', value: stats.total, tone: cssVar.text.secondary, filterValue: undefined },
              { title: 'Pending', value: stats.pending, tone: colors.info[600], filterValue: 'PENDING' },
              { title: 'Overdue', value: stats.overdue, tone: colors.warning[600], filterValue: 'OVERDUE' },
              { title: 'Sent', value: stats.sent, tone: colors.success[600], filterValue: 'SENT' },
              { title: 'Failed', value: stats.failed, tone: colors.error[600], filterValue: 'FAILED' },
              { title: 'Cancelled', value: stats.cancelled, tone: colors.warning[600], filterValue: 'CANCELLED' }
            ].map((item) => {
              const isActive = item.filterValue
                ? statusFilter === item.filterValue
                : !statusFilter;
              const label = `${item.title}: ${item.value?.toLocaleString() ?? 0}`;
              return (
                <Tag
                  key={item.title}
                  onClick={() => {
                    if (!item.filterValue) {
                      setStatusFilter(undefined);
                    } else {
                      handleQuickStatusFilter(item.filterValue);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (!item.filterValue) {
                        setStatusFilter(undefined);
                      } else {
                        handleQuickStatusFilter(item.filterValue);
                      }
                    }
                  }}
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(item.tone, isActive ? 0.55 : 0.25),
                    background: withAlpha(item.tone, isActive ? 0.12 : 0.06),
                    color: item.tone,
                    fontWeight: 700,
                    margin: 0,
                    cursor: 'pointer'
                  }}
                >
                  {label}
                </Tag>
              );
            })}
          </div>
        </Card>
      )}

      {/* Filters Bar */}
      <Card style={{ ...panelStyle, marginBottom: spacingToNumber(spacing[2]) }}>
        <Space
          direction={isNarrow ? 'vertical' : 'horizontal'}
          size={spacingToNumber(spacing[2])}
          style={{ width: '100%', flexWrap: 'wrap' }}
        >
          {scheduledFetching ? (
            <>
              <Skeleton.Input active style={{ minWidth: 160 }} />
              <Skeleton.Input active style={{ minWidth: 200 }} />
              <Skeleton.Input active style={{ minWidth: 200 }} />
              <Skeleton.Input active style={{ minWidth: 250, flex: 1 }} />
              <Skeleton.Button active style={{ width: 90 }} />
            </>
          ) : (
            <>
              <Select
                placeholder="Filter by status"
                allowClear
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ minWidth: 160 }}
                size="small"
                options={[
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'OVERDUE', label: 'Overdue' },
                  { value: 'SENT', label: 'Sent' },
                  { value: 'FAILED', label: 'Failed' },
                  { value: 'CANCELLED', label: 'Cancelled' }
                ]}
              />

              <Select
                placeholder="Filter by event rule"
                allowClear
                showSearch
                value={integrationFilter}
                onChange={setIntegrationFilter}
                style={{ minWidth: 200 }}
                size="small"
                options={integrations.map(w => ({
                  value: w.id,
                  label: w.name
                }))}
              />

              <Select
                placeholder="Filter by event type"
                allowClear
                showSearch
                value={eventTypeFilter}
                onChange={setEventTypeFilter}
                style={{ minWidth: 200 }}
                size="small"
                options={eventTypes.map(et => ({
                  value: et,
                  label: et
                }))}
              />

              <Input.Search
                placeholder="Search in any field (name, event type, URL, payload, error, ID...)"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 250, flex: 1 }}
                size="small"
              />

              <Button icon={<ReloadOutlined />} loading={scheduledFetching} onClick={() => refetchScheduled()} size="small">
                Refresh
              </Button>
            </>
          )}
        </Space>
      </Card>

      {/* Bulk Actions Bar */}
      {selectedRowKeys.length > 0 && (
        <Card
          style={{
            ...panelStyle,
            marginBottom: spacingToNumber(spacing[4]),
            background: withAlpha(colors.info[500], 0.05),
            borderColor: colors.info[300]
          }}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Space>
              <Typography.Text strong>
                {selectedRowKeys.length} selected
              </Typography.Text>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>
                Clear
              </Button>
            </Space>
            <Space>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBulkDelete}
              >
                Bulk Delete
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      {/* Table */}
      <div className="full-bleed-table" style={tableFullBleedStyle}>
      <ModernTable
        dataSource={filtered}
        rowKey="id"
        rowSelection={rowSelection}
        scroll={{ x: 1200 }}
        loading={scheduledFetching}
        size="small"
        pagination={{
          defaultPageSize: 15,
          showSizeChanger: true,
          pageSizeOptions: ['10', '15', '25', '50', '100'],
          showTotal: (total) => `${total} scheduled integrations`
        }}
        expandable={{
          expandedRowRender: (record) => (
            <div style={{ padding: spacing[3] }}>
              {scheduledFetching ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : (
                <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
                  <div>
                    <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                      Original Event ID:
                    </Typography.Text>
                    <Typography.Text code>{record.originalEventId}</Typography.Text>
                  </div>
                  {record.payload && (
                    <div>
                      <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                        Payload:
                      </Typography.Text>
                      <div style={{ marginTop: spacing[1], fontFamily: 'monospace', fontSize: 12 }}>
                        <pre className="clamped-code-block" style={{ margin: 0 }}>
                          {JSON.stringify(record.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                  {record.errorMessage && (
                    <div>
                      <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                        Error Message:
                      </Typography.Text>
                      <Typography.Text type="danger" style={{ fontFamily: 'monospace' }}>
                        {record.errorMessage}
                      </Typography.Text>
                      {record.attemptCount && (
                        <Typography.Text type="secondary" style={{ marginLeft: spacing[2], fontSize: token.fontSizeSM }}>
                          (Attempt #{record.attemptCount})
                        </Typography.Text>
                      )}
                    </div>
                  )}
                  {record.cancellationInfo && (
                    <div>
                      <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                        Cancellation Info:
                      </Typography.Text>
                      <Typography.Text code>
                        {JSON.stringify(record.cancellationInfo, null, 2)}
                      </Typography.Text>
                    </div>
                  )}
                  {record.recurringConfig && (
                    <div>
                      <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                        Recurring Config:
                      </Typography.Text>
                      <div style={{ marginTop: spacing[1], fontFamily: 'monospace', fontSize: 12 }}>
                        <pre className="clamped-code-block" style={{ margin: 0 }}>
                          {JSON.stringify(record.recurringConfig, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                  <Divider style={{ margin: `${spacing[2]} 0` }} />
                  <div>
                    <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                      Created:
                    </Typography.Text>
                    <Typography.Text>{formatDateTime(record.createdAt)}</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ marginRight: spacing[2] }}>
                      Updated:
                    </Typography.Text>
                    <Typography.Text>{formatDateTime(record.updatedAt)}</Typography.Text>
                  </div>
                </Space>
              )}
            </div>
          )
        }}
        columns={columns}
      />
      </div>
    </div>
  );
};
