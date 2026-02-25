import { Space } from 'antd';
import type { ReactNode } from 'react';
import type { TabsProps } from 'antd';
import { spacingToNumber } from '../../../../../design-system/utils';
import { DeliveryModeSelector } from './DeliveryModeSelector';
import { FormActionFooter } from './FormActionFooter';
import { IntegrationSections } from './IntegrationSections';
import { RuleStatusBar } from './RuleStatusBar';

interface IntegrationFormBodyProps {
  isCreate: boolean;
  isEditMode: boolean;
  isMultiAction: boolean;
  isSaving: boolean;
  isActiveValue?: boolean;
  canTest: boolean;
  canSave: boolean;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  deliveryModeChoice: 'single' | 'multi';
  onChangeDeliveryMode: (value: 'single' | 'multi') => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  activePanels: string[];
  onPanelsChange: (keys: string[]) => void;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  saveText: string;
  testText: string;
  formAlerts: ReactNode;
  sectionItems: TabsProps['items'];

  // RuleStatusBar props
  missingRequiredCount?: number;
  validationErrors?: string[];
  // Activate action (shown in footer)
  onActivate?: () => void;
}

export const IntegrationFormBody = ({
  isCreate,
  isEditMode,
  isMultiAction,
  isSaving,
  isActiveValue,
  canTest,
  canSave,
  spacing,
  token,
  colors,
  deliveryModeChoice,
  onChangeDeliveryMode,
  onExpandAll,
  onCollapseAll,
  activePanels,
  onPanelsChange,
  onSave,
  onTest,
  onCancel,
  saveText,
  testText,
  formAlerts,
  sectionItems,
  missingRequiredCount = 0,
  validationErrors = [],
  onActivate
}: IntegrationFormBodyProps) => {
  // Show status bar only in create or edit mode
  const showStatusBar = isCreate || isEditMode;
  const isValid = canSave && missingRequiredCount === 0 && validationErrors.length === 0;

  // Only show activate button when creating OR when editing an inactive integration
  // Don't show it when editing an already active integration (no need to activate what's already active)
  const shouldShowActivate = isCreate || !isActiveValue;

  return (
    <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
      {formAlerts}

      {/* Status Bar - Sticky status indicator only (no action buttons) */}
      {showStatusBar && (
        <RuleStatusBar
          isCreate={isCreate}
          isActive={isActiveValue}
          isDraft={!isActiveValue}
          missingRequiredCount={missingRequiredCount}
          validationErrors={validationErrors}
          isValid={isValid}
        />
      )}

      {(isCreate || isEditMode) && (
        <DeliveryModeSelector
          value={deliveryModeChoice}
          onChange={onChangeDeliveryMode}
          spacing={spacing}
          token={token}
          colors={colors}
        />
      )}

      <IntegrationSections activePanels={activePanels} onChange={onPanelsChange} items={sectionItems} spacing={spacing} />

      <FormActionFooter
        visible={isCreate || isEditMode}
        isCreate={isCreate}
        isSaving={isSaving}
        isActiveValue={isActiveValue}
        canTest={canTest}
        canSave={canSave}
        onSave={onSave}
        onTest={onTest}
        onCancel={onCancel}
        saveText={saveText}
        testText={testText}
        testDisabledTooltip="Fix validation errors before testing"
        testEnabledTooltip="Send a test event to this event rule"
        spacing={spacing}
        token={token}
        colors={colors}
        onActivate={shouldShowActivate ? onActivate : undefined}
        showActivate={shouldShowActivate}
      />
    </Space>
  );
};
