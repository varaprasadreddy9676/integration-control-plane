import { useState, useEffect, useMemo } from 'react';
import {
  Table,
  Button,
  Tag,
  Space,
  Modal,
  message,
  Input,
  Select,
  Card,
  Grid,
  Popconfirm,
  Drawer,
  Typography,
  Alert,
  Descriptions,
  Tooltip,
  Spin
} from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  StopOutlined,
  FilterOutlined,
  RobotOutlined,
  CopyOutlined
} from '@ant-design/icons';
import {
  listDLQEntries,
  getDLQEntry,
  getDLQStats,
  retryDLQEntry,
  abandonDLQEntry,
  deleteDLQEntry,
  bulkRetryDLQ,
  bulkAbandonDLQ,
  bulkDeleteDLQ,
  DLQEntry
} from '../../../services/api';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { TraceViewer } from './TraceViewer';
import { analyzeError, type ErrorAnalysisResult } from '../../../services/ai-api';
import { useTenant } from '../../../app/tenant-context';
import { useAIStatus } from '../hooks/useAIStatus';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface DLQManagementProps {
  integrationConfigId?: string;
}

export const DLQManagement = ({ integrationConfigId }: DLQManagementProps) => {
  const { spacing, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const { orgId } = useTenant();
  const { isAvailable: isAIAvailable } = useAIStatus();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<ErrorAnalysisResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleAIAnalyze = async (record: DLQEntry) => {
    if (!orgId) return;
    setAiResult(null);
    setAiError(null);
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      const result = await analyzeError(orgId, {
        errorMessage: record.error?.message || 'Unknown error',
        integrationId: record.integrationConfigId,
        logId: record.executionLogId || undefined
      });
      setAiResult(result);
    } catch (err: any) {
      setAiError(err.message || 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  };
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[5]}`,
        paddingRight: spacing[1]
      };

  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<DLQEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [selectedEntry, setSelectedEntry] = useState<DLQEntry | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceViewerOpen, setTraceViewerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [abandonNotes, setAbandonNotes] = useState('');

  // Filters
  const [filters, setFilters] = useState({
    status: undefined as 'pending' | 'retrying' | 'resolved' | 'abandoned' | undefined,
    errorCategory: undefined as string | undefined,
    direction: 'OUTBOUND' as 'OUTBOUND' | 'SCHEDULED' | undefined,
    limit: 50,
    offset: 0
  });

  useEffect(() => {
    loadData();
  }, [integrationConfigId, filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [entriesRes, statsRes] = await Promise.all([
        listDLQEntries({
          ...filters,
          integrationConfigId
        }),
        getDLQStats({ integrationConfigId })
      ]);

      setEntries(entriesRes.data);
      setTotal(entriesRes.pagination.total);
      setStats(statsRes);
    } catch (error: any) {
      message.error('Failed to load DLQ entries: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (dlqId: string) => {
    try {
      await retryDLQEntry(dlqId);
      message.success('Retry initiated successfully');
      loadData();
    } catch (error: any) {
      message.error('Failed to retry: ' + error.message);
    }
  };

  const handleAbandon = async (dlqId: string, notes?: string) => {
    try {
      await abandonDLQEntry(dlqId, notes);
      message.success('Entry abandoned successfully');
      setAbandonNotes('');
      loadData();
    } catch (error: any) {
      message.error('Failed to abandon: ' + error.message);
    }
  };

  const handleDelete = async (dlqId: string) => {
    try {
      await deleteDLQEntry(dlqId);
      message.success('Entry deleted successfully');
      loadData();
    } catch (error: any) {
      message.error('Failed to delete: ' + error.message);
    }
  };

  const handleBulkRetry = async () => {
    try {
      const dlqIds = selectedRowKeys as string[];
      const result = await bulkRetryDLQ(dlqIds);
      message.success(`Initiated retry for ${result.success.length} entries`);
      if (result.failed.length > 0) {
        message.warning(`${result.failed.length} entries failed to retry`);
      }
      setSelectedRowKeys([]);
      loadData();
    } catch (error: any) {
      message.error('Bulk retry failed: ' + error.message);
    }
  };

  const handleBulkAbandon = async () => {
    Modal.confirm({
      title: 'Abandon Multiple Entries',
      content: (
        <div>
          <p>Are you sure you want to abandon {selectedRowKeys.length} entries?</p>
          <TextArea
            placeholder="Enter reason for abandonment (optional)"
            rows={3}
            onChange={(e) => setAbandonNotes(e.target.value)}
          />
        </div>
      ),
      onOk: async () => {
        try {
          const dlqIds = selectedRowKeys as string[];
          const result = await bulkAbandonDLQ(dlqIds, abandonNotes);
          const successCount = result?.success?.length ?? 0;
          const failedCount = result?.failed?.length ?? 0;
          message.success(`Abandoned ${successCount} entries`);
          if (failedCount > 0) {
            message.warning(`${failedCount} entries failed to abandon`);
          }
          setSelectedRowKeys([]);
          setAbandonNotes('');
          loadData();
        } catch (error: any) {
          message.error('Bulk abandon failed: ' + error.message);
        }
      }
    });
  };

  const handleBulkDelete = async () => {
    Modal.confirm({
      title: 'Delete Multiple Entries',
      content: (
        <div>
          <p>Are you sure you want to delete {selectedRowKeys.length} entries?</p>
          <Text type="secondary">This action cannot be undone.</Text>
        </div>
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const dlqIds = selectedRowKeys as string[];
          const result = await bulkDeleteDLQ(dlqIds);
          const successCount = result?.success?.length ?? 0;
          const failedCount = result?.failed?.length ?? 0;
          message.success(`Deleted ${successCount} entries`);
          if (failedCount > 0) {
            message.warning(`${failedCount} entries failed to delete`);
          }
          setSelectedRowKeys([]);
          loadData();
        } catch (error: any) {
          message.error('Bulk delete failed: ' + error.message);
        }
      }
    });
  };

  const viewDetails = async (dlqId: string) => {
    try {
      const entry = await getDLQEntry(dlqId);
      setSelectedEntry(entry);
      setDetailsDrawerOpen(true);
    } catch (error: any) {
      message.error('Failed to load details: ' + error.message);
    }
  };

  const getStatusTag = (status: string) => {
    const config: Record<string, { color: string; icon: React.ReactNode }> = {
      pending: { color: 'warning', icon: <ClockCircleOutlined /> },
      retrying: { color: 'processing', icon: <ReloadOutlined spin /> },
      resolved: { color: 'success', icon: <CheckCircleOutlined /> },
      abandoned: { color: 'default', icon: <StopOutlined /> }
    };
    const { color, icon } = config[status] || { color: 'default', icon: null };
    return (
      <Tag color={color} icon={icon}>
        {status.toUpperCase()}
      </Tag>
    );
  };

  const getResolutionTag = (entry: DLQEntry) => {
    if (entry.status === 'resolved') {
      return <Tag color="success">Succeeded</Tag>;
    }
    if (entry.status === 'abandoned') {
      return <Tag color="error">Failed</Tag>;
    }
    if (entry.status === 'retrying') {
      return <Tag color="processing">Retrying</Tag>;
    }
    return <Tag color="warning">Pending</Tag>;
  };

  const getResolutionSummary = (entry: DLQEntry) => {
    if (entry.status === 'resolved') {
      if (entry.resolutionMethod === 'auto_retry') return 'Succeeded after retry';
      if (entry.resolutionMethod === 'manual_retry') return 'Succeeded after manual retry';
      if (entry.resolutionMethod === 'fixed') return 'Resolved after fix';
      return 'Resolved';
    }
    if (entry.status === 'abandoned') {
      if (entry.resolutionMethod === 'max_retries_exceeded') return 'Abandoned after max retries';
      if (entry.resolutionMethod === 'manual_abandon') return 'Abandoned manually';
      return 'Abandoned';
    }
    if (entry.status === 'retrying') return 'Retry in progress';
    return 'Pending retry';
  };

  const getCategoryTag = (category: string) => {
    const colors: Record<string, string> = {
      TIMEOUT: 'orange',
      NETWORK: 'red',
      SERVER_ERROR: 'volcano',
      RATE_LIMIT: 'magenta',
      CLIENT_ERROR: 'gold',
      AUTH_ERROR: 'purple',
      DATA_ERROR: 'cyan',
      VALIDATION_ERROR: 'geekblue',
      UNKNOWN: 'default'
    };
    return <Tag color={colors[category] || 'default'}>{category}</Tag>;
  };

  const columns = [
    {
      title: 'DLQ ID',
      dataIndex: 'dlqId',
      key: 'dlqId',
      width: 160,
      render: (id: string) => (
        <Text code copyable style={{ fontSize: 11 }}>
          {id.substring(0, 16)}...
        </Text>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => getStatusTag(status)
    },
    {
      title: 'Outcome',
      key: 'resolution',
      width: 140,
      render: (_: any, record: DLQEntry) => getResolutionTag(record)
    },
    {
      title: 'Direction',
      dataIndex: 'direction',
      key: 'direction',
      width: 130,
      render: (direction: string) => (
        <Tag color={direction === 'SCHEDULED' ? 'purple' : 'blue'}>
          {direction}
        </Tag>
      )
    },
    {
      title: 'Error Category',
      dataIndex: ['error', 'category'],
      key: 'errorCategory',
      width: 140,
      render: (category: string) => getCategoryTag(category)
    },
    {
      title: 'Error Message',
      dataIndex: ['error', 'message'],
      key: 'errorMessage',
      ellipsis: true,
      width: 260,
      render: (message: string) => (
        <Tooltip title={message}>
          <Text type="danger" style={{ fontSize: 12 }}>
            {message}
          </Text>
        </Tooltip>
      )
    },
    {
      title: 'Retry Count',
      dataIndex: 'retryCount',
      key: 'retryCount',
      width: 100,
      render: (count: number, record: DLQEntry) => (
        <Text>{count} / {record.maxRetries}</Text>
      )
    },
    {
      title: 'Next Retry',
      dataIndex: 'nextRetryAt',
      key: 'nextRetryAt',
      width: 140,
      render: (nextRetryAt: string | null, record: DLQEntry) => {
        if (record.status !== 'pending') return '-';
        if (!nextRetryAt) return '-';
        const date = new Date(nextRetryAt);
        const now = new Date();
        const isPast = date < now;
        return (
          <Text type={isPast ? 'success' : 'secondary'} style={{ fontSize: 12 }}>
            {date.toLocaleString()}
          </Text>
        );
      }
    },
    {
      title: 'Failed At',
      dataIndex: 'failedAt',
      key: 'failedAt',
      width: 150,
      render: (date: string) => new Date(date).toLocaleString()
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_: any, record: DLQEntry) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => viewDetails(record.dlqId)}
          >
            Details
          </Button>
          {isAIAvailable && (
            <Button
              size="small"
              icon={<RobotOutlined />}
              onClick={() => handleAIAnalyze(record)}
            >
              AI
            </Button>
          )}
          {record.status !== 'resolved' && record.status !== 'abandoned' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<ReloadOutlined />}
                onClick={() => handleRetry(record.dlqId)}
              >
                Retry
              </Button>
              <Popconfirm
                title="Abandon this entry?"
                description="This action cannot be undone"
                onConfirm={() => handleAbandon(record.dlqId)}
                okText="Yes"
                cancelText="No"
              >
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                >
                  Abandon
                </Button>
              </Popconfirm>
            </>
          )}
          <Popconfirm
            title="Delete this entry?"
            description="This action cannot be undone"
            onConfirm={() => handleDelete(record.dlqId)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    getCheckboxProps: (_record: DLQEntry) => ({})
  };

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.08),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: 12,
    margin: 0
  });

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Stats Cards */}
      {stats && (
        <Card size="small" style={{ marginBottom: spacing[2] }} bodyStyle={{ padding: spacing[2] }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], alignItems: 'center' }}>
            {[
              { label: `Total pending: ${stats.statusBreakdown?.pending || 0}`, tone: colors.warning[500] },
              { label: `Retrying: ${stats.statusBreakdown?.retrying || 0}`, tone: colors.primary[500] },
              { label: `Resolved: ${stats.statusBreakdown?.resolved || 0}`, tone: colors.success[500] },
              { label: `Abandoned: ${stats.statusBreakdown?.abandoned || 0}`, tone: colors.neutral[500] }
            ].map((item) => (
              <Tag key={item.label} style={tagTone(item.tone)}>
                {item.label}
              </Tag>
            ))}
          </div>
        </Card>
      )}

      {/* Filters and Bulk Actions */}
      <Card size="small" style={{ marginBottom: spacing[2] }}>
        <Space size="small" wrap>
          <Select
            placeholder="Direction"
            style={{ width: 140 }}
            allowClear
            value={filters.direction}
            onChange={(direction) => setFilters({ ...filters, direction, offset: 0 })}
            options={[
              { value: 'OUTBOUND', label: 'Outbound' },
              { value: 'SCHEDULED', label: 'Scheduled' }
            ]}
            size="small"
          />
          <Select
            placeholder="Filter by status"
            style={{ width: 150 }}
            allowClear
            value={filters.status}
            onChange={(status) => setFilters({ ...filters, status, offset: 0 })}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'retrying', label: 'Retrying' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'abandoned', label: 'Abandoned' }
            ]}
            size="small"
          />

          <Button icon={<FilterOutlined />} onClick={loadData} size="small">
            Apply Filters
          </Button>

          {selectedRowKeys.length > 0 && (
            <>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={handleBulkRetry}
                size="small"
              >
                Retry Selected ({selectedRowKeys.length})
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleBulkAbandon}
                size="small"
              >
                Abandon Selected ({selectedRowKeys.length})
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBulkDelete}
                size="small"
              >
                Delete Selected ({selectedRowKeys.length})
              </Button>
            </>
          )}

          <Button icon={<ReloadOutlined />} onClick={loadData} size="small">
            Refresh
          </Button>
        </Space>
      </Card>

      {/* Table */}
      <div className="full-bleed-table" style={tableFullBleedStyle}>
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={entries}
          rowKey="dlqId"
          loading={loading}
          size="small"
          tableLayout="fixed"
          pagination={{
            current: Math.floor(filters.offset / filters.limit) + 1,
            pageSize: filters.limit,
            total,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} entries`,
            onChange: (page, pageSize) => {
              setFilters({
                ...filters,
                offset: (page - 1) * pageSize,
                limit: pageSize
              });
            }
          }}
          scroll={{ x: 1200 }}
        />
      </div>

      {/* Details Drawer */}
      <Drawer
        title="DLQ Entry Details"
        placement="right"
        width={700}
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
      >
	        {selectedEntry && (
	          <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
	            <Alert
	              type={selectedEntry.status === 'resolved' ? 'success' : 'warning'}
	              message={`Status: ${selectedEntry.status.toUpperCase()}`}
	              showIcon
            />

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Resolution">
                <Space>
                  {getResolutionTag(selectedEntry)}
                  <Text type="secondary">{selectedEntry.status.toUpperCase()}</Text>
                </Space>
              </Descriptions.Item>
              {selectedEntry.resolutionMethod && (
                <Descriptions.Item label="Resolution Method">
                  <Tag>{selectedEntry.resolutionMethod}</Tag>
                </Descriptions.Item>
              )}
              {selectedEntry.resolvedAt && (
                <Descriptions.Item label="Resolved At">
                  {new Date(selectedEntry.resolvedAt).toLocaleString()}
                </Descriptions.Item>
              )}
              {selectedEntry.resolvedBy && (
                <Descriptions.Item label="Resolved By">
                  {selectedEntry.resolvedBy}
                </Descriptions.Item>
              )}
              {selectedEntry.resolutionNotes && (
                <Descriptions.Item label="Resolution Notes">
                  {selectedEntry.resolutionNotes}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Outcome">
                {getResolutionSummary(selectedEntry)}
              </Descriptions.Item>
              <Descriptions.Item label="DLQ ID">
                <Text code copyable>{selectedEntry.dlqId}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Trace ID">
                <Space>
                  <Text code copyable>{selectedEntry.traceId}</Text>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => {
                      setSelectedTraceId(selectedEntry.traceId);
                      setTraceViewerOpen(true);
                    }}
                  >
                    View Trace
                  </Button>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Direction">{selectedEntry.direction}</Descriptions.Item>
              <Descriptions.Item label="Retry Count">
                {selectedEntry.retryCount} / {selectedEntry.maxRetries}
              </Descriptions.Item>
              <Descriptions.Item label="Retry Strategy">{selectedEntry.retryStrategy}</Descriptions.Item>
              {selectedEntry.nextRetryAt && (
                <Descriptions.Item label="Next Retry At">
                  {new Date(selectedEntry.nextRetryAt).toLocaleString()}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Failed At">
                {new Date(selectedEntry.failedAt).toLocaleString()}
              </Descriptions.Item>
              {selectedEntry.resolvedAt && (
                <>
                  <Descriptions.Item label="Resolved At">
                    {new Date(selectedEntry.resolvedAt).toLocaleString()}
                  </Descriptions.Item>
                  <Descriptions.Item label="Resolved By">
                    {selectedEntry.resolvedBy}
                  </Descriptions.Item>
                  <Descriptions.Item label="Resolution Method">
                    {selectedEntry.resolutionMethod}
                  </Descriptions.Item>
                </>
              )}
            </Descriptions>

	            <Card title="Error Details" size="small">
	              <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
	                <div>
	                  <Text strong>Category: </Text>
	                  {getCategoryTag(selectedEntry.error.category)}
	                </div>
                <div>
                  <Text strong>Code: </Text>
                  <Text code>{selectedEntry.error.code}</Text>
                </div>
                <div>
                  <Text strong>Message: </Text>
                  <Text type="danger">{selectedEntry.error.message}</Text>
                </div>
                {selectedEntry.error.statusCode && (
                  <div>
                    <Text strong>HTTP Status: </Text>
                    <Tag>{selectedEntry.error.statusCode}</Tag>
                  </div>
                )}
                {selectedEntry.error.stack && (
                  <div>
                    <Text strong>Stack Trace:</Text>
                    <pre
                      className="clamped-code-block"
                      style={{
                      background: colors.neutral[900],
                      color: colors.neutral[100],
                      padding: spacing[2],
                      borderRadius: 4,
                      fontSize: 10,
                      maxHeight: 200,
                      overflow: 'auto'
                    }}
                    >
                      {selectedEntry.error.stack}
                    </pre>
                  </div>
                )}
              </Space>
            </Card>

            <Card title="Original Payload" size="small">
              <pre
                className="clamped-code-block"
                style={{
                background: colors.neutral[50],
                padding: spacing[2],
                borderRadius: 4,
                fontSize: 11,
                maxHeight: 400,
                overflow: 'auto'
                }}
              >
                {JSON.stringify(selectedEntry.payload, null, 2)}
              </pre>
            </Card>

            {selectedEntry.status !== 'resolved' && selectedEntry.status !== 'abandoned' && (
              <Space>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={() => handleRetry(selectedEntry.dlqId)}
                >
                  Retry Now
                </Button>
                <Popconfirm
                  title="Abandon this entry?"
                  description="This action cannot be undone"
                  onConfirm={() => handleAbandon(selectedEntry.dlqId)}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button danger icon={<StopOutlined />}>
                    Abandon
                  </Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        )}
      </Drawer>

      {/* Trace Viewer */}
      {selectedTraceId && (
        <TraceViewer
          traceId={selectedTraceId}
          open={traceViewerOpen}
          onClose={() => {
            setTraceViewerOpen(false);
            setSelectedTraceId(null);
          }}
        />
      )}

      {/* AI Error Analysis Modal */}
      <Modal
        title={<Space><RobotOutlined />AI Error Analysis</Space>}
        open={aiModalOpen}
        onCancel={() => setAiModalOpen(false)}
        footer={<Button onClick={() => setAiModalOpen(false)}>Close</Button>}
        width={600}
      >
        {aiLoading && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">Analyzing error...</Text>
            </div>
          </div>
        )}
        {aiError && (
          <Alert type="error" message="Analysis failed" description={aiError} showIcon />
        )}
        {aiResult && !aiLoading && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={aiResult.severity === 'high' ? 'error' : aiResult.severity === 'medium' ? 'warning' : 'info'}
              message={
                <Space>
                  <Tag color={aiResult.severity === 'high' ? 'red' : aiResult.severity === 'medium' ? 'orange' : 'blue'}>
                    {aiResult.severity?.toUpperCase()}
                  </Tag>
                  {aiResult.rootCause}
                </Space>
              }
              showIcon
            />
            <div>
              <Text strong>Explanation</Text>
              <div style={{ marginTop: 8 }}><Text>{aiResult.explanation}</Text></div>
            </div>
            <div>
              <Text strong>Suggested Fix</Text>
              <div style={{ marginTop: 8 }}><Text>{aiResult.suggestedFix}</Text></div>
            </div>
            {aiResult.codeChange && (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Code Change</Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(aiResult!.codeChange!);
                      message.success('Copied');
                    }}
                  >
                    Copy
                  </Button>
                </Space>
                <pre style={{ background: 'rgba(0,0,0,0.04)', padding: '12px 16px', borderRadius: 6, fontSize: 12, overflow: 'auto', margin: 0 }}>
                  {aiResult.codeChange}
                </pre>
              </div>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};
