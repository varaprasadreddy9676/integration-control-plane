import { useState } from 'react';
import { Card, Descriptions, Space, Tag, Collapse, Typography, Button, message, Timeline, Divider, Skeleton, Modal, Alert, Spin } from 'antd';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CopyOutlined, ReloadOutlined, ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, LoadingOutlined, RobotOutlined } from '@ant-design/icons';
import { PageHeader } from '../../../components/common/PageHeader';
import { getLogById, getIntegrationById } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens, spacingToNumber, withAlpha } from '../../../design-system/utils';
import { DeliveryAttempt } from '../../../mocks/types';
import { checkAIStatus, diagnoseLogFix, applyLogFix, type DiagnoseLogFixResult } from '../../../services/ai-api';
import { useTenant } from '../../../app/tenant-context';

const { Panel } = Collapse;
const { Text, Title } = Typography;

export const LogDetailRoute = () => {
  const { spacing, token, colors, borderRadius } = useDesignTokens();
  const { id } = useParams();
  const navigate = useNavigate();
  const { orgId } = useTenant();
  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status', orgId],
    queryFn: () => checkAIStatus(orgId!),
    enabled: !!orgId,
    staleTime: 30_000
  });
  const isAIAvailable = !!aiStatus?.available;
  const [aiAnalysisOpen, setAiAnalysisOpen] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<DiagnoseLogFixResult | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [aiApplyLoading, setAiApplyLoading] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);

  const handleAnalyzeWithAI = async () => {
    if (!orgId || !id || !data?.errorMessage) return;
    setAiAnalysisOpen(true);
    setAiAnalysisLoading(true);
    setAiAnalysisResult(null);
    setAiAnalysisError(null);
    try {
      const result = await diagnoseLogFix(orgId, {
        logId: id,
        integrationId: integration?.id
      });
      setAiAnalysisResult(result);
    } catch (err: any) {
      setAiAnalysisError(err.message || 'AI analysis failed');
    } finally {
      setAiAnalysisLoading(false);
    }
  };
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['log', id],
    queryFn: () => (id ? getLogById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id)
  });

  const handleApplyFix = async () => {
    if (!orgId || !id || !aiAnalysisResult?.patchable) return;

    try {
      setAiApplyLoading(true);
      await applyLogFix(orgId, {
        logId: id,
        integrationId: aiAnalysisResult.integrationId || undefined,
        codeChange: aiAnalysisResult.patch?.script?.after,
        scriptPath: aiAnalysisResult.patch?.script?.path,
        configPatch: aiAnalysisResult.patch?.config?.patch || undefined
      });
      message.success('AI fix applied successfully');
      await refetch();
      setAiAnalysisOpen(false);
    } catch (err: any) {
      message.error(err.message || 'Failed to apply AI fix');
    } finally {
      setAiApplyLoading(false);
    }
  };

  // Use integration configuration from the log response (no separate API call needed)
  const integration = data?.__KEEP_integrationConfig__;
  const responseStatus = data?.responseStatus;
  const hasResponseStatus = typeof responseStatus === 'number';
  const responseOk = hasResponseStatus && responseStatus >= 200 && responseStatus < 300;
  const metadata = data?.metadata;
  const dataFetched = metadata?.dataFetched;
  const transformedPayload = metadata?.transformedPayload;
  const curlCommand = metadata?.curlCommand;
  const hasDataFetched = dataFetched !== undefined && dataFetched !== null;
  const hasTransformedPayload = transformedPayload !== undefined && transformedPayload !== null;
  const hasCurlCommand = Boolean(curlCommand);

  // Headers added by browsers/Postman that are not relevant for reproduction
  const SKIP_HEADERS = new Set([
    'user-agent', 'accept', 'postman-token', 'host',
    'accept-encoding', 'connection', 'content-length', 'accept-language'
  ]);

  // Generate curl command using actual request headers (unredacted for debugging)
  const generateCurlCommand = (config: any, payload: any, requestHeaders?: any, direction?: string) => {
    if (!payload) return '';

    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

    let targetUrl: string;
    let httpMethod: string;

    if (direction === 'INBOUND') {
      // For inbound requests, reconstruct the gateway endpoint URL
      targetUrl = `${apiBase}/integrations/${config?.type || 'integration'}?orgId=${orgId}`;
      httpMethod = 'POST';
    } else {
      targetUrl = config?.targetUrl || '';
      httpMethod = config?.httpMethod || 'POST';
    }

    let curl = `curl --location '${targetUrl}'`;

    if (requestHeaders && typeof requestHeaders === 'object') {
      Object.entries(requestHeaders).forEach(([key, value]) => {
        if (!SKIP_HEADERS.has(key.toLowerCase())) {
          curl += ` \\\n  --header '${key}: ${value}'`;
        }
      });
    } else if (config) {
      curl += ` \\\n  --header 'Content-Type: application/json'`;

      if (config.outgoingAuthType === 'API_KEY' && config.outgoingAuthConfig) {
        const headerName = config.outgoingAuthConfig.headerName || 'X-API-Key';
        const value = config.outgoingAuthConfig.value || '[REDACTED]';
        curl += ` \\\n  --header '${headerName}: ${value.substring(0, 8)}...'`;
      } else if (config.outgoingAuthType === 'BEARER' && config.outgoingAuthConfig) {
        curl += ` \\\n  --header 'Authorization: Bearer ${(config.outgoingAuthConfig.value || '[REDACTED]').substring(0, 12)}...'`;
      } else if (config.outgoingAuthType === 'BASIC' && config.outgoingAuthConfig) {
        curl += ` \\\n  --header 'Authorization: Basic [REDACTED]'`;
      }
    }

    curl += ` \\\n  --data-raw '${JSON.stringify(payload, null, 2)}'`;

    return curl;
  };

  const formatResponseBody = (body: any): string => {
    if (body === null || body === undefined) return '';
    if (typeof body === 'string') return body;
    return JSON.stringify(body, null, 2);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('Copied to clipboard');
    }).catch(() => {
      message.error('Failed to copy');
    });
  };

  // Helper functions for retry attempts
  const getAttemptIcon = (attempt: DeliveryAttempt) => {
    switch (attempt.status) {
      case 'SUCCESS':
        return <CheckCircleOutlined style={{ color: colors.success[600] }} />;
      case 'FAILED':
        return <ExclamationCircleOutlined style={{ color: colors.error[600] }} />;
      case 'RETRYING':
        return <LoadingOutlined style={{ color: colors.warning[600] }} />;
      default:
        return <ClockCircleOutlined style={{ color: colors.info[600] }} />;
    }
  };

  const getAttemptColor = (attempt: DeliveryAttempt) => {
    switch (attempt.status) {
      case 'SUCCESS':
        return colors.success[600];
      case 'FAILED':
        return colors.error[600];
      case 'RETRYING':
        return colors.warning[600];
      default:
        return colors.info[600];
    }
  };

  const generateCurlCommandForAttempt = (attempt: DeliveryAttempt, __KEEP_integrationConfig__?: any) => {
    const targetUrl = attempt.targetUrl || __KEEP_integrationConfig__?.targetUrl;
    const httpMethod = attempt.httpMethod || __KEEP_integrationConfig__?.httpMethod || 'POST';

    if (!targetUrl || !attempt.requestPayload) return '';

    let curl = `curl -X ${httpMethod} "${targetUrl}"`;

    // If we have actual request headers from the attempt, use them (UNREDACTED for debugging)
    if (attempt.requestHeaders && typeof attempt.requestHeaders === 'object') {
      Object.entries(attempt.requestHeaders).forEach(([key, value]) => {
        // Add ALL headers exactly as they were sent (including auth headers)
        curl += ` \\\n  -H "${key}: ${value}"`;
      });
    } else {
      // Fallback: Reconstruct from integration config (redacted for security)
      curl += ` \\\n  -H "Content-Type: application/json"`;

      if (__KEEP_integrationConfig__?.outgoingAuthType === 'API_KEY' && __KEEP_integrationConfig__.outgoingAuthConfig) {
        const headerName = __KEEP_integrationConfig__.outgoingAuthConfig.headerName || 'X-API-Key';
        const value = __KEEP_integrationConfig__.outgoingAuthConfig.value || '[REDACTED]';
        curl += ` \\\n  -H "${headerName}: ${value.substring(0, 8)}..."`;
      } else if (__KEEP_integrationConfig__?.outgoingAuthType === 'BEARER' && __KEEP_integrationConfig__.outgoingAuthConfig) {
        curl += ` \\\n  -H "Authorization: Bearer ${(__KEEP_integrationConfig__.outgoingAuthConfig.value || '[REDACTED]').substring(0, 12)}..."`;
      } else if (__KEEP_integrationConfig__?.outgoingAuthType === 'BASIC' && __KEEP_integrationConfig__.outgoingAuthConfig) {
        curl += ` \\\n  -H "Authorization: Basic [REDACTED]"`;
      }
    }

    curl += ` \\\n  -d '${JSON.stringify(attempt.requestPayload, null, 2)}'`;

    return curl;
  };

  const AttemptTimelineItem = ({ attempt, __KEEP_integrationConfig__ }: { attempt: DeliveryAttempt; __KEEP_integrationConfig__?: any }) => (
    <Timeline.Item
      dot={getAttemptIcon(attempt)}
      color={attempt.status === 'SUCCESS' ? 'green' : attempt.status === 'FAILED' ? 'red' : 'blue'}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Title level={5} style={{ margin: 0, color: getAttemptColor(attempt) }}>
              Attempt {attempt.attemptNumber}
            </Title>
            <Tag color={attempt.status === 'SUCCESS' ? 'success' : attempt.status === 'FAILED' ? 'error' : 'processing'}>
              {attempt.status}
            </Tag>
          </Space>
          <Text type="secondary">{formatDateTime(attempt.attemptedAt)}</Text>
        </div>

        {attempt.retryReason && (
          <Text type="secondary" style={{ fontStyle: 'italic' }}>
            Reason: {attempt.retryReason}
          </Text>
        )}

        <Descriptions size="small" column={3} bordered>
          {attempt.responseStatus && (
            <Descriptions.Item label="HTTP Status">
              <Tag color={attempt.responseStatus >= 200 && attempt.responseStatus < 300 ? 'green' : 'red'}>
                {attempt.responseStatus}
              </Tag>
            </Descriptions.Item>
          )}
          {attempt.responseTimeMs && (
            <Descriptions.Item label="Response Time">{attempt.responseTimeMs} ms</Descriptions.Item>
          )}
          <Descriptions.Item label="Target">
            <Text code style={{ fontSize: '11px' }}>{attempt.targetUrl}</Text>
          </Descriptions.Item>
        </Descriptions>

        {attempt.errorMessage && (
          <div style={{ marginTop: spacing[1] }}>
            <Text type="danger" strong>Error:</Text>
            <Text code style={{ display: 'block', marginTop: spacing[0.5], fontSize: '12px' }}>
              {attempt.errorMessage}
            </Text>
          </div>
        )}

        <Collapse size="small" ghost>
          <Panel
            header={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>Request Details</Text>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__));
                  }}
                >
                  Copy cURL
                </Button>
              </div>
            }
            key="request"
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <Text strong>cURL Command:</Text>
                <div style={{ position: 'relative' }}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__))}
                    style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                  />
                  <pre
                    style={{
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: spacing[2],
                      paddingRight: spacing[5],
                      borderRadius: token.borderRadiusLG,
                      fontSize: '11px',
                      lineHeight: '1.4',
                      maxHeight: '150px',
                      overflow: 'auto',
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      marginTop: spacing[1]
                    }}
                  >
                    {generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__)}
                  </pre>
                </div>
              </div>

              <div>
                <Space>
                  <Text strong>Request Payload:</Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(JSON.stringify(attempt.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </Space>
                <pre
                  style={{
                    background: withAlpha(token.colorTextBase, 0.06),
                    color: token.colorText,
                    padding: spacing[2],
                    borderRadius: token.borderRadiusLG,
                    fontSize: '11px',
                    lineHeight: '1.4',
                    maxHeight: '150px',
                    overflow: 'auto',
                    marginTop: spacing[1]
                  }}
                >
                  {JSON.stringify(attempt.requestPayload, null, 2)}
                </pre>
              </div>
            </Space>
          </Panel>

          <Panel
            header={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>Response Details</Text>
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(formatResponseBody(attempt.responseBody));
                    }}
                  >
                    Copy Response
                  </Button>
                )}
              </div>
            }
            key="response"
          >
            <div>
              <Text strong>Response Body:</Text>
              <div style={{ position: 'relative' }}>
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(formatResponseBody(attempt.responseBody))}
                    style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                  />
                )}
                <pre
                  style={{
                    background: withAlpha(token.colorTextBase, 0.04),
                    color: token.colorText,
                    padding: spacing[2],
                    paddingRight: attempt.responseBody ? spacing[5] : spacing[2],
                    borderRadius: token.borderRadiusLG,
                    fontSize: '11px',
                    lineHeight: '1.4',
                    maxHeight: '150px',
                    overflow: 'auto',
                    marginTop: spacing[1]
                  }}
                >
                  {formatResponseBody(attempt.responseBody) || 'No response captured'}
                </pre>
              </div>
            </div>
          </Panel>
        </Collapse>
      </Space>
    </Timeline.Item>
  );

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5']
  });

  return (
    <div>
      <PageHeader
        title="Delivery log"
        breadcrumb={[
          { label: 'Logs', path: '/logs' },
          { label: id ?? '' }
        ]}
        compact
        actions={<Link to="/logs">Back to logs</Link>}
      />
      {isLoading || !data ? (
        <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[3])}>
          <Card title="Overview" size="small">
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
          <Card title="Integration Configuration" size="small">
            <Skeleton active paragraph={{ rows: 5 }} />
          </Card>
          <Card title="Delivery Timeline" size="small">
            <Skeleton active paragraph={{ rows: 7 }} />
          </Card>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[3])}>
          {/* Overview Card */}
          <Card title="Overview" size="small">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Integration">{data.__KEEP_integrationName__}</Descriptions.Item>
              <Descriptions.Item label="Event type">{data.eventType}</Descriptions.Item>
              <Descriptions.Item label="Flow">
                {data.direction === 'OUTBOUND' && data.triggerType === 'SCHEDULED'
                  ? 'SCHEDULED'
                  : (data.direction || 'OUTBOUND')}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <span
                  style={tagTone(
                    data.status === 'SUCCESS'
                      ? colors.success[600]
                      : data.status === 'FAILED'
                        ? colors.error[600]
                        : data.status === 'RETRYING'
                          ? colors.warning[600]
                          : colors.info[600]
                  )}
                >
                  {data.status}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Attempt Count">
                <Tag color={data.attemptCount > 1 ? 'orange' : 'blue'}>
                  {data.attemptCount} {data.attemptCount === 1 ? 'attempt' : 'attempts'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDateTime(data.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Response status">
                {hasResponseStatus ? (
                  <Tag color={responseOk ? 'green' : 'red'}>
                    {responseStatus}
                  </Tag>
                ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Response time">
                {data.responseTimeMs ? `${data.responseTimeMs} ms` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Error Message">
                {data.errorMessage ? (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text type="danger">{data.errorMessage}</Text>
                    {isAIAvailable && (
                      <Button
                        size="small"
                        icon={<RobotOutlined />}
                        onClick={handleAnalyzeWithAI}
                      >
                        Analyze with AI
                      </Button>
                    )}
                  </Space>
                ) : '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* AI Analysis Modal */}
          <Modal
            title={<Space><RobotOutlined />AI Error Analysis</Space>}
            open={aiAnalysisOpen}
            onCancel={() => setAiAnalysisOpen(false)}
            footer={
              <Space>
                <Button onClick={() => setAiAnalysisOpen(false)}>Close</Button>
                {aiAnalysisResult?.patchable && (
                  <Button
                    type="primary"
                    loading={aiApplyLoading}
                    onClick={handleApplyFix}
                  >
                    Apply Suggested Fix
                  </Button>
                )}
              </Space>
            }
            width={600}
          >
            {aiAnalysisLoading && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin size="large" />
                <div style={{ marginTop: 16 }}>
                  <Text type="secondary">Analyzing error...</Text>
                </div>
              </div>
            )}
            {aiAnalysisError && (
              <Alert type="error" message="Analysis failed" description={aiAnalysisError} showIcon />
            )}
            {aiAnalysisResult && (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {(() => {
                  const sev = aiAnalysisResult.analysis.severity;
                  const isHigh = sev === 'critical' || sev === 'high';
                  const tone = isHigh ? 'error' : sev === 'medium' ? 'warning' : 'info';
                  const tagColor = isHigh ? 'red' : sev === 'medium' ? 'orange' : 'blue';
                  return (
                <Alert
                  type={tone as any}
                  message={<><Tag color={tagColor}>{aiAnalysisResult.analysis.severity?.toUpperCase()}</Tag> {aiAnalysisResult.analysis.rootCause}</>}
                  showIcon
                />
                  );
                })()}
                <div>
                  <Text strong>Explanation</Text>
                  <div style={{ marginTop: 8 }}>
                    <Text>{aiAnalysisResult.analysis.explanation}</Text>
                  </div>
                </div>
                <div>
                  <Text strong>Suggested Fix</Text>
                  <div style={{ marginTop: 8 }}>
                    <Text>{aiAnalysisResult.analysis.suggestedFix}</Text>
                  </div>
                </div>
                {aiAnalysisResult.patch?.script?.diff && (
                  <div>
                    <Space style={{ marginBottom: 8 }}>
                      <Text strong>Script Diff</Text>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          navigator.clipboard.writeText(aiAnalysisResult.patch!.script!.diff);
                          message.success('Copied to clipboard');
                        }}
                      >
                        Copy Diff
                      </Button>
                    </Space>
                    <pre style={{ background: 'rgba(0,0,0,0.04)', padding: '12px 16px', borderRadius: 6, fontSize: 12, overflow: 'auto', margin: 0 }}>
                      {aiAnalysisResult.patch.script.diff}
                    </pre>
                  </div>
                )}
                {aiAnalysisResult.patch?.config?.changes?.length ? (
                  <div>
                    <Text strong>Config Diff</Text>
                    <div style={{ marginTop: 8 }}>
                      {aiAnalysisResult.patch.config.changes.map((change) => (
                        <div key={change.path} style={{ marginBottom: 8 }}>
                          <Tag color="blue">{change.path}</Tag>
                          <Text type="secondary"> from </Text>
                          <Text code>{JSON.stringify(change.before)}</Text>
                          <Text type="secondary"> to </Text>
                          <Text code>{JSON.stringify(change.after)}</Text>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!aiAnalysisResult.patchable && (
                  <Alert
                    type="info"
                    showIcon
                    message="No safe auto-patch detected"
                    description="AI analysis is available, but no script/config patch was produced for one-click apply."
                  />
                )}
              </Space>
            )}
          </Modal>

          {/* Integration Configuration Details */}
          {integration && (
            <Card
              title="Integration Configuration"
              size="small"
              extra={
                <Button
                  type="link"
                  icon={<ReloadOutlined />}
                  onClick={() => navigate(`/integrations/${integration.id}`)}
                >
                  View Integration
                </Button>
              }
            >
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Target URL">{integration.targetUrl}</Descriptions.Item>
                <Descriptions.Item label="HTTP Method">
                  <Tag color="blue">{integration.httpMethod}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Authentication">
                  <Tag color={integration.outgoingAuthType === 'NONE' ? 'green' : 'orange'}>
                    {integration.outgoingAuthType}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Timeout">{integration.timeoutMs} ms</Descriptions.Item>
                <Descriptions.Item label="Max Retries">{integration.retryCount}</Descriptions.Item>
                <Descriptions.Item label="Active">
                  <Tag color={integration.isActive ? 'green' : 'red'}>
                    {integration.isActive ? 'Yes' : 'No'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* Scheduled Job Execution Details */}
          {(data.direction === 'SCHEDULED' || data.triggerType === 'SCHEDULE') && metadata && (
            <Card title="Scheduled Job Execution Flow" size="small">
              <Timeline>
                {metadata.recordsFetched !== undefined && (
                  <Timeline.Item color="blue" dot={<CheckCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>Step 1: Data Fetched from Source</Text>
                      <Text type="secondary">
                        Retrieved {metadata.recordsFetched} record(s) from data source
                      </Text>
                      {hasDataFetched && (
                        <Collapse size="small" ghost>
                          <Panel header={<Text strong>View Data</Text>} key="dataFetched">
                            <div style={{ position: 'relative' }}>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => copyToClipboard(JSON.stringify(dataFetched, null, 2))}
                                style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                              />
                              <pre
                                style={{
                                  background: withAlpha(token.colorTextBase, 0.06),
                                  color: token.colorText,
                                  padding: spacing[2],
                                  paddingRight: spacing[5],
                                  borderRadius: token.borderRadiusLG,
                                  fontSize: '11px',
                                  lineHeight: '1.4',
                                  maxHeight: '200px',
                                  overflow: 'auto',
                                  marginTop: spacing[1]
                                }}
                              >
                                {JSON.stringify(dataFetched, null, 2)}
                              </pre>
                            </div>
                          </Panel>
                        </Collapse>
                      )}
                    </Space>
                  </Timeline.Item>
                )}

                {hasTransformedPayload && (
                  <Timeline.Item color="green" dot={<CheckCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>Step 2: Data Transformed</Text>
                      <Text type="secondary">
                        Applied transformation script to prepare payload for delivery
                      </Text>
                      <Collapse size="small" ghost>
                        <Panel header={<Text strong>View Transformed Payload</Text>} key="transformed">
                          <div style={{ position: 'relative' }}>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(JSON.stringify(transformedPayload, null, 2))}
                              style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                            />
                            <pre
                              style={{
                                background: withAlpha(token.colorTextBase, 0.06),
                                color: token.colorText,
                                padding: spacing[2],
                                paddingRight: spacing[5],
                                borderRadius: token.borderRadiusLG,
                                fontSize: '11px',
                                lineHeight: '1.4',
                                maxHeight: '200px',
                                overflow: 'auto',
                                marginTop: spacing[1]
                              }}
                            >
                              {JSON.stringify(transformedPayload, null, 2)}
                            </pre>
                          </div>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {metadata.httpRequest && (
                  <Timeline.Item
                    color={responseOk ? 'green' : 'red'}
                    dot={responseOk ?
                      <CheckCircleOutlined style={{ fontSize: '16px' }} /> :
                      <ExclamationCircleOutlined style={{ fontSize: '16px' }} />
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>Step 3: HTTP Request Sent</Text>
                      <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="Method">
                          <Tag color="blue">{metadata.httpRequest.method}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="URL">
                          <Text code style={{ fontSize: '11px' }}>{metadata.httpRequest.url}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Response Status">
                          <Tag color={responseOk ? 'green' : 'red'}>
                            {hasResponseStatus ? responseStatus : 'N/A'}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Response Time">
                          {data.responseTimeMs ? `${data.responseTimeMs} ms` : 'N/A'}
                        </Descriptions.Item>
                      </Descriptions>

                      <Collapse size="small" ghost>
                        {hasCurlCommand && (
                          <Panel
                            header={
                              <Space>
                                <Text strong>cURL Command</Text>
                                <Button
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(curlCommand || '');
                                  }}
                                >
                                  Copy
                                </Button>
                              </Space>
                            }
                            key="curl"
                          >
                            <pre
                              style={{
                                background: '#1e1e1e',
                                color: '#d4d4d4',
                                padding: spacing[2],
                                borderRadius: token.borderRadiusLG,
                                fontSize: '11px',
                                lineHeight: '1.4',
                                maxHeight: '200px',
                                overflow: 'auto',
                                fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                              }}
                            >
                              {curlCommand}
                            </pre>
                          </Panel>
                        )}
                        <Panel header={<Text strong>Request Headers</Text>} key="headers">
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.06),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '150px',
                              overflow: 'auto'
                            }}
                          >
                            {JSON.stringify(metadata.httpRequest.headers, null, 2)}
                          </pre>
                        </Panel>
                        <Panel header={<Text strong>Request Body</Text>} key="body">
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.06),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '200px',
                              overflow: 'auto'
                            }}
                          >
                            {JSON.stringify(metadata.httpRequest.body, null, 2)}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.responseBody && (
                  <Timeline.Item color={responseOk ? 'green' : 'red'}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>Step 4: Response Received</Text>
                      <Collapse size="small" ghost>
                        <Panel
                          header={
                            <Space>
                              <Text strong>View Response</Text>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(formatResponseBody(data.responseBody));
                                }}
                              >
                                Copy
                              </Button>
                            </Space>
                          }
                          key="response"
                        >
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.04),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '200px',
                              overflow: 'auto'
                            }}
                          >
                            {formatResponseBody(data.responseBody) || 'No response captured'}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.errorMessage && (
                  <Timeline.Item color="red" dot={<ExclamationCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px', color: colors.error[600] }}>Error Occurred</Text>
                      <div style={{
                        background: withAlpha(colors.error[100], 0.3),
                        padding: spacing[2],
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${colors.error[300]}`
                      }}>
                        <Text type="danger">{data.errorMessage}</Text>
                        {metadata.errorContext && (
                          <div style={{ marginTop: spacing[2] }}>
                            <Text type="secondary" style={{ display: 'block' }}>
                              Failed at stage: <Tag color="red">{metadata.errorContext.stage}</Tag>
                            </Text>
                          </div>
                        )}
                      </div>
                    </Space>
                  </Timeline.Item>
                )}
              </Timeline>
            </Card>
          )}

          {/* Request & Response Details */}
          <Collapse>
            <Panel
              header={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Title level={5} style={{ margin: 0 }}>Request Details</Title>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </div>
              }
              key="request"
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Title level={5}>Request Payload</Title>
                  <div style={{ position: 'relative' }}>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                      style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                    />
                    <pre
                      className="clamped-code-block"
                      style={{
                        background: withAlpha(token.colorTextBase, 0.06),
                        color: token.colorText,
                        padding: spacing[3],
                        paddingRight: spacing[5],
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        fontSize: '12px',
                        lineHeight: '1.5',
                        maxHeight: '300px',
                        overflow: 'auto'
                      }}
                    >
                      {JSON.stringify(data.requestPayload, null, 2)}
                    </pre>
                  </div>
                </div>

                {integration && data.direction === 'COMMUNICATION' ? (
                  <div>
                    <Title level={5}>Email Test cURL</Title>
                    <div style={{ position: 'relative' }}>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          const payload = data.requestPayload as any;
                          const smtpConfig = integration?.actions?.[data.actionIndex ?? 0]?.communicationConfig?.smtp;
                          const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
                          const integrationSlug = integration?.type || 'EMAIL';
                          const toVal = Array.isArray(payload?.to) ? payload.to.join(', ') : (payload?.to || 'recipient@example.com');
                          const subjectVal = payload?.subject || 'Test Email';
                          const htmlVal = payload?.html || '<h1>Test</h1><p>This is a test email.</p>';
                          const bodyObj: any = { to: toVal, subject: subjectVal, html: htmlVal };
                          if (payload?.text) bodyObj.text = payload.text;
                          bodyObj.attachments = [
                            {
                              filename: 'document.pdf',
                              content: '<BASE64_ENCODED_PDF>',
                              encoding: 'base64',
                              contentType: 'application/pdf'
                            }
                          ];
                          const curl = [
                            `# From: ${smtpConfig?.fromEmail || 'SMTP'} → To: ${toVal}`,
                            `# Host: ${smtpConfig?.host || ''}:${smtpConfig?.port || ''}`,
                            `# Remove the "attachments" block if no PDF is needed`,
                            ``,
                            `curl --location '${apiBase}/integrations/${integrationSlug}?orgId=${orgId}' \\`,
                            `  --header 'X-API-Key: YOUR_API_KEY' \\`,
                            `  --header 'Content-Type: application/json' \\`,
                            `  --data-raw '${JSON.stringify(bodyObj, null, 2)}'`,
                          ].join('\n');
                          copyToClipboard(curl);
                        }}
                        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                      >
                        Copy cURL
                      </Button>
                      <pre
                        className="clamped-code-block"
                        style={{
                          background: '#1e1e1e',
                          color: '#d4d4d4',
                          padding: spacing[3],
                          borderRadius: token.borderRadiusLG,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          fontSize: '12px',
                          lineHeight: '1.5',
                          maxHeight: '300px',
                          overflow: 'auto',
                          fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                        }}
                      >
                        {(() => {
                          const payload = data.requestPayload as any;
                          const smtpConfig = integration?.actions?.[data.actionIndex ?? 0]?.communicationConfig?.smtp;
                          const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
                          const integrationSlug = integration?.type || 'EMAIL';
                          const toVal = Array.isArray(payload?.to) ? payload.to.join(', ') : (payload?.to || 'recipient@example.com');
                          const subjectVal = payload?.subject || 'Test Email';
                          const htmlVal = payload?.html || '<h1>Test</h1><p>This is a test email.</p>';
                          const bodyObj: any = { to: toVal, subject: subjectVal, html: htmlVal };
                          if (payload?.text) bodyObj.text = payload.text;
                          bodyObj.attachments = [
                            {
                              filename: 'document.pdf',
                              content: '<BASE64_ENCODED_PDF>',
                              encoding: 'base64',
                              contentType: 'application/pdf'
                            }
                          ];
                          return [
                            `# From: ${smtpConfig?.fromEmail || 'SMTP'} → To: ${toVal}`,
                            `# Host: ${smtpConfig?.host || ''}:${smtpConfig?.port || ''}`,
                            `# Remove the "attachments" block if no PDF is needed`,
                            ``,
                            `curl --location '${apiBase}/integrations/${integrationSlug}?orgId=${orgId}' \\`,
                            `  --header 'X-API-Key: YOUR_API_KEY' \\`,
                            `  --header 'Content-Type: application/json' \\`,
                            `  --data-raw '${JSON.stringify(bodyObj, null, 2)}'`,
                          ].join('\n');
                        })()}
                      </pre>
                    </div>
                  </div>
                ) : integration && (
                  <div>
                    <Title level={5}>cURL Command</Title>
                    <div style={{ position: 'relative' }}>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyToClipboard(generateCurlCommand(integration, data.requestPayload, data.requestHeaders, data.direction))}
                        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                      >
                        Copy cURL
                      </Button>
                      <pre
                        className="clamped-code-block"
                        style={{
                          background: '#1e1e1e',
                          color: '#d4d4d4',
                          padding: spacing[3],
                          borderRadius: token.borderRadiusLG,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          fontSize: '12px',
                          lineHeight: '1.5',
                          maxHeight: '200px',
                          overflow: 'auto',
                          fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                        }}
                      >
                        {generateCurlCommand(integration, data.requestPayload, data.requestHeaders, data.direction)}
                      </pre>
                    </div>
                  </div>
                )}
              </Space>
            </Panel>

            <Panel
              header={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Title level={5} style={{ margin: 0 }}>Response Details</Title>
                  {data.responseBody && (
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                    >
                      Copy Response
                    </Button>
                  )}
                </div>
              }
              key="response"
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Descriptions column={1} bordered size="small">
                  {hasResponseStatus && (
                    <Descriptions.Item label="HTTP Status">
                      <Tag color={responseOk ? 'green' : 'red'}>
                        {responseStatus}
                      </Tag>
                    </Descriptions.Item>
                  )}
                  {data.responseTimeMs && (
                    <Descriptions.Item label="Response Time">
                      {data.responseTimeMs} ms
                    </Descriptions.Item>
                  )}
                  {data.errorMessage && (
                    <Descriptions.Item label="Error Message">
                      <Text type="danger" code>{data.errorMessage}</Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <div>
                  <Title level={5}>Response Body</Title>
                  <div style={{ position: 'relative' }}>
                    {data.responseBody && (
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                        style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                      />
                    )}
                    <pre
                      className="clamped-code-block"
                      style={{
                        background: withAlpha(token.colorTextBase, 0.04),
                        color: token.colorText,
                        padding: spacing[3],
                        paddingRight: data.responseBody ? spacing[5] : spacing[3],
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        fontSize: '12px',
                        lineHeight: '1.5',
                        maxHeight: '300px',
                        overflow: 'auto'
                      }}
                    >
                      {formatResponseBody(data.responseBody) || 'No response captured'}
                    </pre>
                  </div>
                </div>
              </Space>
            </Panel>

            {/* Detailed Retry Timeline */}
            {data.retryAttempts && data.retryAttempts.length > 0 && (
              <Panel
                header={
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <Title level={5} style={{ margin: 0 }}>Delivery Attempts Timeline</Title>
                    <Tag color="blue">{data.retryAttempts.length} attempts</Tag>
                    <Tag color={data.status === 'SUCCESS' ? 'success' : data.status === 'FAILED' ? 'error' : 'processing'}>
                      Final: {data.status}
                    </Tag>
                  </div>
                }
                key="retry-timeline"
              >
                <div style={{ background: withAlpha(colors.info[100], 0.3), padding: spacing[3], borderRadius: token.borderRadiusLG, marginBottom: spacing[3] }}>
                  <Space direction="vertical" size="small">
                    <Text strong>Delivery Summary:</Text>
                    <Space split={<Divider type="vertical" />}>
                      <Text>Total Attempts: <Tag color="blue">{data.attemptCount}</Tag></Text>
                      <Text>Duration: {data.retryAttempts.length > 1 ?
                        `${Math.round((new Date(data.retryAttempts[data.retryAttempts.length - 1].attemptedAt).getTime() - new Date(data.retryAttempts[0].attemptedAt).getTime()) / 1000)}s` :
                        'N/A'
                      }</Text>
                      <Text>Final Status: <Tag color={data.status === 'SUCCESS' ? 'success' : 'error'}>{data.status}</Tag></Text>
                    </Space>
                  </Space>
                </div>

                <Timeline
                  mode="left"
                  style={{ marginTop: spacing[3] }}
                  items={data.retryAttempts.map((attempt, index) => ({
                    key: attempt.attemptNumber,
                    children: <AttemptTimelineItem attempt={attempt} __KEEP_integrationConfig__={integration} />
                  }))}
                />
              </Panel>
            )}

            {/* Legacy Retry Information Panel for logs without detailed attempts */}
            {!data.retryAttempts && data.attemptCount > 1 && (
              <Panel
                header={
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <Title level={5} style={{ margin: 0 }}>Retry Information</Title>
                    <Tag color="orange">{data.attemptCount} total attempts</Tag>
                    <Tag color="default">Legacy View</Tag>
                  </div>
                }
                key="retries"
              >
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Total Attempts">
                    <Tag color="orange">{data.attemptCount}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Final Status">
                    <span
                      style={tagTone(
                        data.status === 'SUCCESS'
                          ? colors.success[600]
                          : data.status === 'FAILED'
                            ? colors.error[600]
                            : colors.warning[600]
                      )}
                    >
                      {data.status}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Integration Max Retries">
                    {integration?.retryCount || 'N/A'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Retry Strategy">
                    <Text code>Exponential backoff with jitter</Text>
                  </Descriptions.Item>
                </Descriptions>

                <div style={{ marginTop: spacing[3] }}>
                  <Text type="secondary">
                    <strong>Note:</strong> This log shows aggregated retry information.
                    New logs will include detailed information for each individual attempt with request/response details.
                  </Text>
                </div>
              </Panel>
            )}
          </Collapse>
        </Space>
      )}
    </div>
  );
};
