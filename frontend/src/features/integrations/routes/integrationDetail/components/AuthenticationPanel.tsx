import { Skeleton, Row, Col, Alert } from 'antd';
import type { FormInstance } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { AuthenticationSection } from '../../../components/detail/AuthenticationSection';
import { SectionHeader } from './SectionHeader';
import { spacingToNumber } from '../../../../../design-system/utils';

interface AuthenticationPanelProps {
  form: FormInstance;
  uiConfig: any;
  selectedAuthType?: string;
  isMultiAction: boolean;
  spacing: Record<string, string>;
  colors: any;
  isLoading?: boolean;
  currentEventType?: string;
}

export const AuthenticationPanelHeader = ({
  spacing,
  colors
}: Pick<AuthenticationPanelProps, 'spacing' | 'colors'>) => (
  <SectionHeader
    icon={<LockOutlined style={{ fontSize: 18, color: colors.primary[600] }} />}
    title="Security"
    spacing={spacing}
  />
);

export const AuthenticationPanelContent = ({
  form,
  uiConfig,
  selectedAuthType,
  isMultiAction,
  spacing,
  isLoading = false,
  currentEventType
}: AuthenticationPanelProps) => {
  if (isLoading) {
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 5 }} />
      </div>
    );
  }

  // Disable authentication section until event type is selected
  if (!currentEventType) {
    return (
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            message="Select an event type first"
            description="Authentication configuration will be available after you select an event type in the Configuration section above."
            style={{ marginBottom: 0 }}
          />
        </Col>
      </Row>
    );
  }

  return (
    <AuthenticationSection
      form={form}
      uiConfig={uiConfig}
      selectedAuthType={selectedAuthType}
      isMultiAction={isMultiAction}
      spacing={spacing}
    />
  );
};
