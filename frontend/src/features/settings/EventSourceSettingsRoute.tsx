/**
 * Event Source Settings Route
 * /settings/event-source
 *
 * Lets org admins configure how events are ingested:
 *   - MySQL polling (with per-org column mapping)
 *   - Kafka consumer
 *   - HTTP Push (inbound webhook)
 *
 * Features:
 *   - Live column discovery from the real DB table
 *   - Test Connection validates credentials + mapping before saving
 *   - Full audit trail via backend audit-logger
 *   - Org-scoped: ORG_ADMIN only sees/edits their own org's config
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Select,
  Input,
  InputNumber,
  Switch,
  Button,
  Space,
  Typography,
  Divider,
  Alert,
  Tag,
  App,
  Spin,
  Tooltip,
  Row,
  Col,
  Table,
  Collapse,
  Modal,
  Badge
} from 'antd';
import {
  DatabaseOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
  SearchOutlined,
  ApiOutlined,
  WifiOutlined
} from '@ant-design/icons';
import { PageHeader } from '../../components/common';
import { PermissionGuard } from '../../components/common';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import {
  getEventSourceConfig,
  upsertEventSourceConfig,
  deleteEventSourceConfig,
  testEventSourceConnection,
  type ColumnMeta,
  type EventSourceTestResult
} from '../../services/api';
import activityTracker, { ACTIVITY_EVENTS } from '../../services/activity-tracker';
import { useTenant } from '../../app/tenant-context';

const { Text, Title, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Column mapping field definitions
// ---------------------------------------------------------------------------

const MAPPING_FIELDS = [
  {
    key: 'id',
    label: 'Row ID',
    required: true,
    description: 'Auto-increment primary key — used as the polling cursor'
  },
  {
    key: 'orgId',
    label: 'Org ID',
    required: true,
    description: 'Column that identifies the organisation (used to scope queries)'
  },
  {
    key: 'eventType',
    label: 'Event Type',
    required: true,
    description: 'Column containing the event type string (e.g. OP_VISIT_CREATED)'
  },
  {
    key: 'payload',
    label: 'Payload',
    required: true,
    description: 'Column with the event JSON payload (varchar or json type)'
  },
  {
    key: 'orgUnitId',
    label: 'Org Unit ID',
    required: false,
    description: 'Optional: sub-entity / branch identifier'
  },
  {
    key: 'timestamp',
    label: 'Timestamp',
    required: false,
    description: 'Optional: event creation time'
  }
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColumnSelect({
  discoveredColumns,
  placeholder
}: {
  discoveredColumns: ColumnMeta[];
  placeholder: string;
}) {
  if (discoveredColumns.length === 0) {
    return <Input placeholder={placeholder} />;
  }
  return (
    <Select
      showSearch
      allowClear
      placeholder={placeholder}
      filterOption={(input, option) =>
        (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
      }
      options={discoveredColumns.map(c => ({
        value: c.name,
        label: c.name,
        title: `${c.name} — ${c.type}${c.nullable ? ' (nullable)' : ''}${c.key ? ` [${c.key}]` : ''}`
      }))}
    />
  );
}

function MysqlFields({
  useSharedPool,
  discoveredColumns,
  discovering,
  onDiscover
}: {
  useSharedPool: boolean;
  discoveredColumns: ColumnMeta[];
  discovering: boolean;
  onDiscover: () => void;
}) {
  const { spacing } = useDesignTokens();

  return (
    <>
      <Form.Item
        name="useSharedPool"
        label="Use shared database pool"
        valuePropName="checked"
        tooltip="Enable to use the server's built-in MySQL connection. Disable to provide dedicated credentials for this org."
      >
        <Switch />
      </Form.Item>

      {!useSharedPool && (
        <>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="host"
                label="Host"
                rules={[{ required: true, message: 'Host is required' }]}
              >
                <Input placeholder="mysql.example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="port" label="Port">
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="3306" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="user"
                label="Username"
                rules={[{ required: true, message: 'Username is required' }]}
              >
                <Input placeholder="db_user" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="Password">
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="database"
            label="Database"
            rules={[{ required: true, message: 'Database name is required' }]}
          >
            <Input placeholder="my_database" />
          </Form.Item>
        </>
      )}

      <Row gutter={16}>
        <Col span={16}>
          <Form.Item
            name="table"
            label="Table"
            rules={[{ required: true, message: 'Table name is required' }]}
            tooltip="The table to poll for new events"
          >
            <Input placeholder="notification_queue" />
          </Form.Item>
        </Col>
        <Col span={8} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
          <Button
            icon={<SearchOutlined />}
            onClick={onDiscover}
            loading={discovering}
            block
          >
            Discover Columns
          </Button>
        </Col>
      </Row>

      {discoveredColumns.length > 0 && (
        <Alert
          type="success"
          showIcon
          message={`${discoveredColumns.length} columns discovered from table`}
          description="Select columns below using the dropdown, or type a name manually."
          style={{ marginBottom: 16 }}
        />
      )}

      <Divider orientation="left" style={{ fontSize: 13 }}>
        Column Mapping
        <Tooltip title="Map each standard event field to the actual column name in your table. Run Discover Columns to pick from a dropdown.">
          <InfoCircleOutlined style={{ marginLeft: 6, color: cssVar.text.muted }} />
        </Tooltip>
      </Divider>

      <Row gutter={16}>
        {MAPPING_FIELDS.map(field => (
          <Col key={field.key} span={12}>
            <Form.Item
              name={['columnMapping', field.key]}
              label={
                <Space size={4}>
                  {field.label}
                  {field.required
                    ? <Tag color="red" style={{ fontSize: 10, padding: '0 4px' }}>required</Tag>
                    : <Tag style={{ fontSize: 10, padding: '0 4px' }}>optional</Tag>
                  }
                </Space>
              }
              tooltip={field.description}
              rules={field.required ? [{ required: true, message: `${field.label} column is required` }] : []}
            >
              <ColumnSelect
                discoveredColumns={discoveredColumns}
                placeholder={`e.g. ${field.key === 'id' ? 'id' : field.key === 'orgId' ? 'entity_parent_rid' : field.key === 'eventType' ? 'transaction_type' : field.key === 'payload' ? 'message' : field.key}`}
              />
            </Form.Item>
          </Col>
        ))}
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="pollIntervalMs" label="Poll Interval (ms)" tooltip="How often to check for new rows. Default: 5000">
            <InputNumber min={500} max={300000} style={{ width: '100%' }} placeholder="5000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="batchSize" label="Batch Size" tooltip="Rows fetched per poll cycle. Default: 10">
            <InputNumber min={1} max={500} style={{ width: '100%' }} placeholder="10" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function KafkaFields() {
  return (
    <>
      <Form.Item
        name="brokers"
        label="Brokers"
        rules={[{ required: true, message: 'At least one broker is required' }]}
        tooltip="Comma-separated list of broker addresses (host:port)"
        getValueFromEvent={(e: React.ChangeEvent<HTMLInputElement>) =>
          e.target.value.split(',').map(s => s.trim()).filter(Boolean)
        }
        getValueProps={(value: string[]) => ({ value: Array.isArray(value) ? value.join(', ') : value })}
      >
        <Input placeholder="kafka1.example.com:9092, kafka2.example.com:9092" />
      </Form.Item>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="topic"
            label="Topic"
            rules={[{ required: true, message: 'Topic is required' }]}
          >
            <Input placeholder="events.outbound" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="groupId" label="Consumer Group ID" tooltip="Defaults to ig-org-{orgId} if not set">
            <Input placeholder="ig-org-145" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="clientId" label="Client ID">
            <Input placeholder="integration-gateway" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="fromBeginning" label="Consume from beginning" valuePropName="checked"
            tooltip="Read all messages from the start of the topic (only on first connect)">
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="sessionTimeout" label="Session Timeout (ms)">
            <InputNumber min={1000} style={{ width: '100%' }} placeholder="30000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="heartbeatInterval" label="Heartbeat Interval (ms)">
            <InputNumber min={100} style={{ width: '100%' }} placeholder="3000" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function HttpPushFields() {
  const { spacing } = useDesignTokens();
  return (
    <>
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message="HTTP Push — events are sent to this gateway"
        description={
          <>
            <Text>
              External systems send events via <Text code>POST /api/v1/events/push</Text> with your org's
              API key. No outbound connection is needed.
            </Text>
          </>
        }
        style={{ marginBottom: spacing[3] }}
      />
      <Form.Item
        name="webhookSecret"
        label="Webhook Secret"
        tooltip="Optional shared secret used to verify the sender. If set, requests must include X-Webhook-Secret header."
      >
        <Input.Password placeholder="Optional shared secret" />
      </Form.Item>
    </>
  );
}

function TestResultPanel({ result }: { result: EventSourceTestResult }) {
  const { spacing } = useDesignTokens();

  if (!result.success) {
    return (
      <Alert
        type="error"
        showIcon
        icon={<CloseCircleOutlined />}
        message={
          <Space>
            <Text strong>Connection failed</Text>
            {result.code && <Tag color="red">{result.code}</Tag>}
          </Space>
        }
        description={
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>{result.error}</Text>
            {result.hint && (
              <Text type="secondary">
                <InfoCircleOutlined style={{ marginRight: 4 }} />
                {result.hint}
              </Text>
            )}
          </Space>
        }
      />
    );
  }

  const mappingRows = result.validatedMapping
    ? Object.entries(result.validatedMapping).map(([field, info]) => ({
        field,
        column: info.column,
        found: info.found,
        type: info.type
      }))
    : [];

  const collapseItems = [
    ...(mappingRows.length > 0
      ? [{
          key: 'mapping',
          label: `Column Mapping Validation (${mappingRows.filter(r => r.found).length}/${mappingRows.length} found)`,
          children: (
            <Table
              size="small"
              dataSource={mappingRows}
              rowKey="field"
              pagination={false}
              columns={[
                { title: 'Field', dataIndex: 'field', width: 120, render: (v: string) => <Text code>{v}</Text> },
                { title: 'Column', dataIndex: 'column', render: (v: string) => <Text code>{v}</Text> },
                {
                  title: 'Status', dataIndex: 'found', width: 80,
                  render: (found: boolean) => found
                    ? <Tag color="success" icon={<CheckCircleOutlined />}>Found</Tag>
                    : <Tag color="error" icon={<CloseCircleOutlined />}>Missing</Tag>
                },
                { title: 'DB Type', dataIndex: 'type', render: (v: string) => v ? <Text type="secondary">{v}</Text> : '—' }
              ]}
            />
          )
        }]
      : []),
    ...(result.tableColumns && result.tableColumns.length > 0
      ? [{
          key: 'columns',
          label: `All Table Columns (${result.tableColumns.length})`,
          children: (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.tableColumns.map(col => (
                <Tag key={col}>{col}</Tag>
              ))}
            </div>
          )
        }]
      : []),
    ...(result.sampleEvent
      ? [{
          key: 'sample',
          label: 'Sample Event (normalized)',
          children: (
            <pre
              style={{
                background: cssVar.bg.subtle,
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflowX: 'auto',
                margin: 0
              }}
            >
              {JSON.stringify(result.sampleEvent, null, 2)}
            </pre>
          )
        }]
      : [])
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message={<Text strong>Connection successful</Text>}
        description={result.message}
      />
      {collapseItems.length > 0 && (
        <Collapse size="small" items={collapseItems} />
      )}
    </Space>
  );
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------

export const EventSourceSettingsRoute = () => {
  const { orgId } = useTenant();
  const { message: messageApi, modal } = App.useApp();
  const { spacing } = useDesignTokens();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  // Reactive form watches
  const sourceType: string = Form.useWatch('type', form) ?? 'mysql';
  const useSharedPool: boolean = Form.useWatch('useSharedPool', form) ?? true;

  // Column discovery state
  const [discoveredColumns, setDiscoveredColumns] = useState<ColumnMeta[]>([]);
  const [discovering, setDiscovering] = useState(false);

  // Test result state
  const [testResult, setTestResult] = useState<EventSourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Track page view on mount
  useEffect(() => {
    activityTracker.track({
      event: ACTIVITY_EVENTS.SETTINGS_VIEWED,
      action: 'event-source-settings-viewed',
      metadata: { orgId }
    });
  }, [orgId]);

  // Load existing config — treat 404 as "not configured yet" (not an error)
  const {
    data: currentConfig,
    isLoading,
    error: loadError
  } = useQuery({
    queryKey: ['eventSourceConfig', orgId],
    queryFn: async () => {
      try {
        return await getEventSourceConfig(orgId);
      } catch (e: any) {
        if (e?.statusCode === 404) return null;
        throw e;
      }
    },
    enabled: !!orgId,
    retry: false,
    staleTime: 30_000
  });

  // Populate form when config loads
  useEffect(() => {
    if (currentConfig) {
      form.setFieldsValue({
        type: currentConfig.type,
        ...currentConfig.config
      });
      // Clear test result when config is (re)loaded
      setTestResult(null);
      setDiscoveredColumns([]);
    } else if (currentConfig === null) {
      // Not configured — set sensible defaults
      form.setFieldsValue({ type: 'mysql', useSharedPool: true });
    }
  }, [currentConfig, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { type, ...cfg } = values;
      return upsertEventSourceConfig(orgId, { type, config: cfg });
    },
    onSuccess: (_, variables) => {
      messageApi.success('Event source configuration saved');
      queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] });
      activityTracker.track({
        event: ACTIVITY_EVENTS.SETTINGS_UPDATED,
        action: 'event-source-config-saved',
        metadata: { type: variables.type, orgId }
      });
    },
    onError: (err: any) => {
      messageApi.error(err?.message || 'Failed to save configuration');
    }
  });

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      saveMutation.mutate(values);
    } catch {
      // Ant Design already highlights the failing fields
    }
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    activityTracker.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      action: 'event-source-test-clicked',
      metadata: { orgId }
    });

    try {
      const values = form.getFieldsValue();
      const { type, ...cfg } = values;
      const result = await testEventSourceConnection(type ?? sourceType, cfg);
      setTestResult(result);
      // If MySQL test succeeded, populate column discovery from the result
      if (result.success && result.columnMeta && result.columnMeta.length > 0) {
        setDiscoveredColumns(result.columnMeta);
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message, code: 'REQUEST_FAILED' });
    } finally {
      setTesting(false);
    }
  };

  // Discover columns (runs test without columnMapping to get schema only)
  const handleDiscoverColumns = async () => {
    setDiscovering(true);
    activityTracker.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      action: 'event-source-discover-columns',
      metadata: { orgId }
    });

    try {
      const values = form.getFieldsValue();
      // Omit columnMapping so the test just probes the connection + table
      const { type: _t, columnMapping: _cm, ...cfg } = values;
      const result = await testEventSourceConnection('mysql', cfg);
      if (result.success && result.columnMeta) {
        setDiscoveredColumns(result.columnMeta);
        messageApi.success(`Discovered ${result.columnMeta.length} columns from "${cfg.table}"`);
      } else {
        messageApi.error(result.hint ?? result.error ?? 'Could not connect to discover columns');
      }
    } catch (err: any) {
      messageApi.error('Failed to reach the database');
    } finally {
      setDiscovering(false);
    }
  };

  // Delete / remove config
  const handleDelete = () => {
    modal.confirm({
      title: 'Remove event source configuration?',
      content: 'The adapter for this org will be stopped. You can reconfigure it at any time.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteEventSourceConfig(orgId);
          messageApi.success('Event source configuration removed');
          queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] });
          form.resetFields();
          form.setFieldsValue({ type: 'mysql', useSharedPool: true });
          setTestResult(null);
          setDiscoveredColumns([]);
          activityTracker.track({
            event: ACTIVITY_EVENTS.SETTINGS_UPDATED,
            action: 'event-source-config-deleted',
            metadata: { orgId }
          });
        } catch (err: any) {
          messageApi.error(err?.message || 'Failed to remove configuration');
        }
      }
    });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const statusTag = currentConfig?.isActive
    ? <Tag icon={<CheckCircleOutlined />} color="success">Active</Tag>
    : <Tag icon={<CloseCircleOutlined />} color="default">Not configured</Tag>;

  const sourceTypeLabel: Record<string, string> = {
    mysql: 'MySQL Polling',
    kafka: 'Kafka Consumer',
    http_push: 'HTTP Push'
  };

  return (
    <PermissionGuard feature="event_source" operation="read">
      <PageHeader
        title="Event Source"
        description="Configure how this organisation's events are ingested — MySQL polling, Kafka consumer, or HTTP Push."
        breadcrumb={[
          { label: 'Settings', path: '/settings' },
          { label: 'Event Source' }
        ]}
        compact
        actions={statusTag}
      />

      {/* Current status card */}
      {currentConfig && (
        <Card size="small" style={{ marginBottom: spacing[3] }}>
          <Space split={<Divider type="vertical" />} wrap>
            <Space size={4}>
              <Text type="secondary">Type:</Text>
              <Text strong>{sourceTypeLabel[currentConfig.type] ?? currentConfig.type}</Text>
            </Space>
            {currentConfig.config?.table && (
              <Space size={4}>
                <Text type="secondary">Table:</Text>
                <Text code>{currentConfig.config.table}</Text>
              </Space>
            )}
            {currentConfig.updatedAt && (
              <Space size={4}>
                <Text type="secondary">Last updated:</Text>
                <Text>{new Date(currentConfig.updatedAt).toLocaleString()}</Text>
              </Space>
            )}
          </Space>
        </Card>
      )}

      {loadError && (
        <Alert
          type="warning"
          showIcon
          message="Could not load existing configuration"
          description={(loadError as any)?.message}
          style={{ marginBottom: spacing[3] }}
        />
      )}

      {/* Configuration form */}
      <Card title={<Space><DatabaseOutlined />Configure Event Source</Space>}>
        <Form form={form} layout="vertical" size="middle">

          {/* Source type selector */}
          <Form.Item
            name="type"
            label="Source Type"
            rules={[{ required: true }]}
            style={{ maxWidth: 320 }}
          >
            <Select
              options={[
                { value: 'mysql',     label: 'MySQL Polling' },
                { value: 'kafka',     label: 'Kafka Consumer' },
                { value: 'http_push', label: 'HTTP Push (inbound webhook)' }
              ]}
              onChange={() => {
                setTestResult(null);
                setDiscoveredColumns([]);
              }}
            />
          </Form.Item>

          <Divider style={{ margin: `${spacing[2]} 0 ${spacing[3]}` }} />

          {/* Source-specific fields */}
          {sourceType === 'mysql' && (
            <MysqlFields
              useSharedPool={useSharedPool}
              discoveredColumns={discoveredColumns}
              discovering={discovering}
              onDiscover={handleDiscoverColumns}
            />
          )}
          {sourceType === 'kafka' && <KafkaFields />}
          {sourceType === 'http_push' && <HttpPushFields />}

          <Divider />

          {/* Action buttons */}
          <Space wrap>
            <Tooltip title="Validates credentials, table existence, and column mapping against the live database. Nothing is saved.">
              <Button
                icon={<WifiOutlined />}
                onClick={handleTest}
                loading={testing}
              >
                Test Connection
              </Button>
            </Tooltip>

            <PermissionGuard feature="event_source" operation="write">
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saveMutation.isPending}
              >
                Save Configuration
              </Button>
            </PermissionGuard>

            {currentConfig && (
              <PermissionGuard feature="event_source" operation="delete">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleDelete}
                >
                  Remove
                </Button>
              </PermissionGuard>
            )}

            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] })}
              type="text"
            >
              Reload
            </Button>
          </Space>
        </Form>
      </Card>

      {/* Test connection result */}
      {testResult && (
        <Card
          size="small"
          style={{ marginTop: spacing[3] }}
          title={
            <Space>
              {testResult.success
                ? <CheckCircleOutlined style={{ color: cssVar.success.text }} />
                : <CloseCircleOutlined style={{ color: cssVar.error.text }} />
              }
              Test Result
            </Space>
          }
        >
          <TestResultPanel result={testResult} />
        </Card>
      )}
    </PermissionGuard>
  );
};
