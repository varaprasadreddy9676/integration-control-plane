import type { TabsProps } from 'antd';
import type { ReactNode } from 'react';
import { Form, Space, Card, Alert, Divider, Typography, Tag } from 'antd';
import { ApiOutlined, LockOutlined, ThunderboltOutlined, ClockCircleOutlined, CodeOutlined, CheckCircleOutlined, EyeOutlined } from '@ant-design/icons';

const { Text } = Typography;
import { ConfigurationPanelContent } from './ConfigurationPanel';
import { AuthenticationPanelContent } from './AuthenticationPanel';
import { MultiActionHeader } from './MultiActionHeader';
import { MultiActionList } from './MultiActionList';
import { DeliveryPanel } from './DeliveryPanel';
import { TransformationPanelContent } from './TransformationPanel';
import { cssVar } from '../../../../../design-system/utils';

export interface IntegrationSectionsContentProps {
  form: any;
  tenant: any;
  eventTypes: any[];
  uiConfig: any;
  isMultiAction: boolean;
  isCreate: boolean;
  isEditMode: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedEntityRids?: any[];
  actionsCount: number;
  existingActionsCount: number;
  selectedEventTypeData: any;
  availableFields: any[];
  spacing: Record<string, string>;
  token: any;
  colors: any;
  loadCleverTapTemplate: () => void;
  multiActionValidationErrors: string[];
  formatScriptForDisplay: (script?: string) => string;
  selectedAuthType?: string;
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  transformationTab: 'SIMPLE' | 'SCRIPT';
  selectedEventType?: string;
  mappingState: { mappings: any[]; staticFields: any[] };
  scriptValue: string;
  lastPreviewMeta?: { durationMs?: number; status?: number };
  tagTone: (base: string) => any;
  onPreview: () => void;
  onOpenDesigner: () => void;
  isReadOnly?: boolean;
  isLoading?: boolean;
  integrationId?: string;
  onSave?: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  isActiveValue?: boolean;
}

