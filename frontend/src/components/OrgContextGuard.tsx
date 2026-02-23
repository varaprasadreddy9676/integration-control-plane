import { useState } from 'react';
import { Card, Alert, Input, Button, Space, Typography, Select } from 'antd';
import { InfoCircleOutlined, ReloadOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth-context';
import { useTenant } from '../app/tenant-context';
import { useDesignTokens } from '../design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { listAdminOrgSummaries } from '../services/api';

const { Title, Text, Paragraph } = Typography;

/**
 * Guard component that displays a friendly UI when orgId is missing.
 * Allows manual input for development/recovery scenarios.
 *
 * SUPER_ADMIN can access admin routes without orgId, but needs to select an org for org-specific routes.
 */
export const OrgContextGuard = ({ children }: { children: React.ReactNode }) => {
  const { shadows } = useDesignTokens();
  const { orgId, setManualOrgId } = useTenant();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  const isAdminRoute = location.pathname.startsWith('/admin');

  const { data: adminOrgs = [] } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isSuperAdmin || isAdmin,
    staleTime: 30 * 1000
  });

  // If orgId exists, render children
  if (orgId > 0) {
    return <>{children}</>;
  }

  // If on admin route and user is SUPER_ADMIN/ADMIN, allow access without orgId
  if (isAdminRoute && (isSuperAdmin || isAdmin)) {
    return <>{children}</>;
  }

  // SUPER_ADMIN/ADMIN on org route without orgId: show org selector
  if (isSuperAdmin || isAdmin) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '24px'
      }}>
        <Card
          style={{
            maxWidth: 600,
            width: '100%',
            boxShadow: shadows['2xl']
          }}
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <ApartmentOutlined style={{ fontSize: 64, color: '#667eea', marginBottom: 16 }} />
              <Title level={3} style={{ marginBottom: 8 }}>
                Select Organization
              </Title>
              <Text type="secondary">
                This page requires an organization context
              </Text>
            </div>

            <Alert
              message="Admin Access"
              description="As a super admin, you can view any organization's data. Please select an organization to continue."
              type="info"
              showIcon
            />

            <div>
              <Paragraph strong>Select Organization:</Paragraph>
              <Select
                size="large"
                placeholder="Choose an organization"
                style={{ width: '100%' }}
                options={adminOrgs.map((org) => ({
                  label: org.name ? `${org.name} (Org ${org.orgId})` : `Org ${org.orgId}`,
                  value: org.orgId
                }))}
                onChange={(value) => {
                  if (value) {
                    setManualOrgId(Number(value));
                  }
                }}
                showSearch
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>

            <div>
              <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Or go to admin dashboard:
              </Text>
              <Button
                type="default"
                size="large"
                block
                onClick={() => navigate('/admin/orgs')}
              >
                Go to Admin Dashboard
              </Button>
            </div>
          </Space>
        </Card>
      </div>
    );
  }

  const handleSetOrgId = () => {
    const orgIdValue = Number(inputValue);
    if (!Number.isFinite(orgIdValue) || orgIdValue <= 0) {
      setInputError('Please enter a valid positive number');
      return;
    }
    setInputError('');
    setManualOrgId(orgIdValue);
  };

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '24px'
    }}>
      <Card
        style={{
          maxWidth: 600,
          width: '100%',
          boxShadow: shadows['2xl']
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <InfoCircleOutlined style={{ fontSize: 64, color: '#667eea', marginBottom: 16 }} />
            <Title level={3} style={{ marginBottom: 8 }}>
              Missing Organization Context
            </Title>
            <Text type="secondary">
              This application requires an organization identifier to function
            </Text>
          </div>

          <Alert
            message="Expected Usage"
            description={
              <Paragraph style={{ marginBottom: 0 }}>
                This application is designed to be embedded as an iframe within your source system.
                The parent application should pass the <code>orgId</code> parameter:
                <br /><br />
                <code>?orgId=&lt;number&gt;</code>
              </Paragraph>
            }
            type="info"
            showIcon
          />

          <div>
            <Paragraph strong>What happened?</Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 14 }}>
              The <code>orgId</code> parameter was not found in the URL, session storage, or local storage.
              This usually means:
            </Paragraph>
            <ul style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)', paddingLeft: 20 }}>
              <li>The iframe URL doesn't include the required parameter</li>
              <li>You're accessing the app directly instead of through client app</li>
              <li>Storage was cleared or is unavailable</li>
            </ul>
            <Alert
              type="info"
              message="Note: SUPER_ADMIN and ADMIN users have global access and don't need an orgId"
              showIcon
              style={{ fontSize: 13 }}
            />
          </div>

          <div>
            <Paragraph strong>Recovery Options:</Paragraph>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {/* Option 1: Manual Input (for development/testing) */}
              <div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  Option 1: Enter Org ID manually (for development/testing)
                </Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="Enter org ID (e.g., 33)"
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      setInputError('');
                    }}
                    onPressEnter={handleSetOrgId}
                    status={inputError ? 'error' : ''}
                    type="number"
                    size="large"
                  />
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleSetOrgId}
                  >
                    Continue
                  </Button>
                </Space.Compact>
                {inputError && (
                  <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {inputError}
                  </Text>
                )}
              </div>

              {/* Option 2: Reload */}
              <div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                  Option 2: Reload the parent client application
                </Text>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleReload}
                  block
                  size="large"
                >
                  Reload Page
                </Button>
              </div>
            </Space>
          </div>

          <Alert
            message="Need Help?"
            description="Contact your system administrator if this issue persists. The client app integration may need to be reconfigured."
            type="warning"
            showIcon
          />
        </Space>
      </Card>
    </div>
  );
};
