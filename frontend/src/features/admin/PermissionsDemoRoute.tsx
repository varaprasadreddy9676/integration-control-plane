import { Card, Table, Tag, Space, Typography, Alert, Descriptions } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SafetyOutlined } from '@ant-design/icons';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens } from '../../design-system/utils';
import { useAuth } from '../../app/auth-context';
import { usePermissions } from '../../hooks/usePermissions';
import { FEATURES, OPERATIONS, getRoleFeatures } from '../../utils/permissions';

const { Text, Title } = Typography;

interface PermissionRow {
  feature: string;
  read: boolean;
  write: boolean;
  delete: boolean;
  execute: boolean;
  configure: boolean;
  export: boolean;
}

export const PermissionsDemoRoute = () => {
  const { spacing, token } = useDesignTokens();
  const { user } = useAuth();
  const { can, role } = usePermissions();

  const roleFeatures = getRoleFeatures(user?.role);

  // Build permission matrix
  const permissionMatrix: PermissionRow[] = Object.keys(FEATURES).map((featureKey) => {
    const feature = FEATURES[featureKey as keyof typeof FEATURES];
    return {
      feature,
      read: can(feature, OPERATIONS.READ),
      write: can(feature, OPERATIONS.WRITE),
      delete: can(feature, OPERATIONS.DELETE),
      execute: can(feature, OPERATIONS.EXECUTE),
      configure: can(feature, OPERATIONS.CONFIGURE),
      export: can(feature, OPERATIONS.EXPORT)
    };
  });

  const columns = [
    {
      title: 'Feature',
      dataIndex: 'feature',
      key: 'feature',
      width: 200,
      render: (text: string) => (
        <Text strong style={{ textTransform: 'uppercase' }}>
          {text.replace(/_/g, ' ')}
        </Text>
      )
    },
    {
      title: 'Read',
      dataIndex: 'read',
      key: 'read',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    },
    {
      title: 'Write',
      dataIndex: 'write',
      key: 'write',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    },
    {
      title: 'Delete',
      dataIndex: 'delete',
      key: 'delete',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    },
    {
      title: 'Execute',
      dataIndex: 'execute',
      key: 'execute',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    },
    {
      title: 'Configure',
      dataIndex: 'configure',
      key: 'configure',
      width: 90,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    },
    {
      title: 'Export',
      dataIndex: 'export',
      key: 'export',
      width: 80,
      align: 'center' as const,
      render: (hasAccess: boolean) =>
        hasAccess ? (
          <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} />
        ) : (
          <CloseCircleOutlined style={{ color: token.colorTextDisabled, fontSize: 16 }} />
        )
    }
  ];

  const getRoleColor = (role?: string) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return 'red';
      case 'ADMIN':
        return 'purple';
      case 'ORG_ADMIN':
        return 'blue';
      case 'INTEGRATION_EDITOR':
        return 'cyan';
      case 'VIEWER':
        return 'green';
      default:
        return 'default';
    }
  };

  return (
    <div>
      <PageHeader
        title="Permissions & RBAC"
        description="View your role-based access control permissions"
      />

      <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
        {/* Current User Info */}
        <Card title="Your Account" style={{ borderRadius: token.borderRadiusLG }}>
          <Descriptions column={2}>
            <Descriptions.Item label="Email">{user?.email}</Descriptions.Item>
            <Descriptions.Item label="User ID">{user?.id}</Descriptions.Item>
            <Descriptions.Item label="Role">
              <Tag color={getRoleColor(user?.role)}>{user?.role}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Organization ID">
              {user?.orgId || <Text type="secondary">Global Access</Text>}
            </Descriptions.Item>
            {user?.impersonated && (
              <Descriptions.Item label="Impersonation Status" span={2}>
                <Alert
                  type="warning"
                  message={`You are being impersonated by: ${user.impersonatedBy}`}
                  showIcon
                />
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* Permission Matrix */}
        <Card
          title="Permission Matrix"
          extra={
            <Text type="secondary">
              {user?.role === 'SUPER_ADMIN' ? (
                <Text type="success">Full Access to All Features</Text>
              ) : (
                `${permissionMatrix.filter((p) => p.read || p.write || p.delete || p.execute || p.configure || p.export).length} / ${permissionMatrix.length} features accessible`
              )}
            </Text>
          }
          style={{ borderRadius: token.borderRadiusLG }}
        >
          <Table
            columns={columns}
            dataSource={permissionMatrix}
            rowKey="feature"
            pagination={false}
            size="small"
            scroll={{ x: 800 }}
            rowClassName={(record) => {
              const hasAnyAccess =
                record.read ||
                record.write ||
                record.delete ||
                record.execute ||
                record.configure ||
                record.export;
              return hasAnyAccess ? '' : 'disabled-row';
            }}
          />
        </Card>

        {/* RBAC System Info */}
        <Card title="About RBAC System" style={{ borderRadius: token.borderRadiusLG }}>
          <Space direction="vertical" size={spacingToNumber(spacing[3])}>
            <div>
              <Title level={5}>Feature-Based Permissions</Title>
              <Text>
                This application uses a simple, feature-based RBAC (Role-Based Access Control)
                system. Each feature has standard operations (read, write, delete, execute,
                configure, export), and roles are mapped to these features.
              </Text>
            </div>

            <div>
              <Title level={5}>Available Roles</Title>
              <Space wrap>
                <Tag color="red">SUPER_ADMIN - Global Access</Tag>
                <Tag color="purple">ADMIN - Organization Admin</Tag>
                <Tag color="blue">ORG_ADMIN - Organization Admin</Tag>
                <Tag color="cyan">INTEGRATION_EDITOR - Can Edit Integrations</Tag>
                <Tag color="green">VIEWER - Read-Only Access</Tag>
                <Tag color="default">ORG_USER - Basic User</Tag>
              </Space>
            </div>

            <div>
              <Title level={5}>Standard Operations</Title>
              <ul>
                <li>
                  <Text strong>READ:</Text> View and list items
                </li>
                <li>
                  <Text strong>WRITE:</Text> Create and edit items
                </li>
                <li>
                  <Text strong>DELETE:</Text> Remove items
                </li>
                <li>
                  <Text strong>EXECUTE:</Text> Run operations (test, retry, etc.)
                </li>
                <li>
                  <Text strong>CONFIGURE:</Text> Modify settings and configurations
                </li>
                <li>
                  <Text strong>EXPORT:</Text> Export data to files
                </li>
              </ul>
            </div>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

const spacingToNumber = (spacing: string): number => {
  return parseInt(spacing.replace('px', ''), 10);
};
