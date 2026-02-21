import { useState, useEffect } from 'react';
import {
  Card, Form, Input, Select, Switch, Button, Space, Alert, Typography, Divider,
  Statistic, Row, Col, Tag, Progress, message as antMessage
} from 'antd';
import {
  SaveOutlined, ExperimentOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { PermissionGuard } from '../../components/common/PermissionGuard';
import { FEATURES, OPERATIONS } from '../../utils/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import { useTenant } from '../../app/tenant-context';
import {
  getAIConfig, saveAIConfig, testAIConnection, deleteAIKey, getAIUsage
} from '../../services/ai-api';

const { Text } = Typography;

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI (GPT)',
  claude: 'Anthropic (Claude)',
  kimi: 'Kimi (Moonshot AI)',
  zai: 'Z.ai (GLM)'
};

export const AISettingsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const queryClient = useQueryClient();
  const { can, configureAI } = usePermissions();
  const { orgId } = useTenant();
  const [form] = Form.useForm();
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testResult, setTestResult] = useState<{ latencyMs: number; model: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [messageApi, contextHolder] = antMessage.useMessage();

  const { data: aiConfig, isLoading } = useQuery({
    queryKey: ['aiConfig', orgId],
    queryFn: () => getAIConfig(orgId!),
    enabled: !!orgId,
    staleTime: 60_000
  });

  const { data: usageData } = useQuery({
    queryKey: ['aiUsage', orgId],
    queryFn: () => getAIUsage(orgId!),
    enabled: !!orgId,
    staleTime: 60_000
  });


  // Sync form when config loads
  useEffect(() => {
    if (aiConfig) {
      setSelectedProvider(aiConfig.provider || 'openai');
      form.setFieldsValue({
        provider: aiConfig.provider,
        model: aiConfig.model,
        dailyLimit: aiConfig.dailyLimit,
        enabled: aiConfig.enabled
      });
    }
  }, [aiConfig, form]);


  const saveMutation = useMutation({
    mutationFn: (values: any) => saveAIConfig(orgId!, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiConfig', orgId] });
      queryClient.invalidateQueries({ queryKey: ['ai-status', orgId] });
      messageApi.success('AI configuration saved');
    },
    onError: (err: any) => {
      messageApi.error(err.message || 'Failed to save configuration');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAIKey(orgId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiConfig', orgId] });
      queryClient.invalidateQueries({ queryKey: ['ai-status', orgId] });
      form.setFieldValue('apiKey', '');
      messageApi.success('API key removed');
    },
    onError: (err: any) => {
      messageApi.error(err.message || 'Failed to remove API key');
    }
  });

  const handleSave = async () => {
    const values = await form.validateFields();
    // Don't send empty apiKey if one is already saved
    if (!values.apiKey && aiConfig?.hasApiKey) {
      delete values.apiKey;
    }
    saveMutation.mutate(values);
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testAIConnection(orgId!);
      setTestStatus('ok');
      setTestResult(result);
    } catch (err: any) {
      setTestStatus('fail');
      setTestError(err.message || 'Connection failed');
    }
  };

  const modelOptions = (aiConfig?.providerModels?.[selectedProvider] || []).map((m: string) => ({
    label: m,
    value: m
  }));

  const canConfigure = configureAI();
  const usagePercent = usageData?.rateLimit
    ? Math.min(100, Math.round((usageData.rateLimit.usage / usageData.rateLimit.limit) * 100))
    : 0;

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="AI Configuration"
        description="Configure AI features and API settings for intelligent automation"
      />

      <PermissionGuard
        feature={FEATURES.AI_CONFIG}
        operation={OPERATIONS.READ}
        fallback={
          <Alert
            type="error"
            message="Access Denied"
            description="You don't have permission to view AI configuration."
            showIcon
          />
        }
      >
        {/* Usage Card */}
        {usageData && (
          <Card style={{ marginBottom: spacing[4], borderRadius: token.borderRadiusLG }}>
            <Row gutter={24} align="middle">
              <Col span={6}>
                <Statistic
                  title="Requests Today"
                  value={usageData.rateLimit?.usage ?? 0}
                  suffix={`/ ${usageData.rateLimit?.limit ?? '∞'}`}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Remaining"
                  value={usageData.rateLimit?.remaining ?? usageData.rateLimit?.limit ?? '∞'}
                />
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>Daily usage</Text>
                <Progress
                  percent={usagePercent}
                  status={usagePercent >= 90 ? 'exception' : usagePercent >= 70 ? 'active' : 'normal'}
                  style={{ marginTop: 4 }}
                />
              </Col>
            </Row>
          </Card>
        )}

        <Card
          className="panel"
          style={{ borderRadius: token.borderRadiusLG }}
          loading={isLoading}
        >
          <Form
            form={form}
            layout="vertical"
            disabled={!canConfigure || saveMutation.isPending || deleteMutation.isPending}
          >
            <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>

              {/* Enable/Disable AI */}
              <Form.Item name="enabled" label="Enable AI Features" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Divider />

              {/* Provider Selection */}
              <Form.Item
                name="provider"
                label="AI Provider"
                rules={[{ required: true, message: 'Please select an AI provider' }]}
              >
                <Select
                  size="large"
                  options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ label, value }))}
                  onChange={(val) => {
                    setSelectedProvider(val);
                    form.setFieldValue('model', undefined);
                  }}
                />
              </Form.Item>

              {/* Model Selection */}
              <Form.Item
                name="model"
                label="Model"
                rules={[{ required: true, message: 'Please select a model' }]}
              >
                <Select
                  size="large"
                  options={modelOptions.length > 0 ? modelOptions : undefined}
                  placeholder={modelOptions.length === 0 ? 'Loading models...' : 'Select model'}
                  disabled={!canConfigure || modelOptions.length === 0}
                />
              </Form.Item>

              {/* API Key */}
              <PermissionGuard
                feature={FEATURES.AI_CONFIG}
                operation={OPERATIONS.CONFIGURE}
                fallback={
                  <Alert
                    type="info"
                    message="View Only"
                    description="Contact your administrator to modify AI settings."
                    showIcon
                  />
                }
              >
                <Form.Item
                  name="apiKey"
                  label={
                    <Space>
                      API Key
                      {aiConfig?.hasApiKey && (
                        <Tag color="green" icon={<CheckCircleOutlined />}>Key saved</Tag>
                      )}
                    </Space>
                  }
                  rules={[
                    {
                      required: !aiConfig?.hasApiKey,
                      message: 'Please enter an API key'
                    }
                  ]}
                >
                  <Input.Password
                    size="large"
                    placeholder={aiConfig?.hasApiKey ? '••••••••••••••••' : 'sk-...'}
                  />
                </Form.Item>

                {aiConfig?.hasApiKey && (
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    loading={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                    style={{ marginTop: -16, marginBottom: 16 }}
                  >
                    Remove saved key
                  </Button>
                )}
              </PermissionGuard>

              {/* Daily Limit */}
              <Form.Item
                name="dailyLimit"
                label="Daily Request Limit"
                help="Maximum AI requests per day (0 = unlimited)"
              >
                <Select
                  size="large"
                  options={[
                    { label: 'Unlimited', value: 0 },
                    { label: '50 requests/day', value: 50 },
                    { label: '100 requests/day', value: 100 },
                    { label: '250 requests/day', value: 250 },
                    { label: '500 requests/day', value: 500 },
                    { label: '1000 requests/day', value: 1000 }
                  ]}
                />
              </Form.Item>

              {/* Actions */}
              <PermissionGuard feature={FEATURES.AI_CONFIG} operation={OPERATIONS.CONFIGURE}>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Space>
                    <Button
                      type="primary"
                      size="large"
                      icon={<SaveOutlined />}
                      onClick={handleSave}
                      loading={saveMutation.isPending}
                    >
                      Save Configuration
                    </Button>

                    <Button
                      size="large"
                      icon={
                        testStatus === 'testing' ? <LoadingOutlined spin /> :
                        testStatus === 'ok' ? <CheckCircleOutlined /> :
                        testStatus === 'fail' ? <CloseCircleOutlined /> :
                        <ExperimentOutlined />
                      }
                      onClick={handleTestConnection}
                      loading={testStatus === 'testing'}
                      disabled={!aiConfig?.hasApiKey}
                    >
                      Test Connection
                    </Button>
                  </Space>
                </Form.Item>
              </PermissionGuard>

              {/* Test result feedback */}
              {testStatus === 'ok' && testResult && (
                <Alert
                  type="success"
                  showIcon
                  message={`Connected successfully — ${testResult.model} (${testResult.latencyMs}ms)`}
                />
              )}
              {testStatus === 'fail' && testError && (
                <Alert type="error" showIcon message="Connection failed" description={testError} />
              )}
            </Space>
          </Form>
        </Card>

        {/* Permissions Info */}
        <Card
          title="Your Permissions"
          style={{ marginTop: spacing[4], borderRadius: token.borderRadiusLG }}
        >
          <Space direction="vertical" size={spacingToNumber(spacing[2])}>
            <div>
              <Text strong>AI Features:</Text>
              <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                <li>
                  <Text type={can(FEATURES.AI, OPERATIONS.READ) ? 'success' : 'secondary'}>
                    {can(FEATURES.AI, OPERATIONS.READ) ? '✓' : '✗'} View AI features
                  </Text>
                </li>
                <li>
                  <Text type={can(FEATURES.AI, OPERATIONS.EXECUTE) ? 'success' : 'secondary'}>
                    {can(FEATURES.AI, OPERATIONS.EXECUTE) ? '✓' : '✗'} Use AI features
                  </Text>
                </li>
              </ul>
            </div>
            <div>
              <Text strong>AI Configuration:</Text>
              <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                <li>
                  <Text type={can(FEATURES.AI_CONFIG, OPERATIONS.READ) ? 'success' : 'secondary'}>
                    {can(FEATURES.AI_CONFIG, OPERATIONS.READ) ? '✓' : '✗'} View configuration
                  </Text>
                </li>
                <li>
                  <Text type={can(FEATURES.AI_CONFIG, OPERATIONS.CONFIGURE) ? 'success' : 'secondary'}>
                    {can(FEATURES.AI_CONFIG, OPERATIONS.CONFIGURE) ? '✓' : '✗'} Modify configuration
                  </Text>
                </li>
              </ul>
            </div>
          </Space>
        </Card>
      </PermissionGuard>
    </div>
  );
};
