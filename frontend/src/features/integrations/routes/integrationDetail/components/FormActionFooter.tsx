import { FormActions } from '../../../components/common';
import { spacingToNumber, withAlpha, cssVar } from '../../../../../design-system/utils';

interface FormActionFooterProps {
  visible: boolean;
  isCreate: boolean;
  isSaving: boolean;
  isActiveValue?: boolean;
  canTest: boolean;
  canSave: boolean;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  saveText: string;
  testText: string;
  testDisabledTooltip: string;
  testEnabledTooltip: string;
  spacing: Record<string, string>;
  token: { colorBorderSecondary: string; colorBgBase: string };
  colors: { neutral: Record<number, string> };
}

export const FormActionFooter = ({
  visible,
  isCreate,
  isSaving,
  isActiveValue,
  canTest,
  canSave,
  onSave,
  onTest,
  onCancel,
  saveText,
  testText,
  testDisabledTooltip,
  testEnabledTooltip,
  spacing,
  colors
}: FormActionFooterProps) => {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: spacingToNumber(spacing[2]),
        padding: `${spacing[3]} 0`,
        borderTop: `1px solid ${cssVar.border.default}`,
        background: cssVar.bg.base,
        boxShadow: `0 -8px 18px ${withAlpha(colors.neutral[900], 0.08)}`
      }}
    >
      <FormActions
        mode={isCreate ? 'create' : 'edit'}
        isSaving={isSaving}
        isActive={isActiveValue}
        canTest={canTest}
        canSave={canSave}
        onSave={onSave}
        onTest={onTest}
        onCancel={onCancel}
        saveText={saveText}
        testText={testText}
        testDisabledTooltip={testDisabledTooltip}
        testEnabledTooltip={testEnabledTooltip}
        spacing={spacing}
        colors={colors}
        size="large"
      />
    </div>
  );
};
