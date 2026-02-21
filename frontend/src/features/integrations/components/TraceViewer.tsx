import { useState, useEffect } from 'react';
import {
  Modal,
  Timeline,
  Tag,
  Typography,
  Spin,
  Alert,
  Descriptions,
  Tabs,
  Empty,
  Card,
  Space,
  Statistic
} from 'antd';
import type { TabsProps } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { getExecutionLogTimeline, ExecutionLogTimeline } from '../../../services/api';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';

const { Text, Title } = Typography;

interface TraceViewerProps {
  traceId: string;
  open: boolean;
  onClose: () => void;
}

export const TraceViewer = ({ traceId, open, onClose }: TraceViewerProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExecutionLogTimeline | null>(null);

  useEffect(() => {
    if (open && traceId) {
      loadTrace();
    }
  }, [open, traceId]);

  const loadTrace = async () => {
    setLoading(true);
    setError(null);
    try {
      const timeline = await getExecutionLogTimeline(traceId);
      setData(timeline);
    } catch (err: any) {
      setError(err.message || 'Failed to load execution trace');
    } finally {
      setLoading(false);
    }
  };

  const normalizeStatus = (status: string) => (status || '').toString().toUpperCase();

  const getStatusIcon = (status: string) => {
    switch (normalizeStatus(status)) {
      case 'SUCCESS':
        return <CheckCircleOutlined style={{ color: colors.success[500] }} />;
      case 'ERROR':
      case 'FAILED':
      case 'ABANDONED':
        return <CloseCircleOutlined style={{ color: colors.error[500] }} />;
      case 'WARNING':
        return <WarningOutlined style={{ color: colors.warning[500] }} />;
      case 'PENDING':
      case 'RETRYING':
        return <SyncOutlined spin style={{ color: colors.primary[500] }} />;
      default:
        return <ClockCircleOutlined />;
    }
  };

  const getStatusColor = (status: string): string => {
    switch (normalizeStatus(status)) {
      case 'SUCCESS':
        return 'success';
      case 'ERROR':
      case 'FAILED':
      case 'ABANDONED':
        return 'error';
      case 'WARNING':
        return 'warning';
      case 'PENDING':
      case 'RETRYING':
        return 'processing';
      default:
        return 'default';
    }
  };

  const formatDuration = (ms: number | null): string => {
    if (ms === null || ms === undefined) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatStageName = (name: string): string => {
    if (!name) return 'Unknown stage';
    return name
      .replace(/_/g, ' ')
      .replace(/:/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const renderTimeline = () => {
    if (!data) return null;

    const items = data.timeline.map((step, index) => ({
      dot: getStatusIcon(step.status),
      color: normalizeStatus(step.status) === 'SUCCESS' ? 'green' : normalizeStatus(step.status) === 'ERROR' ? 'red' : 'blue',
      children: (
        <div style={{ paddingBottom: spacing[3] }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] }}>
            <Text strong style={{ fontSize: 14 }}>
              {formatStageName(step.name)}
            </Text>
            <Space size="small">
              {step.durationMs !== null && (
                <Tag icon={<ThunderboltOutlined />} color="blue">
                  {formatDuration(step.durationMs)}
                </Tag>
              )}
              <Tag color={getStatusColor(step.status)}>
                {normalizeStatus(step.status)}
              </Tag>
            </Space>
          </div>

          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(step.timestamp).toLocaleString()}
          </Text>

          {step.error && (
            <Alert
              type="error"
              message={step.error.message}
              description={step.error.code ? `Error Code: ${step.error.code}` : undefined}
              style={{ marginTop: spacing[2], fontSize: 12 }}
              showIcon
            />
          )}

          {step.metadata && Object.keys(step.metadata).length > 0 && (
            <Card size="small" style={{ marginTop: spacing[2], background: colors.neutral[50] }}>
              <pre className="clamped-code-block" style={{ margin: 0, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
                {JSON.stringify(step.metadata, null, 2)}
              </pre>
            </Card>
          )}

          {step.response && (
            <Card size="small" style={{ marginTop: spacing[2], background: colors.neutral[50] }}>
              <Space direction="vertical" size={spacingToNumber(spacing[1])} style={{ width: '100%' }}>
                {step.response.statusCode && (
                  <div>
                    <Text strong>Vendor Status: </Text>
                    <Tag color={step.response.statusCode >= 200 && step.response.statusCode < 300 ? 'success' : 'error'}>
                      {step.response.statusCode}
                    </Tag>
                  </div>
                )}
                {step.response.body && (
                  <div>
                    <Text strong>Vendor Response:</Text>
                    <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1], maxHeight: 220, overflow: 'auto' }}>
                      {typeof step.response.body === 'string'
                        ? step.response.body
                        : JSON.stringify(step.response.body, null, 2)}
                    </pre>
                  </div>
                )}
              </Space>
            </Card>
          )}

          {step.gapMs !== null && step.gapMs > 0 && index < data.timeline.length - 1 && (
            <div style={{ marginTop: spacing[2], paddingLeft: spacing[3], borderLeft: `2px dashed ${colors.neutral[300]}` }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                ⏱ Gap: {formatDuration(step.gapMs)}
              </Text>
            </div>
          )}
        </div>
      )
    }));

    return (
      <Timeline
        mode="left"
        items={items}
        style={{ marginTop: spacing[4] }}
      />
    );
  };

  const renderSummary = () => {
    if (!data) return null;

    const { summary } = data;

	    return (
	      <Card style={{ marginBottom: spacing[4] }}>
	        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
	          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
	            <Title level={5} style={{ margin: 0 }}>Execution Summary</Title>
              <Tag color={getStatusColor(summary.status)} icon={getStatusIcon(summary.status)}>
	              {normalizeStatus(summary.status)}
              </Tag>
	          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing[3] }}>
            <Statistic
              title="Total Duration"
              value={formatDuration(summary.totalDuration)}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ fontSize: 18 }}
            />
            <Statistic
              title="Steps Executed"
              value={summary.stepCount}
              valueStyle={{ fontSize: 18 }}
            />
            <Statistic
              title="Direction"
              value={summary.direction || 'N/A'}
              valueStyle={{ fontSize: 18 }}
            />
            <Statistic
              title="Trigger Type"
              value={summary.triggerType || 'N/A'}
              valueStyle={{ fontSize: 18 }}
            />
          </div>

          <Descriptions column={2} size="small">
            <Descriptions.Item label="Trace ID">
              <Text code copyable style={{ fontSize: 12 }}>
                {summary.traceId}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Started At">
              {summary.startedAt ? new Date(summary.startedAt).toLocaleString() : 'N/A'}
            </Descriptions.Item>
            {summary.finishedAt && (
              <Descriptions.Item label="Finished At">
                {new Date(summary.finishedAt).toLocaleString()}
              </Descriptions.Item>
            )}
            {summary.errorStep && (
              <Descriptions.Item label="Failed At Step">
                <Tag color="error">{summary.errorStep}</Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Space>
      </Card>
    );
  };

  const renderRequestResponse = () => {
    if (!data) return null;

    const tabs: NonNullable<TabsProps['items']> = [
      {
        key: 'request',
        label: 'Request',
        children: data.request ? (
          <Card>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              {data.request.url && (
                <div>
                  <Text strong>URL: </Text>
                  <Text code>{data.request.method || 'POST'} {data.request.url}</Text>
                </div>
              )}
              {data.request.headers && Object.keys(data.request.headers).length > 0 && (
                <div>
                  <Text strong>Headers:</Text>
                  <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1] }}>
                    {JSON.stringify(data.request.headers, null, 2)}
                  </pre>
                </div>
              )}
              {data.request.body && (
                <div>
                  <Text strong>Body:</Text>
                  <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1], maxHeight: 400, overflow: 'auto' }}>
                    {typeof data.request.body === 'string'
                      ? data.request.body
                      : JSON.stringify(data.request.body, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>
        ) : (
          <Empty description="No request data available" />
        )
      },
      {
        key: 'response',
        label: 'Response',
        children: data.response ? (
          <Card>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              {data.response.statusCode && (
                <div>
                  <Text strong>Status Code: </Text>
                  <Tag color={data.response.statusCode >= 200 && data.response.statusCode < 300 ? 'success' : 'error'}>
                    {data.response.statusCode}
                  </Tag>
                </div>
              )}
              {data.response.headers && Object.keys(data.response.headers).length > 0 && (
                <div>
                  <Text strong>Headers:</Text>
                  <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1] }}>
                    {JSON.stringify(data.response.headers, null, 2)}
                  </pre>
                </div>
              )}
              {data.response.body && (
                <div>
                  <Text strong>Body:</Text>
                  <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1], maxHeight: 400, overflow: 'auto' }}>
                    {typeof data.response.body === 'string'
                      ? data.response.body
                      : JSON.stringify(data.response.body, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>
        ) : (
          <Empty description="No response data available" />
        )
      }
    ];

    if (data.error) {
      tabs.push({
        key: 'error',
        label: (
          <span>
            <CloseCircleOutlined style={{ marginRight: 4, color: colors.error[500] }} />
            Error Details
          </span>
        ),
        children: (
          <Alert
            type="error"
            message={data.error.message}
            description={
              <div style={{ marginTop: spacing[2] }}>
                {data.error.code && (
                  <div>
                    <Text strong>Error Code: </Text>
                    <Text code>{data.error.code}</Text>
                  </div>
                )}
                {data.error.stack && (
                  <div style={{ marginTop: spacing[2] }}>
                    <Text strong>Stack Trace:</Text>
                    <pre className="clamped-code-block" style={{ background: colors.neutral[900], color: colors.neutral[100], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1], maxHeight: 300, overflow: 'auto' }}>
                      {data.error.stack}
                    </pre>
                  </div>
                )}
              </div>
            }
            showIcon
          />
        )
      });
    }

    if (data.vendorResponses && data.vendorResponses.length > 0) {
      tabs.push({
        key: 'vendor-responses',
        label: 'Vendor Responses',
        children: (
          <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
            {data.vendorResponses.map((response, index) => (
              <Card key={`${response.stage}-${response.timestamp || index}`}>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="Stage">{formatStageName(response.stage)}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <Tag color={getStatusColor(response.status)}>{normalizeStatus(response.status)}</Tag>
                  </Descriptions.Item>
                  {response.timestamp && (
                    <Descriptions.Item label="Timestamp">
                      {new Date(response.timestamp).toLocaleString()}
                    </Descriptions.Item>
                  )}
                  {response.responseStatus !== null && response.responseStatus !== undefined && (
                    <Descriptions.Item label="Vendor HTTP Status">
                      <Tag color={response.responseStatus >= 200 && response.responseStatus < 300 ? 'success' : 'error'}>
                        {response.responseStatus}
                      </Tag>
                    </Descriptions.Item>
                  )}
                  {response.provider && (
                    <Descriptions.Item label="Provider">{response.provider}</Descriptions.Item>
                  )}
                  {response.channel && (
                    <Descriptions.Item label="Channel">{response.channel}</Descriptions.Item>
                  )}
                  {response.messageId && (
                    <Descriptions.Item label="Vendor Message ID">
                      <Text code copyable>{response.messageId}</Text>
                    </Descriptions.Item>
                  )}
                  {response.target && (
                    <Descriptions.Item label="Target">{response.target}</Descriptions.Item>
                  )}
                </Descriptions>
                {response.responseBody && (
                  <div style={{ marginTop: spacing[2] }}>
                    <Text strong>Response Payload:</Text>
                    <pre className="clamped-code-block" style={{ background: colors.neutral[50], padding: spacing[2], borderRadius: 4, fontSize: 11, marginTop: spacing[1], maxHeight: 300, overflow: 'auto' }}>
                      {typeof response.responseBody === 'string'
                        ? response.responseBody
                        : JSON.stringify(response.responseBody, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            ))}
          </Space>
        )
      });
    }

    return <Tabs items={tabs} />;
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <ClockCircleOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
          <span>Execution Trace Viewer</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={1000}
      footer={null}
      style={{ top: 20 }}
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: spacing[5] }}>
          <Spin size="large" />
          <div style={{ marginTop: spacing[3] }}>
            <Text type="secondary">Loading execution trace...</Text>
          </div>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          message="Failed to load trace"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}

      {!loading && !error && data && (
        <div>
          {renderSummary()}

          <Card
            title="Execution Timeline"
            style={{ marginBottom: spacing[4] }}
            bodyStyle={{ maxHeight: 500, overflow: 'auto' }}
          >
            {renderTimeline()}
          </Card>

          {renderRequestResponse()}
        </div>
      )}

      {!loading && !error && !data && (
        <Empty description="No trace data available" />
      )}
    </Modal>
  );
};
