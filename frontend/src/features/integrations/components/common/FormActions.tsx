import { Button, Space, Tooltip } from 'antd';
import {
  SaveOutlined,
  CloseOutlined,
  EditOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  DownloadOutlined,
  UploadOutlined
} from '@ant-design/icons';
import { spacingToNumber } from '../../../../design-system/utils';

export interface FormActionsProps {
  /**
   * Mode of the form: create, edit, or view
   */
  mode: 'create' | 'edit' | 'view';

  /**
   * Whether the form is currently in edit mode (for view mode only)
   */
  isEditMode?: boolean;

  /**
   * Whether the form is currently saving
   */
  isSaving?: boolean;

  /**
   * Whether the entity is active (for enable/disable toggle)
   */
  isActive?: boolean;

  /**
   * Whether the test button should be shown
   */
  canTest?: boolean;

  /**
   * Whether the save button should be disabled
   */
  canSave?: boolean;

  /**
   * Whether to show the duplicate button
   */
  canDuplicate?: boolean;

  /**
   * Whether to show the export button
   */
  canExport?: boolean;

  /**
   * Whether to show the import button
   */
  canImport?: boolean;

  /**
   * Save button callback
   */
  onSave: () => void;

  /**
   * Test button callback
   */
  onTest?: () => void;

  /**
   * Cancel button callback
   */
  onCancel: () => void;

  /**
   * Toggle edit mode callback (for view mode)
   */
  onToggleEdit?: () => void;

  /**
   * Toggle active state callback
   */
  onToggleActive?: (active: boolean) => void;

  /**
   * Duplicate button callback
   */
  onDuplicate?: () => void;

  /**
   * Export button callback
   */
  onExport?: () => void;

  /**
   * Import button callback
   */
  onImport?: () => void;

  /**
   * Custom text for save button
   */
  saveText?: string;

  /**
   * Custom text for cancel button
   */
  cancelText?: string;

  /**
   * Custom text for edit button
   */
  editText?: string;

  /**
   * Custom text for test button
   */
  testText?: string;

  /**
   * Custom text for duplicate button
   */
  duplicateText?: string;

  /**
   * Custom text for export button
   */
  exportText?: string;

  /**
   * Custom text for import button
   */
  importText?: string;

  /**
   * Tooltip text for disabled test button
   */
  testDisabledTooltip?: string;

  /**
   * Tooltip text for enabled test button
   */
  testEnabledTooltip?: string;

  /**
   * Design tokens
   */
  spacing: any;

  /**
   * Design tokens - colors
   */
  colors: any;

  /**
   * Size of the buttons
   */
  size?: 'small' | 'middle' | 'large';
}

/**
 * Reusable form action buttons component that supports multiple modes and states.
 *
 * Usage:
 * ```tsx
 * <FormActions
 *   mode="edit"
 *   isSaving={false}
 *   canTest={true}
 *   onSave={handleSave}
 *   onTest={handleTest}
 *   onCancel={handleCancel}
 *   spacing={spacing}
 *   colors={colors}
 * />
 * ```
 */
export const FormActions = ({
  mode,
  isEditMode = false,
  isSaving = false,
  isActive = true,
  canTest = false,
  canSave = true,
  canDuplicate = false,
  canExport = false,
  canImport = false,
  onSave,
  onTest,
  onCancel,
  onToggleEdit,
  onToggleActive,
  onDuplicate,
  onExport,
  onImport,
  saveText,
  cancelText,
  editText,
  testText,
  duplicateText,
  exportText,
  importText,
  testDisabledTooltip,
  testEnabledTooltip,
  spacing,
  colors,
  size = 'large'
}: FormActionsProps) => {
  // View mode - Show Test, Export, Duplicate, and Edit buttons
  if (mode === 'view' && !isEditMode) {
    return (
      <Space size={spacingToNumber(spacing['2'])}>
        {canTest && onTest && (
          <Tooltip
            title={
              isActive === false
                ? (testDisabledTooltip || "Enable the entity to test it")
                : (testEnabledTooltip || "Send a test event")
            }
          >
            <Button
              onClick={onTest}
              disabled={isActive === false}
              icon={<ThunderboltOutlined />}
              size={size}
            >
              {testText || 'Test'}
            </Button>
          </Tooltip>
        )}
        {canExport && onExport && (
          <Button
            onClick={onExport}
            icon={<DownloadOutlined />}
            size={size}
          >
            {exportText || 'Export'}
          </Button>
        )}
        {canDuplicate && onDuplicate && (
          <Button
            onClick={onDuplicate}
            icon={<CopyOutlined />}
            size={size}
          >
            {duplicateText || 'Duplicate'}
          </Button>
        )}
        {onToggleEdit && (
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={onToggleEdit}
            size={size}
          >
            {editText || 'Edit'}
          </Button>
        )}
      </Space>
    );
  }

  // Edit mode (when in view mode but editing) - Show Save and Cancel buttons
  if (mode === 'view' && isEditMode) {
    return (
      <Space size={spacingToNumber(spacing['2'])}>
        <Button
          icon={<CloseOutlined />}
          onClick={onCancel}
          size={size}
        >
          {cancelText || 'Cancel'}
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSave}
          loading={isSaving}
          disabled={isSaving || !canSave}
          size={size}
        >
          {saveText || 'Save Changes'}
        </Button>
      </Space>
    );
  }

  // Edit mode (dedicated edit route) - Show Save and Cancel buttons
  if (mode === 'edit') {
    return (
      <Space size={spacingToNumber(spacing['2'])}>
        <Button
          icon={<CloseOutlined />}
          onClick={onCancel}
          size={size}
        >
          {cancelText || 'Cancel'}
        </Button>
        {canTest && onTest && (
          <Tooltip
            title={
              !canSave
                ? (testDisabledTooltip || "Fix validation errors before testing")
                : (testEnabledTooltip || "Send a test event")
            }
          >
            <Button
              onClick={onTest}
              disabled={!canSave}
              icon={<ThunderboltOutlined />}
              size={size}
            >
              {testText || 'Test'}
            </Button>
          </Tooltip>
        )}
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSave}
          loading={isSaving}
          disabled={isSaving || !canSave}
          size={size}
        >
          {saveText || 'Save Changes'}
        </Button>
      </Space>
    );
  }

  // Create mode - Show Import (optional), Cancel, and Create buttons
  if (mode === 'create') {
    return (
      <Space size={spacingToNumber(spacing['2'])}>
        {canImport && onImport && (
          <Button
            onClick={onImport}
            icon={<UploadOutlined />}
            size={size}
          >
            {importText || 'Import Config'}
          </Button>
        )}
        <Button
          onClick={onCancel}
          type="text"
          size={size}
        >
          {cancelText || 'Cancel'}
        </Button>
        <Button
          type="primary"
          onClick={onSave}
          loading={isSaving}
          disabled={isSaving || !canSave}
          size={size}
        >
          {saveText || 'Create'}
        </Button>
      </Space>
    );
  }

  // Fallback - shouldn't happen
  return null;
};
