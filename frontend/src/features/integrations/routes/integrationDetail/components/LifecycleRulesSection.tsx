import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Form, Row, Select, Space, Tag, Tooltip, Typography } from 'antd';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';

const { Text } = Typography;

const ACTION_OPTIONS = [
  { label: 'Cancel Pending', value: 'CANCEL_PENDING' },
  { label: 'Reschedule Pending', value: 'RESCHEDULE_PENDING' },
  { label: 'Replace Existing', value: 'REPLACE_EXISTING' },
  { label: 'Ignore', value: 'IGNORE' },
];

interface LifecycleRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  extractionMode: 'PATHS' | 'SCRIPT';
  matchKeyOptions: Array<{ label: string; value: string }>;
  subjectPreviewKeys: string[];
  hasRescheduleRule: boolean;
}

export const LifecycleRulesSection = ({
  eventTypeOptions,
  extractionMode,
  matchKeyOptions,
  subjectPreviewKeys,
  hasRescheduleRule,
  token,
  colors,
}: LifecycleRulesSectionProps) => (
  <Card
    size="small"
    title="Lifecycle Rules"
    extra={<Text type="secondary">When one of these events arrives, the platform cancels or reschedules matching pending deliveries.</Text>}
    style={{ borderRadius: token.borderRadiusLG }}
  >
    {hasRescheduleRule && (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Reschedule Pending cancels old pending deliveries, then schedules again from this event."
      />
    )}

    {extractionMode === 'SCRIPT' && (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Run Preview Extracted Subject to confirm which keys your script returns before choosing match keys."
        description={
          subjectPreviewKeys.length > 0 ? (
            <Space wrap style={{ marginTop: 8 }}>
              {subjectPreviewKeys.map((key) => (
                <Tag key={key} color="blue">
                  {key}
                </Tag>
              ))}
            </Space>
          ) : undefined
        }
      />
    )}

    <Form.List name="lifecycleRules">
      {(fields, { add, remove }) => (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {fields.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No lifecycle rules yet. Add one for cancellation, reschedule, or replacement events."
            />
          )}
          {fields.map((field) => {
            const { key: _ignoredKey, ...fieldProps } = field;

            return (
              <Card key={field.key} size="small" style={{ borderRadius: token.borderRadiusLG, borderColor: colors.secondary[200] }}>
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={10}>
                    <Form.Item
                      {...fieldProps}
                      name={[field.name, 'eventTypes']}
                      label="Follow-up Events"
                      rules={[{ required: true, message: 'Select at least one event type' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select mode="multiple" options={eventTypeOptions} placeholder="APPOINTMENT_CANCELLATION" showSearch />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      {...fieldProps}
                      name={[field.name, 'action']}
                      label="Action"
                      rules={[{ required: true, message: 'Action is required' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select options={ACTION_OPTIONS} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      {...fieldProps}
                      name={[field.name, 'matchKeys']}
                      label="Match Keys"
                      rules={[{ required: true, message: 'Pick at least one key' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        mode={extractionMode === 'SCRIPT' ? 'tags' : 'multiple'}
                        options={matchKeyOptions}
                        placeholder={extractionMode === 'SCRIPT' ? 'Type or pick keys' : 'Pick keys'}
                        allowClear
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={2}>
                    <Tooltip title="Remove">
                      <Button
                        danger
                        title="Remove"
                        aria-label="Remove lifecycle rule"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Tooltip>
                  </Col>
                </Row>
              </Card>
            );
          })}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ eventTypes: [], action: 'CANCEL_PENDING', matchKeys: [] })}>
            Add Lifecycle Rule
          </Button>
        </Space>
      )}
    </Form.List>
  </Card>
);
