import { useState, useEffect } from 'react';
import { Row, Col, Form, Input, Select, Button, Space, Alert, Typography, Popover, App, Tag } from 'antd';
import Editor from '@monaco-editor/react';
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  RocketOutlined
} from '@ant-design/icons';
import { useDesignTokens, withAlpha, cssVar } from '../../../../design-system/utils';
import { HelpPopover, SchedulingScriptHelp, UtilityFunctionsHelp, ScriptSyntaxHelp } from './shared';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useTenant } from '../../../../app/tenant-context';
import { generateSchedulingScript } from '../../../../services/ai-api';
import { type SchedulingTestResult } from '../../../../services/api';
import { SchedulingPreview } from './SchedulingPreview';
import { SchedulingTemplates } from './SchedulingTemplates';
// import { SchedulingQuickBuilder } from './SchedulingQuickBuilder';
import { formatDateTime } from '../../../../utils/format';

// Monaco Editor wrapper component for Form.Item compatibility
const MonacoEditorInput = ({ value, onChange, placeholder, height = '300px', onScriptChange }: any) => {
  const { token } = useDesignTokens();
  const colors = cssVar.legacy;

  const handleChange = (newValue: string | undefined) => {
    const val = newValue ?? '';
    onChange?.(val);
    onScriptChange?.(val);
  };

  return (
    <div
      style={{
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        border: `1px solid ${withAlpha(colors.neutral[900], 0.6)}`,
        boxShadow: token.boxShadowSecondary
      }}
    >
      <Editor
        height={height}
        language="javascript"
        value={value || placeholder || ''}
        onChange={handleChange}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on'
        }}
        theme="vs-dark"
      />
    </div>
  );
};

