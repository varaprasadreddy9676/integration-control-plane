import { useState, useMemo } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Checkbox, Space, Typography, Tag, Alert, Tooltip, Popconfirm, message, Row, Col, Divider } from 'antd';
import { PlusOutlined, SafetyOutlined, DeleteOutlined, InfoCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, SearchOutlined, FilterOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { FEATURES, OPERATIONS } from '../../utils/permissions';
import { getRoles, createRole, updateRole, deleteRole, type RoleConfig } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea, Search } = Input;

interface PermissionMatrixRow {
  feature: string;
  featureName: string;
  [roleKey: string]: any;
}

export const RoleManagementRoute = () => {
  const { spacing, token } = useDesignTokens();
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleConfig | null>(null);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: getRoles
  });

  const updateMutation = useMutation({
    mutationFn: ({ role, payload }: { role: string; payload: { name?: string; description?: string; features?: Record<string, string[]> } }) =>
      updateRole(role, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setIsEditModalVisible(false);
      setEditingRole(null);
      message.success('Role permissions updated successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to update role');
    }
  });

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setIsCreateModalVisible(false);
      form.resetFields();
      message.success('Role created successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to create role');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      message.success('Role deleted successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to delete role');
    }
  });

  const handleCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      scope: 'organization'
    });
    setIsCreateModalVisible(true);
  };

  const handleCreateSave = async () => {
    const values = await form.validateFields();
    createMutation.mutate({
      name: values.name,
      description: values.description,
      scope: values.scope,
      features: {}
    });
  };

  const handleEditRole = (role: RoleConfig) => {
    setEditingRole(role);

    const permissions: Record<string, string[]> = {};
    Object.entries(FEATURES).forEach(([_, featureValue]) => {
      permissions[featureValue] = role.features[featureValue] || [];
    });

    editForm.setFieldsValue(permissions);
    setIsEditModalVisible(true);
  };

  const handleEditSave = async () => {
    if (!editingRole) return;

    const values = await editForm.validateFields();

    const features: Record<string, string[]> = {};
    Object.entries(values).forEach(([feature, operations]) => {
      if (Array.isArray(operations) && operations.length > 0) {
        features[feature] = operations;
      }
    });

    updateMutation.mutate({
      role: editingRole.role,
      payload: { features }
    });
  };

  // Filter roles
  const filteredRoles = useMemo(() => {
    return roles.filter((role) => {
      const matchesSearch = !searchText ||
        role.name.toLowerCase().includes(searchText.toLowerCase()) ||
        role.role.toLowerCase().includes(searchText.toLowerCase()) ||
        role.description.toLowerCase().includes(searchText.toLowerCase());

      const matchesScope = scopeFilter === 'all' || role.scope === scopeFilter;

      return matchesSearch && matchesScope;
    });
  }, [roles, searchText, scopeFilter]);

  // Build permission matrix data
  const matrixData: PermissionMatrixRow[] = useMemo(() => {
    return Object.entries(FEATURES).map(([key, value]) => {
      const row: PermissionMatrixRow = {
        feature: value,
        featureName: key.replace(/_/g, ' ')
      };

      filteredRoles.forEach((role) => {
        row[role.role] = role.features[value] || [];
      });

      return row;
    });
  }, [filteredRoles]);

  // Build table columns
  const columns = useMemo(() => [
    {
      title: 'Feature',
      dataIndex: 'featureName',
      key: 'feature',
      fixed: 'left' as const,
      width: 200,
      render: (text: string) => (
        <Text strong style={{ textTransform: 'capitalize', fontSize: '12px' }}>
          {text}
        </Text>
      )
    },
    ...filteredRoles.map((role) => ({
      title: (
        <Space direction="vertical" size={0} align="center" style={{ width: '100%' }}>
          <Space size={4}>
            <Text strong style={{ fontSize: '12px' }}>{role.name}</Text>
            {role.isCustom && <Tag color="purple" style={{ margin: 0, fontSize: '10px' }}>CUSTOM</Tag>}
          </Space>
          <Tag
            color={role.scope === 'global' ? 'red' : role.scope === 'organization' ? 'blue' : 'default'}
            style={{ margin: 0, fontSize: '10px' }}
          >
            {role.scope}
          </Tag>
        </Space>
      ),
      dataIndex: role.role,
      key: role.role,
      width: 150,
      align: 'center' as const,
      render: (operations: string[]) => {
        const allOps = Object.values(OPERATIONS);
        const hasAll = allOps.every(op => operations.includes(op));

        if (hasAll) {
          return (
            <Tooltip title="Has all operations">
              <Tag color="green" style={{ margin: 0, fontSize: '10px' }}>
                <CheckCircleOutlined /> FULL ACCESS
              </Tag>
            </Tooltip>
          );
        }

        if (operations.length === 0) {
          return (
            <Tag color="default" style={{ margin: 0, opacity: 0.4, fontSize: '10px' }}>
              NO ACCESS
            </Tag>
          );
        }

        return (
          <Tooltip title={operations.map(op => op.toUpperCase()).join(', ')}>
            <Space wrap size={2}>
              {operations.map((op) => (
                <Tag key={op} color="blue" style={{ margin: '1px', fontSize: '10px', padding: '0 4px' }}>
                  {op.charAt(0).toUpperCase()}
                </Tag>
              ))}
            </Space>
          </Tooltip>
        );
      }
    }))
  ], [filteredRoles]);

  return (
    <div>
      <PageHeader
        title="Role & Permission Management"
        description="Define roles and assign feature permissions"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Role
          </Button>
        }
      />

      <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
        {/* Filters */}
        <Card style={{ borderRadius: token.borderRadiusLG }}>
          <Row gutter={16}>
            <Col span={16}>
              <Search
                placeholder="Search by role name, description, or scope..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                size="large"
              />
            </Col>
            <Col span={8}>
              <Select
                placeholder="Filter by scope"
                value={scopeFilter}
                onChange={setScopeFilter}
                style={{ width: '100%' }}
                size="large"
                suffixIcon={<FilterOutlined />}
              >
                <Select.Option value="all">All Scopes</Select.Option>
                <Select.Option value="global">Global Only</Select.Option>
                <Select.Option value="organization">Organization Only</Select.Option>
                <Select.Option value="api">API Only</Select.Option>
              </Select>
            </Col>
          </Row>

          <Divider style={{ margin: `${spacing[3]} 0` }} />

          <Space size={spacingToNumber(spacing[2])}>
            <Text type="secondary">
              Showing <Text strong>{filteredRoles.length}</Text> of <Text strong>{roles.length}</Text> roles
            </Text>
            {searchText && (
              <Tag closable onClose={() => setSearchText('')}>
                Search: "{searchText}"
              </Tag>
            )}
            {scopeFilter !== 'all' && (
              <Tag closable onClose={() => setScopeFilter('all')}>
                Scope: {scopeFilter}
              </Tag>
            )}
          </Space>
        </Card>

        {/* Role Cards */}
        <Card title="Roles" style={{ borderRadius: token.borderRadiusLG }}>
          {filteredRoles.length === 0 ? (
            <Alert
              type="info"
              message="No roles found"
              description={
                searchText || scopeFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'No roles available. Create a new role to get started.'
              }
              showIcon
            />
          ) : (
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              {filteredRoles.map((role) => (
                <Card
                  key={role.role}
                  size="small"
                  style={{
                    borderRadius: token.borderRadius,
                    borderLeft: `4px solid ${
                      role.scope === 'global'
                        ? token.colorError
                        : role.scope === 'organization'
                        ? token.colorPrimary
                        : token.colorTextSecondary
                    }`
                  }}
                  hoverable
                >
                  <Row justify="space-between" align="middle">
                    <Col flex="auto">
                      <Space direction="vertical" size={2}>
                        <Space size={8}>
                          <Text strong style={{ fontSize: '15px' }}>{role.name}</Text>
                          {role.isCustom && <Tag color="purple">Custom</Tag>}
                          <Tag color={
                            role.scope === 'global' ? 'red' :
                            role.scope === 'organization' ? 'blue' :
                            'default'
                          }>
                            {role.scope.toUpperCase()}
                          </Tag>
                        </Space>
                        <Text type="secondary" style={{ fontSize: '13px' }}>
                          {role.description}
                        </Text>
                        <Text type="secondary" style={{ fontSize: '11px' }}>
                          <InfoCircleOutlined /> {Object.keys(role.features).length} features configured
                        </Text>
                      </Space>
                    </Col>
                    <Col>
                      <Space>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => handleEditRole(role)}
                          disabled={role.role === 'SUPER_ADMIN'}
                        >
                          Edit Permissions
                        </Button>
                        {role.isCustom && (
                          <Popconfirm
                            title="Delete Role"
                            description={`Delete "${role.name}"? This cannot be undone.`}
                            onConfirm={() => deleteMutation.mutate(role.role)}
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              loading={deleteMutation.isPending}
                            >
                              Delete
                            </Button>
                          </Popconfirm>
                        )}
                      </Space>
                    </Col>
                  </Row>
                </Card>
              ))}
            </Space>
          )}
        </Card>

        {/* Permission Matrix */}
        {filteredRoles.length > 0 && (
          <Card
            title={
              <Space>
                <span>Permission Matrix</span>
                <Tooltip title="Each cell shows which operations a role has for that feature. First letter of each operation is shown.">
                  <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                </Tooltip>
              </Space>
            }
            style={{ borderRadius: token.borderRadiusLG }}
          >
            <Table
              columns={columns}
              dataSource={matrixData}
              rowKey="feature"
              loading={isLoading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="small"
              bordered
            />
          </Card>
        )}
      </Space>

      {/* Create Role Modal */}
      <Modal
        title="Create New Role"
        open={isCreateModalVisible}
        onCancel={() => setIsCreateModalVisible(false)}
        onOk={handleCreateSave}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Role Name"
            rules={[{ required: true, message: 'Please enter a role name' }]}
          >
            <Input placeholder="e.g., Content Editor" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true, message: 'Please enter a description' }]}
          >
            <TextArea rows={2} placeholder="Describe what this role can do" />
          </Form.Item>

          <Form.Item
            name="scope"
            label="Scope"
            rules={[{ required: true, message: 'Please select a scope' }]}
          >
            <Select>
              <Select.Option value="global">Global - Access all organizations</Select.Option>
              <Select.Option value="organization">Organization - Scoped to user's org</Select.Option>
              <Select.Option value="api">API - Service account access</Select.Option>
            </Select>
          </Form.Item>

          <Alert
            type="info"
            message="Permissions can be assigned after creating the role"
            showIcon
          />
        </Form>
      </Modal>

      {/* Edit Permissions Modal */}
      <Modal
        title={
          <Space>
            <span>Edit Permissions: {editingRole?.name}</span>
            {editingRole?.isCustom && <Tag color="purple">Custom</Tag>}
          </Space>
        }
        open={isEditModalVisible}
        onCancel={() => {
          setIsEditModalVisible(false);
          setEditingRole(null);
        }}
        onOk={handleEditSave}
        confirmLoading={updateMutation.isPending}
        width={800}
      >
        <Alert
          type="info"
          message={
            <Space split={<Divider type="vertical" />}>
              <span><Text strong>Role:</Text> {editingRole?.role}</span>
              <span><Text strong>Scope:</Text> {editingRole?.scope?.toUpperCase()}</span>
            </Space>
          }
          description={editingRole?.description}
          showIcon
          style={{ marginBottom: spacing[3] }}
        />

        <Form form={editForm} layout="vertical">
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
              {Object.entries(FEATURES).map(([key, value]) => (
                <Card
                  key={value}
                  size="small"
                  style={{
                    borderRadius: token.borderRadius,
                    backgroundColor: token.colorBgContainer
                  }}
                >
                  <Form.Item
                    name={value}
                    label={
                      <Text strong style={{ textTransform: 'capitalize', fontSize: '13px' }}>
                        {key.replace(/_/g, ' ')}
                      </Text>
                    }
                    style={{ marginBottom: 0 }}
                  >
                    <Checkbox.Group style={{ width: '100%' }}>
                      <Row gutter={[8, 8]}>
                        {Object.entries(OPERATIONS).map(([opKey, opValue]) => (
                          <Col span={8} key={opValue}>
                            <Checkbox value={opValue}>
                              {opKey.replace(/_/g, ' ')}
                            </Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </Form.Item>
                </Card>
              ))}
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
};
