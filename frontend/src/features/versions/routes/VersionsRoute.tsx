import { useMemo, useState } from 'react';
import { App, Button, Card, Tag, Typography, Space, Select, Input, Modal, Progress, Alert, Timeline, Badge, Tabs, Table } from 'antd';
import {
  HistoryOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  RollbackOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { PageHeader } from '../../../components/common/PageHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import {
  getIntegrationVersions,
  createIntegrationVersion,
  updateIntegrationVersion,
  deleteIntegrationVersion,
  setDefaultIntegrationVersion,
  activateIntegrationVersion,
  rollbackIntegrationVersion,
  compareIntegrationVersions,
  getIntegrationCompatibilityMatrix
} from '../../../services/api';
import type { IntegrationConfig } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface IntegrationVersion {
  id: string;
  name: string;
  version: string;
  versionNotes?: string;
  isDefault: boolean;
  isPrerelease: boolean;
  isActive: boolean;
  compatibilityMode: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface CompatibilityMatrix {
  __KEEP_integrationName__: string;
  versions: Array<{
    id: string;
    version: string;
    parsedVersion: {
      major: number;
      minor: number;
      patch: number;
      prerelease: string | null;
    };
    isPrerelease: boolean;
    isActive: boolean;
    isDefault: boolean;
    compatibilityMode: string;
    createdAt: string;
    updatedAt: string;
    isCompatible: boolean;
  }>;
  compatibleVersions: Array<{
    id: string;
    version: string;
    parsedVersion: any;
    isPrerelease: boolean;
    isActive: boolean;
    isDefault: boolean;
    compatibilityMode: string;
    createdAt: string;
    updatedAt: string;
  }>;
  incompatibleVersions: any[];
  summary: {
    totalVersions: number;
    activeVersions: number;
    defaultVersion: any;
    latestVersion?: string;
    defaultCompatibilityMode: string;
  };
}

export const VersionsRoute = () => {
  const navigate = useNavigateWithParams();
  const { __KEEP_integrationName__ } = useParams<{ __KEEP_integrationName__: string }>();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { spacing, token, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5']
  });

  // State for version management
  const [selectedVersion, setSelectedVersion] = useState<IntegrationVersion | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [compatibilityModalVisible, setCompatibilityModalVisible] = useState(false);
  const [rollbackModalVisible, setRollbackModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('versions');
  const [compareVersions, setCompareVersions] = useState<[string?, string?]>([]);
  const [formData, setFormData] = useState<Partial<IntegrationVersion>>({});
  const [loading, setLoading] = useState(false);

  // Queries
  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['integration-versions', __KEEP_integrationName__],
    queryFn: () => getIntegrationVersions(__KEEP_integrationName__!),
    enabled: !!__KEEP_integrationName__
  });

  const { data: compatibility, isLoading: compatibilityLoading } = useQuery({
    queryKey: ['integration-compatibility', __KEEP_integrationName__],
    queryFn: () => getIntegrationCompatibilityMatrix(__KEEP_integrationName__!),
    enabled: !!__KEEP_integrationName__
  });

  // Mutations
  const createVersionMutation = useMutation({
    mutationFn: (data: any) => createIntegrationVersion(__KEEP_integrationName__!, data),
    onSuccess: () => {
      msgApi.success('Version created successfully');
      setCreateModalVisible(false);
      setFormData({});
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to create version: ${error.message}`);
    }
  });

  const updateVersionMutation = useMutation({
    mutationFn: ({ versionId, data }: { versionId: string; data: any }) =>
      updateIntegrationVersion(__KEEP_integrationName__!, versionId, data),
    onSuccess: () => {
      msgApi.success('Version updated successfully');
      setEditModalVisible(false);
      setSelectedVersion(null);
      setFormData({});
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to update version: ${error.message}`);
    }
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (versionId: string) => deleteIntegrationVersion(__KEEP_integrationName__!, versionId),
    onSuccess: () => {
      msgApi.success('Version deleted successfully');
      setSelectedVersion(null);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to delete version: ${error.message}`);
    }
  });

  const setDefaultMutation = useMutation({
    mutationFn: (versionId: string) => setDefaultIntegrationVersion(__KEEP_integrationName__!, versionId),
    onSuccess: () => {
      msgApi.success('Default version updated successfully');
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to set default version: ${error.message}`);
    }
  });

  const activateVersionMutation = useMutation({
    mutationFn: ({ versionId, activate }: { versionId: string; activate: boolean }) =>
      activateIntegrationVersion(__KEEP_integrationName__!, versionId, { activate }),
    onSuccess: (_, variables) => {
      const action = variables.activate ? 'activated' : 'deactivated';
      msgApi.success(`Version ${action} successfully`);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
    },
    onError: (error) => {
      msgApi.error(`Failed to change version status: ${error.message}`);
    }
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ versionId, reason }: { versionId: string; reason: string }) =>
      rollbackIntegrationVersion(__KEEP_integrationName__!, versionId, { reason }),
    onSuccess: () => {
      msgApi.success('Rollback completed successfully');
      setRollbackModalVisible(false);
      setSelectedVersion(null);
      queryClient.invalidateQueries({ queryKey: ['integration-versions'] });
      queryClient.invalidateQueries({ queryKey: ['integration-compatibility'] });
    },
    onError: (error) => {
      msgApi.error(`Rollback failed: ${error.message}`);
    }
  });

  // Helper functions
  const parseVersion = (version: string) => {
    const parts = version.split('.');
    const prereleaseMatch = version.match(/^(.*)-(.+)$/);
    return {
      major: parseInt(parts[0]) || 0,
      minor: parseInt(parts[1]) || 0,
      patch: parseInt(parts[2]) || 0,
      prerelease: prereleaseMatch ? prereleaseMatch[2] : null
    };
  };

  const getVersionIcon = (version: IntegrationVersion) => {
    if (version.isDefault) return <CheckCircleOutlined style={{ color: colors.success[600] }} />;
    if (version.isActive) return <RocketOutlined style={{ color: colors.primary[600] }} />;
    if (version.isPrerelease) return <WarningOutlined style={{ color: colors.warning[600] }} />;
    return <ClockCircleOutlined style={{ color: cssVar.text.muted }} />;
  };

  const getStatusBadge = (version: IntegrationVersion) => {
    if (version.isDefault) return <Tag style={tagTone(colors.primary[600])}>DEFAULT</Tag>;
    if (version.isActive) return <Tag style={tagTone(colors.success[600])}>ACTIVE</Tag>;
    return <Tag style={tagTone(colors.neutral[600])}>INACTIVE</Tag>;
  };

  const getCompatibilityColor = (isCompatible: boolean) => {
    return isCompatible ? colors.success[600] : colors.error[600];
  };

  const handleCreateVersion = () => {
    setFormData({
      versionNotes: '',
      isPrerelease: false,
      compatibilityMode: 'BACKWARD_COMPATIBLE',
      isDefault: false
    });
    setCreateModalVisible(true);
  };

  const handleEditVersion = (version: IntegrationVersion) => {
    setSelectedVersion(version);
    setFormData({
      versionNotes: version.versionNotes,
      isPrerelease: version.isPrerelease,
      compatibilityMode: version.compatibilityMode
    });
    setEditModalVisible(true);
  };

  const handleDeleteVersion = (version: IntegrationVersion) => {
    Modal.confirm({
      title: `Delete version ${version.version}?`,
      content: 'This action cannot be undone. If this is the default version, another version will be set as default.',
      okButtonProps: { danger: true },
      onOk: () => deleteVersionMutation.mutate(version.id)
    });
  };

  const handleSetDefault = (version: IntegrationVersion) => {
    setDefaultMutation.mutate(version.id);
  };

  const handleActivateToggle = (version: IntegrationVersion) => {
    activateVersionMutation.mutate({
      versionId: version.id,
      activate: !version.isActive
    });
  };

  const handleRollback = (version: IntegrationVersion) => {
    setSelectedVersion(version);
    setRollbackModalVisible(true);
  };

  const handleCompareVersions = () => {
    if (compareVersions.length === 2) {
      // Navigate to comparison view
      navigate(`/versions/${__KEEP_integrationName__}/compare/${compareVersions[0]}/${compareVersions[1]}`);
    }
  };

  const versionColumns = [
    {
      title: 'Version',
      key: 'version',
      render: (_: any, record: IntegrationVersion) => (
        <Space>
          {getVersionIcon(record)}
          <Space direction="vertical" size={2}>
            <Space>
              <Text strong>{record.version}</Text>
              {getStatusBadge(record)}
            </Space>
            <Space size={4}>
              {record.isPrerelease && <Tag style={tagTone(colors.warning[600])}>Pre-release</Tag>}
              <Tag style={tagTone(colors.info[600])}>{record.compatibilityMode}</Tag>
            </Space>
          </Space>
        </Space>
      )
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatDateTime
    },
    {
      title: 'Notes',
      dataIndex: 'versionNotes',
      key: 'versionNotes',
      ellipsis: true,
      render: (notes: string) => (
        <Text type="secondary" style={{ maxWidth: 200 }} ellipsis>
          {notes || 'No notes provided'}
        </Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: IntegrationVersion) => (
        <Space>
          {!record.isDefault && (
            <Button
              type="text"
              size="small"
              onClick={() => handleSetDefault(record)}
            >
              Set Default
            </Button>
          )}
          <Button
            type="text"
            size="small"
            onClick={() => handleActivateToggle(record)}
          >
            {record.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            type="text"
            size="small"
            onClick={() => handleEditVersion(record)}
          >
            Edit
          </Button>
          <Button
            type="text"
            size="small"
            onClick={() => handleRollback(record)}
          >
            Rollback
          </Button>
          {!record.isDefault && (
            <Button
              type="text"
              size="small"
              danger
              onClick={() => handleDeleteVersion(record)}
            >
              Delete
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title={`Version Management: ${__KEEP_integrationName__}`}
        description="Manage event rule versions, compatibility, and rollbacks. Track changes and ensure backward compatibility."
        statusChips={[
          { label: `${versions.length} versions` },
          { label: `${versions.filter(v => v.isActive).length} active`, color: colors.primary[600] },
          { label: `${versions.filter(v => v.isPrerelease).length} pre-release`, color: colors.warning[600] }
        ]}
        compact
        actions={
          <Space>
            <Button size="middle" icon={<HistoryOutlined />} onClick={() => setCompatibilityModalVisible(true)}>
              Compatibility Matrix
            </Button>
            <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={handleCreateVersion}>
              Create Version
            </Button>
          </Space>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="middle"
        tabBarStyle={{ marginBottom: spacing[2] }}
        items={[
          {
            key: 'versions',
            label: 'Versions',
            children: (
              <div style={{ padding: `${spacing[3]} 0` }}>
                <Card
                  title="Version History"
                  size="small"
                  extra={
                    <Space>
                      <Select
                        placeholder="Select versions to compare"
                        mode="multiple"
                        maxCount={2}
                        style={{ width: 250 }}
                        value={compareVersions}
                        onChange={setCompareVersions}
                        options={versions.map(v => ({
                          value: v.id,
                          label: v.version,
                          disabled: v.id === compareVersions[0] || v.id === compareVersions[1]
                        }))}
                      />
                      <Button
                        type="primary"
                        size="middle"
                        disabled={compareVersions.length !== 2}
                        onClick={handleCompareVersions}
                      >
                        Compare
                      </Button>
                    </Space>
                  }
                >
                  <Table
                    columns={versionColumns}
                    dataSource={versions}
                    rowKey="id"
                    loading={versionsLoading}
                    pagination={{ pageSize: 10 }}
                    rowClassName={(record: IntegrationVersion) => record.isDefault ? 'default-version-row' : ''}
                  />
                </Card>
              </div>
            )
          },
          {
            key: 'timeline',
            label: 'Timeline',
            children: (
              <Card title="Version Timeline" size="small">
                <Timeline
                  mode="left"
                  items={versions.map(version => ({
                    dot: getVersionIcon(version),
                    children: (
                      <Space direction="vertical" size={4}>
                        <Space>
                          <Text strong>{version.version}</Text>
                          {getStatusBadge(version)}
                        </Space>
                        <Text type="secondary">{formatDateTime(version.createdAt)}</Text>
                        {version.versionNotes && (
                          <Paragraph type="secondary" style={{ margin: 0 }}>
                            {version.versionNotes}
                          </Paragraph>
                        )}
                      </Space>
                    )
                  }))}
                />
              </Card>
            )
          }
        ]}
      />

      {/* Create Version Modal */}
      <Modal
        title="Create New Version"
        open={createModalVisible}
        onOk={() => createVersionMutation.mutate(formData)}
        onCancel={() => {
          setCreateModalVisible(false);
          setFormData({});
        }}
        confirmLoading={createVersionMutation.isPending}
        width={600}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong>Version Information</Text>
            <Space direction="vertical" size="small" style={{ width: '100%', marginTop: spacing[2] }}>
              <div>
                <Text>Version Notes *</Text>
                <TextArea
                  rows={3}
                  placeholder="Describe what's new in this version..."
                  value={formData.versionNotes}
                  onChange={(e) => setFormData(prev => ({ ...prev, versionNotes: e.target.value }))}
                />
              </div>
              <div>
                <Space style={{ width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <Text>Compatibility Mode</Text>
                    <Select
                      value={formData.compatibilityMode}
                      onChange={(value) => setFormData(prev => ({ ...prev, compatibilityMode: value }))}
                      style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                      options={[
                        { value: 'BACKWARD_COMPATIBLE', label: 'Backward Compatible' },
                        { value: 'FORWARD_COMPATIBLE', label: 'Forward Compatible' },
                        { value: 'NONE', label: 'No Compatibility' }
                      ]}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text>Type</Text>
                    <Select
                      value={formData.isPrerelease}
                      onChange={(value) => setFormData(prev => ({ ...prev, isPrerelease: value }))}
                      style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                      options={[
                        { value: false, label: 'Stable Release' },
                        { value: true, label: 'Pre-release' }
                      ]}
                    />
                  </div>
                </Space>
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      {/* Edit Version Modal */}
      <Modal
        title={`Edit Version: ${selectedVersion?.version}`}
        open={editModalVisible}
        onOk={() => updateVersionMutation.mutate({
          versionId: selectedVersion!.id,
          data: formData
        })}
        onCancel={() => {
          setEditModalVisible(false);
          setSelectedVersion(null);
          setFormData({});
        }}
        confirmLoading={updateVersionMutation.isPending}
        width={600}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text>Current Version: {selectedVersion?.version}</Text>
            <Space direction="vertical" size="small" style={{ width: '100%', marginTop: spacing[2] }}>
              <div>
                <Text>Version Notes</Text>
                <TextArea
                  rows={3}
                  placeholder="Update version notes..."
                  value={formData.versionNotes}
                  onChange={(e) => setFormData(prev => ({ ...prev, versionNotes: e.target.value }))}
                />
              </div>
              <div>
                <Text>Compatibility Mode</Text>
                <Select
                  value={formData.compatibilityMode}
                  onChange={(value) => setFormData(prev => ({ ...prev, compatibilityMode: value }))}
                  style={{ width: '100%', marginTop: spacingToNumber(spacing[1]) }}
                  options={[
                    { value: 'BACKWARD_COMPATIBLE', label: 'Backward Compatible' },
                    { value: 'FORWARD_COMPATIBLE', label: 'Forward Compatible' },
                    { value: 'NONE', label: 'No Compatibility' }
                  ]}
                />
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      {/* Compatibility Matrix Modal */}
      <Modal
        title="Compatibility Matrix"
        open={compatibilityModalVisible}
        onCancel={() => setCompatibilityModalVisible(false)}
        width={1000}
        footer={[
          <Button key="close" onClick={() => setCompatibilityModalVisible(false)}>
            Close
          </Button>
        ]}
      >
        {compatibility ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={4}>Compatibility Summary</Title>
              <Space size="large">
                <Space direction="vertical">
                  <Badge color={getCompatibilityColor(true)} text="Compatible" />
                  <Text>{compatibility.compatibleVersions.length} versions</Text>
                </Space>
                <Space direction="vertical">
                  <Badge color={getCompatibilityColor(false)} text="Incompatible" />
                  <Text>{compatibility.incompatibleVersions.length} versions</Text>
                </Space>
                <Space direction="vertical">
                  <Text strong>Total Versions</Text>
                  <Text>{compatibility.summary.totalVersions}</Text>
                </Space>
                <Space direction="vertical">
                  <Text strong>Default Version</Text>
                  <Text>{compatibility.summary.defaultVersion?.version || 'None'}</Text>
                </Space>
              </Space>
            </div>

            <div>
              <Title level={4}>Version Compatibility Details</Title>
              <Table
                columns={[
                  { title: 'Version', dataIndex: 'version', key: 'version' },
                  {
                    title: 'Status',
                    dataIndex: 'isCompatible',
                    key: 'isCompatible',
                    render: (compatible: boolean) => (
                      <Badge
                        color={getCompatibilityColor(compatible)}
                        text={compatible ? 'Compatible' : 'Incompatible'}
                      />
                    )
                  },
                  { title: 'Type', dataIndex: 'isPrerelease', key: 'isPrerelease',
                    render: (prerelease: boolean) => (
                      <Tag style={tagTone(prerelease ? colors.warning[600] : colors.success[600])}>
                        {prerelease ? 'Pre-release' : 'Stable'}
                      </Tag>
                    )
                  },
                  { title: 'Default', dataIndex: 'isDefault', key: 'isDefault',
                    render: (isDefault: boolean) => (
                      isDefault ? <CheckCircleOutlined style={{ color: colors.success[600] }} /> : '-'
                    )
                  },
                  { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: formatDateTime }
                ]}
                dataSource={compatibility.versions}
                rowKey="id"
                pagination={false}
                scroll={{ y: 300 }}
              />
            </div>
          </Space>
        ) : (
          <div style={{ textAlign: 'center', padding: `${spacing[10]} 0` }}>
            Loading compatibility matrix...
          </div>
        )}
      </Modal>

      {/* Rollback Confirmation Modal */}
      <Modal
        title={`Rollback to Version ${selectedVersion?.version}`}
        open={rollbackModalVisible}
        onOk={() => rollbackMutation.mutate({
          versionId: selectedVersion!.id,
          reason: (formData as any).rollbackReason || 'Manual rollback'
        })}
        onCancel={() => {
          setRollbackModalVisible(false);
          setSelectedVersion(null);
          setFormData({});
        }}
        confirmLoading={rollbackMutation.isPending}
        okText="Rollback"
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            message="Warning: This will rollback the event rule configuration"
            description="Rolling back will change the active event rule version. This may affect downstream systems if they are not compatible with the selected version."
            type="warning"
            showIcon
            style={{ marginBottom: spacing[4] }}
          />

          <div>
            <Text strong>Rollback Version: {selectedVersion?.version}</Text>
            {selectedVersion?.versionNotes && (
              <Paragraph type="secondary" style={{ marginTop: spacing[2] }}>
                {selectedVersion.versionNotes}
              </Paragraph>
            )}
          </div>

          <div>
            <Text strong>Rollback Reason *</Text>
            <TextArea
              rows={3}
              placeholder="Explain why this rollback is necessary..."
              value={(formData as any).rollbackReason}
              onChange={(e) => setFormData(prev => ({ ...prev, rollbackReason: e.target.value } as any))}
            />
          </div>
        </Space>
      </Modal>

      <style>{`
        .default-version-row {
          background-color: ${withAlpha(colors.success[100], 1)};
          border-left: 3px solid ${colors.success[600]};
        }
      `}</style>
    </div>
  );
};
