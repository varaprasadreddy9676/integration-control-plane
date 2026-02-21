import { useMemo } from 'react';
import { Drawer, Typography, Space, Tag, Button, Divider, Timeline, Card, Collapse } from 'antd';
import { CopyOutlined, ClockCircleOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { EventAuditRecord } from '../../../mocks/types';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';
import { formatDateTime, formatDateTimeWithSeconds } from '../../../utils/format';
import { useNavigateWithParams, buildUrlWithEntityParentRid } from '../../../utils/navigation';

const { Text, Title } = Typography;

interface EventAuditDrawerProps {
  event: EventAuditRecord | null;
  open: boolean;
  onClose: () => void;
}

const statusColorMap: Record<string, string> = {
  RECEIVED: 'processing',
  PROCESSING: 'processing',
  DELIVERED: 'success',
  SKIPPED: 'warning',
  FAILED: 'error',
  STUCK: 'error'
};

export const EventAuditDrawer = ({ event, open, onClose }: EventAuditDrawerProps) => {
  const { token, themeColors, spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { mode } = useThemeMode();
  const navigate = useNavigateWithParams();

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  const timelineItems = useMemo(() => {
    if (!event?.timeline || event.timeline.length === 0) return [];
    const sorted = [...event.timeline]
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .map((entry, index, all) => {
        const prev = all[index - 1];
        const deltaMs = prev ? (new Date(entry.ts).getTime() - new Date(prev.ts).getTime()) : null;
        return {
          color: entry.stage === 'FAILED' || entry.stage === 'STUCK' ? colors.error[500]
          : entry.stage === 'DELIVERED' ? colors.success[500]
          : entry.stage === 'SKIPPED' ? colors.warning[500]
          : colors.primary[500],
        dot: entry.stage === 'DELIVERED'
          ? <CheckCircleOutlined />
          : entry.stage === 'FAILED' || entry.stage === 'STUCK'
          ? <CloseCircleOutlined />
          : entry.stage === 'SKIPPED'
          ? <WarningOutlined />
          : <ClockCircleOutlined />,
        children: (
          <div
            style={{
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: token.borderRadius,
              border: `1px solid ${cssVar.border.default}`,
              background: withAlpha(colors.neutral[50], 0.8)
            }}
          >
            <Space size={spacingToNumber(spacing[2])} align="center" wrap>
              <Tag
                color={statusColorMap[entry.stage] || 'default'}
                style={{ margin: 0, fontWeight: 700 }}
              >
                {entry.stage}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTimeWithSeconds(entry.ts)}
              </Text>
              {deltaMs !== null && deltaMs >= 0 && (
                <Tag
                  color="default"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    background: withAlpha(colors.neutral[200], 0.5)
                  }}
                >
                  +{formatDuration(deltaMs)}
                </Tag>
              )}
            </Space>
            {entry.details && (
              <Typography.Paragraph
                style={{ marginTop: spacing['1'], fontSize: 12, marginBottom: 0 }}
                ellipsis={{ rows: 2, expandable: true, symbol: 'More' }}
              >
                {entry.details}
              </Typography.Paragraph>
            )}
          </div>
        )
      };
      });
    return sorted;
  }, [event?.timeline, colors, token, spacing]);

  if (!event) return null;

  const delivery = event.deliveryStatus || {};
  const processedAt = event.processedAt || event.processingCompletedAt;

  const handleCopy = (value?: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
  };

  const formatJson = (value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  };

  const hasFullPayload = event.payload !== undefined && event.payload !== null;
  const hasSummaryPayload = Boolean(event.payloadSummary && Object.keys(event.payloadSummary).length > 0);
  const payloadValue = hasFullPayload ? event.payload : hasSummaryPayload ? event.payloadSummary : null;
  const payloadText = payloadValue !== null && payloadValue !== undefined ? formatJson(payloadValue) : '';

  return (
    <Drawer
      title={
        <Space size={spacingToNumber(spacing[2])}>
          <WarningOutlined style={{ color: colors.primary[600] }} />
          <span>Event Audit</span>
        </Space>
      }
      placement="right"
      width={760}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(event.eventId)}
          >
            Copy Event ID
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${cssVar.border.default}`,
            background: mode === 'dark' ? withAlpha(colors.neutral[900], 0.4) : cssVar.bg.surface
          }}
          styles={{ body: { padding: spacing[4] } }}
        >
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[3], flexWrap: 'wrap' }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Event ID</Text>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{event.eventId}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Status</Text>
                <div>
                  <Tag color={statusColorMap[event.status || 'RECEIVED'] || 'default'} style={{ margin: 0 }}>
                    {event.status || 'RECEIVED'}
                  </Tag>
                </div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Event Type</Text>
                <div style={{ fontWeight: 600 }}>{event.eventType || '—'}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Source</Text>
                <div>{event.source || '—'} {event.sourceId ? `(${event.sourceId})` : ''}</div>
              </div>
            </div>

            <Divider style={{ margin: `${spacing[2]} 0` }} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing[3] }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Received</Text>
                <div>{event.receivedAt ? formatDateTime(event.receivedAt) : '—'}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Processed</Text>
                <div>{processedAt ? formatDateTime(processedAt) : '—'}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Processing Time</Text>
                <div>{typeof event.processingTimeMs === 'number' ? `${event.processingTimeMs} ms` : '—'}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Delivery</Text>
                <div>
                  {delivery.integrationsMatched ?? 0} matched · {delivery.deliveredCount ?? 0} ok · {delivery.failedCount ?? 0} failed
                </div>
                {delivery.deliveryLogIds && delivery.deliveryLogIds.length > 0 && (
                  <Space size={spacingToNumber(spacing[1])} style={{ marginTop: spacing[1], flexWrap: 'wrap' }}>
                    {delivery.deliveryLogIds.map((logId) => (
                      <a
                        key={logId}
                        href={buildUrlWithEntityParentRid(`/logs/${logId}`)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12 }}
                      >
                        View log {logId}
                      </a>
                    ))}
                  </Space>
                )}
              </div>
            </div>

            {(event.skipCategory || event.skipReason || event.errorMessage) && (
              <div style={{ marginTop: spacing[2] }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Skip / Failure</Text>
                <div style={{ marginTop: spacing['0.5'] }}>
                  {event.skipCategory && <Tag color="warning" style={{ marginRight: spacing[1] }}>{event.skipCategory}</Tag>}
                  <Text strong style={{ color: colors.error[600] }}>{event.skipReason || event.errorMessage || '—'}</Text>
                </div>
                {event.errorStack && (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: spacing[2] }}
                    items={[
                      {
                        key: 'error-details',
                        label: (
                          <Space size={spacingToNumber(spacing[1])}>
                            <ExclamationCircleOutlined style={{ color: colors.error[500] }} />
                            <Text type="secondary" style={{ fontSize: 12 }}>View Error Stack Trace</Text>
                          </Space>
                        ),
                        children: (
                          <Card
                            size="small"
                            style={{
                              borderRadius: token.borderRadius,
                              border: `1px solid ${colors.error[200]}`,
                              background: mode === 'dark' ? withAlpha(colors.error[900], 0.1) : withAlpha(colors.error[50], 0.5)
                            }}
                          >
                            <pre
                              style={{
                                margin: 0,
                                fontSize: 11,
                                fontFamily: 'ui-monospace, monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                color: mode === 'dark' ? colors.error[300] : colors.error[700],
                                maxHeight: 300,
                                overflow: 'auto'
                              }}
                            >
                              {event.errorStack}
                            </pre>
                          </Card>
                        )
                      }
                    ]}
                  />
                )}
              </div>
            )}
          </Space>
        </Card>

        <div>
          <Title level={5} style={{ marginBottom: spacing[2] }}>Timeline</Title>
          {timelineItems.length > 0 ? (
            <Timeline items={timelineItems} />
          ) : (
            <Text type="secondary">No timeline data available.</Text>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] }}>
            <Title level={5} style={{ margin: 0 }}>Payload</Title>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(payloadText)}
              disabled={!payloadText}
            >
              Copy Payload
            </Button>
          </div>
          <div style={{ marginTop: spacing[2] }}>
          <Card
            style={{
              borderRadius: token.borderRadius,
              border: `1px solid ${cssVar.border.default}`,
              background: mode === 'dark' ? withAlpha(colors.neutral[900], 0.4) : withAlpha(colors.neutral[50], 0.6)
            }}
            styles={{ body: { padding: spacing[3] } }}
          >
            {payloadText ? (
              <>
                {!hasFullPayload && hasSummaryPayload && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: spacing[2] }}>
                    Full payload not stored. Showing summary only.
                  </Text>
                )}
                <pre
                  className="clamped-code-block"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 360,
                    overflow: 'auto'
                  }}
                >
                  {payloadText}
                </pre>
              </>
            ) : (
              <Text type="secondary">
                No payload captured for this event.
              </Text>
            )}
          </Card>
          </div>
        </div>
      </Space>
    </Drawer>
  );
};