export const buildIntegrationSectionItems = ({
  form,
  tenant,
  eventTypes,
  uiConfig,
  isMultiAction,
  isCreate,
  isEditMode,
  eventTypesLoading,
  scopeValue,
  excludedEntityRids,
  actionsCount,
  existingActionsCount,
  selectedEventTypeData,
  availableFields,
  spacing,
  token,
  colors,
  loadCleverTapTemplate,
  multiActionValidationErrors,
  formatScriptForDisplay,
  selectedAuthType,
  deliveryModeValue,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  transformationTab,
  selectedEventType,
  mappingState,
  scriptValue,
  lastPreviewMeta,
  tagTone,
  onPreview,
  onOpenDesigner,
  isReadOnly = false,
  isLoading = false,
  integrationId,
  onSave,
  onCancel,
  isSaving = false,
  isActiveValue
}: IntegrationSectionsContentProps): TabsProps['items'] => {
  const wrapContent = (content: ReactNode) => (
    <fieldset disabled={isReadOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
      <Card style={{ marginTop: spacing[2] }} size="small">
        {content}
      </Card>
    </fieldset>
  );

  // Helper to check if a tab is complete
  const isTabComplete = (tabKey: string): boolean => {
    const values = form.getFieldsValue();

    switch (tabKey) {
      case 'configuration':
        // For multi-action integrations, targetUrl is optional (can be defined at action level)
        // For single-action integrations, targetUrl is required
        if (isMultiAction) {
          return !!(values.name && values.eventType);
        }
        return !!(values.name && values.eventType && values.targetUrl);
      case 'authentication':
        return true; // Auth is optional
      case 'delivery':
        return true; // Always has a delivery mode
      case 'transformation':
        return true; // Transformation is optional
      case 'multiAction':
        return true; // Multi-action management
      default:
        return false;
    }
  };

  // Check if configuration tab is complete (required for all other tabs)
  const configComplete = isTabComplete('configuration');

  const items: TabsProps['items'] = [
    {
      key: 'configuration',
      label: (
        <Space size={6}>
          <ApiOutlined />
          Basic Info
          {configComplete && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: false, // First tab always enabled
      children: wrapContent(
        <ConfigurationPanelContent
          form={form}
          eventTypes={eventTypes}
          uiConfig={uiConfig}
          tenant={tenant}
          isMultiAction={isMultiAction}
          eventTypesLoading={eventTypesLoading}
          scopeValue={scopeValue}
          excludedEntityRids={excludedEntityRids}
          spacing={spacing}
          token={token}
          colors={colors}
          isLoading={isLoading}
        />
      )
    }
  ];

  if (isMultiAction) {
    items.push({
      key: 'multiAction',
      label: (
        <Space size={6}>
          <ThunderboltOutlined />
          Multi-Action
          {isTabComplete('multiAction') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <MultiActionList
          form={form}
          isCreate={isCreate}
          isEditMode={isEditMode}
          isMultiAction={isMultiAction}
          actionsCount={actionsCount}
          existingActionsCount={existingActionsCount}
          uiConfig={uiConfig}
          selectedEventTypeData={selectedEventTypeData}
          availableFields={availableFields}
          spacing={spacing}
          token={token}
          colors={colors}
          loadCleverTapTemplate={loadCleverTapTemplate}
          multiActionValidationErrors={multiActionValidationErrors}
          formatScriptForDisplay={formatScriptForDisplay}
        />
      )
    });
  }

  items.push(
    {
      key: 'authentication',
      label: (
        <Space size={6}>
          <LockOutlined />
          Authentication
          {isTabComplete('authentication') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <AuthenticationPanelContent
          form={form}
          uiConfig={uiConfig}
          selectedAuthType={selectedAuthType}
          isMultiAction={isMultiAction}
          spacing={spacing}
          colors={colors}
          isLoading={isLoading}
          currentEventType={selectedEventType}
        />
      )
    },
    {
      key: 'delivery',
      label: (
        <Space size={6}>
          <ClockCircleOutlined />
          Delivery
          {isTabComplete('delivery') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <DeliveryPanel
          deliveryModeValue={deliveryModeValue}
          uiConfig={uiConfig}
          schedulingScriptValidation={schedulingScriptValidation}
          isValidatingScript={isValidatingScript}
          onValidateScript={onValidateScript}
          onCopyExampleScript={onCopyExampleScript}
          onValidationClose={onValidationClose}
          spacing={spacing}
          token={token}
          colors={colors}
          form={form}
          currentEventType={selectedEventType}
          isLoading={isLoading}
          integrationId={integrationId}
        />
      )
    }
  );

  if (!isMultiAction) {
    items.push({
      key: 'transformation',
      label: (
        <Space size={6}>
          <CodeOutlined />
          Transformation
          {isTabComplete('transformation') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <TransformationPanelContent
          isCreate={isCreate}
          isEditMode={isEditMode}
          transformationTab={transformationTab}
          selectedEventType={selectedEventType}
          mappingState={mappingState}
          scriptValue={scriptValue}
          lastPreviewMeta={lastPreviewMeta}
          spacing={spacing}
          token={token}
          colors={colors}
          tagTone={tagTone}
          onPreview={onPreview}
          onOpenDesigner={onOpenDesigner}
          formatScriptForDisplay={formatScriptForDisplay}
          isLoading={isLoading}
        />
      )
    });
  }

  // Add Review tab for create/edit mode
  if ((isCreate || isEditMode) && onSave && onCancel) {
    const values = form.getFieldsValue();
    const allTabsComplete = configComplete && isTabComplete('authentication') && isTabComplete('delivery');

    items.push({
      key: 'review',
      label: (
        <Space size={6}>
          <EyeOutlined />
          Review & Submit
          {allTabsComplete && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Review Your Configuration"
            description="Please review all settings before saving the event rule. You can click on any tab above to make changes."
          />

          {/* Basic Information Summary */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
              <ApiOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
              <Text strong style={{ fontSize: 16 }}>Basic Information</Text>
            </div>
            <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Rule Name:</Text>
                <Text strong>{values.name || <Text type="secondary" style={{ color: cssVar.text.secondary }}>Not set</Text>}</Text>
              </div>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Event Type:</Text>
                <Text strong><code>{values.eventType || <Text type="secondary" style={{ color: cssVar.text.secondary }}>Not set</Text>}</code></Text>
              </div>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Target URL:</Text>
                <Text strong>{values.targetUrl || <Text type="secondary" style={{ color: cssVar.text.secondary }}>Not set</Text>}</Text>
              </div>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>HTTP Method:</Text>
                <Tag color="blue">{values.httpMethod || 'POST'}</Tag>
              </div>
              {values.scope && (
                <div style={{ display: 'flex', gap: spacing[2] }}>
                  <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Scope:</Text>
                  <Tag>{values.scope === 'GLOBAL' ? 'All Tenants' : 'Current Tenant'}</Tag>
                </div>
              )}
            </Space>
          </div>

          <Divider style={{ margin: 0 }} />

          {/* Multi-Action Summary */}
          {isMultiAction && (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                  <ThunderboltOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                  <Text strong style={{ fontSize: 16 }}>Multi-Action Configuration</Text>
                </div>
                <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                  <div style={{ display: 'flex', gap: spacing[2] }}>
                    <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Actions Configured:</Text>
                    <Text strong>{actionsCount} action{actionsCount !== 1 ? 's' : ''}</Text>
                  </div>
                </Space>
              </div>
              <Divider style={{ margin: 0 }} />
            </>
          )}

          {/* Authentication Summary */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
              <LockOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
              <Text strong style={{ fontSize: 16 }}>Authentication</Text>
            </div>
            <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Auth Type:</Text>
                <Tag color={values.authType === 'NONE' ? 'default' : 'blue'}>
                  {values.authType || 'NONE'}
                </Tag>
              </div>
            </Space>
          </div>

          <Divider style={{ margin: 0 }} />

          {/* Delivery Mode Summary */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
              <ClockCircleOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
              <Text strong style={{ fontSize: 16 }}>Delivery Mode</Text>
            </div>
            <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Mode:</Text>
                <Tag color={
                  deliveryModeValue === 'IMMEDIATE' ? 'green' :
                  deliveryModeValue === 'DELAYED' ? 'orange' :
                  deliveryModeValue === 'RECURRING' ? 'purple' : 'default'
                }>
                  {deliveryModeValue || 'IMMEDIATE'}
                </Tag>
              </div>
              {deliveryModeValue === 'DELAYED' && values.schedulingScript && (
                <div style={{ display: 'flex', gap: spacing[2] }}>
                  <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Scheduling Script:</Text>
                  <Text type="secondary" style={{ color: cssVar.text.secondary }}>Configured</Text>
                </div>
              )}
              {deliveryModeValue === 'RECURRING' && values.schedulingScript && (
                <div style={{ display: 'flex', gap: spacing[2] }}>
                  <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Recurring Script:</Text>
                  <Text type="secondary" style={{ color: cssVar.text.secondary }}>Configured</Text>
                </div>
              )}
            </Space>
          </div>

          {/* Transformation Summary */}
          {!isMultiAction && (
            <>
              <Divider style={{ margin: 0 }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                  <CodeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                  <Text strong style={{ fontSize: 16 }}>Transformation</Text>
                </div>
                <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                  <div style={{ display: 'flex', gap: spacing[2] }}>
                    <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Mode:</Text>
                    <Tag>{transformationTab === 'SIMPLE' ? 'Field Mapping' : 'JavaScript Transform'}</Tag>
                  </div>
                  {transformationTab === 'SIMPLE' && mappingState && (
                    <div style={{ display: 'flex', gap: spacing[2] }}>
                      <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Mappings:</Text>
                      <Text strong>
                        {mappingState.mappings?.length || 0} field{mappingState.mappings?.length !== 1 ? 's' : ''} mapped,{' '}
                        {mappingState.staticFields?.length || 0} static field{mappingState.staticFields?.length !== 1 ? 's' : ''}
                      </Text>
                    </div>
                  )}
                  {transformationTab === 'SCRIPT' && scriptValue && (
                    <div style={{ display: 'flex', gap: spacing[2] }}>
                      <Text type="secondary" style={{ minWidth: 150, color: cssVar.text.secondary }}>Script:</Text>
                      <Text type="secondary" style={{ color: cssVar.text.secondary }}>Configured ({scriptValue.split('\n').length} lines)</Text>
                    </div>
                  )}
                </Space>
              </div>
            </>
          )}
        </Space>
      )
    });
  }

  return items;
};
