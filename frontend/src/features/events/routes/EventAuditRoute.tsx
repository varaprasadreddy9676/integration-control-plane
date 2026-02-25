import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, DatePicker, Input, Select, Space, Tag, Typography, Grid, Dropdown, Modal, Form, InputNumber, Switch } from 'antd';
import { DownloadOutlined, ReloadOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import { getEventAudit, getEventAuditById, getEventAuditStats, exportEventAuditToCsv, insertTestNotificationQueueEvents, getEventTypes } from '../../../services/api';
import type { EventAuditRecord } from '../../../mocks/types';
import { formatDateTimeWithSeconds, formatNumber } from '../../../utils/format';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { EventAuditDrawer } from '../components/EventAuditDrawer';
import { BulkImportModal } from '../components/BulkImportModal';
import { useTenant } from '../../../app/tenant-context';

const { RangePicker } = DatePicker;

const statusOptions = ['RECEIVED', 'PROCESSING', 'DELIVERED', 'SKIPPED', 'FAILED', 'STUCK'];
const skipCategoryOptions = [
  'DUPLICATE',
  'NO_WEBHOOK',
  'FILTER_MISMATCH',
  'CIRCUIT_BREAKER',
  'TRANSFORMATION_ERROR',
  'INVALID_PAYLOAD',
  'NO_ENTITY_CONTEXT',
  'PAYLOAD_TOO_LARGE',
  'SOURCE_FILTERED',
  'ACK_FAILURE',
  'WORKER_ERROR',
  'TEST_EVENT'
];
const sourceOptions = ['mysql', 'kafka', 'sqs', 'http'];

export const EventAuditRoute = () => {
  const location = useLocation();
  const { spacing, token, shadows, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const { orgId } = useTenant();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1]
      };

  const [statusFilter, setStatusFilter] = useState<string>();
  const [sourceFilter, setSourceFilter] = useState<string>();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>();
  const [skipCategoryFilter, setSkipCategoryFilter] = useState<string>();
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedEvent, setSelectedEvent] = useState<EventAuditRecord | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [testForm] = Form.useForm();

  const hoursBack = useMemo(() => {
    if (!dateRange) return 24;
    const start = new Date(dateRange[0]).getTime();
    const end = new Date(dateRange[1]).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 24;
    const diffHours = Math.ceil((end - start) / (1000 * 60 * 60));
    return Math.max(1, diffHours);
  }, [dateRange]);

  const { data: stats, refetch: refetchStats, isFetching: statsFetching } = useQuery({
    queryKey: ['event-audit-stats', hoursBack],
    queryFn: () => getEventAuditStats(hoursBack)
  });

  const {
    data: listResult,
    refetch: refetchEvents,
    isFetching: eventsFetching
  } = useQuery({
    queryKey: ['event-audit', statusFilter, sourceFilter, eventTypeFilter, skipCategoryFilter, dateRange, search, page, pageSize],
    queryFn: () => getEventAudit({
      status: statusFilter,
      source: sourceFilter,
      eventType: eventTypeFilter,
      skipCategory: skipCategoryFilter,
      startDate: dateRange?.[0],
      endDate: dateRange?.[1],
      search: search || undefined,
      limit: pageSize,
      page
    })
  });

  const events = listResult?.events || [];
  const total = listResult?.total || 0;

  // Refetch on navigate (sidebar click)
  useEffect(() => {
    refetchStats();
    refetchEvents();
  }, [location.key]);

  const { data: allEventTypes = [] } = useQuery({
    queryKey: ['event-types'],
    queryFn: getEventTypes
  });

  const { data: selectedEventDetail } = useQuery({
    queryKey: ['event-audit-detail', selectedEventId],
    queryFn: () => getEventAuditById(selectedEventId as string),
    enabled: Boolean(selectedEventId && drawerOpen)
  });

  const drawerEvent = selectedEventDetail || selectedEvent;

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.12),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM
  });

  const statusColor = (status?: string) => {
    switch (status) {
      case 'DELIVERED':
        return colors.success[600];
      case 'FAILED':
      case 'STUCK':
        return colors.error[600];
      case 'SKIPPED':
        return colors.warning[600];
      case 'PROCESSING':
      case 'RECEIVED':
        return colors.info[600];
      default:
        return colors.neutral[500];
    }
  };

  const eventTypeOptions = useMemo(() => {
    const types = Object.keys(stats?.byEventType || {});
    return types.map(type => ({ value: type, label: type }));
  }, [stats?.byEventType]);

  const createExportProgress = (label: string) => {
    const key = `export-${Date.now()}`;
    const startedAt = Date.now();
    msgApi.open({ key, type: 'loading', content: `${label}: queued`, duration: 0 });

    const formatBytes = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return '';
      const units = ['B', 'KB', 'MB', 'GB'];
      let idx = 0;
      let size = value;
      while (size >= 1024 && idx < units.length - 1) {
        size /= 1024;
        idx += 1;
      }
      return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
    };

    const formatEta = (processed: number, total: number) => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || processed <= 0 || total <= processed) {
        return '';
      }
      const rate = processed / elapsedSec;
      if (!Number.isFinite(rate) || rate <= 0) return '';
      const remainingSec = Math.max(0, Math.round((total - processed) / rate));
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      if (mins <= 0) return `${secs}s`;
      return `${mins}m ${secs}s`;
    };

    const onProgress = (progress: { status: string; processedRecords?: number; totalRecords?: number; fileSizeBytes?: number }) => {
      const total = progress.totalRecords ?? 0;
      const processed = progress.processedRecords ?? 0;
      const statusLabel = progress.status === 'PROCESSING'
        ? 'Processing'
        : progress.status === 'COMPLETED'
          ? 'Finalizing'
          : progress.status === 'FAILED'
            ? 'Failed'
            : 'Queued';
      const countLabel = total > 0 ? `${processed}/${total}` : processed > 0 ? `${processed}` : '';
      const sizeLabel = progress.fileSizeBytes ? formatBytes(progress.fileSizeBytes) : '';
      const etaLabel = formatEta(processed, total);
      const etaDisplay = !etaLabel && sizeLabel ? 'eta unknown' : etaLabel ? `eta ${etaLabel}` : '';
      const extraLabel = [sizeLabel && `size ${sizeLabel}`, etaDisplay].filter(Boolean).join(' · ');
      msgApi.open({
        key,
        type: 'loading',
        content: `${label}: ${statusLabel}${countLabel ? ` (${countLabel})` : ''}${extraLabel ? ` · ${extraLabel}` : ''}`,
        duration: 0
      });
    };

    const finish = (message: string, isError = false) => {
      msgApi.open({ key, type: isError ? 'error' : 'success', content: message, duration: 2 });
    };

    return { onProgress, finish };
  };

  const handleExportCsv = async () => {
    setExportLoading(true);
    try {
      const { onProgress, finish } = createExportProgress('Export CSV');
      await exportEventAuditToCsv({
        status: statusFilter,
        eventType: eventTypeFilter,
        source: sourceFilter,
        skipCategory: skipCategoryFilter,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
        timeoutMs: 120000
      }, { onProgress });
      finish('Export complete');
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Failed to export event audit');
    } finally {
      setExportLoading(false);
    }
  };

  const handleTestSubmit = async (values: any) => {
    setTestLoading(true);
    try {
      const payload = {
        orgId: Number(values.orgId),
        orgUnitRid: Number(values.orgUnitRid),
        phone: values.phone || undefined,
        mrn: values.mrn || undefined,
        datetime: values.datetime || undefined,
        createdAt: values.createdAt || undefined,
        limit: values.limit ? Number(values.limit) : undefined,
        eventTypes: values.eventTypes && values.eventTypes.length > 0 ? values.eventTypes : undefined,
        randomizeDates: Boolean(values.randomizeDates),
        randomDaysBack: values.randomDaysBack ? Number(values.randomDaysBack) : undefined,
        randomDaysForward: values.randomDaysForward ? Number(values.randomDaysForward) : undefined
      };
      const result = await insertTestNotificationQueueEvents(payload);
      msgApi.success(`Inserted ${result.inserted} test events.`);
      setTestModalOpen(false);
      testForm.resetFields();
      refetchEvents();
      refetchStats();
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Failed to insert test events');
    } finally {
      setTestLoading(false);
    }
  };

  const exportMenu = {
    items: [
      {
        key: 'csv',
        label: 'Export CSV',
        icon: <DownloadOutlined />,
        onClick: handleExportCsv
      }
    ]
  };

  return (
    <div>
      <PageHeader
        title="Event Audit"
        description="Track every event received, skipped, delivered, or failed."
        statusChips={[
          { label: `${formatNumber(total)} events` },
          { label: `${stats?.delivered ?? 0} delivered` },
          { label: `${stats?.skipped ?? 0} skipped` },
          { label: `${stats?.failed ?? 0} failed` },
          { label: `${stats?.stuck ?? 0} stuck` }
        ]}
        compact
        actions={
          <Space size={spacingToNumber(spacing[2])}>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setImportModalOpen(true)}
              size="small"
            >
              Bulk Import
            </Button>
            <Button
              onClick={() => {
                testForm.setFieldsValue({
                  orgId: orgId || undefined,
                  orgUnitRid: orgId || undefined,
                  randomizeDates: false,
                  randomDaysBack: 7,
                  randomDaysForward: 7
                });
                setTestModalOpen(true);
              }}
              size="small"
            >
              Add Test Events
            </Button>
            <Dropdown menu={exportMenu} trigger={['click']}>
              <Button icon={<DownloadOutlined />} disabled={exportLoading} size="small">
                Export CSV
              </Button>
            </Dropdown>
            <Button
              icon={<ReloadOutlined />}
              loading={eventsFetching || statsFetching}
              onClick={() => { refetchEvents(); refetchStats(); }}
              size="small"
            >
              Refresh
            </Button>
          </Space>
        }
      />

      <Card
        style={{
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${cssVar.border.default}`,
          background: cssVar.bg.surface,
          boxShadow: shadows.xl,
          marginBottom: spacing[3]
        }}
        styles={{ body: { padding: spacing[3] } }}
      >
        <Space
          wrap
          size={spacingToNumber(spacing[2])}
          style={{ width: '100%', alignItems: 'center' }}
        >
          <Typography.Text type="secondary" style={{ fontWeight: 600 }}>
            Filters
          </Typography.Text>
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160, flex: '1 1 180px' }}
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); setPage(1); }}
            options={statusOptions.map((status) => ({ value: status, label: status }))}
            size="small"
          />
          <Select
            placeholder="Source"
            allowClear
            style={{ minWidth: 160, flex: '1 1 180px' }}
            value={sourceFilter}
            onChange={(value) => { setSourceFilter(value); setPage(1); }}
            options={sourceOptions.map((source) => ({ value: source, label: source.toUpperCase() }))}
            size="small"
          />
          <Select
            placeholder="Event Type"
            allowClear
            style={{ minWidth: 200, flex: '1 1 220px' }}
            value={eventTypeFilter}
            onChange={(value) => { setEventTypeFilter(value); setPage(1); }}
            options={eventTypeOptions}
            size="small"
          />
          <Select
            placeholder="Skip Category"
            allowClear
            style={{ minWidth: 200, flex: '1 1 220px' }}
            value={skipCategoryFilter}
            onChange={(value) => { setSkipCategoryFilter(value); setPage(1); }}
            options={skipCategoryOptions.map((category) => ({ value: category, label: category }))}
            size="small"
          />
          <RangePicker
            style={{ minWidth: 240, flex: '1 1 240px' }}
            onChange={(dates, dateStrings) => {
              if (dateStrings[0] && dateStrings[1]) {
                setDateRange([dateStrings[0], dateStrings[1]]);
              } else {
                setDateRange(null);
              }
              setPage(1);
            }}
            size="small"
          />
          <Input.Search
            placeholder="Search event ID, source ID, or summary"
            allowClear
            style={{ minWidth: 220, flex: '1 1 240px' }}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            size="small"
          />
        </Space>
      </Card>

      <Modal
        title="Insert Test Events"
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        okText="Insert Events"
        onOk={() => testForm.submit()}
        confirmLoading={testLoading}
        destroyOnClose
      >
        <Form
          form={testForm}
          layout="vertical"
          onFinish={handleTestSubmit}
          requiredMark="optional"
        >
          <Form.Item
            name="orgUnitRid"
            label="Org Unit RID"
            rules={[{ required: true, message: 'Please enter org unit RID' }]}
          >
            <InputNumber style={{ width: '100%' }} placeholder="e.g., 353" min={1} />
          </Form.Item>
          <Form.Item
            name="orgId"
            label="Org ID"
            rules={[{ required: true, message: 'Please enter org ID' }]}
          >
            <InputNumber style={{ width: '100%' }} placeholder="e.g., 353" min={1} />
          </Form.Item>
          <Form.Item name="phone" label="Patient Mobile (optional)">
            <Input placeholder="e.g., 9886106330" />
          </Form.Item>
          <Form.Item name="mrn" label="Patient MRN (optional)">
            <Input placeholder="e.g., 25-26/GGKN/05338" />
          </Form.Item>
          <Form.Item name="datetime" label="Payload DateTime (optional)">
            <Input placeholder="e.g., 27/01/2026 02:58 PM" />
          </Form.Item>
          <Form.Item name="createdAt" label="DB Created At (optional)">
            <Input placeholder="e.g., 2026-02-05 15:44:02" />
          </Form.Item>
          <Form.Item name="limit" label="Limit Events (optional)">
            <InputNumber style={{ width: '100%' }} placeholder="Insert first N events" min={1} />
          </Form.Item>
          <Form.Item
            name="randomizeDates"
            label="Randomize Date Fields"
            valuePropName="checked"
            extra="Replaces date-like fields in the payloads within a random range."
          >
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.randomizeDates !== next.randomizeDates}>
            {({ getFieldValue }) =>
              getFieldValue('randomizeDates') ? (
                <Space size="middle" style={{ width: '100%' }}>
                  <Form.Item
                    name="randomDaysBack"
                    label="Days Back"
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <InputNumber style={{ width: '100%' }} placeholder="e.g., 7" min={0} />
                  </Form.Item>
                  <Form.Item
                    name="randomDaysForward"
                    label="Days Forward"
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <InputNumber style={{ width: '100%' }} placeholder="e.g., 7" min={0} />
                  </Form.Item>
                </Space>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="eventTypes"
            label="Event Types (optional)"
            extra="Leave empty to insert all event types."
          >
            <Select
              mode="multiple"
              placeholder="Select event types to insert"
              allowClear
              showSearch
              optionFilterProp="label"
              options={allEventTypes.map(type => ({ label: type, value: type }))}
              maxTagCount={4}
            />
          </Form.Item>
        </Form>
      </Modal>

      <div className="full-bleed-table" style={tableFullBleedStyle}>
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${cssVar.border.default}`,
            background: cssVar.bg.surface,
            boxShadow: shadows.xl
          }}
        >
          <ModernTable<EventAuditRecord>
            dataSource={events}
            rowKey={(record) => record._id || record.eventId || record.id || ''}
            loading={eventsFetching}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                if (nextPageSize) setPageSize(nextPageSize);
              }
            }}
            size="small"
            columns={[
            {
              title: 'Received At',
              dataIndex: 'receivedAt',
              key: 'receivedAt',
              width: 180,
              render: (value: string) => value ? formatDateTimeWithSeconds(value) : '—',
              sorter: (a: any, b: any) => new Date(a.receivedAt || 0).getTime() - new Date(b.receivedAt || 0).getTime()
            },
            {
              title: 'Event Type',
              dataIndex: 'eventType',
              key: 'eventType',
              width: 200,
              render: (value: string) => (
                <Tag style={tagTone(colors.info[600])}>{value || '—'}</Tag>
              )
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              width: 140,
              render: (value: string) => (
                <Tag style={tagTone(statusColor(value))}>{value || '—'}</Tag>
              )
            },
            {
              title: 'Source',
              dataIndex: 'source',
              key: 'source',
              width: 140,
              render: (value: string, record: EventAuditRecord) => (
                <Space size={spacingToNumber(spacing[1])}>
                  <Tag style={tagTone(colors.neutral[500])}>{(value || '—').toUpperCase()}</Tag>
                  {record.sourceId && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {record.sourceId}
                    </Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: 'Delivery',
              key: 'delivery',
              width: 180,
              render: (_: any, record: EventAuditRecord) => {
                const delivery = record.deliveryStatus || {};
                return (
                  <Typography.Text>
                    {delivery.integrationsMatched ?? 0} matched · {delivery.deliveredCount ?? 0} ok · {delivery.failedCount ?? 0} failed
                  </Typography.Text>
                );
              }
            },
            {
              title: 'Skip / Reason',
              dataIndex: 'skipReason',
              key: 'skipReason',
              width: 240,
              render: (_: any, record: EventAuditRecord) => (
                <Typography.Text type="secondary">
                  {record.skipCategory ? `${record.skipCategory}: ` : ''}{record.skipReason || record.errorMessage || '—'}
                </Typography.Text>
              )
            },
            {
              title: 'Event ID',
              dataIndex: 'eventId',
              key: 'eventId',
              width: 220,
              render: (value: string) => (
                <Typography.Text
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                  ellipsis
                >
                  {value || '—'}
                </Typography.Text>
              )
            },
            {
              title: '',
              key: 'actions',
              width: 80,
              render: (_: any, record: EventAuditRecord) => (
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  onClick={() => {
                    setSelectedEvent(record);
                    setSelectedEventId(record.eventId);
                    setDrawerOpen(true);
                  }}
                >
                  View
                </Button>
              )
            }
            ]}
          />
        </Card>
      </div>

      <EventAuditDrawer
        event={drawerEvent}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedEventId(null);
        }}
      />

      <BulkImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          setImportModalOpen(false);
          refetchEvents();
          refetchStats();
        }}
      />
    </div>
  );
};
