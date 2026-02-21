import { Skeleton, Tabs, Tag, Typography, Row, Col, Alert } from 'antd';
import { FieldTimeOutlined } from '@ant-design/icons';
import { DeliverySettingsSectionEnhanced } from '../../../components/detail/DeliverySettingsSectionEnhanced';
import { SchedulingSection } from '../../../components/detail/SchedulingSection';
import { RateLimitSection } from '../../../components/detail/RateLimitSection';
import { spacingToNumber } from '../../../../../design-system/utils';

interface DeliveryPanelProps {
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  uiConfig: any;
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  form?: any;
  currentEventType?: string;
  isLoading?: boolean;
  integrationId?: string;
}

export const DeliveryPanelHeader = ({
  deliveryModeValue,
  spacing,
  colors
}: Pick<DeliveryPanelProps, 'deliveryModeValue' | 'spacing' | 'colors'>) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    <FieldTimeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>Delivery</Typography.Text>
      {deliveryModeValue && deliveryModeValue !== 'IMMEDIATE' && (
        <Tag color="processing" style={{ marginLeft: spacing[2], fontSize: 11 }}>Scheduled</Tag>
      )}
    </div>
  </div>
);

export const DeliveryPanel = ({
  deliveryModeValue,
  uiConfig,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  spacing,
  token,
  colors,
  form,
  currentEventType,
  isLoading = false,
  integrationId
}: DeliveryPanelProps) => {
  if (isLoading) {
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  // Disable delivery section until event type is selected
  if (!currentEventType) {
    return (
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            message="Select an event type first"
            description="Delivery configuration will be available after you select an event type in the Configuration section above."
            style={{ marginBottom: 0 }}
          />
        </Col>
      </Row>
    );
  }

  return (
    <Tabs
      defaultActiveKey="retries"
      size="small"
      tabBarStyle={{ marginBottom: spacingToNumber(spacing[2]) }}
      items={[
        {
          key: 'retries',
          label: 'Retries & Timeout',
          children: (
            <DeliverySettingsSectionEnhanced
              uiConfig={uiConfig}
              spacing={spacing}
            />
          )
        },
        {
          key: 'scheduling',
          label: 'Scheduling',
          children: (
            <SchedulingSection
              deliveryModeValue={deliveryModeValue}
              schedulingScriptValidation={schedulingScriptValidation}
              isValidatingScript={isValidatingScript}
              onValidateScript={onValidateScript}
              onCopyExampleScript={onCopyExampleScript}
              onValidationClose={onValidationClose}
              spacing={spacing}
              token={token}
              colors={colors}
              form={form}
              currentEventType={currentEventType}
              integrationId={integrationId}
            />
          )
        },
        {
          key: 'rateLimit',
          label: 'Rate Limiting',
          children: (
            <RateLimitSection
              form={form}
              spacing={spacing}
            />
          )
        }
      ]}
    />
  );
};
