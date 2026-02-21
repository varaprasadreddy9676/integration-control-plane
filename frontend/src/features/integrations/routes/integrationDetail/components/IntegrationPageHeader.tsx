import { Form, Switch, Typography } from 'antd';
import type { IntegrationConfig } from '../../../../../mocks/types';
import { PageHeader } from '../../../../../components/common/PageHeader';
import { FormActions } from '../../../components/common';
import { formatDateTime } from '../../../../../utils/format';
import { cssVar } from '../../../../../design-system/utils';

interface IntegrationPageHeaderProps {
  isCreate: boolean;
  isEditMode: boolean;
  existingIntegration?: IntegrationConfig;
  isMultiAction: boolean;
  deliveryModeValue?: string;
  transformationTab: 'SIMPLE' | 'SCRIPT';
  isActiveValue?: boolean;
  isSaving: boolean;
  spacing: Record<string, string>;
  colors: any;
  onSave: () => void;
  onTest: () => void;
  onCancelEdit: () => void;
  onEnterEditMode: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onImport: () => void;
}

export const IntegrationPageHeader = ({
  isCreate,
  isEditMode,
  existingIntegration,
  isMultiAction,
  deliveryModeValue,
  transformationTab,
  isActiveValue,
  isSaving,
  spacing,
  colors,
  onSave,
  onTest,
  onCancelEdit,
  onEnterEditMode,
  onDuplicate,
  onExport,
  onImport
}: IntegrationPageHeaderProps) => {
  const statusChips = isCreate
    ? [
        { label: 'Draft', color: cssVar.text.secondary },
        { label: isMultiAction ? 'Multi-action' : 'Single' },
        deliveryModeValue && {
          label: deliveryModeValue === 'IMMEDIATE' ? 'Immediate' : 'Scheduled'
        }
      ].filter(Boolean)
    : [
        {
          label: existingIntegration?.isActive ? 'Active' : 'Paused',
          color: existingIntegration?.isActive ? colors.success[600] : colors.warning[600]
        },
        { label: isMultiAction ? 'Multi-action' : 'Single' },
        deliveryModeValue && { label: deliveryModeValue === 'IMMEDIATE' ? 'Immediate' : 'Scheduled' },
        { label: transformationTab === 'SCRIPT' ? 'JavaScript Transform' : 'Simple Mapping' },
        existingIntegration?.updatedAt && { label: `Last updated ${formatDateTime(existingIntegration.updatedAt)}` }
      ].filter(Boolean);

  return (
    <PageHeader
      title={isCreate ? 'Create Event Rule' : existingIntegration?.name ?? 'Event Rule Configuration'}
      description={
        isCreate
          ? 'Configure a new event rule endpoint for event delivery'
          : 'Manage delivery settings, authentication, and transformations'
      }
      breadcrumb={[
        { label: 'Configuration', path: '/event-gateway/integrations' },
        { label: 'Outbound Integrations', path: '/integrations' },
        { label: isCreate ? 'New' : existingIntegration?.name ?? 'Details' }
      ]}
      compact
      titleSuffix={
        !isCreate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
              {isActiveValue === false ? 'Paused' : 'Active'}
            </Typography.Text>
            <Form.Item name="isActive" valuePropName="checked" noStyle>
              <Switch size="small" />
            </Form.Item>
          </div>
        ) : undefined
      }
      statusChips={statusChips as any}
      actions={
        !isCreate && !isEditMode ? (
          <FormActions
            mode="view"
            isEditMode={isEditMode}
            isSaving={isSaving}
            isActive={isActiveValue}
            canTest={!isCreate}
            canSave={false}
            canDuplicate={!isCreate && !isEditMode}
            canExport={!isCreate && !isEditMode}
            canImport={false}
            onSave={onSave}
            onTest={onTest}
            onCancel={onCancelEdit}
            onToggleEdit={onEnterEditMode}
            onDuplicate={onDuplicate}
            onExport={onExport}
            onImport={onImport}
            saveText={isCreate ? 'Create Event Rule' : 'Save Changes'}
            editText="Edit Integration"
            testText="Test Event Rule"
            testDisabledTooltip="Enable the event rule to test it"
            testEnabledTooltip="Send a test event to this event rule"
            spacing={spacing}
            colors={colors}
            size="large"
          />
        ) : undefined
      }
    />
  );
};
