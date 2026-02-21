import { useMemo, useState } from 'react';
import { Drawer, Space, Typography, Button, Alert, Divider, Checkbox, Input, Tag, Row, Col } from 'antd';
import {
  CheckCircleOutlined,
  ThunderboltOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  LockOutlined,
  SyncOutlined,
  GlobalOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../../../design-system/utils';

const { Title, Text, Paragraph } = Typography;

interface ReviewItem {
  label: string;
  value: string | React.ReactNode;
  icon: React.ReactNode;
  critical?: boolean;
}

interface ReadinessCheck {
  label: string;
  isComplete: boolean;
  warning?: string;
}

interface ReviewConfirmDrawerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (action: 'activate' | 'draft') => void;
  isCreating: boolean;

  // Rule configuration for review
  ruleName: string;
  eventType: string;
  targetUrl: string;
  httpMethod: string;
  scope: string;
  deliveryMode: string;
  retryPolicy: string;
  authMethod: string;
  transformationType?: string;

  // Readiness checks
  readinessChecks: ReadinessCheck[];

  // Loading state
  isSaving: boolean;
}

export const ReviewConfirmDrawer = ({
  open,
  onClose,
  onConfirm,
  isCreating,
  ruleName,
  eventType,
  targetUrl,
  httpMethod,
  scope,
  deliveryMode,
  retryPolicy,
  authMethod,
  transformationType,
  readinessChecks,
  isSaving
}: ReviewConfirmDrawerProps) => {
  const { spacing, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const [activationChoice, setActivationChoice] = useState<'activate' | 'draft'>('draft');
  const [confirmText, setConfirmText] = useState('');
  const [hasReadImpact, setHasReadImpact] = useState(false);

  const isReadyToActivate = readinessChecks.every(check => check.isComplete);
  const requiresConfirmation = activationChoice === 'activate';
  const confirmationMatch = confirmText.toUpperCase() === 'ACTIVATE';
  const canProceed = activationChoice === 'draft' || (requiresConfirmation && confirmationMatch && hasReadImpact);

  const handleConfirm = () => {
    if (canProceed) {
      onConfirm(activationChoice);
      // Reset state
      setConfirmText('');
      setHasReadImpact(false);
    }
  };

  // Build review items
  const reviewItems: ReviewItem[] = [
    {
      label: 'Trigger Event',
      value: eventType || 'Not configured',
      icon: <ThunderboltOutlined style={{ color: colors.primary[500] }} />,
      critical: true
    },
    {
      label: 'Target Endpoint',
      value: (
        <Space direction="vertical" size={2}>
          <Text code style={{ fontSize: 12 }}>{httpMethod}</Text>
          <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{targetUrl}</Text>
        </Space>
      ),
      icon: <ApiOutlined style={{ color: colors.primary[500] }} />,
      critical: true
    },
    {
      label: 'Scope',
      value: scope === 'ALL' ? 'All entities' : scope === 'TENANT' ? 'Current tenant only' : scope,
      icon: <GlobalOutlined style={{ color: cssVar.text.secondary }} />
    },
    {
      label: 'Delivery',
      value: deliveryMode === 'IMMEDIATE' ? 'Immediate' : deliveryMode === 'DELAYED' ? 'Delayed (scheduled)' : 'Recurring',
      icon: <ClockCircleOutlined style={{ color: cssVar.text.secondary }} />
    },
    {
      label: 'Retry Policy',
      value: retryPolicy,
      icon: <SyncOutlined style={{ color: cssVar.text.secondary }} />
    },
    {
      label: 'Authentication',
      value: authMethod || 'None',
      icon: <LockOutlined style={{ color: cssVar.text.secondary }} />
    }
  ];

  if (transformationType) {
    reviewItems.push({
      label: 'Transformation',
      value: transformationType,
      icon: <ApiOutlined style={{ color: cssVar.text.secondary }} />
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={null}
      width={640}
      closable={false}
      styles={{
        body: { padding: 0 }
      }}
    >
      <div style={{ padding: `${spacing[5]} ${spacing[5]} ${spacing[3]}` }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing[4] }}>
          <Space direction="vertical" size={spacingToNumber(spacing[2])}>
            <Title level={3} style={{ margin: 0 }}>
              Review & Confirm
            </Title>
            <Text type="secondary" style={{ color: cssVar.text.secondary }}>
              Review what this event rule will do before {isCreating ? 'creating' : 'updating'} it
            </Text>
          </Space>
          <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
        </div>

        {/* Impact Summary */}
        <Alert
          type="info"
          showIcon
          icon={<ThunderboltOutlined />}
          style={{ marginBottom: spacing[5] }}
          message={
            <div>
              <Text strong style={{ fontSize: 14 }}>This rule will:</Text>
              <Paragraph style={{ marginTop: spacing[2], marginBottom: 0, fontSize: 13 }}>
                Automatically send <Text strong>{httpMethod}</Text> requests to <Text code style={{ fontSize: 11 }}>{targetUrl}</Text> when{' '}
                <Text strong>{eventType}</Text> events occur{' '}
                {scope === 'ALL' ? 'across all entities' : 'in the current tenant'}.
                {deliveryMode !== 'IMMEDIATE' && ` Delivery will be ${deliveryMode.toLowerCase()}.`}
              </Paragraph>
            </div>
          }
        />

        {/* Configuration Details */}
        <div style={{ marginBottom: spacing[5] }}>
          <Text strong style={{ fontSize: 14, marginBottom: spacing[3], display: 'block' }}>
            Configuration Details
          </Text>
          <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
            {reviewItems.map((item, idx) => (
              <Row key={idx} gutter={16} align="middle">
                <Col span={1}>
                  <div style={{ fontSize: 16 }}>{item.icon}</div>
                </Col>
                <Col span={7}>
                  <Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                    {item.label}
                  </Text>
                </Col>
                <Col span={16}>
                  <div>
                    {typeof item.value === 'string' ? (
                      <Text strong={item.critical} style={{ fontSize: 13 }}>
                        {item.value}
                      </Text>
                    ) : (
                      item.value
                    )}
                  </div>
                </Col>
              </Row>
            ))}
          </Space>
        </div>

        <Divider />

        {/* Readiness Checklist */}
        <div style={{ marginBottom: spacing[5] }}>
          <Text strong style={{ fontSize: 14, marginBottom: spacing[3], display: 'block' }}>
            Readiness Checklist
          </Text>
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            {readinessChecks.map((check, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: spacing[2],
                  padding: spacing[2],
                  background: check.isComplete ? withAlpha(colors.success[50], 0.3) : withAlpha(colors.warning[50], 0.3),
                  borderRadius: 6,
                  border: `1px solid ${check.isComplete ? colors.success[200] : colors.warning[200]}`
                }}
              >
                {check.isComplete ? (
                  <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 16, paddingTop: 2 }} />
                ) : (
                  <ExclamationCircleOutlined style={{ color: colors.warning[600], fontSize: 16, paddingTop: 2 }} />
                )}
                <div style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13 }}>{check.label}</Text>
                  {check.warning && (
                    <div style={{ marginTop: spacing[1] }}>
                      <Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                        {check.warning}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Space>
        </div>

        <Divider />

        {/* Activation Choice */}
        <div style={{ marginBottom: spacing[5] }}>
          <Text strong style={{ fontSize: 14, marginBottom: spacing[3], display: 'block' }}>
            What would you like to do?
          </Text>
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <div
              onClick={() => setActivationChoice('draft')}
              style={{
                padding: spacing[3],
                border: `2px solid ${activationChoice === 'draft' ? colors.primary[500] : colors.neutral[200]}`,
                borderRadius: 8,
                cursor: 'pointer',
                background: activationChoice === 'draft' ? withAlpha(colors.primary[50], 0.3) : 'transparent',
                transition: transitions.all
              }}
            >
              <Space>
                <SaveOutlined style={{ fontSize: 18, color: activationChoice === 'draft' ? colors.primary[600] : cssVar.text.secondary }} />
                <div>
                  <Text strong style={{ display: 'block', fontSize: 14 }}>
                    Save as Draft
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                    Review and test before activating
                  </Text>
                </div>
              </Space>
            </div>

            <div
              onClick={() => isReadyToActivate && setActivationChoice('activate')}
              style={{
                padding: spacing[3],
                border: `2px solid ${activationChoice === 'activate' ? colors.success[500] : colors.neutral[200]}`,
                borderRadius: 8,
                cursor: isReadyToActivate ? 'pointer' : 'not-allowed',
                background: activationChoice === 'activate' ? withAlpha(colors.success[50], 0.3) : 'transparent',
                opacity: isReadyToActivate ? 1 : 0.5,
                transition: transitions.all
              }}
            >
              <Space>
                <ThunderboltOutlined style={{ fontSize: 18, color: activationChoice === 'activate' ? colors.success[600] : cssVar.text.secondary }} />
                <div>
                  <Text strong style={{ display: 'block', fontSize: 14 }}>
                    Activate Immediately
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                    {isReadyToActivate ? 'Start processing events right away' : 'Complete all readiness checks first'}
                  </Text>
                </div>
              </Space>
            </div>
          </Space>
        </div>

        {/* Activation Confirmation (High-impact action) */}
        {requiresConfirmation && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: spacing[4] }}
            message="Confirmation Required"
            description={
              <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%', marginTop: spacing[2] }}>
                <Checkbox checked={hasReadImpact} onChange={(e) => setHasReadImpact(e.target.checked)}>
                  <Text style={{ fontSize: 13 }}>
                    I understand this rule will immediately start processing events and sending requests to the target endpoint
                  </Text>
                </Checkbox>
                <div>
                  <Text style={{ fontSize: 13, display: 'block', marginBottom: spacing[2] }}>
                    Type <Text strong code>ACTIVATE</Text> to confirm:
                  </Text>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type ACTIVATE"
                    disabled={!hasReadImpact}
                    style={{
                      borderColor: confirmText && !confirmationMatch ? colors.error[400] : undefined
                    }}
                  />
                </div>
              </Space>
            }
          />
        )}
      </div>

      {/* Footer Actions */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: spacing[4],
          background: cssVar.bg.surface,
          borderTop: `1px solid ${cssVar.border.default}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Button size="large" onClick={onClose}>
          Back to Edit
        </Button>
        <Button
          type={activationChoice === 'activate' ? 'primary' : 'default'}
          size="large"
          icon={activationChoice === 'activate' ? <ThunderboltOutlined /> : <SaveOutlined />}
          onClick={handleConfirm}
          disabled={!canProceed}
          loading={isSaving}
        >
          {activationChoice === 'activate' ? 'Activate Event Rule' : 'Save Draft'}
        </Button>
      </div>
    </Drawer>
  );
};
