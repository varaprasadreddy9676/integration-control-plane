/**
 * Inspector Panel Component
 *
 * Right sidebar for editing selected node properties
 */

import React from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Button,
  Typography,
  Space,
  Divider,
  Alert,
  Empty,
} from 'antd';
import { DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { cssVar } from '../../../design-system/utils';
import type {
  FlowNode,
  FlowNodeData,
  TriggerNodeData,
  InboundAuthNodeData,
  OutboundAuthNodeData,
  HttpNodeData,
  TransformNodeData,
  FilterNodeData,
  ScheduleScriptNodeData,
  DelayNodeData,
  MultiActionNodeData,
  ResponseNodeData,
  IntegrationNodeData,
  AuthType,
  HttpMethod,
  TransformMode,
} from '../state/flowTypes';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export interface InspectorPanelProps {
  selectedNode: FlowNode | null;
  onUpdateNode: (nodeId: string, updates: Partial<Omit<FlowNodeData, 'nodeType'>>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
  onDuplicateNode,
}) => {
  const [form] = Form.useForm();

  // Update form when selected node changes
  React.useEffect(() => {
    if (selectedNode) {
      form.setFieldsValue(selectedNode.data);
    } else {
      form.resetFields();
    }
  }, [selectedNode, form]);

  const handleFormChange = (_changedValues: any, allValues: any) => {
    if (selectedNode) {
      // Never allow changing the discriminant. It breaks the FlowNodeData union.
      const { nodeType: _nodeType, errors: _errors, warnings: _warnings, ...updates } = allValues || {};
      onUpdateNode(selectedNode.id, updates);
    }
  };

  const handleDelete = () => {
    if (selectedNode) {
      onDeleteNode(selectedNode.id);
    }
  };

  const handleDuplicate = () => {
    if (selectedNode && onDuplicateNode) {
      onDuplicateNode(selectedNode.id);
    }
  };

  if (!selectedNode) {
    return (
      <div
        style={{
          width: '350px',
          height: '100%',
          background: cssVar.bg.base,
          borderLeft: `1px solid ${cssVar.border.default}`,
          padding: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty
          description={
            <Text type="secondary">Select a node to edit its properties</Text>
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '350px',
        height: '100%',
        background: cssVar.bg.base,
        borderLeft: `1px solid ${cssVar.border.default}`,
        overflowY: 'auto',
        padding: '16px',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <Title level={5} style={{ marginBottom: '8px' }}>
          {selectedNode.data.label || 'Node Properties'}
        </Title>
        <Text type="secondary" style={{ fontSize: '12px' }}>
          {selectedNode.type}
        </Text>
      </div>

      {selectedNode.data.errors && selectedNode.data.errors.length > 0 && (
        <Alert
          message="Validation Errors"
          description={
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {selectedNode.data.errors.map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          }
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onValuesChange={handleFormChange}
        size="small"
      >
        {/* Common fields */}
        <Form.Item label="Label" name="label">
          <Input placeholder="Node label" />
        </Form.Item>

        <Form.Item label="Description" name="description">
          <TextArea rows={2} placeholder="Optional description" />
        </Form.Item>

        <Divider />

        {/* Node-specific fields */}
        {renderNodeSpecificFields(selectedNode, form)}
      </Form>

      <Divider />

      {/* Actions */}
      <Space direction="vertical" style={{ width: '100%' }}>
        {onDuplicateNode && (
          <Button
            icon={<CopyOutlined />}
            onClick={handleDuplicate}
            block
          >
            Duplicate Node
          </Button>
        )}

        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={handleDelete}
          block
          disabled={selectedNode.type === 'trigger'}
        >
          Delete Node
        </Button>

        {selectedNode.type === 'trigger' && (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', textAlign: 'center' }}>
            Trigger node cannot be deleted
          </Text>
        )}
      </Space>
    </div>
  );
};

// Helper function to render node-specific form fields
function renderNodeSpecificFields(node: FlowNode, form: any): React.ReactNode {
  switch (node.type) {
    case 'trigger':
      return renderTriggerFields(node.data as TriggerNodeData, form);
    case 'inboundAuth':
      return renderInboundAuthFields(node.data as InboundAuthNodeData, form);
    case 'outboundAuth':
      return renderOutboundAuthFields(node.data as OutboundAuthNodeData, form);
    case 'http':
      return renderHttpFields(node.data as HttpNodeData, form);
    case 'transform':
      return renderTransformFields(node.data as TransformNodeData, form);
    case 'filter':
      return renderFilterFields(node.data as FilterNodeData, form);
    case 'scheduleScript':
      return renderScheduleScriptFields(node.data as ScheduleScriptNodeData, form);
    case 'delay':
      return renderDelayFields(node.data as DelayNodeData, form);
    case 'multiAction':
      return renderMultiActionFields(node.data as MultiActionNodeData, form);
    case 'response':
      return renderResponseFields(node.data as ResponseNodeData, form);
    case 'integration':
      return renderIntegrationFields(node.data as IntegrationNodeData, form);
    default:
      return <Text type="secondary">No configuration available</Text>;
  }
}

function renderTriggerFields(data: TriggerNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item noStyle shouldUpdate>
        {() => {
          const triggerType = form.getFieldValue('triggerType');
          const scheduleType = form.getFieldValue('scheduleType');

          return (
            <>
              {triggerType === 'INBOUND' && (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="Inbound Integration"
                    description="This integration acts as an HTTP proxy, forwarding incoming requests to a target URL."
                    style={{ marginBottom: '16px' }}
                  />
                  <Form.Item
                    label="Integration Identifier"
                    name="inboundType"
                    rules={[
                      { required: true, message: 'Integration identifier is required' },
                      {
                        pattern: /^[a-z0-9-]+$/,
                        message: 'Must be lowercase alphanumeric with hyphens only'
                      }
                    ]}
                    extra="Unique identifier used in the API path (e.g., 'clevertap', 'salesforce', 'zoho-crm')"
                  >
                    <Input placeholder="e.g., clevertap" />
                  </Form.Item>
                </>
              )}

              {triggerType === 'OUTBOUND_EVENT' && (
                <Form.Item label="Event Name" name="eventName" rules={[{ required: true }]}>
                  <Select placeholder="Select event">
                    <Option value="OP_VISIT_CREATED">OP Visit Created</Option>
                    <Option value="LAB_RESULT_READY">Lab Result Ready</Option>
                    <Option value="APPOINTMENT_CONFIRMED">Appointment Confirmed</Option>
                  </Select>
                </Form.Item>
              )}

              {triggerType === 'OUTBOUND_SCHEDULED' && (
                <>
                  <Form.Item label="Event Type" name="eventName" rules={[{ required: true }]}>
                    <Input placeholder="SCHEDULED_EVENT" />
                  </Form.Item>
                  <Form.Item label="Schedule Type" name="scheduleType" rules={[{ required: true }]}>
                    <Select placeholder="Select type">
                      <Option value="CRON">Cron Expression</Option>
                      <Option value="DELAYED">Delayed (One-time)</Option>
                      <Option value="RECURRING">Recurring Interval</Option>
                    </Select>
                  </Form.Item>

                  {scheduleType === 'CRON' && (
                    <Form.Item label="Cron Expression" name="cronExpression" rules={[{ required: true }]}>
                      <Input placeholder="0 0 * * *" />
                    </Form.Item>
                  )}

                  {scheduleType === 'DELAYED' && (
                    <Form.Item label="Delay (seconds)" name="delaySeconds" rules={[{ required: true }]}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  )}

                  {scheduleType === 'RECURRING' && (
                    <>
                      <Form.Item label="Interval" name="recurringInterval" rules={[{ required: true }]}>
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="Unit" name="recurringUnit" rules={[{ required: true }]}>
                        <Select>
                          <Option value="SECONDS">Seconds</Option>
                          <Option value="MINUTES">Minutes</Option>
                          <Option value="HOURS">Hours</Option>
                          <Option value="DAYS">Days</Option>
                        </Select>
                      </Form.Item>
                    </>
                  )}
                </>
              )}
            </>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderInboundAuthFields(data: InboundAuthNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Auth Type" name="authType" rules={[{ required: true }]}>
        <Select>
          <Option value="NONE">None</Option>
          <Option value="API_KEY">API Key</Option>
          <Option value="BEARER">Bearer Token</Option>
          <Option value="BASIC">Basic Auth</Option>
        </Select>
      </Form.Item>

      <Form.Item noStyle shouldUpdate>
        {() => {
          const authType = form.getFieldValue('authType') as AuthType;
          return (
            <>
              {authType === 'API_KEY' && (
                <>
                  <Form.Item label="API Key Header" name="apiKeyHeader">
                    <Input placeholder="X-API-Key" />
                  </Form.Item>
                  <Form.Item label="Expected API Key" name="expectedApiKey" rules={[{ required: true }]}>
                    <Input.Password placeholder="Expected key value" />
                  </Form.Item>
                </>
              )}

              {authType === 'BEARER' && (
                <Form.Item label="Expected Token" name="expectedBearerToken" rules={[{ required: true }]}>
                  <Input.Password placeholder="Expected bearer token" />
                </Form.Item>
              )}

              {authType === 'BASIC' && (
                <>
                  <Form.Item label="Expected Username" name="expectedUsername" rules={[{ required: true }]}>
                    <Input placeholder="Username" />
                  </Form.Item>
                  <Form.Item label="Expected Password" name="expectedPassword" rules={[{ required: true }]}>
                    <Input.Password placeholder="Password" />
                  </Form.Item>
                </>
              )}
            </>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderOutboundAuthFields(data: OutboundAuthNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Auth Type" name="authType" rules={[{ required: true }]}>
        <Select>
          <Option value="NONE">None</Option>
          <Option value="API_KEY">API Key</Option>
          <Option value="BEARER">Bearer Token</Option>
          <Option value="BASIC">Basic Auth</Option>
          <Option value="OAUTH2">OAuth 2.0</Option>
        </Select>
      </Form.Item>

      <Form.Item noStyle shouldUpdate>
        {() => {
          const authType = form.getFieldValue('authType') as AuthType;
          return (
            <>
              {authType === 'API_KEY' && (
                <>
                  <Form.Item label="API Key Header" name="apiKeyHeader">
                    <Input placeholder="X-API-Key" />
                  </Form.Item>
                  <Form.Item label="API Key" name="apiKey" rules={[{ required: true }]}>
                    <Input.Password placeholder="API key value" />
                  </Form.Item>
                </>
              )}

              {authType === 'BEARER' && (
                <Form.Item label="Bearer Token" name="bearerToken" rules={[{ required: true }]}>
                  <Input.Password placeholder="Bearer token" />
                </Form.Item>
              )}

              {authType === 'BASIC' && (
                <>
                  <Form.Item label="Username" name="basicUsername" rules={[{ required: true }]}>
                    <Input placeholder="Username" />
                  </Form.Item>
                  <Form.Item label="Password" name="basicPassword" rules={[{ required: true }]}>
                    <Input.Password placeholder="Password" />
                  </Form.Item>
                </>
              )}
            </>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderHttpFields(data: HttpNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="URL" name="url" rules={[{ required: true, type: 'url' }]}>
        <Input placeholder="https://api.example.com/endpoint" />
      </Form.Item>

      <Form.Item label="Method" name="method" rules={[{ required: true }]}>
        <Select>
          <Option value="GET">GET</Option>
          <Option value="POST">POST</Option>
          <Option value="PUT">PUT</Option>
          <Option value="PATCH">PATCH</Option>
          <Option value="DELETE">DELETE</Option>
        </Select>
      </Form.Item>

      <Form.Item label="Timeout (ms)" name="timeout">
        <InputNumber min={1000} max={60000} step={1000} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="Retry Count" name="retryCount">
        <InputNumber min={0} max={10} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="Retry Delay (ms)" name="retryDelay">
        <InputNumber min={100} max={10000} step={100} style={{ width: '100%' }} />
      </Form.Item>
    </>
  );
}

function renderTransformFields(data: TransformNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Transform Mode" name="transformMode" rules={[{ required: true }]}>
        <Select>
          <Option value="NONE">None</Option>
          <Option value="SIMPLE">Simple Mapping</Option>
          <Option value="SCRIPT">JavaScript</Option>
        </Select>
      </Form.Item>

      <Form.Item label="Direction" name="transformDirection" rules={[{ required: true }]}>
        <Select>
          <Option value="request">Request</Option>
          <Option value="response">Response</Option>
        </Select>
      </Form.Item>

      <Form.Item noStyle shouldUpdate>
        {() => {
          const transformMode = form.getFieldValue('transformMode') as TransformMode;
          if (transformMode !== 'SCRIPT') return null;

          return (
            <>
              <Form.Item label="Script Code" name="scriptCode" rules={[{ required: true }]}>
                <TextArea
                  rows={10}
                  placeholder="function transform(input) {\n  // Transform logic here\n  return output;\n}"
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
              <Alert
                message="JavaScript function that receives input and returns transformed output"
                type="info"
                showIcon
                style={{ marginBottom: '16px' }}
              />
            </>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderFilterFields(data: FilterNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Match Mode" name="matchMode" rules={[{ required: true }]}>
        <Select>
          <Option value="all">All conditions (AND)</Option>
          <Option value="any">Any condition (OR)</Option>
        </Select>
      </Form.Item>

      <Alert
        message="Configure filter conditions using the visual editor (coming soon)"
        type="info"
        showIcon
      />
    </>
  );
}

function renderScheduleScriptFields(data: ScheduleScriptNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Schedule Script" name="script" rules={[{ required: true }]}>
        <TextArea
          rows={10}
          placeholder={`// Return a timestamp (ms) or recurring config object\n// Example (delay 1 hour):\nreturn Date.now() + 60 * 60 * 1000;`}
          style={{ fontFamily: 'monospace' }}
        />
      </Form.Item>
      <Alert
        message="Script must return a timestamp (ms) or a recurring config object"
        description="This is executed by the scheduler to determine when to run the integration."
        type="info"
        showIcon
        style={{ marginBottom: '16px' }}
      />
    </>
  );
}

function renderDelayFields(data: DelayNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Delay Type" name="delayType" rules={[{ required: true }]}>
        <Select>
          <Option value="FIXED">Fixed Delay</Option>
          <Option value="DYNAMIC">Dynamic (Expression)</Option>
        </Select>
      </Form.Item>

      <Form.Item noStyle shouldUpdate>
        {() => {
          const delayType = form.getFieldValue('delayType');
          return (
            <>
              {delayType === 'FIXED' && (
                <Form.Item label="Delay (ms)" name="delayMs" rules={[{ required: true }]}>
                  <InputNumber min={0} max={300000} step={1000} style={{ width: '100%' }} />
                </Form.Item>
              )}

              {delayType === 'DYNAMIC' && (
                <Form.Item label="Delay Expression" name="delayExpression" rules={[{ required: true }]}>
                  <Input placeholder="e.g., payload.delaySeconds * 1000" />
                </Form.Item>
              )}
            </>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderMultiActionFields(data: MultiActionNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Execution Mode" name="executeInParallel" valuePropName="checked">
        <Switch checkedChildren="Parallel" unCheckedChildren="Sequential" />
      </Form.Item>

      <Form.Item label="Continue on Error" name="continueOnError" valuePropName="checked">
        <Switch />
      </Form.Item>

      <Alert
        message="Configure multiple actions using the visual editor (coming soon)"
        type="info"
        showIcon
      />
    </>
  );
}

function renderResponseFields(data: ResponseNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Status Code" name="statusCode" rules={[{ required: true }]}>
        <InputNumber min={100} max={599} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="Body Type" name="bodyType" rules={[{ required: true }]}>
        <Select>
          <Option value="json">JSON</Option>
          <Option value="text">Plain Text</Option>
          <Option value="html">HTML</Option>
          <Option value="template">Template</Option>
        </Select>
      </Form.Item>

      <Form.Item noStyle shouldUpdate>
        {() => {
          const bodyType = form.getFieldValue('bodyType');
          if (bodyType !== 'json' && bodyType !== 'template') return null;
          return (
            <Form.Item label="Body Template" name="bodyTemplate">
              <TextArea
                rows={6}
                placeholder='{"status": "success", "data": "{{data}}"}'
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          );
        }}
      </Form.Item>
    </>
  );
}

function renderIntegrationFields(data: IntegrationNodeData, form: any): React.ReactNode {
  return (
    <>
      <Form.Item label="Integration Name" name="__KEEP_integrationName__">
        <Input placeholder="Optional name" />
      </Form.Item>

      <Form.Item label="URL" name="url" rules={[{ required: true, type: 'url' }]}>
        <Input placeholder="https://integration.example.com/endpoint" />
      </Form.Item>

      <Form.Item label="Method" name="method" rules={[{ required: true }]}>
        <Select>
          <Option value="POST">POST</Option>
          <Option value="PUT">PUT</Option>
          <Option value="PATCH">PATCH</Option>
        </Select>
      </Form.Item>

      <Form.Item label="Timeout (ms)" name="timeout">
        <InputNumber min={1000} max={60000} step={1000} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="Retry Count" name="retryCount">
        <InputNumber min={0} max={10} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="Enable DLQ" name="enableDLQ" valuePropName="checked">
        <Switch />
      </Form.Item>
    </>
  );
}

export default InspectorPanel;
