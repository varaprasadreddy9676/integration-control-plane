import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Form, InputNumber, Row, Select, Space, Tag, Tooltip, Typography } from 'antd';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';

const { Text } = Typography;

const ACTION_OPTIONS = [
  { label: 'Release Held Payload', value: 'RELEASE_HELD' },
  { label: 'Discard Held Payload', value: 'DISCARD_HELD' },
];

interface ConditionRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  extractionMode: 'PATHS' | 'SCRIPT';
  matchKeyOptions: Array<{ label: string; value: string }>;
  subjectPreviewKeys: string[];
}

export const ConditionRulesSection = ({
  eventTypeOptions,
  extractionMode,
  matchKeyOptions,
  subjectPreviewKeys,
  token,
  colors,
}: ConditionRulesSectionProps) => (
  <Card
    size="small"
    title="Hold And Release Rules"
    extra={<Text type="secondary">Hold the current event now and decide later which follow-up events release or discard it.</Text>}
    style={{ borderRadius: token.borderRadiusLG }}
  >
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="Release Held Payload sends the originally held payload when this follow-up event arrives. Discard Held Payload drops the held payload without sending it."
    />

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

    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      <Col xs={24} md={12}>
        <Form.Item name="conditionPayloadStrategy" label="Payload Strategy" style={{ marginBottom: 0 }}>
          <Select
            options={[
              {
                label: 'Original Event Payload',
                value: 'ORIGINAL_EVENT',
              },
            ]}
          />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item
          name="conditionExpiresAfterHours"
          label="Expire Held Payload After (Hours)"
          tooltip="Optional. After this window, the held payload will no longer be released."
          style={{ marginBottom: 0 }}
        >
          <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} placeholder="Optional" />
        </Form.Item>
      </Col>
    </Row>

    <Form.List name="conditionRules">
      {(fields, { add, remove }) => (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {fields.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No condition rules yet. Add release or discard events for this held payload."
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
                      <Select mode="multiple" options={eventTypeOptions} placeholder="GRN_APPROVED" showSearch />
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
                        aria-label="Remove condition rule"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Tooltip>
                  </Col>
                </Row>
              </Card>
            );
          })}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ eventTypes: [], action: 'RELEASE_HELD', matchKeys: [] })}>
            Add Condition Rule
          </Button>
        </Space>
      )}
    </Form.List>
  </Card>
);
