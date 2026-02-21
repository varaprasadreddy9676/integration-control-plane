import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Card, Col, DatePicker, Descriptions, Divider, Drawer, Grid, Input, Row, Select, Space, Statistic, Tag, Typography, Skeleton, Dropdown, Collapse } from 'antd';
import { ClearOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { PageHeader } from '../../../components/common/PageHeader';
import { FilterBar } from '../../../components/common/FilterBar';
import { ModernTable } from '../../../components/common/ModernTable';
import { exportAlertCenterLogsToCsv, exportAlertCenterLogsToJson, getAlertCenterLogs, getAlertCenterStatus, getTenantInfo, getUIConfig } from '../../../services/api';
import type { AlertCenterLog } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';

const STATUS_OPTIONS = [
  { value: 'SENT', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'SKIPPED', label: 'Skipped' }
];

const CHANNEL_OPTIONS = [
  { value: 'EMAIL', label: 'Email' }
];

const TYPE_LABELS: Record<string, string> = {
  DELIVERY_FAILURE_REPORT: 'Delivery Failure Report'
};

const { RangePicker } = DatePicker;

export const AlertCenterRoute = () => {
  const { spacing, token, shadows, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1]
      };
  const [searchParams, setSearchParams] = useSearchParams();
  const hasDefaultedStatus = useRef(false);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [channelFilter, setChannelFilter] = useState<string>();
  const [typeFilter, setTypeFilter] = useState<string>();
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AlertCenterLog | null>(null);
  const [payloadExpanded, setPayloadExpanded] = useState(false);
  const [providerResponseExpanded, setProviderResponseExpanded] = useState(false);

  // Pagination with auto-reset on filter changes
  // NOTE: Backend doesn't support server-side pagination yet (no page/offset params)
  // This uses client-side pagination on loaded records
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 25,
    resetDeps: [statusFilter, channelFilter, typeFilter, search, dateRange]
  });

  useEffect(() => {
    const status = searchParams.get('status') || undefined;
    const channel = searchParams.get('channel') || undefined;
    const type = searchParams.get('type') || undefined;
    const q = searchParams.get('search') || '';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!status && !hasDefaultedStatus.current) {
      hasDefaultedStatus.current = true;
      setStatusFilter('SENT');
    } else {
      setStatusFilter(status);
    }
    setChannelFilter(channel);
    setTypeFilter(type);
    setSearch(q);
    if (startDate && endDate) {
      setDateRange([startDate, endDate]);
    } else {
      setDateRange(null);
    }
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);

    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');

    if (channelFilter) params.set('channel', channelFilter);
    else params.delete('channel');

    if (typeFilter) params.set('type', typeFilter);
    else params.delete('type');

    if (search) params.set('search', search);
    else params.delete('search');

    if (dateRange?.[0] && dateRange?.[1]) {
      params.set('startDate', dateRange[0]);
      params.set('endDate', dateRange[1]);
    } else {
      params.delete('startDate');
      params.delete('endDate');
    }

    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [statusFilter, channelFilter, typeFilter, search, dateRange, searchParams, setSearchParams]);

  const { data: logs = [], isFetching, refetch } = useQuery<AlertCenterLog[]>({
    queryKey: ['alert-center', statusFilter, channelFilter, typeFilter, search, dateRange],
    queryFn: () => getAlertCenterLogs({
      status: statusFilter || undefined,
      channel: channelFilter || undefined,
      type: typeFilter || undefined,
      search: search || undefined,
      startDate: dateRange?.[0],
      endDate: dateRange?.[1],
      // TODO: Backend should support server-side pagination (page/offset params)
      limit: 100
    })
  });
  const { data: alertStatus, isFetching: alertStatusLoading } = useQuery({
    queryKey: ['alert-center-status'],
    queryFn: getAlertCenterStatus,
    staleTime: 60 * 1000
  });
  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000
  });
  const { data: tenantInfo } = useQuery({
    queryKey: ['tenant-info'],
    queryFn: getTenantInfo,
    staleTime: 5 * 60 * 1000
  });

  const stats = useMemo(() => {
    return {
      total: logs.length,
      sent: logs.filter(log => log.status === 'SENT').length,
      failed: logs.filter(log => log.status === 'FAILED').length,
      skipped: logs.filter(log => log.status === 'SKIPPED').length
    };
  }, [logs]);

  const typeOptions = useMemo(() => {
    const values = Array.from(new Set(logs.map(log => log.type).filter(Boolean)));
    const merged = values.length ? values : Object.keys(TYPE_LABELS);
    return merged.map(value => ({ value, label: TYPE_LABELS[value] || value }));
  }, [logs]);

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
    if (status === 'SENT') return colors.success[600];
    if (status === 'FAILED') return colors.error[600];
    if (status === 'SKIPPED') return colors.warning[600];
    return cssVar.text.secondary;
  };

  const formatRecipients = (recipients?: string[]) => {
    if (!recipients || recipients.length === 0) return '—';
    if (recipients.length === 1) return recipients[0];
    return `${recipients[0]} +${recipients.length - 1}`;
  };

  const jsonColors = {
    key: cssVar.text.secondary,
    string: colors.success[700],
    number: colors.info[700],
    boolean: colors.warning[700],
    null: cssVar.text.muted
  };

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const formatJsonForDisplay = (value: unknown) => {
    const json = JSON.stringify(value, null, 2) || '';
    const escaped = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const highlighted = escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"\\s*:)|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?/g,
      (match) => {
        if (match.startsWith('"') && match.endsWith(':')) {
          return `<span style=\"color: ${jsonColors.key}; font-weight: 600;\">${match}</span>`;
        }
        if (match.startsWith('"')) {
          return `<span style=\"color: ${jsonColors.string};\">${match}</span>`;
        }
        if (match === 'true' || match === 'false') {
          return `<span style=\"color: ${jsonColors.boolean}; font-weight: 600;\">${match}</span>`;
        }
        if (match === 'null') {
          return `<span style=\"color: ${jsonColors.null};\">${match}</span>`;
        }
        return `<span style=\"color: ${jsonColors.number};\">${match}</span>`;
      }
    );
    return highlighted;
  };

  const formatTextOrJsonForDisplay = (value?: string | null) => {
    if (!value) return '';
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatJsonForDisplay(parsed);
      } catch (err) {
        return escapeHtml(value);
      }
    }
    return escapeHtml(value);
  };

  const handleClearFilters = () => {
    setStatusFilter(undefined);
    setChannelFilter(undefined);
    setTypeFilter(undefined);
    setSearch('');
    setDateRange(null);
    const params = new URLSearchParams(searchParams);
    params.delete('status');
    params.delete('channel');
    params.delete('type');
    params.delete('search');
    params.delete('startDate');
    params.delete('endDate');
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      msgApi.success(`${label} copied to clipboard`);
    } catch (error) {
      msgApi.error('Failed to copy to clipboard');
    }
  };

  const handleRefresh = async () => {
    try {
      await refetch();
      msgApi.success('Alert logs refreshed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh logs';
      msgApi.error(errorMessage);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (exportLoading) return;
    setExportLoading(true);
    try {
      const filters = {
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
        type: typeFilter || undefined,
        search: search || undefined,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1]
      };
      if (format === 'csv') {
        await exportAlertCenterLogsToCsv(filters);
      } else {
        await exportAlertCenterLogsToJson(filters);
      }
      msgApi.success(`Exported alert logs as ${format.toUpperCase()}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      msgApi.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const columns = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => <Tag style={tagTone(statusColor(value))}>{value || '—'}</Tag>
    },
    {
      title: 'Subject',
      dataIndex: 'subject',
      render: (value: string) => (
        <Typography.Text ellipsis style={{ maxWidth: 400, display: 'block' }}>
          {value || '—'}
        </Typography.Text>
      )
    },
    {
      title: 'Recipients',
      dataIndex: 'recipients',
      width: 220,
      render: (value: string[]) => (
        <Typography.Text ellipsis style={{ maxWidth: 200, display: 'block' }}>
          {formatRecipients(value)}
        </Typography.Text>
      )
    },
    {
      title: 'Failures',
      dataIndex: 'totalFailures',
      width: 100,
      align: 'right' as const,
      render: (value: number) => (typeof value === 'number' ? value : '—')
    },
    {
      title: 'Details',
      dataIndex: 'id',
      width: 100,
      fixed: 'right' as const,
      render: (_: string, record: AlertCenterLog) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => {
            setSelectedLog(record);
            setPayloadExpanded(!!record.payload);
            setProviderResponseExpanded(!!record.providerResponse);
          }}
        >
          View
        </Button>
      )
    }
  ];

  const cardStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface,
    boxShadow: shadows.xl
  } as const;

  return (
    <div>
      <PageHeader
        title="Alert Center"
        description="Monitor outbound alerting activity across channels."
        compact
        actions={(
          <Space size={spacingToNumber(spacing[2])} wrap>
            <Dropdown
              disabled={exportLoading}
              menu={{
                items: [
                  { key: 'csv', label: 'Export CSV', icon: <DownloadOutlined />, onClick: () => handleExport('csv') },
                  { key: 'json', label: 'Export JSON', icon: <DownloadOutlined />, onClick: () => handleExport('json') }
                ]
              }}
            >
              <Button icon={<DownloadOutlined />} loading={exportLoading} size="small">
                {exportLoading ? 'Exporting...' : 'Export logs'}
              </Button>
            </Dropdown>
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={isFetching} size="small">
              Refresh
            </Button>
            <Button icon={<ClearOutlined />} onClick={handleClearFilters} size="small">
              Clear Filters
            </Button>
          </Space>
        )}
      />

      <Card style={{ ...cardStyle, marginBottom: spacing[2], padding: `${spacing['1.5']} ${spacing[3]}` }} bodyStyle={{ padding: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], alignItems: 'center' }}>
          {[
            { label: `Total: ${stats.total}`, tone: colors.primary[600] },
            { label: `Sent: ${stats.sent}`, tone: colors.success[600] },
            { label: `Failed: ${stats.failed}`, tone: colors.error[600] },
            { label: `Skipped: ${stats.skipped}`, tone: colors.warning[600] },
            { label: `Next run: ${alertStatus?.nextRunAt ? formatDateTime(alertStatus.nextRunAt) : (alertStatus?.enabled ? '—' : 'Disabled')}`, tone: cssVar.text.secondary },
            { label: `Last run: ${alertStatus?.lastRunLog?.status || '—'}`, tone: alertStatus?.lastRunLog?.status === 'SENT' ? colors.success[600] : alertStatus?.lastRunLog?.status === 'FAILED' ? colors.error[600] : colors.warning[600] },
            { label: `Last run failures: ${typeof alertStatus?.lastRunLog?.totalFailures === 'number' ? alertStatus?.lastRunLog?.totalFailures : '—'}`, tone: cssVar.text.secondary },
            { label: `Recipient: ${uiConfig?.notifications?.failureEmailReports?.email || tenantInfo?.tenantEmail || 'Not configured'}`, tone: cssVar.text.secondary }
          ].map((item) => (
            <Tag
              key={item.label}
              style={{
                borderRadius: borderRadius.full,
                fontSize: 12,
                padding: `${spacing['0.5']} ${spacing[2]}`,
                borderColor: withAlpha(item.tone, 0.25),
                background: withAlpha(item.tone, 0.06),
                color: item.tone,
                fontWeight: 700,
                margin: 0
              }}
            >
              {item.label}
            </Tag>
          ))}
        </div>
      </Card>

      <FilterBar
      >
        <Input
          allowClear
          placeholder="Search subject, recipient, or error"
          prefix={<SearchOutlined style={{ color: cssVar.text.secondary }} />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: isNarrow ? '100%' : 280 }}
          size="small"
        />
        <Select
          allowClear
          placeholder="Status"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value || undefined)}
          options={STATUS_OPTIONS}
          style={{ minWidth: 160 }}
          size="small"
        />
        <Select
          allowClear
          placeholder="Channel"
          value={channelFilter}
          onChange={(value) => setChannelFilter(value || undefined)}
          options={CHANNEL_OPTIONS}
          style={{ minWidth: 160 }}
          size="small"
        />
        <Select
          allowClear
          placeholder="Type"
          value={typeFilter}
          onChange={(value) => setTypeFilter(value || undefined)}
          options={typeOptions}
          style={{ minWidth: 220 }}
          size="small"
        />
        <RangePicker
          style={{ minWidth: 220 }}
          size="small"
          presets={[
            {
              label: 'Last 24h',
              value: [dayjs().subtract(1, 'day'), dayjs()]
            },
            {
              label: 'Last 7d',
              value: [dayjs().subtract(7, 'day'), dayjs()]
            },
            {
              label: 'Last 30d',
              value: [dayjs().subtract(30, 'day'), dayjs()]
            }
          ]}
          value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
          onChange={(_, dateStrings) => {
            if (dateStrings[0] && dateStrings[1]) {
              setDateRange([dateStrings[0], dateStrings[1]]);
            } else {
              setDateRange(null);
            }
          }}
        />
      </FilterBar>

      <div className="full-bleed-table" style={tableFullBleedStyle}>
        <Card style={cardStyle}>
          <ModernTable<AlertCenterLog>
            rowKey="id"
            dataSource={logs}
            columns={columns}
            loading={isFetching}
            pagination={getPaginationConfig(logs.length)}
            scroll={{ x: 900 }}
            size="small"
          />
        </Card>
      </div>

      <Drawer
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Alert Details"
        width={isNarrow ? '100%' : 720}
        destroyOnClose
      >
        {selectedLog ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
            <Descriptions
              column={1}
              size="small"
              labelStyle={{ width: 160, color: cssVar.text.secondary }}
            >
              <Descriptions.Item label="Status">
                <Tag style={tagTone(statusColor(selectedLog.status))}>{selectedLog.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Channel">
                <Tag style={tagTone(colors.info[600])}>{selectedLog.channel}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Type">
                <Tag style={tagTone(colors.neutral[600])}>{TYPE_LABELS[selectedLog.type] || selectedLog.type || '—'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Subject">{selectedLog.subject || '—'}</Descriptions.Item>
              <Descriptions.Item label="Recipients">
                {(selectedLog.recipients || []).join(', ') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Total Failures">
                {typeof selectedLog.totalFailures === 'number' ? selectedLog.totalFailures : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Window">
                {selectedLog.windowStart && selectedLog.windowEnd
                  ? `${formatDateTime(selectedLog.windowStart)} → ${formatDateTime(selectedLog.windowEnd)}`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Created At">
                {formatDateTime(selectedLog.createdAt)}
              </Descriptions.Item>
              {selectedLog.providerUrl && (
                <Descriptions.Item label="Provider URL">
                  <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 12, wordBreak: 'break-all' }}>
                    {selectedLog.providerUrl}
                  </Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider />

            {selectedLog.errorMessage && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography.Text strong>Error Message</Typography.Text>
                  <Button
                    size="small"
                    onClick={() => copyToClipboard(selectedLog.errorMessage || '', 'Error message')}
                  >
                    Copy
                  </Button>
                </div>
                <div style={{ marginTop: spacing[2], padding: spacing[3], background: withAlpha(cssVar.error.bg, 0.8), borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.error.border}` }}>
                  <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>
                    {selectedLog.errorMessage}
                  </Typography.Text>
                </div>
              </div>
            )}

            {selectedLog.errorStack && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography.Text strong>Error Stack</Typography.Text>
                  <Button
                    size="small"
                    onClick={() => copyToClipboard(selectedLog.errorStack || '', 'Error stack')}
                  >
                    Copy
                  </Button>
                </div>
                <div style={{ marginTop: spacing[2], padding: spacing[3], background: cssVar.bg.elevated, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}` }}>
                  <Typography.Text style={{ whiteSpace: 'pre-wrap', fontFamily: token.fontFamilyCode }}>
                    {selectedLog.errorStack}
                  </Typography.Text>
                </div>
              </div>
            )}

            {selectedLog.payload && (
              <Collapse
                size="small"
                ghost
                activeKey={payloadExpanded ? ['payload'] : []}
                onChange={(keys) => setPayloadExpanded(Array.isArray(keys) && keys.includes('payload'))}
                expandIcon={() => null}
                items={[
                  {
                    key: 'payload',
                    label: 'Payload',
                    extra: (
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(JSON.stringify(selectedLog.payload, null, 2), 'Payload');
                        }}
                      >
                        Copy JSON
                      </Button>
                    ),
                    children: (
                      <div style={{ padding: spacing[3], background: cssVar.bg.elevated, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}` }}>
                        <pre
                          className="clamped-code-block"
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            fontFamily: token.fontFamilyCode,
                            fontSize: token.fontSizeSM,
                            color: token.colorText
                          }}
                        >
                          <code
                            className="clamped-code-inline"
                            dangerouslySetInnerHTML={{ __html: formatJsonForDisplay(selectedLog.payload) }}
                            style={{
                              display: 'block'
                            }}
                          />
                        </pre>
                      </div>
                    )
                  }
                ]}
              />
            )}

            {selectedLog.providerResponse && (
              <Collapse
                size="small"
                ghost
                activeKey={providerResponseExpanded ? ['providerResponse'] : []}
                onChange={(keys) => setProviderResponseExpanded(Array.isArray(keys) && keys.includes('providerResponse'))}
                expandIcon={() => null}
                items={[
                  {
                    key: 'providerResponse',
                    label: (
                      <Space size={spacingToNumber(spacing[2])}>
                        <span>Provider Response</span>
                        <Tag style={tagTone(selectedLog.providerResponse.status >= 200 && selectedLog.providerResponse.status < 300 ? colors.success[600] : colors.error[600])}>
                          HTTP {selectedLog.providerResponse.status}
                        </Tag>
                      </Space>
                    ),
                    extra: (
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(selectedLog.providerResponse?.body || '', 'Provider response');
                        }}
                      >
                        Copy
                      </Button>
                    ),
                    children: (
                      <div style={{ padding: spacing[3], background: cssVar.bg.elevated, borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}` }}>
                        <pre className="clamped-code-block" style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM, color: token.colorText }}>
                          <code
                            className="clamped-code-inline"
                            dangerouslySetInnerHTML={{ __html: formatTextOrJsonForDisplay(selectedLog.providerResponse.body) || '(empty)' }}
                            style={{ display: 'block' }}
                          />
                        </pre>
                      </div>
                    )
                  }
                ]}
              />
            )}

            {!selectedLog.errorMessage && !selectedLog.errorStack && !selectedLog.payload && !selectedLog.providerResponse && (
              <div style={{ padding: spacing[4], textAlign: 'center', color: cssVar.text.secondary }}>
                <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>
                  No additional details available for this alert.
                </Typography.Text>
              </div>
            )}
          </div>
        ) : (
          <Skeleton active paragraph={{ rows: 6 }} />
        )}
      </Drawer>
    </div>
  );
};
