import { useMemo } from 'react';
import { Drawer, Typography, Space, Tag, Button, Tabs, message, Grid, Divider, Table, Skeleton } from 'antd';
import {
  ThunderboltOutlined,
  CopyOutlined,
  FileTextOutlined,
  CodeOutlined,
  DatabaseOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { EventType, FieldSchema } from '../../../services/api';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';

const { Title, Text, Paragraph } = Typography;
interface EventDetailDrawerProps {
  event: EventType | null;
  open: boolean;
  onClose: () => void;
  onCreateIntegration: (eventType: string) => void;
}

export const EventDetailDrawer = ({ event, open, onClose, onCreateIntegration }: EventDetailDrawerProps) => {
  const { token, themeColors, spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { mode } = useThemeMode();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const handleCopySample = () => {
    if (event?.samplePayload) {
      navigator.clipboard.writeText(JSON.stringify(event.samplePayload, null, 2));
      message.success('Sample payload copied to clipboard');
    }
  };

  const handleCopyEventType = () => {
    if (event?.eventType) {
      navigator.clipboard.writeText(event.eventType);
      message.success('Event type copied to clipboard');
    }
  };

  const handleCreateIntegration = () => {
    if (event?.eventType) {
      onCreateIntegration(event.eventType);
      onClose();
    }
  };

  const schemaRows = useMemo(() => {
    const buildRows = (fields: FieldSchema[], depth = 0): any[] =>
      fields.flatMap((field) => {
        const base = { ...field, depth, key: field.path || `${field.name}-${depth}` };
        const nestedItems = field.itemSchema ? buildRows(field.itemSchema, depth + 1) : [];
        const nestedProps = field.properties ? buildRows(field.properties, depth + 1) : [];
        return [base, ...nestedItems, ...nestedProps];
      });

    return event?.fields ? buildRows(event.fields) : [];
  }, [event?.fields]);

  if (!open) return null;
  if (!event) {
    return (
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            <FileTextOutlined style={{ color: colors.primary[600] }} />
            <span>Loading event...</span>
          </div>
        }
        placement="right"
        width={isMobile ? '100%' : 720}
        open={open}
        onClose={onClose}
        extra={(
          <Space>
            <Button type="primary" icon={<ThunderboltOutlined />} disabled>
              Create Integration
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[5])} style={{ width: '100%' }}>
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 4 }} />
          <Skeleton active paragraph={{ rows: 6 }} />
        </Space>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <FileTextOutlined style={{ color: colors.primary[600] }} />
          <span>{event?.label || 'Loading event...'}</span>
        </div>
      }
      placement="right"
      width={isMobile ? '100%' : 720}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleCreateIntegration}
          >
            Create Integration
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[5])} style={{ width: '100%' }}>
      {/* Event Info */}
      <div>
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: spacing[1] }}>
              Event Type
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
              <Tag
                style={{
                  margin: 0,
                  fontSize: 13,
                  padding: '4px 12px',
                  fontFamily: 'monospace',
                  background: mode === 'dark' ? withAlpha(colors.neutral[800], 0.6) : withAlpha(colors.neutral[100], 0.8),
                  color: token.colorText
                }}
              >
                {event.eventType}
              </Tag>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={handleCopyEventType}
                aria-label="Copy event type"
              />
            </div>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: spacing[1] }}>
              Category
            </Text>
            <Tag
              color="blue"
              style={{ margin: 0, fontSize: 13 }}
            >
              {event.category}
            </Tag>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: spacing[1] }}>
              Description
            </Text>
            <Paragraph style={{ margin: 0, fontSize: 14 }}>
              {event.description}
            </Paragraph>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: spacing[1] }}>
              Implementation
            </Text>
            <Text
              code
              style={{
                fontSize: 12,
                background: mode === 'dark' ? withAlpha(colors.neutral[800], 0.6) : withAlpha(colors.neutral[100], 0.8),
                padding: '4px 8px',
                borderRadius: token.borderRadius
              }}
            >
              {event.implementationClass}
            </Text>
          </div>
        </Space>
      </div>

      <Divider style={{ margin: 0 }} />

      {/* Tabs for Schema and Sample */}
      <Tabs
        defaultActiveKey="schema"
        items={[
          {
            key: 'schema',
            label: (
              <span>
                <DatabaseOutlined /> Field Schema ({event.fields?.length || 0})
              </span>
            ),
            children: (
              <div
                style={{
                  maxHeight: 'calc(100vh - 400px)',
                  overflowY: 'auto',
                  paddingRight: spacing[2]
                }}
              >
                {event.fields && event.fields.length > 0 ? (
                  <Table
                    dataSource={schemaRows}
                    pagination={false}
                    size="small"
                    style={{ marginTop: spacing[2] }}
                    columns={[
                      {
                        title: 'Field',
                        dataIndex: 'name',
                        key: 'name',
                        render: (text: string, record: any) => (
                          <div style={{ paddingLeft: record.depth * 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' }}>
                              <Text code style={{ fontSize: 12 }}>{text}</Text>
                              {record.required && <Tag color="red" style={{ margin: 0 }}>required</Tag>}
                            </div>
                            <Text type="secondary" style={{ fontSize: 11 }}>{record.path}</Text>
                          </div>
                        )
                      },
                      {
                        title: 'Type',
                        dataIndex: 'type',
                        key: 'type',
                        render: (type: string, record: any) => (
                          <Space size={spacingToNumber(spacing[1])}>
                            <Tag color="blue" style={{ margin: 0 }}>{type}</Tag>
                            {record.itemType && (
                              <Tag color="purple" style={{ margin: 0 }}>items: {record.itemType}</Tag>
                            )}
                          </Space>
                        ),
                        width: 220
                      },
                      {
                        title: 'Description',
                        dataIndex: 'description',
                        key: 'description',
                        render: (desc: string) => desc ? <Text style={{ fontSize: 13 }}>{desc}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                      }
                    ]}
                  />
                ) : (
                  <Text type="secondary">No field schema available</Text>
                )}
              </div>
            )
          },
          {
            key: 'sample',
            label: (
              <span>
                <CodeOutlined /> Sample Payload
              </span>
            ),
            children: event.samplePayload ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: spacing[2] }}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={handleCopySample}
                    aria-label="Copy sample payload"
                  >
                    Copy Sample
                  </Button>
                </div>
                <pre
                  className="clamped-code-block"
                  tabIndex={0}
                  aria-label="Sample payload"
                  style={{
                    background: mode === 'dark' ? withAlpha(colors.neutral[900], 0.8) : withAlpha(colors.neutral[50], 0.8),
                    padding: spacing[4],
                    borderRadius: token.borderRadius,
                    border: `1px solid ${mode === 'dark' ? withAlpha(colors.neutral[700], 0.3) : cssVar.border.default}`,
                    fontSize: 12,
                    lineHeight: 1.6,
                    maxHeight: 'calc(100vh - 400px)',
                    overflowY: 'auto',
                    fontFamily: 'monospace'
                  }}
                >
                  {JSON.stringify(event.samplePayload, null, 2)}
                </pre>
              </div>
            ) : (
              <Text type="secondary">No sample payload available</Text>
            )
          },
          {
            key: 'usage',
            label: (
              <span>
                <InfoCircleOutlined /> Usage Guide
              </span>
            ),
            children: (
              <div>
                <Space direction="vertical" size={spacingToNumber(spacing[4])} style={{ width: '100%' }}>
                  <div>
                    <Title level={5}>When This Event Triggers</Title>
                    <Paragraph type="secondary">
                      {event.description}
                    </Paragraph>
                  </div>

                  <div>
                    <Title level={5}>Common Use Cases</Title>
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Send real-time notifications to external systems</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Sync data to CRM or ERP platforms</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Trigger automated workflows</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Update data warehouses or analytics platforms</Text>
                      </li>
                    </ul>
                  </div>

                  <div>
                    <Title level={5}>Creating a Integration</Title>
                    <Paragraph type="secondary">
                      Click the "Create Integration" button to configure a integration for this event type.
                      You'll be able to:
                    </Paragraph>
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Set the target URL to receive events</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Configure authentication (API Key, OAuth, Basic)</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Transform the payload using field mappings or custom scripts</Text>
                      </li>
                      <li style={{ marginBottom: spacing[2] }}>
                        <Text>Set scope (include children entities or exclude specific entities)</Text>
                      </li>
                    </ul>
                  </div>

                  <div
                    style={{
                      background: mode === 'dark' ? withAlpha(colors.info[900], 0.2) : withAlpha(colors.info[50], 0.8),
                      padding: spacing[4],
                      borderRadius: token.borderRadius,
                      borderLeft: `4px solid ${colors.info[600]}`
                    }}
                  >
                    <Space direction="vertical" size={spacingToNumber(spacing[2])}>
                      <Text strong style={{ color: colors.info[700] }}>
                        💡 Pro Tip
                      </Text>
                      <Text type="secondary">
                        Use the Field Schema tab to understand available fields, then use the Sample Payload
                        tab to see the actual data structure. This helps you write accurate transformations.
                      </Text>
                    </Space>
                  </div>
                </Space>
              </div>
            )
          }
        ]}
      />
      </Space>
    </Drawer>
  );
};
