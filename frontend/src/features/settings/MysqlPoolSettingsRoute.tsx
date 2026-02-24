/**
 * MySQL Shared Pool Settings Route
 * /settings/mysql-pool
 *
 * Lets SUPER_ADMIN / ADMIN configure the shared MySQL connection pool at runtime.
 * Credentials are stored in MongoDB system_config and auto-applied on server restart.
 */

import { useState, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Tag,
  Typography,
  App,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  SaveOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../../components/common';
import { useDesignTokens } from '../../design-system/utils';
import {
  getAdminMysqlPool,
  updateAdminMysqlPool,
  testAdminMysqlPool,
  type MysqlPoolConfig,
  type EventSourceTestResult,
} from '../../services/api';
import { useAuth } from '../../app/auth-context';

const { Text } = Typography;

function TestResultPanel({ result }: { result: EventSourceTestResult }) {
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

  return (
    <Alert
      type="success"
      showIcon
      icon={<CheckCircleOutlined />}
      message={<Text strong>Connection successful</Text>}
      description={result.message}
    />
  );
}

export const MysqlPoolSettingsRoute = () => {
  const { user } = useAuth();
  const { message: messageApi } = App.useApp();
  const { spacing } = useDesignTokens();
  const [form] = Form.useForm();

  const [isConfigured, setIsConfigured] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<MysqlPoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EventSourceTestResult | null>(null);

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAdminMysqlPool();
        setIsConfigured(data.isConfigured);
        setCurrentConfig(data.config);
        if (data.isConfigured && data.config?.host) {
          form.setFieldsValue({
            host: data.config.host,
            port: data.config.port ?? 3306,
            user: data.config.user,
            database: data.config.database,
            connectionLimit: data.config.connectionLimit,
            queueLimit: data.config.queueLimit,
            // never pre-fill password
          });
        } else {
          form.setFieldsValue({ port: 3306 });
        }
      } catch {
        form.setFieldsValue({ port: 3306 });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [form]);

  const handleTest = async () => {
    let values: MysqlPoolConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAdminMysqlPool(values);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message, code: 'REQUEST_FAILED' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    let values: MysqlPoolConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminMysqlPool(values);
      if (result.success) {
        messageApi.success(result.message || 'MySQL pool configuration saved.');
        setIsConfigured(true);
        // Reload masked config
        const data = await getAdminMysqlPool();
        setCurrentConfig(data.config);
        setTestResult(null);
      } else {
        messageApi.error('Failed to configure MySQL pool.');
      }
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Alert
        type="error"
        showIcon
        message="Access denied"
        description="You need SUPER_ADMIN or ADMIN role to manage the MySQL shared pool."
        style={{ margin: 24 }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="MySQL Shared Pool"
        description="Configure the server-wide MySQL connection pool used by orgs with 'Use shared pool' enabled."
        breadcrumb={[
          { label: 'Settings', path: '/settings' },
          { label: 'MySQL Shared Pool' },
        ]}
        compact
        actions={
          isConfigured
            ? <Tag icon={<CheckCircleOutlined />} color="success">Configured</Tag>
            : <Tag icon={<CloseCircleOutlined />} color="default">Not configured</Tag>
        }
      />

      {/* Current status card */}
      {isConfigured && currentConfig?.host && (
        <Card size="small" style={{ marginBottom: spacing[3] }}>
          <Space split={<Divider type="vertical" />} wrap>
            <Space size={4}>
              <Text type="secondary">Host:</Text>
              <Text code>{currentConfig.host}{currentConfig.port ? `:${currentConfig.port}` : ''}</Text>
            </Space>
            {currentConfig.user && (
              <Space size={4}>
                <Text type="secondary">User:</Text>
                <Text code>{currentConfig.user}</Text>
              </Space>
            )}
            {currentConfig.database && (
              <Space size={4}>
                <Text type="secondary">Database:</Text>
                <Text code>{currentConfig.database}</Text>
              </Space>
            )}
            <Space size={4}>
              <Text type="secondary">Password:</Text>
              <Text code>****</Text>
            </Space>
          </Space>
        </Card>
      )}

      <Card
        title={<Space><DatabaseOutlined />Connection Credentials</Space>}
        loading={loading}
      >
        <Form form={form} layout="vertical" size="middle">
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
                <Input placeholder="db_user" autoComplete="username" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="password"
                label="Password"
                rules={[{ required: true, message: 'Password is required' }]}
              >
                <Input.Password placeholder="••••••••" autoComplete="new-password" />
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

          <Divider orientation="left" style={{ fontSize: 13 }}>Advanced (optional)</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="connectionLimit"
                label="Connection Limit"
                tooltip="Max simultaneous connections in the pool (1–20)"
              >
                <InputNumber min={1} max={20} style={{ width: '100%' }} placeholder="10" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="queueLimit"
                label="Queue Limit"
                tooltip="Max queued connection requests before rejecting (0 = unlimited)"
              >
                <InputNumber min={0} max={200} style={{ width: '100%' }} placeholder="0" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Space wrap>
            <Button
              icon={<WifiOutlined />}
              onClick={handleTest}
              loading={testing}
            >
              Test Connection
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              Save & Apply
            </Button>
          </Space>

          {testResult && (
            <div style={{ marginTop: spacing[4] }}>
              <TestResultPanel result={testResult} />
            </div>
          )}
        </Form>
      </Card>
    </>
  );
};
