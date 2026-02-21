import { useMemo, useState } from 'react';
import { App, Button, Card, Modal, Table, Space, Typography, Upload, message as antdMessage, Progress, Alert, Tag } from 'antd';
import { UploadOutlined, DownloadOutlined, DeleteOutlined, PlayCircleOutlined, PauseCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { PageHeader } from '../../../components/common/PageHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
import {
  bulkCreateIntegrations,
  bulkUpdateIntegrations,
  bulkDeleteIntegrations,
  bulkEnableIntegrations,
  bulkDisableIntegrations,
  exportIntegrations,
  importIntegrations,
  validateBulkImport
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import type { IntegrationConfig } from '../../../mocks/types';
import { useDesignTokens, spacingToNumber, withAlpha, cssVar } from '../../../design-system/utils';
import { logError } from '../../../utils/error-logger';

const { Title, Text } = Typography;
const { Dragger } = Upload;

type BulkOperation = 'create' | 'update' | 'delete' | 'activate' | 'deactivate';
type ImportStep = 'upload' | 'validate' | 'preview' | 'execute';

interface BulkJob {
  id: string;
  operation: BulkOperation;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  total: number;
  processed: number;
  successful: number;
  failed: number;
  createdAt: string;
  completedAt?: string;
  errors?: string[];
}

interface ImportData {
  integrations: Partial<IntegrationConfig>[];
  metadata: any;
}

export const BulkOperationsRoute = () => {
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  // State for bulk operations
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>([]);
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<BulkOperation | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'operations' | 'import'>('operations');

  // State for import/export
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Mock data - in real app, this would come from API
  const { data: bulkJobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['bulk-jobs'],
    queryFn: () => [], // Replace with actual API call
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  const { data: integrations = [], isLoading: integrationsLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      // Bulk operations page doesn't need to load integrations - they're selected from other pages
      return [];
    },
    enabled: false // Disabled by default
  });

  // Bulk operation mutations
  const bulkCreateMutation = useMutation({
    mutationFn: (integrations: Partial<IntegrationConfig>[]) => bulkCreateIntegrations(integrations),
    onSuccess: (result: any) => {
      msgApi.success(`Bulk create not implemented yet`);
      setBulkModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['bulk-jobs'] });
    },
    onError: (error: any) => {
      msgApi.error(`Bulk create failed: ${error.message}`);
    }
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: ({ integrationIds, updates }: { integrationIds: string[]; updates: Partial<IntegrationConfig> }) =>
      bulkUpdateIntegrations(integrationIds, updates),
    onSuccess: (result: any) => {
      msgApi.success(`Bulk update not implemented yet`);
      setBulkModalVisible(false);
      setSelectedIntegrationIds([]);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (error: any) => {
      msgApi.error(`Bulk update failed: ${error.message}`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (integrationIds: string[]) => bulkDeleteIntegrations(integrationIds),
    onSuccess: (result: { deletedCount: number; failedIds: string[] }) => {
      msgApi.success(`Deleted ${result.deletedCount} integrations successfully`);
      setBulkModalVisible(false);
      setSelectedIntegrationIds([]);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (error: any) => {
      msgApi.error(`Bulk delete failed: ${error.message}`);
    }
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ integrationIds, activate }: { integrationIds: string[]; activate: boolean }) =>
      activate ? bulkEnableIntegrations(integrationIds) : bulkDisableIntegrations(integrationIds),
    onSuccess: (result: { updatedCount: number; failedIds: string[] }, variables) => {
      const action = variables.activate ? 'activated' : 'deactivated';
      msgApi.success(`${action.charAt(0).toUpperCase() + action.slice(1)} ${result.updatedCount} integrations successfully`);
      setBulkModalVisible(false);
      setSelectedIntegrationIds([]);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (error: any) => {
      msgApi.error(`Bulk status change failed: ${error.message}`);
    }
  });

  const handleBulkOperation = (operation: BulkOperation) => {
    setSelectedOperation(operation);
    setBulkModalVisible(true);
  };

  const executeBulkOperation = async () => {
    if (!selectedOperation) return;

    try {
      setBulkLoading(true);

      switch (selectedOperation) {
        case 'create':
          if (importData) {
            await bulkCreateMutation.mutateAsync(importData.integrations as Partial<IntegrationConfig>[]);
          }
          break;

        case 'update':
          // Would need a form for updates
          await bulkUpdateMutation.mutateAsync({
            integrationIds: selectedIntegrationIds,
            updates: { isActive: true } // Example update
          });
          break;

        case 'delete':
          await bulkDeleteMutation.mutateAsync(selectedIntegrationIds);
          break;

        case 'activate':
          await bulkStatusMutation.mutateAsync({ integrationIds: selectedIntegrationIds, activate: true });
          break;

        case 'deactivate':
          await bulkStatusMutation.mutateAsync({ integrationIds: selectedIntegrationIds, activate: false });
          break;
      }
    } catch (error) {
      // Log error to server with business_logic category
      logError(
        error as Error,
        {
          operation: 'bulk_operation',
          action: selectedOperation,
          integrationCount: selectedIntegrationIds.length,
          integrationIds: selectedIntegrationIds
        },
        'business_logic'
      );
      console.error('Bulk operation failed:', error);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate import data
      setImportStep('validate');
      const validation = await validateBulkImport({ importData: data });

      if (validation.valid) {
        setImportData(data);
        setImportStep('preview');
      } else {
        setValidationErrors(validation.errors || []);
        setImportStep('upload');
        antdMessage.error('Import validation failed');
      }
    } catch (error) {
      antdMessage.error('Failed to parse file');
    }

    return false; // Prevent default upload behavior
  };

  const executeImport = async () => {
    if (!importData) return;

    try {
      setBulkLoading(true);
      const result = await importIntegrations({
        importData,
        options: {
          validateFirst: true,
          continueOnError: false,
          updateExisting: false,
          activateImported: true
        }
      });

      msgApi.success(`Import completed: ${result.results.successful.length} successful, ${result.results.failed.length} failed`);
      setImportStep('upload');
      setImportData(null);
      setValidationErrors([]);

      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      antdMessage.error(`Import failed: ${errorMessage}`);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await exportIntegrations({
        includeInactive: true,
        includeSensitive: false,
        format: 'standard'
      });

      // Create and trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `integration-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      msgApi.success('Integration configurations exported successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      antdMessage.error(`Export failed: ${errorMessage}`);
    }
  };

  const renderBulkJobProgress = (job: BulkJob) => {
    const progress = job.total > 0 ? (job.processed / job.total) * 100 : 0;

    return (
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space>
          <Tag color={job.status === 'COMPLETED' ? 'green' : job.status === 'FAILED' ? 'red' : 'blue'}>
            {job.status}
          </Tag>
          <Text strong>{job.operation?.toUpperCase() || 'UNKNOWN'}</Text>
          <Text type="secondary">
            {new Date(job.createdAt).toLocaleString()}
          </Text>
        </Space>

        <Progress
          percent={progress}
          status={job.status === 'FAILED' ? 'exception' : job.status === 'COMPLETED' ? 'success' : 'active'}
          showInfo={false}
        />

        <Space split={<span>•</span>}>
          <Text>{job.processed}/{job.total} processed</Text>
          <Text type="success">{job.successful} success</Text>
          {job.failed > 0 && <Text type="danger">{job.failed} failed</Text>}
        </Space>

        {job.errors && job.errors.length > 0 && (
          <Alert
            message="Errors encountered"
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {job.errors.slice(0, 3).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {job.errors.length > 3 && <li>... and {job.errors.length - 3} more</li>}
              </ul>
            }
            type="error"
            showIcon
            style={{ marginTop: spacing[2] }}
          />
        )}
      </Space>
    );
  };

  const operationColumns = [
    {
      title: 'Operation',
      dataIndex: 'operation',
      key: 'operation',
      render: (operation: BulkOperation) => (
        <Tag color={operation === 'delete' ? colors.error[600] : colors.primary[600]} style={{ borderRadius: token.borderRadiusSM }}>
          {operation?.toUpperCase() || 'UNKNOWN'}
        </Tag>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: BulkJob['status']) => (
        <Tag
          color={
            status === 'COMPLETED'
              ? colors.success[600]
              : status === 'FAILED'
                ? colors.error[600]
                : colors.info[600]
          }
          style={{ borderRadius: token.borderRadiusSM }}
        >
          {status}
        </Tag>
      )
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_: any, record: BulkJob) => {
        const progress = record.total > 0 ? (record.processed / record.total) * 100 : 0;
        return (
          <Progress
            percent={progress}
            size="small"
            status={record.status === 'FAILED' ? 'exception' : record.status === 'COMPLETED' ? 'success' : 'active'}
          />
        );
      }
    },
    {
      title: 'Results',
      key: 'results',
      render: (_: any, record: BulkJob) => (
        <Space direction="vertical" size="small">
          <Text>{record.processed}/{record.total} processed</Text>
          <Space size="small">
            <Text type="success">{record.successful} ✓</Text>
            {record.failed > 0 && <Text type="danger">{record.failed} ✗</Text>}
          </Space>
        </Space>
      )
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatDateTime
    }
  ];

  return (
    <div>
      <PageHeader
        title="Bulk Operations"
        description="Manage event rules at scale with bulk operations, import/export, and batch processing."
        statusChips={[
          { label: `${selectedIntegrationIds.length} selected` },
          { label: `${bulkJobs.length} active jobs`, color: colors.primary[600] }
        ]}
        actions={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              Export
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setActiveTab('import')}
            >
              Import
            </Button>
          </Space>
        }
      />

      {/* Tab Content */}
      <Card
        tabList={[
          { key: 'operations', tab: 'Bulk Operations' },
          { key: 'import', tab: 'Import/Export' }
        ]}
        activeTabKey={activeTab}
        onTabChange={(key) => setActiveTab(key as 'operations' | 'import')}
      >
        {activeTab === 'operations' && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* Quick Actions */}
            <div>
              <Title level={4}>Quick Actions</Title>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  disabled={selectedIntegrationIds.length === 0}
                  onClick={() => handleBulkOperation('update')}
                >
                  Update Selected ({selectedIntegrationIds.length})
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={selectedIntegrationIds.length === 0}
                  onClick={() => handleBulkOperation('delete')}
                >
                  Delete Selected ({selectedIntegrationIds.length})
                </Button>
                <Button
                  icon={<PlayCircleOutlined />}
                  disabled={selectedIntegrationIds.length === 0}
                  onClick={() => handleBulkOperation('activate')}
                >
                  Activate Selected ({selectedIntegrationIds.length})
                </Button>
                <Button
                  icon={<PauseCircleOutlined />}
                  disabled={selectedIntegrationIds.length === 0}
                  onClick={() => handleBulkOperation('deactivate')}
                >
                  Deactivate Selected ({selectedIntegrationIds.length})
                </Button>
              </Space>
            </div>

            {/* Bulk Jobs History */}
            <div>
              <Title level={4}>Bulk Jobs History</Title>
              <Table
                columns={operationColumns}
                dataSource={bulkJobs}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                expandable={{
                  expandedRowRender: renderBulkJobProgress,
                  rowExpandable: (record) => record.status !== 'COMPLETED'
                }}
                loading={jobsLoading}
              />
            </div>
          </Space>
        )}

        {activeTab === 'import' && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {importStep === 'upload' && (
              <div>
                <Title level={4}>Import Integration Configurations</Title>
                <Dragger
                  accept=".json"
                  beforeUpload={handleFileUpload}
                  showUploadList={false}
                  style={{ padding: `${spacing[10]} ${spacing[5]}` }}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined style={{ fontSize: spacing[12], color: colors.primary[600] }} />
                  </p>
                  <p className="ant-upload-text">Click or drag JSON file to this area to upload</p>
                  <p className="ant-upload-hint">
                    Support for integration configuration exports in JSON format
                  </p>
                </Dragger>

                {validationErrors.length > 0 && (
                  <Alert
                    message="Validation Errors"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {validationErrors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    }
                    type="error"
                    showIcon
                    style={{ marginTop: spacing[4] }}
                  />
                )}
              </div>
            )}

            {importStep === 'preview' && importData && (
              <div>
                <Title level={4}>Import Preview</Title>
                <Alert
                  message={`Ready to import ${importData.integrations.length} event rule configurations`}
                  description="Review the configurations below before proceeding with the import."
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                <Table
                  dataSource={importData.integrations}
                  rowKey={(record, index) => record.name || (index !== undefined ? index.toString() : Math.random().toString())}
                  pagination={false}
                  scroll={{ y: 300 }}
                  columns={[
                    { title: 'Name', dataIndex: 'name', key: 'name' },
                    { title: 'Event Type', dataIndex: 'eventType', key: 'eventType' },
                    { title: 'Target URL', dataIndex: 'targetUrl', key: 'targetUrl', ellipsis: true },
                    { title: 'Method', dataIndex: 'httpMethod', key: 'httpMethod' },
                    { title: 'Active', dataIndex: 'isActive', key: 'isActive',
                      render: (active: boolean) => <StatusBadge status={active ? 'SUCCESS' : 'FAILED'} />
                    }
                  ]}
                />

                <Space style={{ marginTop: 16 }}>
                  <Button
                    type="primary"
                    loading={bulkLoading}
                    onClick={executeImport}
                  >
                    Execute Import
                  </Button>
                  <Button onClick={() => setImportStep('upload')}>
                    Back to Upload
                  </Button>
                </Space>
              </div>
            )}

            <div>
              <Title level={4}>Export Configuration</Title>
              <Alert
                message="Export Event Rule Configurations"
                description="Download all event rule configurations as a JSON file for backup or migration."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleExport}
              >
                Export All Configurations
              </Button>
            </div>
          </Space>
        )}
      </Card>

      {/* Bulk Operation Confirmation Modal */}
      <Modal
        title={`Confirm Bulk ${selectedOperation?.toUpperCase()}`}
        open={bulkModalVisible}
        onOk={executeBulkOperation}
        onCancel={() => {
          setBulkModalVisible(false);
          setSelectedOperation(null);
        }}
        confirmLoading={bulkLoading}
        okText={`Execute ${selectedOperation?.toUpperCase()}`}
        cancelText="Cancel"
      >
        <Space direction="vertical" size="middle">
          <Text>
            Are you sure you want to perform a bulk <Text strong>{selectedOperation}</Text> operation?
          </Text>

          {selectedIntegrationIds.length > 0 && (
            <Alert
              message={`${selectedIntegrationIds.length} event rules selected`}
              description="This operation will affect all selected event rules."
              type="warning"
              showIcon
            />
          )}

          {selectedOperation === 'delete' && (
            <Alert
              message="Warning: This action cannot be undone!"
              description="Deleting event rules will permanently remove them and stop all future deliveries."
              type="error"
              showIcon
            />
          )}
        </Space>
      </Modal>
    </div>
  );
};
