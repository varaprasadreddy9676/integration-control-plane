import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd';
import {
  ApartmentOutlined,
  AuditOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SettingOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { useTenant } from '../../app/tenant-context';
import { PageHeader } from '../../components/common/PageHeader';
import {
  clearUIConfigOverride,
  getAdminSystemConfig,
  getAdminUiConfig,
  getCheckpoint,
  getUIConfig,
  getUIConfigOverride,
  listAdminOrgSummaries,
  updateAdminSystemConfig,
  updateAdminUiConfig,
  updateCheckpoint,
  updateUIConfigOverride
} from '../../services/api';
import { useDesignTokens, spacingToNumber, cssVar } from '../../design-system/utils';

const { Text, Title, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const { token } = useDesignTokens();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
      <Text type="secondary" style={{ fontSize: token.fontSizeSM, flexShrink: 0, marginRight: 12 }}>{label}</Text>
      <Text strong style={{ textAlign: 'right', fontFamily: mono ? token.fontFamilyCode : undefined }}>
        {value || <Text type="secondary" italic style={{ fontWeight: 400 }}>Not set</Text>}
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SettingsRoute = () => {
  const { tenant, orgId, setManualEntityRid } = useTenant();
  const { user, impersonate } = useAuth();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ---- pagination ----
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  // ---- alerting ----
  const [reportEnabled, setReportEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [lookbackMinutes, setLookbackMinutes] = useState(60);
  const [minFailures, setMinFailures] = useState(1);
  const [maxItems, setMaxItems] = useState(25);
  const [overrideEmail, setOverrideEmail] = useState('');
  const [savingAlert, setSavingAlert] = useState(false);
  const [resettingAlert, setResettingAlert] = useState(false);

  // ---- display preferences ----
  const [multiActionDelayMs, setMultiActionDelayMs] = useState(0);
  const [savingDelay, setSavingDelay] = useState(false);
  const [dashboardRefreshSeconds, setDashboardRefreshSeconds] = useState(30);
  const [savingDashboard, setSavingDashboard] = useState(false);

  // ---- checkpoint ----
  const [checkpointValue, setCheckpointValue] = useState<number | null>(null);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);

  // ---- admin ----
  const [adminImpersonateOrgId, setAdminImpersonateOrgId] = useState<number | null>(null);
  const [adminUiConfigText, setAdminUiConfigText] = useState('');
  const [adminSystemConfigText, setAdminSystemConfigText] = useState('');
  const [adminSavingUiConfig, setAdminSavingUiConfig] = useState(false);
  const [adminSavingSystemConfig, setAdminSavingSystemConfig] = useState(false);
  const [adminUiConfigEditable, setAdminUiConfigEditable] = useState(false);
  const [adminSystemConfigEditable, setAdminSystemConfigEditable] = useState(false);

  const [messageApi, contextHolder] = message.useMessage();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  // ---- queries ----
  const { data: uiConfig, isLoading: uiConfigLoading } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000
  });
  const { data: uiOverride, isLoading: uiOverrideLoading, refetch: refetchOverride } = useQuery({
    queryKey: ['uiConfigOverride'],
    queryFn: getUIConfigOverride,
    staleTime: 5 * 60 * 1000
  });
  const { data: checkpointData, isLoading: checkpointLoading, refetch: refetchCheckpoint } = useQuery({
    queryKey: ['workerCheckpoint'],
    queryFn: getCheckpoint,
    staleTime: 10 * 1000
  });
  const { data: adminOrgs = [] } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isAdmin,
    staleTime: 30 * 1000
  });
  const { data: adminUiConfig } = useQuery({
    queryKey: ['adminUiConfig'],
    queryFn: getAdminUiConfig,
    enabled: isAdmin,
    staleTime: 30 * 1000
  });
  const { data: adminSystemConfig } = useQuery({
    queryKey: ['adminSystemConfig'],
    queryFn: getAdminSystemConfig,
    enabled: isAdmin,
    staleTime: 30 * 1000
  });

  // ---- sync state from queries ----
  useEffect(() => {
    const effective = uiConfig?.notifications?.failureEmailReports;
    const override = uiOverride?.notifications?.failureEmailReports;
    const config = override || effective;
    if (config) {
      setReportEnabled(config.enabled ?? false);
      setIntervalMinutes(config.intervalMinutes ?? 15);
      setLookbackMinutes(config.lookbackMinutes ?? 60);
      setMinFailures(config.minFailures ?? 1);
      setMaxItems(config.maxItems ?? 25);
      setOverrideEmail(config.email ?? '');
    }
    const overrideDelay = uiOverride?.worker?.multiActionDelayMs;
    const effectiveDelay = uiConfig?.worker?.multiActionDelayMs;
    if (overrideDelay != null || effectiveDelay != null) {
      setMultiActionDelayMs(Number(overrideDelay ?? effectiveDelay ?? 0));
    }
    const overrideRefresh = uiOverride?.dashboard?.autoRefreshSeconds;
    const effectiveRefresh = uiConfig?.dashboard?.autoRefreshSeconds;
    if (overrideRefresh != null || effectiveRefresh != null) {
      setDashboardRefreshSeconds(Number(overrideRefresh ?? effectiveRefresh ?? 30));
    }
  }, [uiConfig, uiOverride]);

  useEffect(() => {
    if (checkpointData?.lastProcessedId !== undefined) {
      setCheckpointValue(checkpointData.lastProcessedId);
    } else if (checkpointData?.checkpoint?.lastProcessedId !== undefined) {
      setCheckpointValue(checkpointData.checkpoint.lastProcessedId);
    }
  }, [checkpointData]);

  useEffect(() => {
    if (adminUiConfig) setAdminUiConfigText(JSON.stringify(adminUiConfig, null, 2));
  }, [adminUiConfig]);

  useEffect(() => {
    if (adminSystemConfig) setAdminSystemConfigText(JSON.stringify(adminSystemConfig, null, 2));
  }, [adminSystemConfig]);

  // ---- helpers ----
  const buildConfigDiff = (before: any, after: any) => {
    const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    return keys
      .map((key) => {
        const prev = (before || {})[key];
        const next = (after || {})[key];
        return JSON.stringify(prev) === JSON.stringify(next) ? null : { key, before: prev, after: next };
      })
      .filter(Boolean) as Array<{ key: string; before: any; after: any }>;
  };

  // ---- derived data ----
  const childBranches = tenant?.childEntities || [];
  const paginatedBranches = childBranches.slice((page - 1) * pageSize, page * pageSize);
  const hasOverrides = !!uiOverride && Object.keys(uiOverride).length > 0;

  // Determine event source mode for checkpoint card
  const eventSourceMode: 'kafka' | 'mysql' | 'http' | 'none' = (() => {
    if (!checkpointData) return 'none';
    if (checkpointData.eventSource === 'kafka') return 'kafka';
    if (
      checkpointData.lastProcessedId !== undefined ||
      checkpointData.checkpoint?.lastProcessedId !== undefined
    ) return 'mysql';
    return 'http';
  })();

  const cardStyle = { borderRadius: token.borderRadiusLG };
  const mt = { marginTop: spacingToNumber(spacing[5]) };

  // ---- save helpers ----
  const saveAlertSettings = async (overrides?: Partial<{ enabled: boolean; email: string; intervalMinutes: number; lookbackMinutes: number; minFailures: number; maxItems: number }>) => {
    setSavingAlert(true);
    try {
      await updateUIConfigOverride({
        notifications: {
          failureEmailReports: {
            enabled: overrides?.enabled ?? reportEnabled,
            email: overrides?.email ?? overrideEmail,
            intervalMinutes: overrides?.intervalMinutes ?? intervalMinutes,
            lookbackMinutes: overrides?.lookbackMinutes ?? lookbackMinutes,
            minFailures: overrides?.minFailures ?? minFailures,
            maxItems: overrides?.maxItems ?? maxItems
          }
        }
      });
      await refetchOverride();
      queryClient.invalidateQueries({ queryKey: ['uiConfigOverride'] });
      messageApi.success('Alert settings saved');
    } catch {
      messageApi.error('Failed to save alert settings');
    } finally {
      setSavingAlert(false);
    }
  };

  // ============================
  // RENDER
  // ============================
  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Organization Settings"
        description="Configure alerts, display preferences, and view your organization details."
        statusChips={[
          { label: tenant?.region ?? 'Unknown region' },
          { label: tenant?.timezone ?? '' }
        ]}
      />

      <Row gutter={spacingToNumber(spacing[5])}>

        {/* ================================================================
            LEFT COLUMN — configurable settings
            ================================================================ */}
        <Col xs={24} lg={14}>

          {/* ---- 1. Notifications & Alerts ---- */}
          <Card
            title="Notifications & Alerts"
            style={cardStyle}
            extra={
              hasOverrides && (
                <Tooltip title="Reset all alert settings back to platform defaults">
                  <Button
                    size="small"
                    icon={<RollbackOutlined />}
                    loading={resettingAlert}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Reset to platform defaults?',
                        content: 'This will remove your custom alert settings and restore the defaults set by your platform admin.',
                        okText: 'Reset',
                        cancelText: 'Cancel',
                        onOk: async () => {
                          setResettingAlert(true);
                          try {
                            await clearUIConfigOverride();
                            await refetchOverride();
                            messageApi.success('Settings reset to platform defaults');
                          } catch {
                            messageApi.error('Failed to reset settings');
                          } finally {
                            setResettingAlert(false);
                          }
                        }
                      });
                    }}
                  >
                    Reset to defaults
                  </Button>
                </Tooltip>
              )
            }
          >
            {uiConfigLoading || uiOverrideLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : (
              <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
                {/* Toggle row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacingToNumber(spacing[3]), borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <div>
                    <Text strong>Failure email reports</Text>
                    <Paragraph style={{ margin: 0, marginTop: 2, color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>
                      Automatically email a digest when integration deliveries fail
                    </Paragraph>
                  </div>
                  <Switch
                    checked={reportEnabled}
                    loading={savingAlert}
                    onChange={async (checked) => {
                      setReportEnabled(checked);
                      await saveAlertSettings({ enabled: checked });
                    }}
                  />
                </div>

                {/* Config fields — only when enabled */}
                {reportEnabled && (
                  <>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        Report recipient email
                      </Text>
                      <Paragraph style={{ margin: 0, marginTop: 2, fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                        Leave empty to use the org's primary email ({tenant?.tenantEmail || 'none on file'})
                      </Paragraph>
                      <Input
                        placeholder={tenant?.tenantEmail || 'alerts@example.com'}
                        value={overrideEmail}
                        onChange={(e) => setOverrideEmail(e.target.value)}
                        style={{ marginTop: spacingToNumber(spacing[2]) }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: spacingToNumber(spacing[3]) }}>
                      <div>
                        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                          Check every&nbsp;
                          <Tooltip title="How often the system checks for new failures"><InfoCircleOutlined /></Tooltip>
                        </Text>
                        <InputNumber
                          min={1} max={120}
                          value={intervalMinutes}
                          onChange={(v) => setIntervalMinutes(Number(v || 1))}
                          addonAfter="min"
                          style={{ width: '100%', marginTop: spacingToNumber(spacing[2]) }}
                        />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                          Scan window&nbsp;
                          <Tooltip title="How far back to look for failures each check"><InfoCircleOutlined /></Tooltip>
                        </Text>
                        <InputNumber
                          min={15} max={720}
                          value={lookbackMinutes}
                          onChange={(v) => setLookbackMinutes(Number(v || 60))}
                          addonAfter="min"
                          style={{ width: '100%', marginTop: spacingToNumber(spacing[2]) }}
                        />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                          Alert threshold&nbsp;
                          <Tooltip title="Minimum number of failures before sending a report"><InfoCircleOutlined /></Tooltip>
                        </Text>
                        <InputNumber
                          min={1} max={100}
                          value={minFailures}
                          onChange={(v) => setMinFailures(Number(v || 1))}
                          addonAfter="failures"
                          style={{ width: '100%', marginTop: spacingToNumber(spacing[2]) }}
                        />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                          Max per report&nbsp;
                          <Tooltip title="Maximum number of failure records included in each email"><InfoCircleOutlined /></Tooltip>
                        </Text>
                        <InputNumber
                          min={1} max={100}
                          value={maxItems}
                          onChange={(v) => setMaxItems(Number(v || 25))}
                          addonAfter="items"
                          style={{ width: '100%', marginTop: spacingToNumber(spacing[2]) }}
                        />
                      </div>
                    </div>

                    <Button
                      type="primary"
                      loading={savingAlert}
                      onClick={() => saveAlertSettings()}
                    >
                      Save alert settings
                    </Button>
                  </>
                )}
              </Space>
            )}
          </Card>

          {/* ---- 2. Display & Behavior ---- */}
          <Card title="Display & Behavior" style={{ ...cardStyle, ...mt }}>
            {uiConfigLoading || uiOverrideLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : (
              <Space direction="vertical" size={0} style={{ width: '100%' }}>

                {/* Dashboard auto-refresh */}
                <div style={{ paddingBottom: spacingToNumber(spacing[4]) }}>
                  <Text strong>Dashboard auto-refresh</Text>
                  <Paragraph style={{ margin: '2px 0 12px', color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>
                    How often the dashboard automatically reloads live data. Set to 0 to disable.
                  </Paragraph>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: spacingToNumber(spacing[3]) }}>
                    <InputNumber
                      min={0} max={3600}
                      value={dashboardRefreshSeconds}
                      onChange={(v) => setDashboardRefreshSeconds(Number(v ?? 30))}
                      addonAfter="seconds"
                      style={{ flex: 1, marginTop: 4 }}
                    />
                    <Button
                      type="primary"
                      loading={savingDashboard}
                      onClick={async () => {
                        setSavingDashboard(true);
                        try {
                          await updateUIConfigOverride({ dashboard: { autoRefreshSeconds: dashboardRefreshSeconds } });
                          await refetchOverride();
                          messageApi.success('Dashboard refresh interval saved');
                        } catch {
                          messageApi.error('Failed to save');
                        } finally {
                          setSavingDashboard(false);
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Platform default: {uiConfig?.dashboard?.autoRefreshSeconds ?? 30}s
                  </Text>
                </div>

                <Divider style={{ margin: `${spacingToNumber(spacing[2])}px 0 ${spacingToNumber(spacing[4])}px` }} />

                {/* Multi-action delay */}
                <div>
                  <Text strong>Delay between integration actions</Text>
                  <Paragraph style={{ margin: '2px 0 12px', color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>
                    For integrations with multiple sequential actions, add a pause between each step. 0 = no delay.
                  </Paragraph>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: spacingToNumber(spacing[3]) }}>
                    <InputNumber
                      min={0} max={600000}
                      value={multiActionDelayMs}
                      onChange={(v) => setMultiActionDelayMs(Number(v ?? 0))}
                      addonAfter="ms"
                      style={{ flex: 1, marginTop: 4 }}
                    />
                    <Button
                      type="primary"
                      loading={savingDelay}
                      onClick={async () => {
                        setSavingDelay(true);
                        try {
                          await updateUIConfigOverride({ worker: { multiActionDelayMs } });
                          await refetchOverride();
                          messageApi.success('Action delay saved');
                        } catch {
                          messageApi.error('Failed to save');
                        } finally {
                          setSavingDelay(false);
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    Platform default: {uiConfig?.worker?.multiActionDelayMs ?? 0} ms
                  </Text>
                </div>

              </Space>
            )}
          </Card>

          {/* ---- 3. Event Processing (advanced, collapsed by default) ---- */}
          <Collapse
            style={{ ...mt, borderRadius: token.borderRadiusLG, overflow: 'hidden' }}
            items={[{
              key: 'checkpoint',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DatabaseOutlined />
                  <span style={{ fontWeight: 600 }}>Event Processing</span>
                  <Tag color="warning" icon={<WarningOutlined />} style={{ marginLeft: 4 }}>Advanced</Tag>
                </div>
              ),
              children: checkpointLoading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
              ) : eventSourceMode === 'kafka' ? (
                // ---- Kafka mode ----
                <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message="Kafka consumer offsets are managed by Kafka internally. Use Kafka admin tools to reset offsets when needed."
                  />
                  <div style={{ display: 'flex', gap: spacingToNumber(spacing[6]), flexWrap: 'wrap' }}>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Consumer group</Text>
                      <div style={{ fontFamily: token.fontFamilyCode, marginTop: 4 }}>{checkpointData?.consumerGroup}</div>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Topic</Text>
                      <div style={{ fontFamily: token.fontFamilyCode, marginTop: 4 }}>{checkpointData?.topic}</div>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Total lag</Text>
                      <div style={{ fontFamily: token.fontFamilyCode, marginTop: 4 }}>
                        <span style={{ color: (checkpointData?.totalLag || 0) > 100 ? token.colorError : token.colorSuccess }}>
                          {checkpointData?.totalLag || 0} messages
                        </span>
                      </div>
                    </div>
                  </div>
                  {(checkpointData?.partitions?.length ?? 0) > 0 && (
                    <div>
                      <Text strong style={{ fontSize: token.fontSizeSM }}>Partitions</Text>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {checkpointData?.partitions?.map((p: any) => (
                          <div
                            key={p.partition}
                            style={{
                              padding: spacingToNumber(spacing[3]),
                              background: cssVar.bg.surface,
                              border: `1px solid ${token.colorBorder}`,
                              borderRadius: token.borderRadiusSM,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <Text strong>Partition {p.partition}</Text>
                            <div style={{ display: 'flex', gap: spacingToNumber(spacing[5]), fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM }}>
                              <span><Text type="secondary">Offset: </Text>{p.offset}</span>
                              <span><Text type="secondary">High watermark: </Text>{p.highWatermark}</span>
                              <span>
                                <Text type="secondary">Lag: </Text>
                                <span style={{ color: p.lag > 100 ? token.colorError : token.colorSuccess }}>{p.lag}</span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {checkpointData?.error && (
                    <Alert type="warning" showIcon message="Unable to fetch Kafka consumer group details" description={checkpointData.message} />
                  )}
                </Space>
              ) : eventSourceMode === 'mysql' ? (
                // ---- MySQL polling mode ----
                <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
                  <Alert
                    type="warning"
                    showIcon
                    message="Resetting the cursor to 0 will cause the worker to reprocess all events from the beginning, which may trigger duplicate deliveries to all integrations."
                  />
                  <div>
                    <Text strong>Processing cursor</Text>
                    <Paragraph style={{ margin: '2px 0 12px', color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>
                      The ID of the last event row processed. Set to 0 to replay all events from the start.
                    </Paragraph>
                    <div style={{ display: 'flex', gap: spacingToNumber(spacing[3]) }}>
                      <InputNumber
                        min={0}
                        value={checkpointValue}
                        onChange={(v) => setCheckpointValue(v !== null ? Number(v) : 0)}
                        style={{ flex: 1, fontFamily: token.fontFamilyCode }}
                        placeholder="0"
                      />
                      <Button
                        type="primary"
                        icon={<SyncOutlined />}
                        loading={savingCheckpoint}
                        onClick={async () => {
                          if (checkpointValue === null) return;
                          setSavingCheckpoint(true);
                          try {
                            await updateCheckpoint(checkpointValue);
                            messageApi.success('Cursor updated');
                            await refetchCheckpoint();
                          } catch {
                            messageApi.error('Failed to update cursor');
                          } finally {
                            setSavingCheckpoint(false);
                          }
                        }}
                      >
                        Update
                      </Button>
                      <Button
                        danger
                        loading={savingCheckpoint}
                        onClick={() => {
                          Modal.confirm({
                            title: 'Reset cursor to 0?',
                            content: 'The worker will reprocess ALL events, which may cause duplicate deliveries to your integrations.',
                            okText: 'Reset',
                            okButtonProps: { danger: true },
                            cancelText: 'Cancel',
                            onOk: async () => {
                              setSavingCheckpoint(true);
                              try {
                                setCheckpointValue(0);
                                await updateCheckpoint(0);
                                messageApi.warning('Cursor reset to 0 — worker will reprocess all events');
                                await refetchCheckpoint();
                              } catch {
                                messageApi.error('Failed to reset cursor');
                              } finally {
                                setSavingCheckpoint(false);
                              }
                            }
                          });
                        }}
                      >
                        Reset to 0
                      </Button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Current value in DB</Text>
                      <div style={{ fontFamily: token.fontFamilyCode, fontWeight: 600 }}>
                        {checkpointData?.lastProcessedId ?? '—'}
                      </div>
                    </div>
                    <Button size="small" icon={<ReloadOutlined />} onClick={async () => { await refetchCheckpoint(); }}>
                      Refresh
                    </Button>
                  </div>
                </Space>
              ) : (
                // ---- HTTP Push / no event source ----
                <Alert
                  type="info"
                  showIcon
                  message="No cursor management needed"
                  description="Your event source is either HTTP Push or not yet configured. Events are delivered directly — there is no polling cursor to manage."
                />
              )
            }]}
          />

        </Col>

        {/* ================================================================
            RIGHT COLUMN — info panels
            ================================================================ */}
        <Col xs={24} lg={10}>

          {/* ---- Organization info ---- */}
          <Card
            title="Organization"
            style={cardStyle}
            extra={
              <div
                style={{
                  width: 32, height: 32,
                  borderRadius: token.borderRadiusSM,
                  background: `linear-gradient(135deg, ${colors.primary[500]} 0%, ${colors.primary[700]} 100%)`,
                  display: 'grid', placeItems: 'center'
                }}
              >
                <KeyOutlined style={{ color: '#fff', fontSize: 14 }} />
              </div>
            }
          >
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              <FieldRow label="Name" value={tenant?.tenantName} />
              <FieldRow label="Org code" value={tenant?.tenantCode} mono />
              <FieldRow label="Org ID" value={tenant?.orgId} mono />
              <FieldRow label="Region" value={tenant?.region} />
              <FieldRow label="Timezone" value={tenant?.timezone} />
              <FieldRow label="Primary email" value={tenant?.tenantEmail} />
              <FieldRow label="Phone" value={tenant?.tenantPhone} />
              <FieldRow label="Address" value={tenant?.tenantAddress} />
              {(tenant?.tenantTags?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM, flexShrink: 0, marginRight: 12 }}>Tags</Text>
                  <Space size={4} wrap style={{ justifyContent: 'flex-end' }}>
                    {tenant?.tenantTags?.map((t: string) => <Tag key={t}>{t}</Tag>)}
                  </Space>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Branches</Text>
                <Text strong>{childBranches.length}</Text>
              </div>
            </Space>
          </Card>

          {/* ---- Child Branches ---- */}
          {childBranches.length > 0 && (
            <Card
              title={
                <Space>
                  <ApartmentOutlined />
                  <span>Branches</span>
                  <Tag>{childBranches.length}</Tag>
                </Space>
              }
              style={{ ...cardStyle, ...mt }}
            >
              <Table
                dataSource={paginatedBranches}
                rowKey={(row) => row.rid ?? row.code}
                pagination={false}
                size="small"
                columns={[
                  { title: 'Name', dataIndex: 'name', key: 'name' },
                  {
                    title: 'ID',
                    dataIndex: 'rid',
                    key: 'rid',
                    width: 80,
                    render: (rid: number) => (
                      <Text style={{ fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM }}>{rid ?? '—'}</Text>
                    )
                  },
                  { title: 'Code', dataIndex: 'code', key: 'code', width: 110 }
                ]}
              />
              {childBranches.length > pageSize && (
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <Pagination
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={childBranches.length}
                    showSizeChanger
                    pageSizeOptions={[5, 8, 15]}
                    onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
                  />
                </div>
              )}
            </Card>
          )}

          {/* ---- Quick links ---- */}
          <Card
            title={<Space><SettingOutlined /><span>Related Settings</span></Space>}
            style={{ ...cardStyle, ...mt }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[2])}>
              <Button
                block
                icon={<ThunderboltOutlined />}
                onClick={() => navigate('/settings/event-source')}
                style={{ textAlign: 'left', justifyContent: 'flex-start' }}
              >
                Event Source Configuration
              </Button>
              <Button
                block
                icon={<TeamOutlined />}
                onClick={() => navigate('/admin/users')}
                style={{ textAlign: 'left', justifyContent: 'flex-start' }}
              >
                User Management
              </Button>
              {isAdmin && (
                <Button
                  block
                  icon={<AuditOutlined />}
                  onClick={() => navigate('/admin/audit-logs')}
                  style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                >
                  Audit Logs
                </Button>
              )}
            </Space>
          </Card>

        </Col>
      </Row>

      {/* ================================================================
          ADMIN-ONLY SECTION
          ================================================================ */}
      {isAdmin && (
        <div style={{ marginTop: spacingToNumber(spacing[8]) }}>
          <Divider>
            <Space>
              <WarningOutlined style={{ color: token.colorWarning }} />
              <Text type="secondary">Platform Admin Settings</Text>
            </Space>
          </Divider>

          <Row gutter={spacingToNumber(spacing[5])}>
            <Col xs={24} lg={12}>
              <Card title="Organization Scope" style={cardStyle}>
                <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
                  <Text type="secondary">
                    Switch the data view context to any organization, or start an impersonation session as that org's admin.
                  </Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Current org context</Text>
                    <div style={{ fontFamily: token.fontFamilyCode, fontWeight: 600, marginTop: 2 }}>{orgId || 'None'}</div>
                  </div>
                  <Select
                    placeholder="Select organization"
                    value={adminImpersonateOrgId ?? undefined}
                    onChange={(v) => setAdminImpersonateOrgId(Number(v))}
                    options={adminOrgs.map((org) => ({
                      label: org.name ? `${org.name} (${org.orgId})` : `Org ${org.orgId}`,
                      value: org.orgId
                    }))}
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                  />
                  <InputNumber
                    placeholder="Or type an org ID"
                    value={adminImpersonateOrgId ?? undefined}
                    onChange={(v) => setAdminImpersonateOrgId(Number(v || 0))}
                    style={{ width: '100%' }}
                  />
                  <Space wrap>
                    <Button
                      onClick={() => {
                        if (!adminImpersonateOrgId) { messageApi.error('Select or enter an org ID'); return; }
                        Modal.confirm({
                          title: 'Switch organization context?',
                          content: `Set view to org ${adminImpersonateOrgId}. Unsaved changes may be lost.`,
                          okText: 'Switch',
                          onOk: () => {
                            setManualEntityRid(adminImpersonateOrgId);
                            messageApi.success(`Context set to org ${adminImpersonateOrgId}`);
                          }
                        });
                      }}
                    >
                      Set Org Context
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => {
                        if (!adminImpersonateOrgId) { messageApi.error('Select or enter an org ID'); return; }
                        Modal.confirm({
                          title: 'Start impersonation session?',
                          content: `You will act as org ${adminImpersonateOrgId} until you exit impersonation.`,
                          okText: 'Impersonate',
                          onOk: async () => {
                            await impersonate(adminImpersonateOrgId, 'ORG_ADMIN');
                            messageApi.success(`Impersonating org ${adminImpersonateOrgId}`);
                          }
                        });
                      }}
                    >
                      Impersonate Org Admin
                    </Button>
                  </Space>
                </Space>
              </Card>

              <Card title="Global UI Config" style={{ ...cardStyle, ...mt }}>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  Changes apply to all organizations. Must be valid JSON.
                </Paragraph>
                <Input.TextArea
                  value={adminUiConfigText}
                  onChange={(e) => setAdminUiConfigText(e.target.value)}
                  rows={12}
                  style={{ fontFamily: token.fontFamilyCode }}
                  disabled={!adminUiConfigEditable}
                />
                <Space style={{ marginTop: 12 }}>
                  <Button onClick={() => setAdminUiConfigEditable((v) => !v)}>
                    {adminUiConfigEditable ? 'Lock' : 'Unlock editing'}
                  </Button>
                  <Button
                    type="primary"
                    loading={adminSavingUiConfig}
                    disabled={!adminUiConfigEditable}
                    onClick={async () => {
                      try {
                        const parsed = JSON.parse(adminUiConfigText || '{}');
                        const changes = buildConfigDiff(adminUiConfig, parsed);
                        if (changes.length === 0) { messageApi.info('No changes to save'); return; }
                        Modal.confirm({
                          title: 'Apply global UI config?',
                          content: (
                            <div style={{ maxHeight: 240, overflow: 'auto' }}>
                              {changes.map((c) => (
                                <div key={c.key} style={{ marginBottom: 12 }}>
                                  <Text strong>{c.key}</Text>
                                  <pre style={{ fontSize: 12, margin: '4px 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.before, null, 2)}</pre>
                                  <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.after, null, 2)}</pre>
                                </div>
                              ))}
                            </div>
                          ),
                          okText: 'Apply',
                          onOk: async () => {
                            setAdminSavingUiConfig(true);
                            try {
                              await updateAdminUiConfig(parsed);
                              messageApi.success('Global UI config updated');
                              setAdminUiConfigEditable(false);
                            } finally { setAdminSavingUiConfig(false); }
                          }
                        });
                      } catch {
                        messageApi.error('Invalid JSON — fix formatting before saving');
                      }
                    }}
                  >
                    Save
                  </Button>
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="System Config" style={cardStyle} extra={<Tag color="error">Requires restart</Tag>}>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  Only safe fields are exposed here. Changes are written to <Text code>config.json</Text> and take effect after a backend restart.
                </Paragraph>
                <Input.TextArea
                  value={adminSystemConfigText}
                  onChange={(e) => setAdminSystemConfigText(e.target.value)}
                  rows={10}
                  style={{ fontFamily: token.fontFamilyCode }}
                  disabled={!adminSystemConfigEditable}
                />
                <Space style={{ marginTop: 12 }}>
                  <Button onClick={() => setAdminSystemConfigEditable((v) => !v)}>
                    {adminSystemConfigEditable ? 'Lock' : 'Unlock editing'}
                  </Button>
                  <Button
                    type="primary"
                    loading={adminSavingSystemConfig}
                    disabled={!adminSystemConfigEditable}
                    onClick={async () => {
                      try {
                        const parsed = JSON.parse(adminSystemConfigText || '{}');
                        const changes = buildConfigDiff(adminSystemConfig, parsed);
                        if (changes.length === 0) { messageApi.info('No changes to save'); return; }
                        Modal.confirm({
                          title: 'Apply system config changes?',
                          content: (
                            <div style={{ maxHeight: 240, overflow: 'auto' }}>
                              {changes.map((c) => (
                                <div key={c.key} style={{ marginBottom: 12 }}>
                                  <Text strong>{c.key}</Text>
                                  <pre style={{ fontSize: 12, margin: '4px 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.before, null, 2)}</pre>
                                  <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.after, null, 2)}</pre>
                                </div>
                              ))}
                            </div>
                          ),
                          okText: 'Apply',
                          onOk: async () => {
                            setAdminSavingSystemConfig(true);
                            try {
                              const response = await updateAdminSystemConfig(parsed);
                              messageApi.success(response.message);
                              setAdminSystemConfigEditable(false);
                            } finally { setAdminSavingSystemConfig(false); }
                          }
                        });
                      } catch {
                        messageApi.error('Invalid JSON — fix formatting before saving');
                      }
                    }}
                  >
                    Save
                  </Button>
                </Space>
              </Card>
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
};
