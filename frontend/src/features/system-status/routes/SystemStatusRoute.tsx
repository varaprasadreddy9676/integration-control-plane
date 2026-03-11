import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Grid,
  List,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { PortalScopeBadge } from '../../../components/portal/PortalScopeBadge';
import { useAuth } from '../../../app/auth-context';
import { useTenant } from '../../../app/tenant-context';
import { useDesignTokens } from '../../../design-system/utils';
import { getSystemStatus, type SystemStatusAdapter, type SystemStatusResponse, type SystemStatusWorker } from '../../../services/api';
import {
  formatAgeLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercentage,
  getAdapterStatusPresentation,
  getEventSourceConfigurationPresentation,
  getOverallStatusPresentation,
  getWorkerStatusPresentation,
} from '../system-status-utils';
import { useSearchParams } from 'react-router-dom';

const { Text, Paragraph } = Typography;

const TAB_KEYS = ['overview', 'workers', 'event-sources', 'runtime', 'traffic', 'alerts'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const AUTO_REFRESH_INTERVAL_MS = 30000;

function statusTag(label: string, color: string) {
  return <Tag color={color}>{label}</Tag>;
}

function DataAgeLabel({ timestamp }: { timestamp?: string | null }) {
  return <Text type="secondary">{formatAgeLabel(timestamp)}</Text>;
}

function KeyValueTable({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <Descriptions size="small" column={1} bordered>
      {rows.map((row) => (
        <Descriptions.Item key={row.label} label={row.label}>
          {row.value}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function WorkerTable({ workers }: { workers: SystemStatusWorker[] }) {
  return (
    <Table
      size="small"
      rowKey={(worker) => worker.workerName}
      pagination={false}
      dataSource={workers}
      columns={[
        {
          title: 'Worker',
          key: 'worker',
          render: (_, worker) => (
            <Space direction="vertical" size={0}>
              <Text strong>{worker.displayName}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{worker.workerName}</Text>
            </Space>
          ),
        },
        {
          title: 'Status',
          key: 'status',
          render: (_, worker) => {
            const presentation = getWorkerStatusPresentation(worker);
            return statusTag(presentation.label, presentation.color === 'orange' ? 'warning' : presentation.color);
          },
        },
        {
          title: 'Heartbeat',
          key: 'heartbeat',
          render: (_, worker) => <DataAgeLabel timestamp={worker.lastHeartbeat} />,
        },
        {
          title: 'Last Success',
          key: 'success',
          render: (_, worker) => <DataAgeLabel timestamp={worker.lastSuccessAt} />,
        },
        {
          title: 'Last Error',
          key: 'error',
          render: (_, worker) => worker.lastErrorMessage || '—',
        },
        {
          title: 'Metadata',
          key: 'meta',
          render: (_, worker) => {
            const entries = Object.entries(worker.meta || {});
            if (!entries.length) return '—';
            return (
              <Space size={[4, 4]} wrap>
                {entries.slice(0, 4).map(([key, value]) => (
                  <Tag key={key}>{`${key}: ${String(value)}`}</Tag>
                ))}
              </Space>
            );
          },
        },
      ]}
    />
  );
}

function EventSourceTable({ adapters }: { adapters: SystemStatusAdapter[] }) {
  return (
    <Table
      size="small"
      rowKey={(adapter) => `${adapter.sourceType}-${adapter.name}`}
      pagination={false}
      dataSource={adapters}
      columns={[
        {
          title: 'Source',
          key: 'source',
          render: (_, adapter) => (
            <Space direction="vertical" size={0}>
              <Text strong>{adapter.sourceType?.toUpperCase() || 'Unknown'}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{adapter.name}</Text>
            </Space>
          ),
        },
        {
          title: 'Connection',
          key: 'status',
          render: (_, adapter) => {
            const presentation = getAdapterStatusPresentation(adapter);
            return statusTag(presentation.label, presentation.color === 'orange' ? 'warning' : presentation.color);
          },
        },
        {
          title: 'Last Activity',
          key: 'activity',
          render: (_, adapter) => (
            <DataAgeLabel timestamp={adapter.lastMessageAt || adapter.lastSuccessAt || adapter.lastPollFinishedAt || adapter.lastConnectAt} />
          ),
        },
        {
          title: 'Probe / Runtime',
          key: 'probe',
          render: (_, adapter) => {
            if (adapter.connectionProbe?.ok) {
              return `Probe OK${adapter.connectionProbe.responseTimeMs ? ` (${adapter.connectionProbe.responseTimeMs} ms)` : ''}`;
            }
            if (adapter.connectionProbe?.error) return adapter.connectionProbe.error;
            if (adapter.lastReconnectReason) return adapter.lastReconnectReason;
            if (adapter.note) return adapter.note;
            return '—';
          },
        },
        {
          title: 'Details',
          key: 'details',
          render: (_, adapter) => {
            const tags: string[] = [];
            if (adapter.topic) tags.push(`topic: ${adapter.topic}`);
            if (adapter.groupId) tags.push(`group: ${adapter.groupId}`);
            if (adapter.table) tags.push(`table: ${adapter.table}`);
            if (adapter.reconnectAttempt) tags.push(`retries: ${adapter.reconnectAttempt}`);
            if (adapter.lastBackoffMs) tags.push(`backoff: ${adapter.lastBackoffMs}ms`);
            if (adapter.lastRowsFetched !== undefined) tags.push(`rows: ${adapter.lastRowsFetched}`);
            if (adapter.lastCheckpoint !== null && adapter.lastCheckpoint !== undefined) tags.push(`checkpoint: ${String(adapter.lastCheckpoint)}`);
            return tags.length ? <Space size={[4, 4]} wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space> : '—';
          },
        },
      ]}
    />
  );
}

function AlertsList({ data }: { data: SystemStatusResponse }) {
  const alertItems = data.alerts || [];
  const checkEntries = Object.entries(data.checks || {});

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title="Alerts" size="small">
          {alertItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active alerts" />
          ) : (
            <List
              dataSource={alertItems}
              renderItem={(alert) => (
                <List.Item>
                  <List.Item.Meta
                    title={<Space>{statusTag(String(alert.severity || 'unknown'), alert.severity === 'critical' ? 'red' : 'warning')}<Text strong>{alert.type}</Text></Space>}
                    description={alert.message}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Checks" size="small">
          {checkEntries.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No check data" />
          ) : (
            <List
              dataSource={checkEntries}
              renderItem={([key, value]) => (
                <List.Item>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Text>{key}</Text>
                    {statusTag(String(value), value === 'warning' ? 'warning' : value === 'healthy' ? 'green' : value === 'error' ? 'red' : 'default')}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}

export function SystemStatusRoute({ mode = 'admin' }: { mode?: 'admin' | 'standalone' }) {
  const { spacing } = useDesignTokens();
  const { user } = useAuth();
  const { orgId } = useTenant();
  const screens = Grid.useBreakpoint();
  const isStandalone = mode === 'standalone';
  const isPortalSession = !!(user as any)?.isPortalSession;
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshCountdown, setRefreshCountdown] = useState(30);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const activeTab = (searchParams.get('tab') || 'overview') as TabKey;
  const allowedViews = (() => {
    try {
      const stored = localStorage.getItem('integration_gateway_user');
      return stored ? (JSON.parse(stored)?.allowedViews ?? []) : [];
    } catch {
      return [] as string[];
    }
  })();
  const canViewPortalStatus = !isPortalSession || allowedViews.length === 0 || allowedViews.includes('system_status');

  const effectiveOrgId = orgId > 0 ? orgId : Number(searchParams.get('orgId') || 0);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['systemStatus', effectiveOrgId],
    queryFn: () => getSystemStatus(effectiveOrgId),
    enabled: effectiveOrgId > 0 && canViewPortalStatus,
    staleTime: 20000,
    refetchInterval: autoRefresh ? AUTO_REFRESH_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (!autoRefresh) {
      setRefreshCountdown(30);
      return;
    }
    if (!dataUpdatedAt) return;

    const updateCountdown = () => {
      const elapsedMs = Date.now() - dataUpdatedAt;
      const remainingSeconds = Math.max(0, Math.ceil((AUTO_REFRESH_INTERVAL_MS - elapsedMs) / 1000));
      setRefreshCountdown(remainingSeconds);
    };

    updateCountdown();
    const id = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, dataUpdatedAt]);

  const handleManualRefresh = async () => {
    setManualRefreshPending(true);
    try {
      await refetch();
    } finally {
      setManualRefreshPending(false);
    }
  };

  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  const lastUpdatedAge = dataUpdatedAt ? Math.floor((Date.now() - dataUpdatedAt) / 1000) : null;
  const dataStale = !!(autoRefresh && dataUpdatedAt && Date.now() - dataUpdatedAt > AUTO_REFRESH_INTERVAL_MS * 2);

  const overallStatus = useMemo(() => getOverallStatusPresentation(data?.overall?.status), [data?.overall?.status]);
  const workerSummary = data?.workers?.summary;
  const configurationPresentation = useMemo(
    () => getEventSourceConfigurationPresentation(data?.eventSources?.configuration),
    [data?.eventSources?.configuration]
  );

  const directionMix = data?.traffic?.directionMixLast60m || {};
  const backlogRows = [
    { label: 'Pending Deliveries', value: Object.values(data?.backlogs?.pendingDeliveries || {}).reduce((sum, count) => sum + count, 0) },
    { label: 'DLQ', value: Object.values(data?.backlogs?.dlq || {}).reduce((sum, count) => sum + count, 0) },
    { label: 'Scheduled Integrations', value: Object.values(data?.backlogs?.scheduledIntegrations || {}).reduce((sum, count) => sum + count, 0) },
  ];

  if (isPortalSession && !canViewPortalStatus) {
    return (
      <div style={{ padding: spacing[6] }}>
        <Alert
          type="error"
          showIcon
          message="System Status is not allowed for this portal profile"
          description="Ask your administrator to add the System Status view to this portal profile."
        />
      </div>
    );
  }

  const tabItems = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="Overall Health" value={overallStatus.label} prefix={overallStatus.color === 'green' ? <CheckCircleOutlined /> : overallStatus.color === 'red' ? <ExclamationCircleOutlined /> : <WarningOutlined />} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="Alerts" value={data?.overall?.alertCount?.total ?? 0} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="Deliveries (24h)" value={data?.overall?.summary?.deliveries24h ?? 0} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="Success Rate" value={formatPercentage(data?.overall?.summary?.successRate24h)} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="P95 Response" value={formatDuration(data?.overall?.summary?.p95ResponseTimeMs)} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={4}>
              <Card size="small">
                <Statistic title="Uptime" value={data?.process?.uptime?.formatted || '—'} prefix={<ClockCircleOutlined />} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={8}>
              <Card size="small" title="Traffic Windows">
                <KeyValueTable
                  rows={[
                    { label: 'Deliveries · 5m', value: data?.traffic?.deliveries?.last5m ?? 0 },
                    { label: 'Deliveries · 15m', value: data?.traffic?.deliveries?.last15m ?? 0 },
                    { label: 'Deliveries · 60m', value: data?.traffic?.deliveries?.last60m ?? 0 },
                    { label: 'Inbound Events · 60m', value: data?.traffic?.inboundEvents?.last60m ?? 0 },
                    { label: 'Inbound Events · 24h', value: data?.traffic?.inboundEvents?.last24h ?? 0 },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="Backlog Snapshot">
                <KeyValueTable rows={backlogRows.map((row) => ({ label: row.label, value: row.value }))} />
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="Log Freshness">
                <KeyValueTable
                  rows={[
                    { label: 'App Log', value: `${data?.logs?.app?.status || 'unknown'} · ${formatAgeLabel(data?.logs?.app?.modifiedAt)}` },
                    { label: 'Access Log', value: `${data?.logs?.access?.status || 'unknown'} · ${formatAgeLabel(data?.logs?.access?.modifiedAt)}` },
                    { label: 'Event Source Config', value: configurationPresentation.label },
                    { label: 'Workers Healthy', value: workerSummary ? `${workerSummary.healthy}/${workerSummary.total}` : '—' },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </Space>
      ),
    },
    {
      key: 'workers',
      label: 'Workers',
      children: <WorkerTable workers={data?.workers?.items || []} />,
    },
    {
      key: 'event-sources',
      label: 'Event Sources',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="Configuration">
            <KeyValueTable
              rows={[
                { label: 'State', value: configurationPresentation.label },
                { label: 'Configured', value: data?.eventSources?.configuration?.configured ? 'Yes' : 'No' },
                { label: 'Source Type', value: data?.eventSources?.configuration?.sourceType || '—' },
                { label: 'Config Origin', value: data?.eventSources?.configuration?.configOrigin || '—' },
                { label: 'Configuration Error', value: data?.eventSources?.configuration?.error?.errorMessage || '—' },
              ]}
            />
          </Card>
          {data?.eventSources?.configuration?.state === 'not_configured' || (data?.eventSources?.orgAdapters?.length || 0) === 0 ? (
            <Alert
              type="info"
              showIcon
              message="No event source configured"
              description="This org does not currently have a running event source adapter. That is different from a failed adapter." 
            />
          ) : (
            <EventSourceTable adapters={data?.eventSources?.orgAdapters || []} />
          )}
        </Space>
      ),
    },
    {
      key: 'runtime',
      label: 'Runtime',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="Application Runtime">
              <KeyValueTable
                rows={[
                  { label: 'Version', value: data?.process?.appVersion || '—' },
                  { label: 'Node', value: data?.process?.nodeVersion || '—' },
                  { label: 'Environment', value: data?.process?.environment || '—' },
                  { label: 'PID', value: data?.process?.pid ?? '—' },
                  { label: 'Started', value: formatDateTime(data?.process?.startedAt) },
                  { label: 'MySQL', value: data?.process?.mysql?.status || '—' },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="Memory & Host">
              <KeyValueTable
                rows={[
                  { label: 'Heap Used', value: formatBytes(data?.process?.memory?.stats?.heapUsedMB ? data.process.memory.stats.heapUsedMB * 1024 * 1024 : null) },
                  { label: 'RSS', value: formatBytes(data?.process?.memory?.stats?.rss ? data.process.memory.stats.rss * 1024 * 1024 : null) },
                  { label: 'Host Free Memory', value: formatBytes(data?.process?.host?.freeMemoryBytes) },
                  { label: 'Host Total Memory', value: formatBytes(data?.process?.host?.totalMemoryBytes) },
                  { label: 'Host Load', value: Array.isArray(data?.process?.host?.loadAverage) ? data?.process?.host?.loadAverage?.map((value) => value.toFixed(2)).join(' / ') : '—' },
                  { label: 'Hostname', value: data?.process?.host?.hostname || '—' },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="Log Files">
              <Table
                size="small"
                pagination={false}
                rowKey={(row) => row.key}
                dataSource={[
                  { key: 'app', label: 'App Log', ...data?.logs?.app },
                  { key: 'access', label: 'Access Log', ...data?.logs?.access },
                ]}
                columns={[
                  { title: 'Log', dataIndex: 'label', key: 'label' },
                  { title: 'Status', key: 'status', render: (_, row) => statusTag(String(row.status || 'unknown'), row.status === 'fresh' ? 'green' : row.status === 'stale' ? 'warning' : row.status === 'error' ? 'red' : 'default') },
                  { title: 'Modified', key: 'modifiedAt', render: (_, row) => formatDateTime(row.modifiedAt) },
                  { title: 'Age', key: 'age', render: (_, row) => row.modifiedAt ? formatAgeLabel(row.modifiedAt) : '—' },
                  { title: 'Size', key: 'size', render: (_, row) => formatBytes(row.sizeBytes) },
                  { title: 'File', dataIndex: 'fileName', key: 'fileName', render: (value: string) => value || '—' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'traffic',
      label: 'Traffic & Backlog',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="Direction Mix (60m)">
              {Object.keys(directionMix).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No direction mix data" />
              ) : (
                <Space size={[8, 8]} wrap>
                  {Object.entries(directionMix).map(([direction, count]) => (
                    <Tag key={direction}>{`${direction}: ${count}`}</Tag>
                  ))}
                </Space>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="Backlog Breakdown">
              <Descriptions size="small" bordered column={1}>
                <Descriptions.Item label="Pending Deliveries">
                  <Space size={[4, 4]} wrap>
                    {Object.entries(data?.backlogs?.pendingDeliveries || {}).map(([key, value]) => <Tag key={key}>{`${key}: ${value}`}</Tag>)}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="DLQ">
                  <Space size={[4, 4]} wrap>
                    {Object.entries(data?.backlogs?.dlq || {}).map(([key, value]) => <Tag key={key}>{`${key}: ${value}`}</Tag>)}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="Scheduled Integrations">
                  <Space size={[4, 4]} wrap>
                    {Object.entries(data?.backlogs?.scheduledIntegrations || {}).map(([key, value]) => <Tag key={key}>{`${key}: ${value}`}</Tag>)}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="Scheduled Jobs">
              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={8}><Statistic title="Total" value={data?.scheduledJobs?.summary?.total ?? 0} /></Col>
                <Col xs={24} md={8}><Statistic title="Active" value={data?.scheduledJobs?.summary?.active ?? 0} /></Col>
                <Col xs={24} md={8}><Statistic title="Loaded Tasks" value={data?.scheduledJobs?.worker?.loadedTasks ?? 0} /></Col>
              </Row>
              <Table
                size="small"
                rowKey={(row) => `${row.integrationId}-${row.correlationId}`}
                pagination={false}
                dataSource={data?.scheduledJobs?.recentExecutions || []}
                columns={[
                  { title: 'Job', dataIndex: 'integrationName', key: 'integrationName' },
                  { title: 'Status', key: 'status', render: (_, row) => statusTag(String(row.status || 'unknown'), row.status === 'success' ? 'green' : row.status === 'failed' ? 'red' : 'default') },
                  { title: 'Started', key: 'startedAt', render: (_, row) => formatDateTime(row.startedAt) },
                  { title: 'Duration', key: 'durationMs', render: (_, row) => formatDuration(row.durationMs) },
                  { title: 'Records', dataIndex: 'recordsFetched', key: 'recordsFetched' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'alerts',
      label: 'Alerts',
      children: <AlertsList data={data as SystemStatusResponse} />,
    },
  ];

  return (
    <div style={{ padding: isStandalone ? spacing[4] : spacing[6] }}>
      <PageHeader
        title="System Status"
        description={dataUpdatedAt ? `Last updated ${lastUpdatedAge}s ago` : 'Live application health, worker status, traffic, and runtime visibility.'}
        titleSuffix={isPortalSession ? <PortalScopeBadge /> : undefined}
        statusChips={[
          { label: overallStatus.label, color: overallStatus.color === 'orange' ? '#faad14' : overallStatus.color === 'green' ? '#52c41a' : overallStatus.color === 'red' ? '#ff4d4f' : undefined },
          { label: `${data?.overall?.alertCount?.total ?? 0} alerts`, color: (data?.overall?.alertCount?.total || 0) > 0 ? '#faad14' : undefined },
          { label: configurationPresentation.label, color: configurationPresentation.color === 'orange' ? '#faad14' : configurationPresentation.color === 'green' ? '#52c41a' : configurationPresentation.color === 'red' ? '#ff4d4f' : configurationPresentation.color === 'blue' ? '#1677ff' : undefined },
          { label: workerSummary ? `${workerSummary.healthy}/${workerSummary.total} workers healthy` : 'Workers unknown' },
        ]}
        actions={
          <Space wrap>
            <Space size={8}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {autoRefresh ? `Auto-refresh in ${refreshCountdown}s` : 'Auto-refresh off'}
              </Text>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
            </Space>
            <Button icon={<ReloadOutlined />} onClick={handleManualRefresh} loading={manualRefreshPending}>
              {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
            </Button>
          </Space>
        }
      />

      {error && (
        <Alert
          type="error"
          showIcon
          message="Failed to load system status"
          description={(error as Error).message}
          style={{ marginBottom: spacing[4] }}
        />
      )}

      {dataStale && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="Status data is stale"
          description="Auto-refresh is enabled, but the last successful update is older than expected. The data below may no longer reflect the current system state."
          style={{ marginBottom: spacing[4] }}
        />
      )}

      {isLoading && !data ? (
        <Card>
          <Paragraph type="secondary" style={{ margin: 0 }}>Loading system status…</Paragraph>
        </Card>
      ) : !data ? (
        <Card>
          <Empty description="No system status data" />
        </Card>
      ) : (
        <Tabs
          activeKey={TAB_KEYS.includes(activeTab) ? activeTab : 'overview'}
          onChange={setTab}
          items={tabItems}
          tabBarGutter={screens.md ? 24 : 12}
        />
      )}
    </div>
  );
}

export default SystemStatusRoute;
