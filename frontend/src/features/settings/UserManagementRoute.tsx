import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { createAdminUser, listAdminUsers, resetAdminUserPassword, setAdminUserActive, updateAdminUser } from '../../services/api';

export const UserManagementRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const { spacing, token } = useDesignTokens();
  const [messageApi, contextHolder] = message.useMessage();
  const [adminUserModalOpen, setAdminUserModalOpen] = useState(false);
  const [adminEditUser, setAdminEditUser] = useState<any | null>(null);
  const [adminResetPasswordUser, setAdminResetPasswordUser] = useState<any | null>(null);
  const [adminUsersFilterOrg, setAdminUsersFilterOrg] = useState<number | undefined>(undefined);
  const [adminUsersFilterRole, setAdminUsersFilterRole] = useState<string | undefined>(undefined);
  const [adminUsersFilterStatus, setAdminUsersFilterStatus] = useState<'active' | 'disabled' | 'all'>('active');
  const [adminUsersSearch, setAdminUsersSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [adminUserForm] = Form.useForm();
  const [adminResetForm] = Form.useForm();

  const filterPayload = useMemo(() => ({
    orgId: adminUsersFilterOrg,
    role: adminUsersFilterRole,
    search: adminUsersSearch || undefined,
    isActive: adminUsersFilterStatus === 'all'
      ? undefined
      : adminUsersFilterStatus === 'active',
    page,
    limit: pageSize
  }), [adminUsersFilterOrg, adminUsersFilterRole, adminUsersFilterStatus, adminUsersSearch, page, pageSize]);

  const { data: adminUsersResponse, refetch: refetchAdminUsers } = useQuery({
    queryKey: ['adminUsers', filterPayload],
    queryFn: () => listAdminUsers(filterPayload),
    enabled: isAdmin,
    staleTime: 5 * 1000
  });

  const adminUsers = adminUsersResponse?.users || [];
  const adminUsersTotal = adminUsersResponse?.total || 0;

  const adminUserColumns = [
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Role', dataIndex: 'role', key: 'role' },
    { title: 'Org ID', dataIndex: 'orgId', key: 'orgId', render: (value: number) => value ?? '—' },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>
          {value ? 'Active' : 'Disabled'}
        </Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size="small">
          <Button
            size="small"
            onClick={() => {
              setAdminEditUser(record);
              adminUserForm.setFieldsValue({
                email: record.email,
                role: record.role,
                orgId: record.orgId ?? null,
                isActive: record.isActive
              });
              setAdminUserModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="small"
            onClick={() => {
              setAdminResetPasswordUser(record);
              adminResetForm.resetFields();
            }}
          >
            Reset Password
          </Button>
          <Button
            size="small"
            danger={record.isActive}
            onClick={async () => {
              const nextActive = !record.isActive;
              if (!nextActive) {
                Modal.confirm({
                  title: 'Disable user?',
                  content: 'This user will no longer be able to access the system.',
                  okText: 'Disable',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  async onOk() {
                    try {
                      const updated = await setAdminUserActive(record.id, nextActive);
                      messageApi.success(updated.isActive ? 'User enabled' : 'User disabled');
                      await refetchAdminUsers();
                    } catch (error: any) {
                      messageApi.error(error?.message || 'Failed to update user');
                    }
                  }
                });
                return;
              }

              try {
                const updated = await setAdminUserActive(record.id, nextActive);
                messageApi.success(updated.isActive ? 'User enabled' : 'User disabled');
                await refetchAdminUsers();
              } catch (error: any) {
                messageApi.error(error?.message || 'Failed to update user');
              }
            }}
          >
            {record.isActive ? 'Disable' : 'Enable'}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="User Management"
        description="Create and manage admins and org-scoped users."
      />

      {!isAdmin ? (
        <Alert
          type="error"
          message="Admin access only"
          description="You need an admin account to manage users."
          showIcon
        />
      ) : (
        <>
          <Card className="panel" style={{ borderRadius: token.borderRadiusLG }}>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              <Space wrap>
                <Input.Search
                  placeholder="Search by email"
                  allowClear
                  value={adminUsersSearch}
                  onChange={(event) => setAdminUsersSearch(event.target.value)}
                  onSearch={() => {
                    setPage(1);
                    refetchAdminUsers();
                  }}
                  style={{ minWidth: 220 }}
                />
                <InputNumber
                  placeholder="Filter orgId"
                  value={adminUsersFilterOrg}
                  onChange={(value) => {
                    setAdminUsersFilterOrg(value ? Number(value) : undefined);
                    setPage(1);
                  }}
                />
                <Select
                  placeholder="Role"
                  allowClear
                  value={adminUsersFilterRole}
                  onChange={(value) => {
                    setAdminUsersFilterRole(value);
                    setPage(1);
                  }}
                  options={[{ value: 'ADMIN' }, { value: 'ORG_ADMIN' }, { value: 'ORG_USER' }]}
                  style={{ minWidth: 140 }}
                />
                <Select
                  value={adminUsersFilterStatus}
                  onChange={(value) => {
                    setAdminUsersFilterStatus(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'Active', value: 'active' },
                    { label: 'Disabled', value: 'disabled' },
                    { label: 'All', value: 'all' }
                  ]}
                  style={{ minWidth: 120 }}
                />
                <Button onClick={() => refetchAdminUsers()}>Refresh</Button>
                <Button
                  type="primary"
                  onClick={() => {
                    setAdminEditUser(null);
                    adminUserForm.resetFields();
                    adminUserForm.setFieldsValue({ role: 'ORG_ADMIN', isActive: true });
                    setAdminUserModalOpen(true);
                  }}
                >
                  Create User
                </Button>
              </Space>
              <Table
                dataSource={adminUsers}
                rowKey={(row) => row.id}
                size="small"
                pagination={{
                  current: page,
                  pageSize,
                  total: adminUsersTotal,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => {
                    setPage(nextPage);
                    setPageSize(nextPageSize);
                  }
                }}
                columns={adminUserColumns}
              />
            </Space>
          </Card>

          <Modal
            title={adminEditUser ? 'Edit User' : 'Create User'}
            open={adminUserModalOpen}
            onCancel={() => setAdminUserModalOpen(false)}
            onOk={() => adminUserForm.submit()}
            okText={adminEditUser ? 'Save' : 'Create'}
          >
            <Form
              form={adminUserForm}
              layout="vertical"
              onValuesChange={(changedValues) => {
                if (changedValues.role === 'ADMIN') {
                  adminUserForm.setFieldsValue({ orgId: null });
                }
              }}
              onFinish={async (values) => {
                try {
                  if (adminEditUser) {
                    await updateAdminUser(adminEditUser.id, {
                      email: values.email,
                      role: values.role,
                      orgId: values.orgId,
                      isActive: values.isActive
                    });
                    messageApi.success('User updated');
                  } else {
                    await createAdminUser({
                      email: values.email,
                      password: values.password,
                      role: values.role,
                      orgId: values.orgId
                    });
                    messageApi.success('User created');
                  }
                  setAdminUserModalOpen(false);
                  await refetchAdminUsers();
                } catch (error: any) {
                  messageApi.error(error?.message || 'Failed to save user');
                }
              }}
            >
              <Form.Item name="email" label="Email" rules={[{ required: true }]}>
                <Input placeholder="user@example.com" />
              </Form.Item>
              {!adminEditUser && (
                <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                  <Input.Password />
                </Form.Item>
              )}
              <Form.Item name="role" label="Role" rules={[{ required: true }]}>
                <Select options={[{ value: 'ADMIN' }, { value: 'ORG_ADMIN' }, { value: 'ORG_USER' }]} />
              </Form.Item>
              <Form.Item
                name="orgId"
                label="Org ID"
                dependencies={['role']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const role = getFieldValue('role');
                      if (role === 'ADMIN') {
                        return Promise.resolve();
                      }
                      if (value === null || value === undefined || value === '') {
                        return Promise.reject(new Error('Org ID is required for non-admin users'));
                      }
                      return Promise.resolve();
                    }
                  })
                ]}
              >
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="isActive" label="Active" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            title="Reset Password"
            open={!!adminResetPasswordUser}
            onCancel={() => setAdminResetPasswordUser(null)}
            onOk={() => adminResetForm.submit()}
            okText="Reset"
          >
            <Form
              form={adminResetForm}
              layout="vertical"
              onFinish={async (values) => {
                try {
                  if (!adminResetPasswordUser) return;
                  await resetAdminUserPassword(adminResetPasswordUser.id, values.password);
                  messageApi.success('Password reset');
                  setAdminResetPasswordUser(null);
                } catch (error: any) {
                  messageApi.error(error?.message || 'Failed to reset password');
                }
              }}
            >
              <Form.Item name="password" label="New Password" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </div>
  );
};
