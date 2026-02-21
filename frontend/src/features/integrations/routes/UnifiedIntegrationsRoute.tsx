import { useEffect, useState } from 'react';
import { Tabs, Space, Typography, Button, Popover, Divider } from 'antd';
import { ThunderboltOutlined, ApiOutlined, InfoCircleOutlined, PlusOutlined, QuestionCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { IntegrationsRoute } from './IntegrationsRoute';
import { InboundIntegrationsRoute } from '../../inbound-integrations/routes/InboundIntegrationsRoute';
import { ScheduledJobsRoute } from '../../scheduled-jobs/routes/ScheduledJobsRoute';
import { PageHeader } from '../../../components/common/PageHeader';
import { useDesignTokens } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import { useLocation } from 'react-router-dom';

const { Text, Paragraph } = Typography;

// Help content for Outbound Integrations
const OutboundHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Outbound integrations automatically send data to external systems when events occur in your application (e.g., appointment created, patient registered, order placed).
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Your App Event → Gateway → External System</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text> <Text type="secondary">CRM sync, notifications, data pipelines, analytics</Text>
    </div>
  </div>
);

// Help content for Inbound Integrations
const InboundHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Inbound integrations act as a real-time proxy between your client app and external APIs. The gateway handles authentication, transformation, and forwards requests.
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Client App → Gateway → External API → Response</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text> <Text type="secondary">Real-time eligibility checks, live data enrichment, synchronous operations</Text>
    </div>
  </div>
);

// Help content for Scheduled Integrations
const ScheduledHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Scheduled integrations run on time-based triggers (cron schedules or intervals), fetching data from databases and sending batches to external systems.
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Database Query → Gateway (on schedule) → External System</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text> <Text type="secondary">Daily reports, batch syncs, periodic data exports, scheduled notifications</Text>
    </div>
  </div>
);

export const UnifiedIntegrationsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const navigate = useNavigateWithParams();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('event-rules');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (!tabParam) return;

    const normalized = tabParam === 'inbound' || tabParam === 'api'
      ? 'api-integrations'
      : tabParam === 'outbound' || tabParam === 'event'
        ? 'event-rules'
        : tabParam === 'scheduled'
          ? 'scheduled-integrations'
          : tabParam;

    if (normalized === 'api-integrations' || normalized === 'event-rules' || normalized === 'scheduled-integrations') {
      setActiveTab(normalized);
    }
  }, [location.search]);

  const tabItems = [
    {
      key: 'event-rules',
      label: (
        <Space size={6}>
          <ThunderboltOutlined />
          <span>Outbound Integrations</span>
        </Space>
      ),
      children: <IntegrationsRoute hideHeader isActive={activeTab === 'event-rules'} />
    },
    {
      key: 'api-integrations',
      label: (
        <Space size={6}>
          <ApiOutlined />
          <span>Inbound Integrations</span>
        </Space>
      ),
      children: <InboundIntegrationsRoute hideHeader isActive={activeTab === 'api-integrations'} />
    },
    {
      key: 'scheduled-integrations',
      label: (
        <Space size={6}>
          <ClockCircleOutlined />
          <span>Scheduled Integrations</span>
        </Space>
      ),
      children: <ScheduledJobsRoute hideHeader isActive={activeTab === 'scheduled-integrations'} />
    }
  ];

  return (
    <div style={{ minHeight: '100vh' }}>
      <PageHeader
        title="Integrations"
        description="Manage outbound, inbound, and scheduled integrations"
        breadcrumb={[
          { label: 'Configuration' },
          { label: 'Integrations' }
        ]}
        compact
      />

      <div style={{ padding: `0 ${spacing[4]} ${spacing[4]}` }}>
        <Tabs
          activeKey={activeTab}
          onChange={(nextTab) => {
            setActiveTab(nextTab);
            const tabValue = nextTab === 'api-integrations' ? 'inbound'
              : nextTab === 'scheduled-integrations' ? 'scheduled'
              : 'outbound';
            navigate(`/integrations?tab=${tabValue}`);
          }}
          items={tabItems}
          size="middle"
          tabBarStyle={{
            marginBottom: 0,
            paddingBottom: spacing[2],
            borderBottom: `1px solid ${token.colorBorder}`
          }}
          tabBarExtraContent={
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              onClick={() => {
                if (activeTab === 'event-rules') {
                  navigate('/integrations/new');
                } else if (activeTab === 'api-integrations') {
                  navigate('/inbound-integrations/new');
                } else {
                  navigate('/scheduled-jobs/new');
                }
              }}
            >
              New Integration
            </Button>
          }
        />
      </div>
    </div>
  );
};