interface SchedulingSectionProps {
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  spacing: any;
  token: any;
  colors: any;
  currentEventType?: string;
  form?: any;
  integrationId?: string;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * SchedulingSection - Delivery scheduling configuration
 *
 * Compact design with help popovers for progressive disclosure.
 * Replaces verbose alerts with inline help and popover documentation.
 */
export const SchedulingSection = ({
  deliveryModeValue,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  spacing,
  token,
  colors,
  currentEventType,
  form,
  integrationId
}: SchedulingSectionProps) => {
  const { message } = App.useApp();
  const [utilityDocsOpen, setUtilityDocsOpen] = useState(false);
  const { isAvailable: isAIAvailable } = useAIStatus();
  const { orgId } = useTenant();
  const [currentScript, setCurrentScript] = useState<string>('');
  const [previewState, setPreviewState] = useState<{
    preview: SchedulingTestResult | null;
    error: string | null;
    loading: boolean;
  }>({ preview: null, error: null, loading: false });
  const timezoneValue = Form.useWatch(['schedulingConfig', 'timezone'], form);

  // Initialize currentScript from form value when component mounts or form changes
  useEffect(() => {
    const script = form?.getFieldValue(['schedulingConfig', 'script']);
    if (script && script !== currentScript) {
      setCurrentScript(script);
    }
  }, [form, integrationId]); // Re-run when integrationId changes (new integration loaded)

  const handleAIGenerate = async () => {
    const description = form?.getFieldValue(['schedulingConfig', 'description']);
    if (!description || description.trim().length === 0) {
      message.warning('Please enter a description first');
      return;
    }

    if (!deliveryModeValue || deliveryModeValue === 'IMMEDIATE') {
      message.warning('AI scheduling is only available for DELAYED or RECURRING modes');
      return;
    }

    if (!orgId) {
      message.error('Entity not found. Please ensure you have proper access.');
      return;
    }

    const hide = message.loading('Generating scheduling script with AI...', 0);
    try {
      const response = await generateSchedulingScript(orgId, {
        description,
        mode: deliveryModeValue as 'DELAYED' | 'RECURRING',
        eventType: currentEventType
      });

      form?.setFieldValue(['schedulingConfig', 'script'], response.script);
      setCurrentScript(response.script);
      hide();
      message.success('AI-generated scheduling script applied');
    } catch (error: any) {
      hide();
      message.error(error.message || 'Failed to generate scheduling script');
    }
  };

  const handleTemplateSelect = (script: string) => {
    form?.setFieldValue(['schedulingConfig', 'script'], script);
    setCurrentScript(script);
    message.success('Template applied - you can customize it now');
  };

  // const handleQuickScriptApply = (script: string, label: string) => {
  //   form?.setFieldValue(['schedulingConfig', 'script'], script);
  //   setCurrentScript(script);
  //   message.success(`${label} applied - you can customize it now`);
  // };

  const deliveryModeLabel = deliveryModeValue === 'IMMEDIATE'
    ? 'Immediate'
    : deliveryModeValue === 'DELAYED'
    ? 'Delayed (One-Time)'
    : 'Recurring';

  const scriptStatus = () => {
    if (deliveryModeValue === 'IMMEDIATE') {
      return { label: 'Not required', color: 'default' as const };
    }
    if (isValidatingScript) {
      return { label: 'Validating...', color: 'processing' as const };
    }
    if (schedulingScriptValidation.status === 'success') {
      return { label: 'Valid', color: 'success' as const };
    }
    if (schedulingScriptValidation.status === 'error') {
      return { label: 'Invalid', color: 'error' as const };
    }
    return { label: 'Not validated', color: 'default' as const };
  };

  const nextRunLabel = () => {
    if (deliveryModeValue === 'IMMEDIATE') return '—';
    if (previewState.loading) return 'Calculating...';
    if (previewState.error) return 'Preview error';
    if (deliveryModeValue === 'DELAYED') {
      const scheduledFor = previewState.preview?.result?.scheduledFor;
      return scheduledFor ? formatDateTime(scheduledFor) : '—';
    }
    const firstOccurrence = previewState.preview?.result?.firstOccurrenceDate
      || previewState.preview?.result?.sampleOccurrences?.[0]?.scheduledFor;
    return firstOccurrence ? formatDateTime(firstOccurrence) : '—';
  };

  const scriptStatusValue = scriptStatus();
  const nextRunText = nextRunLabel();

  useEffect(() => {
    if (deliveryModeValue === 'IMMEDIATE' || !currentScript || currentScript.trim().length === 0) {
      setPreviewState({ preview: null, error: null, loading: false });
    }
  }, [deliveryModeValue, currentScript]);

  return (
    <Row gutter={[spacingToNumber(spacing[4]), 0]}>
      <Col xs={24}>
        <Form.Item
          name="deliveryMode"
          label={
            <Space size={4}>
              Delivery Mode
              {deliveryModeValue && deliveryModeValue !== 'IMMEDIATE' && (
                <HelpPopover
                  title="Scheduling Requirements"
                  content={<SchedulingScriptHelp mode={deliveryModeValue} />}
                />
              )}
            </Space>
          }
          initialValue="IMMEDIATE"
          tooltip="When to deliver events"
        >
          <Select size="large" placeholder="Select delivery mode" optionLabelProp="label">
            <Select.Option value="IMMEDIATE" label="Immediate">
              <Space>
                <ThunderboltOutlined style={{ color: colors.success[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Immediate</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Send integration immediately when event occurs
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="DELAYED" label="Delayed (One-Time)">
              <Space>
                <ClockCircleOutlined style={{ color: colors.warning[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Delayed (One-Time)</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Schedule integration for a future time (single delivery)
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="RECURRING" label="Recurring">
              <Space>
                <FieldTimeOutlined style={{ color: colors.info[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Recurring</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Schedule integration to repeat at multiple times
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>
      </Col>

      <Col xs={24}>
        <div
          style={{
            background: cssVar.bg.subtle,
            border: `1px solid ${cssVar.border.default}`,
            borderRadius: token.borderRadiusLG,
            padding: `${spacing[2]} ${spacing[3]}`,
            marginBottom: spacingToNumber(spacing[3])
          }}
        >
          <Space wrap size={spacingToNumber(spacing[3])} style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Mode</Typography.Text>
              <Typography.Text style={{ fontSize: 13, fontWeight: 600 }}>{deliveryModeLabel}</Typography.Text>
            </Space>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Timezone</Typography.Text>
              <Typography.Text style={{ fontSize: 13 }}>{timezoneValue || 'Asia/Kolkata'}</Typography.Text>
            </Space>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Next run</Typography.Text>
              <Typography.Text style={{ fontSize: 13 }}>{nextRunText}</Typography.Text>
            </Space>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Script</Typography.Text>
              <Tag color={scriptStatusValue.color}>{scriptStatusValue.label}</Tag>
            </Space>
          </Space>
        </div>
      </Col>

      {deliveryModeValue && deliveryModeValue !== 'IMMEDIATE' && (
        <>
          <Col xs={24}>
            <Form.Item
              name={['schedulingConfig', 'description']}
              label="Description (Optional)"
              tooltip="Describe the schedule"
            >
              <Input.TextArea
                rows={2}
                placeholder="e.g., Send 24 hours before appointment time"
                size="large"
              />
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item
              name={['schedulingConfig', 'timezone']}
              label="Timezone"
              initialValue="Asia/Kolkata"
              tooltip="Script timezone"
            >
              <Select size="large" placeholder="Select timezone">
                <Select.Option value="Asia/Kolkata">Asia/Kolkata (IST)</Select.Option>
                <Select.Option value="UTC">UTC</Select.Option>
                <Select.Option value="America/New_York">America/New_York (EST/EDT)</Select.Option>
                <Select.Option value="Europe/London">Europe/London (GMT/BST)</Select.Option>
                <Select.Option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</Select.Option>
                <Select.Option value="Asia/Tokyo">Asia/Tokyo (JST)</Select.Option>
                <Select.Option value="Australia/Sydney">Australia/Sydney (AEDT/AEST)</Select.Option>
              </Select>
            </Form.Item>
          </Col>

          {/* Quick Scheduler (disabled for now; keep code for future enablement) */}
          {/*
          {(deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING') && (
            <Col xs={24}>
              <SchedulingQuickBuilder
                deliveryMode={deliveryModeValue}
                timezone={timezoneValue || 'Asia/Kolkata'}
                currentScript={currentScript}
                onApplyScript={handleQuickScriptApply}
              />
            </Col>
          )}
          */}

          {/* Quick Templates */}
          {(deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING') && (
            <Col xs={24}>
              <SchedulingTemplates
                deliveryMode={deliveryModeValue}
                onSelectTemplate={handleTemplateSelect}
              />
            </Col>
          )}

          <Col xs={24}>
            <Form.Item
              name={['schedulingConfig', 'script']}
              label={
                <Space>
                  <span>Scheduling Script</span>
                  <HelpPopover
                    title="Script Syntax"
                    content={<ScriptSyntaxHelp />}
                  />
                  {(deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING') && (
                    <>
                      {isAIAvailable && (
                        <Button
                          type="link"
                          size="small"
                          icon={<RocketOutlined />}
                          onClick={handleAIGenerate}
                          style={{ padding: 0, height: 'auto', color: colors.purple?.[600] || '#7b1fa2' }}
                        >
                          AI Generate
                        </Button>
                      )}
                      <Button
                        type="link"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => onCopyExampleScript(deliveryModeValue)}
                        style={{ padding: 0, height: 'auto' }}
                      >
                        Copy example
                      </Button>
                    </>
                  )}
                  <Popover
                    content={<UtilityFunctionsHelp />}
                    title="Available Utility Functions"
                    trigger="click"
                    open={utilityDocsOpen}
                    onOpenChange={setUtilityDocsOpen}
                    overlayStyle={{ maxWidth: 500 }}
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<CodeOutlined />}
                      style={{ padding: 0, height: 'auto' }}
                    >
                      View utility docs
                    </Button>
                  </Popover>
                </Space>
              }
              rules={[
                {
                  required: deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING',
                  message: 'Scheduling script is required for delayed/recurring delivery'
                }
              ]}
              tooltip={
                deliveryModeValue === 'DELAYED'
                  ? 'JavaScript function that returns a single Unix timestamp (number) for when to deliver the integration'
                  : 'JavaScript function that returns a config object with firstOccurrence, intervalMs, and maxOccurrences or endDate'
              }
            >
              <MonacoEditorInput
                height="300px"
                onScriptChange={setCurrentScript}
                placeholder={
                  deliveryModeValue === 'DELAYED'
                    ? `// Example: Send 24 hours before appointment\nconst appointmentTime = parseDate(event.appointmentDateTime);\nconst scheduledTime = subtractHours(appointmentTime, 24);\nreturn toTimestamp(scheduledTime);`
                    : `// Example: Send every 6 hours, max 5 times\nconst firstTime = addHours(now(), 1);\nreturn {\n  firstOccurrence: toTimestamp(firstTime),\n  intervalMs: 6 * 60 * 60 * 1000,\n  maxOccurrences: 5\n};`
                }
              />
            </Form.Item>
          </Col>

          {/* Schedule Preview */}
          {(deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING') && (
            <Col xs={24}>
              <SchedulingPreview
                integrationId={integrationId}
                script={currentScript}
                deliveryMode={deliveryModeValue}
                eventType={currentEventType}
                onPreviewChange={setPreviewState}
              />
            </Col>
          )}

          <Col xs={24}>
            <Button
              icon={<CheckCircleOutlined />}
              onClick={onValidateScript}
              loading={isValidatingScript}
              disabled={isValidatingScript}
              style={{ marginBottom: spacingToNumber(spacing[3]) }}
            >
              {isValidatingScript ? 'Validating...' : 'Validate Script'}
            </Button>
            {schedulingScriptValidation.status !== 'idle' && (
              <Alert
                type={schedulingScriptValidation.status === 'success' ? 'success' : 'error'}
                showIcon
                message={schedulingScriptValidation.status === 'success' ? 'Script Valid' : 'Validation Error'}
                description={schedulingScriptValidation.message}
                closable
                onClose={onValidationClose}
                style={{ marginTop: spacingToNumber(spacing[2]) }}
              />
            )}
          </Col>
        </>
      )}
    </Row>
  );
};
