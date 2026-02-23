import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import {
  Card,
  Space,
  Button,
  Tag,
  Tooltip,
  Modal,
  message,
  Input,
  Switch,
  Typography,
  App,
  Divider,
  Select,
  Grid
} from 'antd';
import {
  ApiOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  ReloadOutlined,
  FilterOutlined,
  MailOutlined
} from '@ant-design/icons';
import { ModernTable } from '../../../components/common/ModernTable';
import { PageHeader } from '../../../components/common/PageHeader';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import {
  getInboundIntegrations,
  deleteInboundIntegration,
  updateInboundIntegration,
  testInboundIntegration
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';

const { Text } = Typography;

interface InboundIntegrationsRouteProps {
  hideHeader?: boolean;
  isActive?: boolean;
}

export const InboundIntegrationsRoute = ({ hideHeader = false, isActive = true }: InboundIntegrationsRouteProps = {}) => {
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: messageApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>();
  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlIntegration, setCurlIntegration] = useState<any>(null);
  const [curlApiKey, setCurlApiKey] = useState('');
  const [curlInboundKey, setCurlInboundKey] = useState('');
  const defaultApiKey = import.meta.env.VITE_API_KEY || '';

  // Test email modal state
  const [testEmailModalOpen, setTestEmailModalOpen] = useState(false);
  const [testEmailIntegration, setTestEmailIntegration] = useState<any>(null);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('Test Email from Integration Gateway');
  const [testEmailBody, setTestEmailBody] = useState('<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>');
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Pagination with auto-reset on filter changes
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 20,
    resetDeps: [searchQuery, statusFilter]
  });

  const buildInboundCurl = (integration: any, options?: { apiKey?: string; inboundKey?: string }) => {
    if (!integration) return '';
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
    const base = apiBase.replace(/\/$/, '');
    const orgId = integration.orgId;
    const url = `${base}/integrations/${encodeURIComponent(integration.type)}?orgId=${orgId}`;
    const httpMethod = (integration.httpMethod || 'POST').toUpperCase();
    const headers: string[] = [];
    const apiKey = options?.apiKey?.trim();
    const inboundKey = options?.inboundKey?.trim();

    if (integration.inboundAuthType === 'API_KEY') {
      const headerName = (integration.inboundAuthConfig?.headerName || 'x-api-key').toLowerCase();
      if (headerName === 'x-api-key') {
        const value = inboundKey || apiKey || '<API_KEY>';
        headers.push(`-H "X-API-Key: ${value}"`);
      } else {
        headers.push(`-H "X-API-Key: ${apiKey || '<API_KEY>'}"`);
        headers.push(`-H "${headerName}: ${inboundKey || '<INBOUND_API_KEY>'}"`);
      }
    } else {
      headers.push(`-H "X-API-Key: ${apiKey || '<API_KEY>'}"`);
    }

    if (httpMethod !== 'GET') {
      headers.push(`-H "Content-Type: application/json"`);
    }

    if (integration.inboundAuthType === 'BEARER') {
      headers.push(`-H "Authorization: Bearer <INBOUND_TOKEN>"`);
    } else if (integration.inboundAuthType === 'BASIC') {
      headers.push(`-H "Authorization: Basic <BASE64_USER_PASS>"`);
    }

    const isEmailCommunication = integration.type === 'EMAIL' ||
      integration.actions?.some((a: any) => a.kind === 'COMMUNICATION');

    let dataPart = '';
    if (httpMethod !== 'GET') {
      if (isEmailCommunication) {
        const sampleBody = {
          to: 'recipient@example.com',
          subject: 'Test Email',
          html: '<h1>Test</h1><p>This is a test email.</p>',
          attachments: [
            {
              filename: 'document.pdf',
              content: '<BASE64_ENCODED_PDF>',
              encoding: 'base64',
              contentType: 'application/pdf'
            }
          ]
        };
        dataPart = ` \\\n  --data-raw '${JSON.stringify(sampleBody, null, 2)}'`;
      } else {
        dataPart = ` \\\n  -d '{}'`;
      }
    }

    return `curl -X ${httpMethod} "${url}" \\\n  ${headers.join(' \\\n  ')}${dataPart}`;
  };

  const handleCopyCurl = (integration: any) => {
    setCurlIntegration(integration);
    setCurlApiKey(defaultApiKey);
    setCurlInboundKey('');
    setCurlModalOpen(true);
  };

  const handleConfirmCopyCurl = () => {
    if (!curlIntegration) return;
    const curl = buildInboundCurl(curlIntegration, { apiKey: curlApiKey, inboundKey: curlInboundKey });
    if (!curl) return;
    navigator.clipboard.writeText(curl).then(() => {
      messageApi.success('Curl command copied');
      setCurlModalOpen(false);
    }).catch(() => {
      messageApi.error('Failed to copy curl command');
    });
  };

  // Fetch inbound integrations
  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['inbound-integrations'],
    queryFn: getInboundIntegrations,
    enabled: isActive
  });

  // Filter by search query, direction, and status
  const filteredIntegrations = useMemo(() => {
    // First filter to only INBOUND integrations
    let filtered = integrations.filter((integration: any) =>
      integration.direction === 'INBOUND'
    );

    // Apply status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter((integration: any) => integration.isActive);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((integration: any) => !integration.isActive);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((integration: any) => {
        const nameMatch = integration.name.toLowerCase().includes(query);
        const typeMatch = integration.type.toLowerCase().includes(query);
        const urlMatch = integration.targetUrl?.toLowerCase().includes(query) || false;

        // For COMMUNICATION integrations, also search in channel/provider
        const isCommunication = integration.actions && integration.actions.length > 0;
        if (isCommunication) {
          const config = integration.actions[0]?.communicationConfig;
          const channelMatch = config?.channel?.toLowerCase().includes(query) || false;
          const providerMatch = config?.provider?.toLowerCase().includes(query) || false;
          return nameMatch || typeMatch || channelMatch || providerMatch;
        }

        return nameMatch || typeMatch || urlMatch;
      });
    }

    return filtered;
  }, [integrations, searchQuery, statusFilter]);

  // Delete integration
  const handleDelete = (integration: any) => {
    Modal.confirm({
      title: `Delete "${integration.name}"?`,
      content: 'This inbound integration will be removed and API calls will fail. This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteInboundIntegration(integration.id);
          messageApi.success('Inbound integration deleted successfully');
          queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] });
        } catch (error: any) {
          messageApi.error(error.message || 'Failed to delete inbound integration');
        }
      }
    });
  };

  // Quick toggle enable/disable
  const handleToggle = async (integration: any, checked: boolean) => {
    if (!checked) {
      modal.confirm({
        title: `Disable "${integration.name}"?`,
        content: 'API calls to this integration will fail when disabled. You can re-enable it anytime.',
        okText: 'Yes, Disable',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await updateInboundIntegration(integration.id, { ...integration, isActive: false });
            messageApi.success('Inbound integration disabled');
            queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] });
          } catch (error: any) {
            messageApi.error(error.message || 'Failed to update inbound integration');
          }
        }
      });
      return;
    }

    // Enable - no confirmation needed
    try {
      await updateInboundIntegration(integration.id, { ...integration, isActive: checked });
      messageApi.success('Inbound integration enabled');
      queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] });
    } catch (error: any) {
      messageApi.error(error.message || 'Failed to update inbound integration');
    }
  };

  // Test integration (HTTP only)
  const handleTest = async (integration: any) => {
    const hide = messageApi.loading('Testing inbound integration...', 0);
    try {
      await testInboundIntegration(integration.id);
      hide();
      messageApi.success('Test request sent successfully');
    } catch (error: any) {
      hide();
      messageApi.error(error.message || 'Failed to test inbound integration');
    }
  };

  // Open test email modal (COMMUNICATION only)
  const handleOpenTestEmailModal = (integration: any) => {
    setTestEmailIntegration(integration);
    setTestEmailAddress('');
    setTestEmailSubject('Test Email from Integration Gateway');
    setTestEmailBody('<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>');
    setTestEmailModalOpen(true);
  };

  // Send test email
  const handleSendTestEmail = async () => {
    if (!testEmailIntegration || !testEmailAddress) return;

    try {
      setIsSendingTest(true);

      const response = await testInboundIntegration(testEmailIntegration.id, {
        to: testEmailAddress,
        subject: testEmailSubject,
        html: testEmailBody
      }) as any;

      if (response.success) {
        const messageId = response.messageId || response.response?.messageId;
        messageApi.success(
          messageId
            ? `Test email sent successfully! Message ID: ${messageId}`
            : (response.message || 'Test email sent successfully!')
        );
        setTestEmailModalOpen(false);
      } else {
        messageApi.error(response.error || 'Test email failed');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.response?.data?.details || error.message || 'Failed to send test email';
      messageApi.error(errorMsg);
    } finally {
      setIsSendingTest(false);
    }
  };

  const columns = [
    {
      title: 'Integration Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      render: (name: string, record: any) => (
        <Space direction="vertical" size="small">
          <Text strong style={{ fontSize: 14 }}>
            {name}
          </Text>
          <Tag color="blue" style={{ fontSize: 11 }}>
            {record.type}
          </Tag>
        </Space>
      )
    },
    {
      title: 'Target / Provider',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      ellipsis: true,
      render: (url: string, record: any) => {
        const isCommunication = record.actions && record.actions.length > 0;

        if (isCommunication) {
          const config = record.actions[0]?.communicationConfig;
          const channel = config?.channel || 'EMAIL';
          const provider = config?.provider || 'SMTP';
          return (
            <Space size={4}>
              <Tag color="purple" style={{ fontSize: 11 }}>{channel}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>via {provider}</Text>
            </Space>
          );
        }

        return (
          <Tooltip title={url}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {url}
            </Text>
          </Tooltip>
        );
      }
    },
    {
      title: 'Authentication',
      dataIndex: 'inboundAuthType',
      key: 'inboundAuthType',
      render: (authType: string) => {
        const colors: Record<string, string> = {
          NONE: 'default',
          API_KEY: 'blue',
          BEARER: 'cyan',
          BASIC: 'green',
          OAUTH1: 'purple',
          OAUTH2: 'purple',
          CUSTOM: 'orange',
          CUSTOM_HEADERS: 'magenta'
        };
        return <Tag color={colors[authType] || 'default'}>{authType}</Tag>;
      }
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      filters: [
        { text: 'Active', value: true },
        { text: 'Disabled', value: false }
      ],
      onFilter: (value: any, record: any) => record.isActive === value,
      render: (isActive: boolean, record: any) => (
        <Switch
          checked={isActive}
          onChange={(checked) => handleToggle(record, checked)}
          checkedChildren={<CheckCircleOutlined />}
          unCheckedChildren={<CloseCircleOutlined />}
        />
      )
    },
    {
      title: 'Last Updated',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      sorter: (a: any, b: any) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      render: (date: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatDateTime(date)}
        </Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: any) => {
        const isCommunication = record.actions && record.actions.length > 0;

        return (
          <Space size="small">
            {/* Copy curl for runtime endpoint - works for both HTTP and COMMUNICATION */}
            <Tooltip title="Copy curl">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopyCurl(record)}
              />
            </Tooltip>
            <Tooltip title="Edit">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => navigate(`/inbound-integrations/${record.id}`)}
              />
            </Tooltip>
            {/* Show different test buttons based on integration type */}
            {isCommunication ? (
              <Tooltip title="Send Test Email">
                <Button
                  type="text"
                  size="small"
                  icon={<MailOutlined />}
                  onClick={() => handleOpenTestEmailModal(record)}
                  disabled={!record.isActive}
                />
              </Tooltip>
            ) : (
              <Tooltip title="Test">
                <Button
                  type="text"
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={() => handleTest(record)}
                  disabled={!record.isActive}
                />
              </Tooltip>
            )}
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record)}
              />
            </Tooltip>
          </Space>
        );
      }
    }
  ];

  return (
    <div>
      {!hideHeader && (
        <PageHeader
          title="Inbound Integrations"
          description="Real-time API proxy integrations that transform and forward requests from the client app to external systems"
          breadcrumb={[
            { label: 'Configuration', path: '/integrations' },
            { label: 'Inbound Integrations' }
          ]}
          compact
          actions={
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              onClick={() => navigate('/inbound-integrations/new')}
            >
              Create API Integration
            </Button>
          }
        />
      )}

      {/* Table with Compact Toolbar */}
      <Card style={{ marginTop: hideHeader ? 0 : spacing[2] }} size="small">
        {/* Compact Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            padding: spacing[2],
            borderBottom: `1px solid ${cssVar.border.default}`,
            background: withAlpha(cssVar.bg.subtle, 0.4),
            alignItems: 'center'
          }}
        >
          {/* Count Tags */}
          <Space size="small">
            <Tag
              style={{
                borderRadius: 4,
                padding: `2px ${spacing[2]}`,
                borderColor: withAlpha(colors.neutral[300], 0.8),
                background: withAlpha(colors.neutral[100], 0.6),
                color: cssVar.text.secondary,
                fontWeight: 600,
                fontSize: 12,
                margin: 0
              }}
            >
              {`${integrations.filter((i: any) => i.direction === 'INBOUND').length} total`}
            </Tag>
            <Tag
              style={{
                borderRadius: 4,
                padding: `2px ${spacing[2]}`,
                borderColor: withAlpha(colors.success[200], 0.8),
                background: withAlpha(colors.success[50], 1),
                color: colors.success[700],
                fontWeight: 600,
                fontSize: 12,
                margin: 0
              }}
            >
              {integrations.filter((i: any) => i.direction === 'INBOUND' && i.isActive).length} active
            </Tag>
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

          {/* Status Filter */}
          <Select
            placeholder="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            size="small"
            allowClear
            options={[
              { label: 'Active', value: 'active' },
              { label: 'Disabled', value: 'inactive' }
            ]}
          />

          {/* Actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: spacing[1] }}>
            <Button
              icon={<FilterOutlined />}
              size="small"
              type="text"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter(undefined);
              }}
            >
              Reset
            </Button>
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] })}
            />
          </div>
        </div>

        <ModernTable
          columns={columns}
          dataSource={filteredIntegrations}
          loading={isLoading}
          rowKey="id"
          pagination={{
            ...getPaginationConfig(filteredIntegrations.length),
            showTotal: (total) => `${total} inbound integrations`
          }}
          emptyState={{
            icon: <ApiOutlined style={{ fontSize: 64, color: cssVar.text.muted }} />,
            title: 'No inbound integrations yet',
            description: 'Create your first inbound integration to enable real-time API proxy functionality',
            action: (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/inbound-integrations/new')}
              >
                Create Inbound Integration
              </Button>
            )
          }}
        />
      </Card>

      <Modal
        title="Copy curl command"
        open={curlModalOpen}
        onOk={handleConfirmCopyCurl}
        onCancel={() => setCurlModalOpen(false)}
        okText="Copy"
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Text type="secondary">
            Provide the gateway API key to include it in the curl command.
          </Text>
          <Input.Password
            placeholder="Gateway API Key (X-API-Key)"
            value={curlApiKey}
            onChange={(e) => setCurlApiKey(e.target.value)}
          />
          {curlIntegration?.inboundAuthType === 'API_KEY' && (
            <Input.Password
              placeholder="Inbound API Key (if required by integration)"
              value={curlInboundKey}
              onChange={(e) => setCurlInboundKey(e.target.value)}
            />
          )}
        </Space>
      </Modal>

      {/* Test Email Modal */}
      <Modal
        title="Send Test Email"
        open={testEmailModalOpen}
        onOk={handleSendTestEmail}
        onCancel={() => setTestEmailModalOpen(false)}
        okText={isSendingTest ? 'Sending...' : 'Send Email'}
        confirmLoading={isSendingTest}
        width={600}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Recipient Email *</Text>
            <Input
              type="email"
              placeholder="recipient@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              size="large"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Subject *</Text>
            <Input
              placeholder="Email subject"
              value={testEmailSubject}
              onChange={(e) => setTestEmailSubject(e.target.value)}
              size="large"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Email Body (HTML) *</Text>
            <Input.TextArea
              placeholder="<h1>Hello!</h1><p>This is a test email.</p>"
              value={testEmailBody}
              onChange={(e) => setTestEmailBody(e.target.value)}
              rows={6}
              disabled={isSendingTest}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};
